import type Database from 'better-sqlite3'
import type { Extraction, FollowUp, Observation } from '../types.js'
import { findOrCreateCustomer, getChatSuggestions, getModalitySuggestions } from '../store/db.js'
import { groundExtraction, handleObservation, normalizeModality, saveObservation, type AgentReply } from './agent.js'
import { matchDataset, type DatasetMatch } from './dataset-match.js'
import { detectLang, type Lang, msgDraftDiscarded, msgNoPending, msgNeedLocation, msgTooLong, msgGreeting, msgNoEquipmentGuidance, msgSimpleResponseGuidance, msgValueSuggestion, msgValueNotInDataset } from './i18n.js'

const hasText = (value?: string) => !!value?.trim() && !/^(unknown|unspecified|not known|desconocido)$/i.test(value.trim())

const INTENT_PATTERNS: Array<{ intent: FollowUp['intent']; pattern: RegExp }> = [
  { intent: 'quantity', pattern: /\b(quantity|how many|cantidad|quantidade|quantité|combien|anzahl|wie viele|quantità|quanti|hoeveel|aantal)\b/i },
  { intent: 'brand', pattern: /\b(brand|manufacturer|marca|fabricante|marque|fabricant|marke|hersteller|produttore|merk|fabrikant)\b/i },
  { intent: 'model', pattern: /\b(model|modelo|modèle|modell|modello)\b/i },
  { intent: 'age', pattern: /\b(age|old|years|antigüedad|antiguedad|años|antiguidade|anos|ancienneté|ans|alter|jahre|età|anni|leeftijd|jaar|oud)\b/i },
  { intent: 'customer', pattern: /\b(hospital|clinic|cl[ií]nica|hôpital|hopital|krankenhaus|ospedale|ziekenhuis)\b/i },
]

/** Returns the single intent a follow-up question is about, or undefined when ambiguous. */
export function detectFollowUpIntent(question: string): FollowUp['intent'] | undefined {
  const matches = INTENT_PATTERNS.filter(({ pattern }) => pattern.test(question))
  return matches.length === 1 ? matches[0]!.intent : undefined
}

const UNKNOWN_ANSWER = /^(?:no|nope|nah|unknown|unspecified|desconocido|desconocida|no s[eé]|no lo s[eé]|ni idea|no idea|sin datos?|sin informaci[oó]n|idk|i\s*don'?t know|not sure|ns\/nc|n\/a|no aplica|keine ahnung|je ne sais pas|non lo so|geen idee|n[aã]o sei)\.?$/i

/** True when the answer means "I don't know" instead of a dataset value. */
export function isUnknownAnswer(answer: string): boolean {
  return UNKNOWN_ANSWER.test(answer.trim())
}

/** Preserve facts already extracted when a small model omits them on a later turn. */
export function mergeExtraction(previous: Extraction | undefined, next: Extraction): Extraction {
  if (!previous) return structuredClone(next)
  const customer = { ...previous.customer }
  for (const [key, value] of Object.entries(next.customer ?? {})) {
    if (hasText(value)) customer[key as keyof NonNullable<Extraction['customer']>] = value
  }
  const equipment = previous.equipment.map(row => ({ ...row }))
  for (const nextRow of next.equipment) {
    const modality = normalizeModality(nextRow.modality)
    const matches = equipment.map((row, index) => ({ row, index }))
      .filter(({ row }) => modality && normalizeModality(row.modality) === modality)
    let index = -1
    if (matches.length === 1) index = matches[0]!.index
    else if (hasText(nextRow.model)) {
      index = matches.find(({ row }) => hasText(row.model) && row.model!.trim().toLowerCase() === nextRow.model!.trim().toLowerCase())?.index ?? -1
    }
    if (index < 0) { equipment.push({ ...nextRow }); continue }
    const merged = { ...equipment[index] }
    for (const [key, value] of Object.entries(nextRow)) {
      if (typeof value === 'string' ? hasText(value) : value !== undefined) {
        Object.assign(merged, { [key]: value })
      }
    }
    if (merged.quantity === undefined && equipment[index]!.quantity !== undefined) {
      merged.quantity = equipment[index]!.quantity
    }
    equipment[index] = merged
  }
  return { customer, equipment, missingFields: next.missingFields }
}

function applyFollowUpAnswer(extraction: Extraction, question: string | undefined, answer: string, modalityHint?: string): Extraction {
  if (!question) return extraction
  const intent = detectFollowUpIntent(question)
  // Combined free-text questions still need the extractor to split the answer.
  if (!intent) return extraction
  if (intent === 'customer') {
    if (isUnknownAnswer(answer)) return extraction
    const name = answer.split(',').map(part => part.trim()).filter(Boolean)[0]
    if (!name) return extraction
    return { ...extraction, customer: { ...extraction.customer, name } }
  }
  const modality = normalizeModality(modalityHint) ?? normalizeModality(/\(([^)]+)\)/.exec(question)?.[1])
  const rows = extraction.equipment.filter(row => !modality || normalizeModality(row.modality) === modality)
  if (!rows.length) return extraction
  for (const row of rows) {
    if (intent === 'quantity') {
      const number = Number(/\b([1-9][0-9]*)\b/.exec(answer)?.[1])
      if (Number.isSafeInteger(number) && number > 0) row.quantity = number
    } else if (intent === 'brand') {
      if (!isUnknownAnswer(answer)) row.brand = answer.trim()
    } else if (intent === 'model') {
      if (!isUnknownAnswer(answer)) row.model = answer.trim()
    } else if (intent === 'age') {
      const number = Number(/\b([0-9]{1,3})\b/.exec(answer)?.[1])
      if (Number.isSafeInteger(number)) {
        row.ageMin = number
        row.ageMax = /\b(?:about|around|approximately|aproximadamente|circa|ungefähr|ongeveer)\b/i.test(answer) ? number + 2 : number
        row.ageQualitative = undefined
      } else if (!isUnknownAnswer(answer)) {
        row.ageQualitative = answer.trim()
      }
    }
  }
  return extraction
}

