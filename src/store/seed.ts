import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { openDb, findOrCreateCustomer, insertObservation } from './db.js'
import type { Observation, EquipmentObservation } from '../types.js'

/**
 * Seed data was pre-converted from Dummy_Installed_Base_Hackathon.xlsx to
 * data/dummy_installed_base.json at build time (see scripts/convert-xlsx.mjs).
 * This removes the vulnerable `xlsx` runtime dependency (GHSA-4r6h-8v6p-xvw6).
 */
const JSON_PATH = join(process.cwd(), 'data', 'dummy_installed_base.json')

interface DummyRow {
  'Observation ID': string | number
  Country: string
  City: string
  'Customer / Hospital': string
  Observer: string
  'Visit Date': string | Date | number
  Modality: string
  Quantity: number
  'Dummy Brand': string
  'Dummy Model': string
  'Approx. Age (Years)': string | number
  Confidence: string
  Status: string
  Source: string
  'Voice Input Example': string
  Notes?: string
}

const DAY_MS = 24 * 60 * 60 * 1000

function toDate(v: DummyRow['Visit Date']): string {
  if (typeof v === 'string') return new Date(v).toISOString()
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'number') {
    const d = new Date(Math.round((v - 25569) * DAY_MS))
    return d.toISOString()
  }
  return new Date().toISOString()
}

function parseAge(v: string | number): { min?: number; max?: number; installationYear?: number; qualitative?: string } | undefined {
  if (v === undefined || v === null || v === '') return undefined
  const s = String(v).trim()
  const m = s.match(/^(\d+)\s*[-–]\s*(\d+)$/)
  if (m) return { min: Number(m[1]), max: Number(m[2]) }
  const single = Number(s)
  if (!Number.isNaN(single)) return { min: single, max: single }
  return { qualitative: s }
}

export function seedFromXlsx(db?: Database.Database): number {
  const rows = JSON.parse(readFileSync(JSON_PATH, 'utf8')) as DummyRow[]

  const own = !db
  db ??= openDb()
  const existing = db.prepare('SELECT COUNT(*) AS c FROM observations').get() as { c: number }
  if (existing.c > 0) {
    console.log(`• DB already seeded (${existing.c} observations). Use --force to re-seed.`)
    return existing.c
  }

  for (const r of rows) {
    const obsId = `SEED-${r['Observation ID']}`
    const customer = findOrCreateCustomer(db, {
      name: r['Customer / Hospital'],
      city: r.City,
      country: r.Country,
    })
    const eq: EquipmentObservation = {
      id: `${obsId}-EQ`,
      observationId: obsId,
      customerId: customer.id,
      modality: r.Modality as EquipmentObservation['modality'],
      quantity: Number(r.Quantity) || 1,
      brand: (r['Dummy Brand'] || 'Unknown') as EquipmentObservation['brand'],
      model: (r['Dummy Model'] || 'Unknown') as EquipmentObservation['model'],
      age: parseAge(r['Approx. Age (Years)']),
      status: r.Status as EquipmentObservation['status'],
      confidence: r.Confidence as EquipmentObservation['confidence'],
      notes: r.Notes,
    }
    const obs: Observation = {
      id: obsId,
      observer: r.Observer,
      observedAt: toDate(r['Visit Date']),
      rawInput: r['Voice Input Example'],
      source: (r.Source === 'Voice' ? 'Voice' : 'Text') as Observation['source'],
      customerId: customer.id,
      equipment: [eq],
      overallConfidence: r.Confidence as Observation['overallConfidence'],
      status: r.Status as Observation['status'],
      reviewConfirmed: true,
      createdAt: new Date().toISOString(),
    }
    insertObservation(db, obs)
  }
  if (own) db.close()
  console.log(`• Seeded ${rows.length} observations from dummy dataset.`)
  return rows.length
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedFromXlsx()
}