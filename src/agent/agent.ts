import Database from 'better-sqlite3'
import {
  observationsForCustomer,
  equipmentForObservation,
  insertObservation,
} from '../store/db.js'
import type {
  Confidence,
  Customer,
  EquipmentObservation,
  Extraction,
  FollowUp,
  Observation,
  Status,
} from '../types.js'
import {
  type Lang,
  detectLang,
  buildFollowUpQuestion,
  buildFollowUpReason,
  msgIdentifiedEquipment,
  msgFollowUpIntro,
  msgReadyToSave,
  msgNoEquipment,
  msgNoEquipmentGuidance,
  msgNeedLocation,
  msgNeedQuantity,
  msgSaved,
  msgAlreadySaved,
  msgDuplicateWarning,
  buildEquipmentSummary,
  buildCustomerLocation,
  modalityLabelPlural,
} from './i18n.js'

export interface AgentReply {
  message: string
  followUps: FollowUp[]
  observation?: Observation
  saved?: boolean
  duplicates?: DuplicateHit[]
  /** Dataset values offered as chips when a free-typed answer did not match. */
  suggestions?: string[]
  /** Original question the suggestions answer, so a chip click resolves the right field. */
  suggestionQuestion?: string
  suggestionIntent?: FollowUp['intent']
  suggestionModality?: string
}

export interface DuplicateHit {
  existingObservationId: string
  customerId: string
  modality: string
  score: number
  reason: string
}

const MODALITY_SYNONYMS: Record<string, string> = {
  mr: 'MR',
  mri: 'MR',
  'magnetic resonance': 'MR',
  'magnetic resonance imaging': 'MR',
  resonance: 'MR',
  scanner: 'CT',
  'ct scanner': 'CT',
  ct: 'CT',
  ultrasound: 'Ultrasound',
  'ultra sound': 'Ultrasound',
  sonography: 'Ultrasound',
  sonographer: 'Ultrasound',
  echo: 'Ultrasound',
  xray: 'X-Ray',
  'x-ray': 'X-Ray',
  'patient monitor': 'Patient Monitoring',
  monitoring: 'Patient Monitoring',
  'patient monitoring': 'Patient Monitoring',
  'image guided therapy': 'Image Guided Therapy',
  resonancia: 'MR',
  resonador: 'MR',
  tomografia: 'CT',
  tomografo: 'CT',
  tac: 'CT',
  ecografia: 'Ultrasound',
  ecografo: 'Ultrasound',
}

function stripAccents(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

export function normalizeModality(raw?: string): string | undefined {
  if (!raw) return undefined
  const key = raw.toLowerCase().trim()
  if (MODALITY_SYNONYMS[key]) return MODALITY_SYNONYMS[key]
  const ascii = stripAccents(key)
  if (MODALITY_SYNONYMS[ascii]) return MODALITY_SYNONYMS[ascii]
  // Handle composite outputs like "MRI/Magnetic Resonance" or "CT scanner (2)".
  for (const sep of ['/', ',', '(', ';']) {
    const first = ascii.split(sep)[0]?.trim()
    if (first && MODALITY_SYNONYMS[first]) return MODALITY_SYNONYMS[first]
  }
  // Fuzzy containment: pick the first known modality present in the string.
  for (const [alias, canonical] of Object.entries(MODALITY_SYNONYMS)) {
    if (mentions(ascii, alias)) return canonical
  }
  return undefined
}

function mentions(text: string, alias: string): boolean {
  const escaped = stripAccents(alias).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp('(^|[^a-z0-9])' + escaped + '(?:e?s)?($|[^a-z0-9])', 'i').test(text)
}

/**
 * Anti-hallucination guard: a modality is kept only if the user's raw input
 * actually mentions it (via any synonym). Small local models sometimes invent
 * equipment that was never observed (e.g. adding an X-Ray to a report that
 * only mentioned MR + CT). True positives survive; invented rows are dropped.
 * Matching is accent-insensitive so "resonadores magneticos" keeps MR.
 */
export function filterModalitiesMentioned(rawInput: string, extraction: Extraction): Extraction {
  const q = stripAccents(rawInput.toLowerCase())
  const mentioned = new Set<string>()
  for (const [alias, canonical] of Object.entries(MODALITY_SYNONYMS)) {
    if (mentions(q, alias)) mentioned.add(canonical)
  }
  const kept = extraction.equipment.filter((e) => {
    const canonical = normalizeModality(e.modality)
    if (!canonical) return false
    // Trust explicitly-named modalities even without exact synonym match, and
    // keep rows whose modality is directly present in the input.
    return mentioned.has(canonical) || mentions(q, canonical)
  })
  return { ...extraction, equipment: kept }
}

const COUNT_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5,
  seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
}
const COUNT_TOKEN = `(?:[1-9][0-9]*|${Object.keys(COUNT_WORDS).join('|')})`
const isUnknown = (value?: string) => !value?.trim() || /^(unknown|unspecified|not known|desconocido)$/i.test(value.trim())