/** Context the web client sends back with a follow-up answer. */
export interface TurnMeta {
  intent?: FollowUp['intent']
  modality?: string
}

const VALIDATED_INTENTS: ReadonlySet<FollowUp['intent']> = new Set(['brand', 'model', 'customer'])

export class Conversation {
  private transcript = ''
  private draft?: Observation
  private extraction?: Extraction
  private duplicateWarning = false
  private detectedLang: Lang = 'en'
  private lockedLang?: Lang
  private declined = new Set<string>()
  constructor(private db: Database.Database, private extract: (text: string) => Promise<Extraction>,
    private observer: string, private autoSave = false, private source: Observation['source'] = 'Text') {}

  setLockedLanguage(lang: Lang) {
    this.lockedLang = lang
    this.detectedLang = lang
  }

  /** Candidate dataset values for a validatable follow-up answer. */
  private datasetCandidates(intent: FollowUp['intent'], modality?: string): string[] | undefined {
    if (intent === 'brand' || intent === 'model') {
      if (modality) {
        const filtered = getModalitySuggestions(this.db, modality)
        const values = intent === 'brand' ? filtered.brands : filtered.models
        if (values.length) return values
      }
      const all = getChatSuggestions(this.db)
      return intent === 'brand' ? all.brands : all.models
    }
    if (intent === 'customer') return getChatSuggestions(this.db).hospitals
    return undefined
  }

  /**
   * Keeps free-typed answers inside the installed-base vocabulary. Returns the
   * dataset match for brand/model/hospital answers, or undefined when there is
   * nothing to validate against (fresh install) or the user said "unknown".
   */
  private matchDatasetAnswer(intent: FollowUp['intent'], answer: string, modality?: string): DatasetMatch | undefined {
    if (!VALIDATED_INTENTS.has(intent) || isUnknownAnswer(answer)) return undefined
    const candidates = this.datasetCandidates(intent, modality)
    if (!candidates?.length) return undefined
    // Hospital answers often carry ", City, Country" after the name; validate the name only.
    const value = intent === 'customer' ? answer.split(',')[0]!.trim() : answer
    return matchDataset(value, candidates)
  }

  /**
   * Keeps the model's own extraction inside the installed-base vocabulary:
   * off-dataset brands/models are dropped (so the agent asks again with valid
   * options) and near matches are rewritten to the canonical spelling. Customer
   * names are only canonicalized, never dropped, so new hospitals can be added.
   */
  private alignWithDataset(extraction: Extraction): void {
    const { brands, models, hospitals } = getChatSuggestions(this.db)
    for (const row of extraction.equipment) {
      if (hasText(row.brand) && brands.length) {
        const match = matchDataset(row.brand!, brands)
        row.brand = match?.status === 'exact' || match?.status === 'close'
          ? (match.canonical ?? match.suggestions[0])
          : undefined
      }
      if (hasText(row.model) && models.length) {
        const match = matchDataset(row.model!, models)
        row.model = match?.status === 'exact' || match?.status === 'close'
          ? (match.canonical ?? match.suggestions[0])
          : undefined
      }
    }
    const name = extraction.customer?.name
    if (hasText(name) && hospitals.length) {
      const match = matchDataset(name!, hospitals)
      if (match?.status === 'exact' || match?.status === 'close') {
        extraction.customer!.name = match.canonical ?? match.suggestions[0]
      }
    }
  }

