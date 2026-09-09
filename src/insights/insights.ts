import Database from 'better-sqlite3'
import {
  allCustomers,
  allObservations,
  observationsForCustomer,
  equipmentForCustomer,
} from '../store/db.js'
import type { Customer, EquipmentObservation } from '../types.js'

export interface CustomerEquipmentSummary {
  modality: string
  totalQuantity: number
  avgAge?: number
  brands: string[]
  lastObserved: string
  oldestQuantity: number
}

export interface Customer360 {
  customer: Customer
  equipment: CustomerEquipmentSummary[]
  observationCount: number
  totalUnits: number
  staleDays?: number
  refreshOpportunity: boolean
}

export interface GlobalStats {
  totalCustomers: number
  totalObservations: number
  totalUnits: number
  byModality: Record<string, number>
  byCountry: Record<string, number>
  staleCount: number
  refreshCandidates: Customer360[]
}

const REFRESH_AGE_YEARS = 7
const STALE_DAYS = 180

export function customer360(db: Database.Database, customer: Customer): Customer360 {
  const eq = equipmentForCustomer(db, customer.id)
  const obs = observationsForCustomer(db, customer.id)

  const byModality = new Map<string, EquipmentObservation[]>()
  for (const e of eq) {
    const list = byModality.get(e.modality) ?? []
    list.push(e)
    byModality.set(e.modality, list)
  }

  const equipment: CustomerEquipmentSummary[] = []
  let totalUnits = 0
  for (const [modality, items] of byModality) {
    const totalQuantity = items.reduce((s, e) => s + e.quantity, 0)
    totalUnits += totalQuantity
    const ages = items
      .filter((e) => e.age?.min !== undefined)
      .map((e) => e.age!.min!)
    const oldestQuantity = items
      .filter((e) => (e.age?.min ?? 0) >= REFRESH_AGE_YEARS)
      .reduce((s, e) => s + e.quantity, 0)
    const lastObserved = obs.length
      ? obs.reduce((a, b) => (a.observedAt > b.observedAt ? a : b)).observedAt
      : ''
    equipment.push({
      modality,
      totalQuantity,
      avgAge: ages.length ? ages.reduce((a, b) => a + b, 0) / ages.length : undefined,
      brands: [...new Set(items.map((e) => e.brand).filter((b) => b && b !== 'Unknown'))] as string[],
      lastObserved,
      oldestQuantity,
    })
  }

  const lastObservedAll = obs.length
    ? obs.reduce((a, b) => (a.observedAt > b.observedAt ? a : b)).observedAt
    : undefined
  const staleDays = lastObservedAll
    ? Math.round((Date.now() - Date.parse(lastObservedAll)) / 86400000)
    : undefined
  const refreshOpportunity = equipment.some((e) => e.oldestQuantity > 0)

  return {
    customer,
    equipment,
    observationCount: obs.length,
    totalUnits,
    staleDays,
    refreshOpportunity,
  }
}

export function globalStats(db: Database.Database): GlobalStats {
  const customers = allCustomers(db)
  const observations = allObservations(db)
  const byModality: Record<string, number> = {}
  const byCountry: Record<string, number> = {}
  let totalUnits = 0
  const all = customers.map((c) => customer360(db, c))
  for (const c360 of all) {
    const c = c360.customer
    byCountry[c.country] = (byCountry[c.country] ?? 0) + 1
    totalUnits += c360.totalUnits
    for (const e of c360.equipment) {
      byModality[e.modality] = (byModality[e.modality] ?? 0) + e.totalQuantity
    }
  }
  const refreshCandidates = all.filter((c) => c.refreshOpportunity)
  const staleCount = all.filter((c) => c.staleDays !== undefined && c.staleDays > STALE_DAYS).length

  return {
    totalCustomers: customers.length,
    totalObservations: observations.length,
    totalUnits,
    byModality,
    byCountry,
    staleCount,
    refreshCandidates,
  }
}

/**
 * Lightweight NL analytics: matches the intent of queries like
 * "customers in Brazil with MR older than 7 years". This is deterministic and
 * offline; richer phrasing can be handled by the LLM in a future iteration.
 */
export function queryInstalledBase(db: Database.Database, query: string) {
  const q = query.toLowerCase()
  const country = extractCountry(q)
  const modality = extractModality(q)
  const age = extractAgeThreshold(q)

  const candidates = allCustomers(db)
    .filter((c) => !country || c.country.toLowerCase() === country)
    .map((c) => customer360(db, c))
    .filter(
      (c360) =>
        !modality ||
        c360.equipment.some((e) => e.modality.toLowerCase() === modality),
    )
    .map((c360) => {
      // Use individual equipment rows (not averages) so "2 old MRs + 1 new"
      // correctly matches "MR older than N years".
      const rows = equipmentForCustomer(db, c360.customer.id)
      const matching = modality
        ? rows.filter((e) => e.modality.toLowerCase() === modality)
        : rows
      const agedUnits = age
        ? matching
            .filter((e) => (e.age?.min ?? 0) >= age)
            .reduce((s, e) => s + e.quantity, 0)
        : 0
      return {
        customer: c360.customer,
        modality,
        matchingQuantity: matching.reduce((s, e) => s + e.quantity, 0),
        agedUnits,
      }
    })
    .filter((r) => (age ? r.agedUnits > 0 : true))

  return { country, modality, ageThreshold: age, results: candidates }
}

function extractCountry(q: string): string | undefined {
  const countries = [
    'brazil', 'panama', 'mexico', 'chile', 'argentina', 'colombia', 'peru',
    'costa rica', 'dominican republic', 'ecuador',
  ]
  return countries.find((c) => q.includes(c))
}

function extractModality(q: string): string | undefined {
  const mods = ['mr', 'ct', 'ultrasound', 'x-ray', 'patient monitoring', 'image guided therapy']
  return mods.find((m) => q.includes(m) || q.includes(m.replace('-', ' ')))
}

function extractAgeThreshold(q: string): number | undefined {
  const m = q.match(/(?:older than|more than|over|greater than)\s*(\d+)/)
  return m ? Number(m[1]) : undefined
}