function groundCustomer(rawInput: string, extracted: Extraction['customer']): Extraction['customer'] {
  const candidates: Array<{ name: string; city: string; country: string }> = []
  const prosePatterns = [
    /\b(?:i['’]?m|i am)\s+at\s+(.{2,80}?)\s+in\s+([^,.\n]{2,60}),\s*([^.?!\n]{2,60}?)(?=[.?!\n]|$)/gi,
    /\b(?:estoy|me encuentro)\s+en\s+(.{2,80}?)\s+en\s+([^,.\n]{2,60}),\s*([^.?!\n]{2,60}?)(?=[.?!\n]|$)/gi,
  ]
  for (const pattern of prosePatterns) {
    for (const match of rawInput.matchAll(pattern)) {
      candidates.push({ name: match[1]!.trim(), city: match[2]!.trim(), country: match[3]!.trim() })
    }
  }
  for (const line of rawInput.split('\n')) {
    const answer = line.replace(/^Answer:\s*/i, '').trim()
    const comma = /^((?:hospital|clinic|cl[ií]nica)\b[^,.]{0,80}),\s*([^,.]{2,60}),\s*([^,.]{2,60})[.!]?$/i.exec(answer)
    const located = /^((?:hospital|clinic|cl[ií]nica)\b.{0,80}?)\s+(?:in|en)\s+([^,.]{2,60}),\s*([^,.]{2,60})[.!]?$/i.exec(answer)
    const match = comma ?? located
    if (match) candidates.push({ name: match[1]!.trim(), city: match[2]!.trim(), country: match[3]!.trim() })
  }
  const grounded = candidates.at(-1)
  return grounded ? { ...extracted, ...grounded } : extracted
}

/** Correct only explicit, unambiguous counts; a modality total must not be applied to each model row. */
export function groundExtraction(rawInput: string, extraction: Extraction): Extraction {
  const userText = rawInput.split('\n').filter(line => !line.startsWith('Follow-up:')).join('\n').toLowerCase()
  const filtered = filterModalitiesMentioned(userText, extraction)
  const customer = groundCustomer(rawInput, filtered.customer)
  const equipment = filtered.equipment.map(row => {
    const e = { ...row }
    const canonical = normalizeModality(e.modality)
    // A modality describes the kind of equipment, not its product model.
    if (e.model && MODALITY_SYNONYMS[e.model.trim().toLowerCase()]) e.model = undefined
    if (canonical && filtered.equipment.filter(other => normalizeModality(other.modality) === canonical).length === 1) {
      const aliases = Object.entries(MODALITY_SYNONYMS).filter(([, mod]) => mod === canonical).map(([alias]) => alias).sort((a, b) => b.length - a.length)
      const pattern = new RegExp(`\\b(${COUNT_TOKEN})\\s+(?:${aliases.join('|')})\\b`, 'gi')
      const counts: number[] = []
      let ambiguous = false
      for (const match of userText.matchAll(pattern)) {
        const prefix = userText.slice(0, match.index)
        if (/(?:not|no|at least|at most|between|or|over|under|about|around|approximately|up to|to|al menos|hasta|entre|o|model|modelo)\s*$/.test(prefix)
          || /[0-9][.,/-]$/.test(prefix)
          || /\b(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred(?: and)?|thousand|veinte|treinta|cuarenta|cincuenta|cien|ciento|mil)[ -]+$/.test(prefix)) { ambiguous = true; continue }
        const token = match[1]!.toLowerCase()
        counts.push(COUNT_WORDS[token] ?? Number(token))
      }
      // A later answer to a quantity question supersedes the original count.
      const quantityAnswers = [...rawInput.matchAll(new RegExp(`Follow-up: [^\\n]*(?:quantity|how many|cantidad)[^\\n]*\\(${canonical}\\)[^\\n]*\\nAnswer: ([^\\n]*)`, 'gi'))]
      const quantityAnswer = quantityAnswers.at(-1)
      const laterInput = quantityAnswer ? rawInput.slice(quantityAnswer.index! + quantityAnswer[0].length) : ''
      if (quantityAnswer && !pattern.test(laterInput) && !/\n(?:Answer: )?(?:actually|correction|instead|en realidad|correccion)\b/i.test(laterInput)) {
        const simpleAnswer = new RegExp(`^(${COUNT_TOKEN})(?:[ \\t]*(?:systems?|units?|equipos?))?[.!]?[ \\t]*$`, 'i').exec(quantityAnswer[1]!.trim())
        if (simpleAnswer) {
          const token = simpleAnswer[1]!.toLowerCase()
          e.quantity = COUNT_WORDS[token] ?? Number(token)
        }
      } else if (!quantityAnswer && !ambiguous && counts.length === 1 && !/\n(?:Answer: )?(?:actually|correction|instead|en realidad|correccion)\b/i.test(rawInput)) {
        e.quantity = counts[0]
      }
    }
    return e
  })
  return { ...filtered, customer, equipment }
}

/**
 * Converts the LLM Extraction into Observation rows, assigning per-equipment
 * Status/Confidence. Rules (from the brief's validation logic):
 *  - quantity provided → Report based; confidence reflects stated certainty
 *  - age qualitative → Estimated; unknown brand → Unknown
 *  - Confirmed only when the user explicitly confirms in the review step
 */
export function buildObservation(params: {
  extraction: Extraction
  customer: Customer
  observer: string
  observedAt: string
  rawInput: string
  source: Observation['source']
  statusOverride?: Status
}): Observation {
  const { extraction, customer, observer, observedAt, rawInput, source } = params
  const obsId = crypto.randomUUID()
  const equipment: EquipmentObservation[] = extraction.equipment
    .map((e, i) => {
      const modality = normalizeModality(e.modality)
      // Drop hallucinated/unrecognized modalities instead of persisting garbage.
      if (!modality) return null
      if (e.quantity === undefined || !Number.isSafeInteger(e.quantity) || e.quantity < 1) {
        throw new Error(`Quantity required for ${modality}`)
      }
      const certainty = e.certainty ?? 'Medium'
      const ageKnown = e.ageMin !== undefined || e.ageMax !== undefined || !!e.ageQualitative
      let status: Status = 'Reported'
      if (ageKnown) status = 'Estimated'
      if (params.statusOverride) status = params.statusOverride
      return {
        id: `${obsId}-EQ${i}`,
        observationId: obsId,
        customerId: customer.id,
        modality: modality as EquipmentObservation['modality'],
        quantity: e.quantity,
        brand: (e.brand ?? 'Unknown') as EquipmentObservation['brand'],
        model: (e.model ?? 'Unknown') as EquipmentObservation['model'],
        age: e.ageMin !== undefined || e.ageMax !== undefined || e.ageQualitative
          ? {
              min: e.ageMin,
              max: e.ageMax,
              qualitative: e.ageQualitative,
              installationYear:
                e.ageMin !== undefined
                  ? new Date(observedAt).getFullYear() - e.ageMin
                  : undefined,
            }
          : undefined,
        status,
        confidence: (certainty ?? 'Medium') as Confidence,
        notes: e.notes,
      }
    })
    .filter((e): e is NonNullable<typeof e> => e !== null)

  const observation: Observation = {
    id: obsId,
    observer,
    observedAt,
    rawInput,
    source,
    customerId: customer.id,
    equipment,
    overallConfidence: overallConfidence(equipment),
    status: params.statusOverride ?? (equipment.some((e) => e.status === 'Estimated') ? 'Estimated' : 'Reported'),
    reviewConfirmed: false,
    createdAt: new Date().toISOString(),
  }
  return observation
}

function overallConfidence(eq: EquipmentObservation[]): Confidence {
  const scores = { High: 3, Medium: 2, Low: 1 }
  const avg = eq.reduce((s, e) => s + scores[e.confidence], 0) / Math.max(eq.length, 1)
  if (avg >= 2.5) return 'High'
  if (avg >= 1.5) return 'Medium'
  return 'Low'
}

/**
 * Detects duplicates: same customer + modality + similar brand/age within a
 * sliding window. Returns candidates above a fuzzy threshold.
 */
export function detectDuplicates(
  db: Database.Database,
  observation: Observation,
): DuplicateHit[] {
  const existing = observationsForCustomer(db, observation.customerId).filter((o) => o.id !== observation.id)
  const hits: DuplicateHit[] = []
  for (const ex of existing) {
    const exEquipment = equipmentForObservation(db, ex.id)
    for (const exEq of exEquipment) {
      for (const newEq of observation.equipment) {
        if (normalizeModality(exEq.modality) !== normalizeModality(newEq.modality)) continue
        if (ex.customerId !== observation.customerId) continue

        let score = 0.5
        const reasons: string[] = []
        if (exEq.brand && exEq.brand !== 'Unknown' && newEq.brand && exEq.brand === newEq.brand) {
          score += 0.25
          reasons.push('same brand')
        }
        if (exEq.model && exEq.model !== 'Unknown' && newEq.model && exEq.model === newEq.model) {
          score += 0.15
          reasons.push('same model')
        }
        if (exEq.age?.min !== undefined && newEq.age?.min !== undefined) {
          const diff = Math.abs(exEq.age.min - newEq.age.min)
          if (diff <= 1) {
            score += 0.1
            reasons.push('similar age')
          }
        }
        if (ex.observedAt) {
          const days = (Date.parse(observation.observedAt) - Date.parse(ex.observedAt)) / 86400000
          if (days >= 0 && days <= 90) {
            score += 0.1
            reasons.push(`recent (${Math.round(days)}d apart)`)
          }
        }
        if (score >= 0.75) {
          hits.push({
            existingObservationId: ex.id,
            customerId: ex.customerId,
            modality: exEq.modality,
            score,
            reason: reasons.join(', '),
          })
        }
      }
    }
  }
  return hits
}

/** Builds natural follow-up questions for the most valuable missing data. */
export function planFollowUps(
  extraction: Extraction,
  lang: Lang = 'en',
  max = 3,
): FollowUp[] {
  const ups: FollowUp[] = []
  const missing = [...(extraction.missingFields ?? [])]
  for (const e of extraction.equipment) {
    if (e.quantity === undefined) missing.unshift({field: 'quantity', modality: e.modality})
    if (isUnknown(e.brand)) missing.push({field: 'brand', modality: e.modality})
    if (isUnknown(e.model)) missing.push({field: 'model', modality: e.modality})
    if (e.ageMin === undefined && e.ageMax === undefined && isUnknown(e.ageQualitative)) missing.push({field: 'age', modality: e.modality})
  }
  const seen = new Set<string>()
  for (const mf of missing) {
    if (ups.length >= max) break
    const field = mf.field.toLowerCase()
    let intent: FollowUp['intent'] = 'notes'
    if (field.includes('brand') || field.includes('manufacturer')) intent = 'brand'
    else if (field.includes('model')) intent = 'model'
    else if (field.includes('age') || field.includes('old')) intent = 'age'
    else if (field.includes('quant')) intent = 'quantity'
    else if (field.includes('customer') || field.includes('hospital')) intent = 'customer'
    else if (field.includes('city') || field.includes('country')) intent = 'location'
    const modality = normalizeModality(mf.modality)
    const rows = extraction.equipment.filter(e => !modality || normalizeModality(e.modality) === modality)
    if (field.includes('modality')) continue
    if (intent === 'customer' && isUnknown(extraction.customer?.name)) continue
    if (intent === 'location' && !isUnknown(extraction.customer?.city) && !isUnknown(extraction.customer?.country)) continue
    if (rows.length && ['quantity', 'brand', 'model', 'age'].includes(intent)) {
      const stillMissing = rows.some(e => intent === 'quantity' ? e.quantity === undefined
        : intent === 'brand' ? isUnknown(e.brand) : intent === 'model' ? isUnknown(e.model)
        : e.ageMin === undefined && e.ageMax === undefined && isUnknown(e.ageQualitative))
      if (!stillMissing) continue
    }
    const key = `${modality ?? ''}:${intent}`
    if (seen.has(key)) continue
    seen.add(key)
    const question = buildFollowUpQuestion(intent, mf.modality, lang)
    const reason = buildFollowUpReason(intent, lang)
    ups.push({
      question: reason ? `${question} (${reason})` : question,
      intent,
      modality: mf.modality,
    })
  }
  return ups
}

/**
 * Core agent turn: given the raw NL input, returns what to tell the user and
 * what to review. Saving requires confirmation unless autosave is enabled.
 * Language is auto-detected from the user's input.
 */
export function handleObservation(params: {
  db: Database.Database
  extraction: Extraction
  customer: Customer
  observer: string
  observedAt: string
  rawInput: string
  source: Observation['source']
  autoSave?: boolean
  lang?: Lang
}): AgentReply {
  const { db, extraction: rawExtraction, customer, observer, observedAt, rawInput, source } = params
  const lang = params.lang ?? detectLang(rawInput)
  // Anti-hallucination: keep only equipment the user actually mentioned.
  const extraction = groundExtraction(rawInput, rawExtraction)
  if (extraction.equipment.some(e => e.quantity === undefined)) {
    const modLabel = extraction.equipment[0]?.modality
      ? modalityLabelPlural(extraction.equipment[0].modality, 2, lang)
      : lang === 'es' ? 'equipos' : 'units'
    return { message: msgNeedQuantity(modLabel, lang), followUps: planFollowUps(extraction, lang) }
  }
  const observation = buildObservation({
    extraction,
    customer,
    observer,
    observedAt,
    rawInput,
    source,
  })

  const followUps = planFollowUps(extraction, lang)
  const missingRequired = extraction.equipment.length === 0
  const hasModality = extraction.equipment.some((e) => e.modality)

  if (missingRequired || !hasModality || !params.autoSave) {
    let message = ''
    if (missingRequired) {
      message = msgNoEquipmentGuidance(lang)
    } else if (!params.autoSave) {
      const summary = buildEquipmentSummary(observation.equipment, lang)
      const location = buildCustomerLocation(customer.name, customer.city, customer.country, lang)
      message = msgIdentifiedEquipment(summary, location, lang)
      if (followUps.length) {
        message += ' ' + msgFollowUpIntro(lang)
      } else {
        message += ' ' + msgReadyToSave(lang)
      }
    } else {
      message = msgSaved(observation.status, lang)
    }
    return { message, followUps, observation }
  }

  return saveObservation(db, observation, false)
}

/** Save the reviewed draft without another inference or rebuilt observation. */
export function saveObservation(db: Database.Database, draft: Observation, confirmed: boolean, allowDuplicate = false): AgentReply {
  const lang = detectLang(draft.rawInput)
  if (!draft.equipment.length) throw new Error('No equipment to save')
  if (db.prepare('SELECT id FROM observations WHERE id=?').get(draft.id)) {
    return { message: msgAlreadySaved(lang), saved: true, observation: draft, followUps: [] }
  }
  const duplicates = detectDuplicates(db, draft)
  if (duplicates.length && !allowDuplicate) {
    return { message: msgDuplicateWarning(lang), observation: draft, duplicates, followUps: [] }
  }
  const observation = structuredClone(draft)
  if (confirmed) {
    observation.reviewConfirmed = true
    // Confirmation validates the report, not the precision of estimated ages.
    observation.equipment = observation.equipment.map(e => ({ ...e, status: e.status === 'Estimated' ? 'Estimated' : 'Confirmed' }))
    observation.status = observation.equipment.some(e => e.status === 'Estimated') ? 'Estimated' : 'Confirmed'
  }
  insertObservation(db, observation)
  return { message: msgSaved(observation.status, lang), observation, saved: true, followUps: [] }
}
