import type Database from 'better-sqlite3'
import type { Extraction, FollowUp, Observation } from '../types.js'
import { findOrCreateCustomer } from '../store/db.js'
import { buildObservation, groundExtraction, normalizeModality, saveObservation, type AgentReply } from './agent.js'
import { parseExtraction } from '../extract/prompt.js'
import { applyCatalogAnswer, catalogQuestionText, matchCatalogAnswer, questionIntent, reviewCatalog, type CatalogQuestion } from './catalog-review.js'
import { detectLang, type Lang, msgDraftDiscarded, msgNoPending, msgTooLong, msgGreeting, msgNoEquipmentGuidance,
  msgIdentifiedEquipment, msgReadyToSave, buildEquipmentSummary, buildCustomerLocation } from './i18n.js'

const hasText = (value?: string) => !!value?.trim() && !/^(unknown|unspecified|not known|desconocido)$/i.test(value.trim())

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

/** Client metadata is only a UI hint. The pending field is owned by the server. */
export interface TurnMeta {
  intent?: FollowUp['intent']
  modality?: string
}

export class Conversation {
  private transcript = ''
  private draft?: Observation
  private extraction?: Extraction
  private pending?: CatalogQuestion
  private duplicateWarning = false
  private detectedLang: Lang = 'en'
  private lockedLang?: Lang
  constructor(private db: Database.Database, private extract: (text: string) => Promise<Extraction>,
    private observer: string, private autoSave = false, private source: Observation['source'] = 'Text') {}

  setLockedLanguage(lang: Lang) { this.lockedLang = lang; this.detectedLang = lang }

  private ask(question: CatalogQuestion, invalid = false): AgentReply {
    this.pending = question
    this.draft = undefined
    const lang = this.detectedLang
    if (question.field === 'modality' && !question.values.length && question.index !== undefined) {
      const row = this.extraction?.equipment[question.index]
      const equipment = [row?.modality, row?.brand, row?.model].filter(hasText).join(' · ')
      const hospital = this.extraction?.customer?.name ?? ''
      return {
        message: lang === 'es'
          ? `El equipo ${question.index + 1}${equipment ? ` (${equipment})` : ''} no tiene una fila disponible en el Excel para «${hospital}»: las filas de ese hospital ya están asignadas a los equipos anteriores de esta observación. Puedes descartar solo este equipo y conservar los anteriores, o comenzar una nueva observación con new o /new. Aún no se ha guardado esta observación.`
          : `Equipment ${question.index + 1}${equipment ? ` (${equipment})` : ''} has no available Excel row for “${hospital}”: that hospital's rows are already assigned to the previous equipment in this observation. You can discard only this equipment and keep the previous entries, or start a new observation with new or /new. This observation has not been saved yet.`,
        followUps: [], suggestions: [],
        actions: [
          { label: lang === 'es' ? 'Descartar solo este equipo' : 'Discard only this equipment', command: '/discard-equipment' },
          { label: lang === 'es' ? 'Nueva observación' : 'New observation', command: '/new' },
        ],
      }
    }
    const text = catalogQuestionText(question, lang)
    const suggestions = question.value
      ? matchCatalogAnswer(question.value, question)?.suggestions ?? question.values
      : question.values
    const rejected = invalid || hasText(question.value)
    const locationConflict = rejected && (question.field === 'city' || question.field === 'country')
    const hospital = this.extraction?.customer?.name ?? ''
    const locationPrefix = locationConflict
      ? (lang === 'es'
        ? `${question.field === 'city' ? 'La ciudad' : 'El país'} «${question.value}» no coincide con ${question.field === 'city' ? 'la ciudad registrada' : 'el país registrado'} para «${hospital}» en el dataset de Excel. ${question.field === 'city' ? 'Ciudad' : 'País'} según el dataset: ${question.values.join(', ')}. `
        : `The ${question.field} “${question.value}” does not match the ${question.field} recorded for “${hospital}” in the Excel dataset. ${question.field === 'city' ? 'City' : 'Country'} in the dataset: ${question.values.join(', ')}. `)
      : ''
    const prefix = question.field === 'customer'
      ? rejected
        ? (lang === 'es'
          ? `El hospital${hasText(question.value) ? ` «${question.value}»` : ' indicado'} no está en el dataset de Excel. No se puede guardar esta observación con ese hospital. `
          : `The hospital${hasText(question.value) ? ` “${question.value}”` : ' provided'} is not in the Excel dataset. This observation cannot be saved with that hospital. `)
        : (lang === 'es' ? 'No pude identificar el hospital en tu mensaje. ' : 'I could not identify the hospital in your message. ')
      : locationConflict ? locationPrefix : rejected
        ? (lang === 'es' ? 'Ese valor no coincide con el dataset para este equipo. ' : 'That value does not match the dataset for this equipment. ') : ''
    return {
      message: question.values.length ? prefix + text : (lang === 'es'
        ? 'No hay más equipos compatibles en el dataset para este hospital. Escribe /new para comenzar otra observación.'
        : 'There are no more matching equipment rows in the dataset for this hospital. Type /new to start another observation.'),
      followUps: [], suggestions, suggestionQuestion: text,
      suggestionIntent: questionIntent(question), suggestionModality: question.modality,
    }
  }

