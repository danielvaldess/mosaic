import type Database from 'better-sqlite3'
import type { Extraction, Observation } from '../types.js'
import { findOrCreateCustomer } from '../store/db.js'
import { groundExtraction, handleObservation, normalizeModality, saveObservation, type AgentReply } from './agent.js'

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
    equipment[index] = merged
  }
  return { customer, equipment, missingFields: next.missingFields }
}

function applyFollowUpAnswer(extraction: Extraction, question: string | undefined, answer: string): Extraction {
  if (!question) return extraction
  const text = question.toLowerCase()
  const intents = [
    text.includes('quantity') || text.includes('how many') || text.includes('cantidad'),
    text.includes('brand') || text.includes('manufacturer') || text.includes('marca'),
    text.includes('model') || text.includes('modelo'),
    text.includes('age') || text.includes('old') || text.includes('edad'),
  ]
  // Combined free-text questions still need the extractor to split the answer.
  if (intents.filter(Boolean).length !== 1) return extraction
  const modality = normalizeModality(/\(([^)]+)\)/.exec(question)?.[1])
  const rows = extraction.equipment.filter(row => !modality || normalizeModality(row.modality) === modality)
  if (!rows.length) return extraction
  for (const row of rows) {
    if (text.includes('quantity') || text.includes('how many') || text.includes('cantidad')) {
      const number = Number(/\b([1-9][0-9]*)\b/.exec(answer)?.[1])
      if (Number.isSafeInteger(number) && number > 0) row.quantity = number
    } else if (text.includes('brand') || text.includes('manufacturer') || text.includes('marca')) {
      row.brand = answer.trim()
    } else if (text.includes('model') || text.includes('modelo')) {
      row.model = answer.trim()
    } else if (text.includes('age') || text.includes('old') || text.includes('edad')) {
      const number = Number(/\b([0-9]{1,3})\b/.exec(answer)?.[1])
      if (Number.isSafeInteger(number)) {
        row.ageMin = number
        row.ageMax = /\b(?:about|around|approximately|aproximadamente)\b/i.test(answer) ? number + 2 : number
        row.ageQualitative = undefined
      } else {
        row.ageQualitative = answer.trim()
      }
    }
  }
  return extraction
}

export class Conversation {
  private transcript = ''
  private draft?: Observation
  private extraction?: Extraction
  private duplicateWarning = false
  constructor(private db: Database.Database, private extract: (text: string) => Promise<Extraction>,
    private observer: string, private autoSave = false, private source: Observation['source'] = 'Text') {}

  async turn(message: string, question?: string): Promise<AgentReply> {
    const command = message.trim().toLowerCase()
    if (['skip', 'cancel', '/new', 'omitir', 'cancelar'].includes(command)) {
      this.reset()
      return { message: 'Draft discarded. Describe a new observation.', followUps: [] }
    }
    if (['confirm', 'confirmar', 'save anyway', 'guardar de todos modos'].includes(command)) {
      if (!this.draft) return { message: 'No pending observation. Describe what you observed first.', followUps: [] }
      const force = ['save anyway', 'guardar de todos modos'].includes(command)
      const reply = saveObservation(this.db, this.draft, true, force && this.duplicateWarning)
      this.duplicateWarning = !!reply.duplicates?.length
      if (reply.saved) this.reset()
      return reply
    }
    const transcript = [this.transcript, question ? `Follow-up: ${question}\nAnswer: ${message}` : message].filter(Boolean).join('\n')
    if (transcript.length > 16000) throw new Error('Observation too long. Confirm or use /new to start again.')
    const merged = mergeExtraction(this.extraction, await this.extract(transcript))
    const extraction = groundExtraction(transcript, applyFollowUpAnswer(merged, question, message))
    // Commit state only after extraction succeeds, so errors can be retried.
    this.transcript = transcript
    this.extraction = extraction
    this.draft = undefined
    this.duplicateWarning = false
    if (!extraction.customer?.name?.trim()) {
      return { message: 'Which hospital, city and country? Reply here to complete this observation.', followUps: [] }
    }
    const customer = findOrCreateCustomer(this.db, {
      name: extraction.customer.name.trim(), city: extraction.customer.city?.trim() || 'Unknown',
      country: extraction.customer.country?.trim() || 'Unknown', site: extraction.customer.site,
    })
    const reply = handleObservation({ db: this.db, extraction, customer, observer: this.observer,
      observedAt: new Date().toISOString(), rawInput: transcript, source: this.source, autoSave: this.autoSave })
    this.draft = reply.observation?.equipment.length ? reply.observation : undefined
    this.duplicateWarning = !!reply.duplicates?.length
    if (reply.saved) this.reset()
    return reply
  }

  private reset() { this.transcript = ''; this.draft = undefined; this.extraction = undefined; this.duplicateWarning = false }
}
