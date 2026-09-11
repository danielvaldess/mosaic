import type { Extraction, FollowUp } from '../types.js'
import { installedBase, sameValue, uniqueValues, type CatalogRow } from '../store/catalog.js'
import { matchDataset } from './dataset-match.js'
import { normalizeModality } from './agent.js'
import type { Lang } from './i18n.js'

export type CatalogField = 'customer' | 'city' | 'country' | 'modality' | 'brand' | 'model' | 'quantity' | 'age'
export interface CatalogQuestion {
  field: CatalogField
  index?: number
  modality?: string
  values: string[]
  value?: string
}

const present = (value: unknown): boolean => value !== undefined && value !== null &&
  String(value).trim() !== '' && !/^(unknown|desconocido|unspecified)$/i.test(String(value).trim())

/** Returns the first gap or conflict. Every accepted equipment tuple belongs to one Excel row. */
export function reviewCatalog(extraction: Extraction): CatalogQuestion | undefined {
  const customer = extraction.customer ??= {}
  const hospitals = uniqueValues(installedBase, 'Customer / Hospital')
  const name = hospitals.find(value => present(customer.name) && sameValue(value, customer.name!))
  if (!name) return { field: 'customer', values: hospitals, value: customer.name }
  customer.name = name
  delete customer.site
  const hospitalRows = installedBase.filter(row => row['Customer / Hospital'] === name)
  for (const [field, column] of [['city', 'City'], ['country', 'Country']] as const) {
    const values = uniqueValues(hospitalRows, column)
    if (!present(customer[field])) customer[field] = values[0]
    const canonical = values.find(value => sameValue(value, customer[field]!))
    if (!canonical) return { field, values, value: customer[field] }
    customer[field] = canonical
  }
  const used = new Set<Readonly<CatalogRow>>()
  for (const [index, equipment] of extraction.equipment.entries()) {
    const modality = normalizeModality(equipment.modality)
    let rows = hospitalRows.filter(row => row.Modality === modality && !used.has(row))
    if (!rows.length) return {
      field: 'modality', index, values: uniqueValues(hospitalRows.filter(row => !used.has(row)), 'Modality'),
      value: equipment.modality,
    }
    equipment.modality = modality
    const fields = [
      ['brand', 'Dummy Brand'], ['model', 'Dummy Model'], ['quantity', 'Quantity'], ['age', 'Approx. Age (Years)'],
    ] as const
    for (const [field, column] of fields) {
      const value = field === 'age'
        ? equipment.ageQualitative || (equipment.ageMin === equipment.ageMax || equipment.ageMax === undefined
          ? equipment.ageMin : `${equipment.ageMin}–${equipment.ageMax}`)
        : equipment[field]
      const values = uniqueValues(rows, column)
      const canonical = values.find(candidate => present(value) && sameValue(candidate, String(value)))
      if (canonical === undefined) return { field, index, modality, values, value: present(value) ? String(value) : undefined }
      rows = rows.filter(row => String(row[column]) === canonical)
      if (field === 'age') {
        equipment.ageMin = Number(canonical)
        equipment.ageMax = Number(canonical)
        delete equipment.ageQualitative
      } else if (field === 'quantity') equipment.quantity = Number(canonical)
      else equipment[field] = canonical
    }
    // Notes from generated text are not catalog facts; keep the original message only as evidence.
    delete equipment.notes
    used.add(rows[0]!)
  }
  extraction.missingFields = []
  return undefined
}

export function questionIntent(question: CatalogQuestion): FollowUp['intent'] {
  return question.field === 'city' || question.field === 'country' ? 'location'
    : question.field === 'modality' ? 'notes' : question.field
}

export function catalogQuestionText(question: CatalogQuestion, lang: Lang): string {
  const labels = lang === 'es'
    ? { customer: 'hospital', city: 'ciudad', country: 'país', modality: 'modalidad', brand: 'marca', model: 'modelo', quantity: 'cantidad', age: 'antigüedad (años)' }
    : { customer: 'hospital', city: 'city', country: 'country', modality: 'modality', brand: 'brand', model: 'model', quantity: 'quantity', age: 'age (years)' }
  const equipment = question.index === undefined ? '' : ` · ${lang === 'es' ? 'equipo' : 'equipment'} ${question.index + 1}${question.modality ? ` (${question.modality})` : ''}`
  return lang === 'es' ? `Selecciona ${labels[question.field]} del dataset${equipment}.` : `Select the ${labels[question.field]} from the dataset${equipment}.`
}

export function matchCatalogAnswer(answer: string, question: CatalogQuestion) {
  let value = answer.trim()
  if (question.field === 'quantity' || question.field === 'age') {
    // Anchored parsing prevents "2 or 9", "-2", "2.5" and "6+" becoming valid integers.
    const units = question.field === 'age' ? '(?:years?|años?|anos?)' : '(?:units?|systems?|equipos?|unidades?)'
    const match = new RegExp(`^(\\d+)(?:\\s+${units})?[.!]?$`, 'i').exec(value)
    if (!match) return { status: 'invalid' as const, suggestions: question.values }
    value = String(Number(match[1]))
  }
  if (question.field === 'modality') value = normalizeModality(value) ?? value
  return matchDataset(value, question.values, { maxSuggestions: question.values.length })
}

export function applyCatalogAnswer(extraction: Extraction, question: CatalogQuestion, value: string): void {
  if (question.field === 'customer' || question.field === 'city' || question.field === 'country') {
    const customer = extraction.customer ??= {}
    customer[question.field === 'customer' ? 'name' : question.field] = value
    return
  }
  const row = extraction.equipment[question.index!]
  if (!row) throw new Error('Equipment no longer exists. Start a new observation.')
  if (question.field === 'quantity') row.quantity = Number(value)
  else if (question.field === 'age') {
    row.ageMin = row.ageMax = Number(value)
    delete row.ageQualitative
  } else row[question.field] = value
}