  async turn(message: string, question?: string, langOverride?: Lang, meta?: TurnMeta): Promise<AgentReply> {
    // Use locked language if set, otherwise detect from input
    if (this.lockedLang) {
      this.detectedLang = this.lockedLang
    } else if (langOverride) {
      this.detectedLang = langOverride
    } else if (!this.transcript || message.length > 10) {
      this.detectedLang = detectLang(message)
    }
    const lang = this.detectedLang
    const command = message.trim().toLowerCase()
    if (['skip', 'cancel', '/new', 'omitir', 'cancelar'].includes(command)) {
      this.reset()
      return { message: msgDraftDiscarded(lang), followUps: [] }
    }
    if (['confirm', 'confirmar', 'save anyway', 'guardar de todos modos'].includes(command)) {
      if (!this.draft) return { message: msgNoPending(lang), followUps: [] }
      const force = ['save anyway', 'guardar de todos modos'].includes(command)
      const reply = saveObservation(this.db, this.draft, true, force && this.duplicateWarning)
      this.duplicateWarning = !!reply.duplicates?.length
      if (reply.saved) this.reset()
      return reply
    }
    // Handle greetings on first message
    if (!this.transcript && /^(hola|buenas|hi|hello|hey|olá|oi|bonjour|salut|hallo|ciao|hoi)\b/i.test(command)) {
      return { message: msgGreeting(lang), followUps: [] }
    }
    // Handle simple responses that need more context
    if (message.length < 15 && !question) {
      const isSimpleResponse = /^(no|sí|si|yes|non|ja|nee|niet|nein|não|nao|no sé|no se|idk|don't know|no lo sé|no lo se|¿\?|\?)$/i.test(command)
      if (isSimpleResponse && !this.draft) {
        return { message: msgSimpleResponseGuidance(lang), followUps: [] }
      }
    }
    const intent = meta?.intent ?? (question ? detectFollowUpIntent(question) : undefined)
    if (question && intent) {
      if (isUnknownAnswer(message)) {
        // Without a modality hint (CLI), decline the intent for every modality.
        this.declined.add(meta?.modality ? `${meta.modality}:${intent}` : intent)
      } else {
        const match = this.matchDatasetAnswer(intent, message, meta?.modality)
        if (match && match.status !== 'exact') {
          const best = match.suggestions[0]
          const value = intent === 'customer' ? message.split(',')[0]!.trim() : message
          return {
            message: match.status === 'close' && best ? msgValueSuggestion(best, lang) : msgValueNotInDataset(value, lang),
            followUps: [],
            suggestions: match.suggestions,
            suggestionQuestion: question,
            suggestionIntent: intent,
            suggestionModality: meta?.modality,
          }
        }
        if (match?.status === 'exact' && match.canonical) {
          const comma = intent === 'customer' ? message.indexOf(',') : -1
          message = comma >= 0 ? `${match.canonical}${message.slice(comma)}` : match.canonical
        }
      }
    }
    const transcript = [this.transcript, question ? `Follow-up: ${question}\nAnswer: ${message}` : message].filter(Boolean).join('\n')
    if (transcript.length > 16000) throw new Error(msgTooLong(lang))
    const merged = mergeExtraction(this.extraction, await this.extract(transcript))
    const extraction = groundExtraction(transcript, applyFollowUpAnswer(merged, question, message, meta?.modality))
    this.alignWithDataset(extraction)
    // Commit state only after extraction succeeds, so errors can be retried.
    this.transcript = transcript
    this.extraction = extraction
    this.draft = undefined
    this.duplicateWarning = false
    if (!extraction.customer?.name?.trim()) {
      return { message: msgNeedLocation(lang), followUps: [] }
    }
    const customer = findOrCreateCustomer(this.db, {
      name: extraction.customer.name.trim(), city: extraction.customer.city?.trim() || 'Unknown',
      country: extraction.customer.country?.trim() || 'Unknown', site: extraction.customer.site,
    })
    const reply = handleObservation({ db: this.db, extraction, customer, observer: this.observer,
      observedAt: new Date().toISOString(), rawInput: transcript, source: this.source, autoSave: this.autoSave, lang })
    // Never re-ask a question the user explicitly answered with "I don't know".
    reply.followUps = reply.followUps.filter(f =>
      !this.declined.has(f.intent) && !this.declined.has(`${f.modality ?? '*'}:${f.intent}`))
    this.draft = reply.observation?.equipment.length ? reply.observation : undefined
    this.duplicateWarning = !!reply.duplicates?.length
    if (reply.saved) this.reset()
    return reply
  }

  private reset() { this.transcript = ''; this.draft = undefined; this.extraction = undefined; this.duplicateWarning = false; this.declined.clear() }
}