  private review(): AgentReply {
    const extraction = this.extraction!
    if (!extraction.equipment.length) {
      this.pending = undefined
      this.draft = undefined
      return { message: msgNoEquipmentGuidance(this.detectedLang), followUps: [] }
    }
    const gap = reviewCatalog(extraction)
    if (gap) return this.ask(gap)
    this.pending = undefined
    const customer = findOrCreateCustomer(this.db, {
      name: extraction.customer!.name!, city: extraction.customer!.city!, country: extraction.customer!.country!,
    })
    this.draft = buildObservation({ extraction, customer, observer: this.observer,
      observedAt: new Date().toISOString(), rawInput: this.transcript, source: this.source })
    if (this.autoSave) {
      const reply = saveObservation(this.db, this.draft, false)
      this.duplicateWarning = !!reply.duplicates?.length
      if (reply.saved) this.reset()
      return reply
    }
    const lang = this.detectedLang
    return { message: msgIdentifiedEquipment(buildEquipmentSummary(this.draft.equipment, lang),
      buildCustomerLocation(customer.name, customer.city, customer.country, lang), lang) + ' ' + msgReadyToSave(lang),
      followUps: [], observation: this.draft }
  }

  async turn(message: string, _question?: string, langOverride?: Lang, _meta?: TurnMeta): Promise<AgentReply> {
    this.detectedLang = this.lockedLang ?? langOverride ?? (this.transcript ? this.detectedLang : detectLang(message))
    const lang = this.detectedLang
    const command = message.trim().toLowerCase()
    if (['skip', 'cancel', '/new', 'new', 'nueva observación', 'nueva observacion', 'new observation', 'omitir', 'cancelar'].includes(command)) {
      this.reset()
      return { message: msgDraftDiscarded(lang), followUps: [] }
    }
    if (command === '/discard-equipment') {
      // Only the server's current exhausted row can be removed; client hints cannot choose a row.
      if (this.extraction && this.pending?.field === 'modality' && !this.pending.values.length && this.pending.index !== undefined) {
        const index = this.pending.index
        this.extraction.equipment.splice(index, 1)
        this.transcript += `\nUser action: Discard equipment entry ${index + 1}; exclude it from this observation.`
        this.pending = undefined
        this.duplicateWarning = false
        return this.review()
      }
      return { message: lang === 'es' ? 'No hay un equipo pendiente que se pueda descartar con esta opción.' : 'There is no pending equipment that can be discarded with this option.', followUps: [] }
    }
    if (['confirm', 'confirmar', 'save anyway', 'guardar de todos modos'].includes(command)) {
      if (this.pending) return this.ask(this.pending)
      if (!this.draft || !this.extraction) return { message: msgNoPending(lang), followUps: [] }
      const gap = reviewCatalog(this.extraction)
      if (gap) return this.ask(gap)
      const force = ['save anyway', 'guardar de todos modos'].includes(command)
      const reply = saveObservation(this.db, this.draft, true, force && this.duplicateWarning)
      this.duplicateWarning = !!reply.duplicates?.length
      if (reply.saved) this.reset()
      return reply
    }
    if (!this.transcript && /^(hola|buenas|hi|hello|hey|olá|oi|bonjour|salut|hallo|ciao|hoi)[!. ]*$/i.test(command)) {
      return { message: msgGreeting(lang), followUps: [] }
    }
    if (this.pending && this.extraction) {
      const match = matchCatalogAnswer(message, this.pending)
      if (match?.status !== 'exact' || !match.canonical) return this.ask({ ...this.pending, value: message.trim() }, true)
      const transcript = [this.transcript, `Follow-up: ${catalogQuestionText(this.pending, lang)}\nAnswer: ${match.canonical}`].join('\n')
      if (transcript.length > 16000) throw new Error(msgTooLong(lang))
      applyCatalogAnswer(this.extraction, this.pending, match.canonical)
      this.transcript = transcript
      this.duplicateWarning = false
      return this.review()
    }
    const transcript = [this.transcript, message].filter(Boolean).join('\n')
    if (transcript.length > 16000) throw new Error(msgTooLong(lang))
    // The model only extracts input. Catalog membership is enforced independently below.
    const next = parseExtraction(await this.extract(transcript))
    const extraction = groundExtraction(transcript, mergeExtraction(this.extraction, next))
    this.transcript = transcript
    this.extraction = extraction
    this.draft = undefined
    this.duplicateWarning = false
    return this.review()
  }

  private reset() {
    this.transcript = ''; this.draft = undefined; this.extraction = undefined
    this.pending = undefined; this.duplicateWarning = false
  }
}
