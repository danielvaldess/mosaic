import { catalogSuggestions } from './catalog.js'
import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type {
  Customer,
  EquipmentObservation,
  Observation,
} from '../types.js'

export const DATA_DIR = process.env.MOSAIC_DATA_DIR ?? join(process.cwd(), 'data')
export const DB_PATH = join(DATA_DIR, 'mosaic.db')

const SCHEMA = `
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  country TEXT NOT NULL,
  site TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(name, city, country)
);

CREATE TABLE IF NOT EXISTS observations (
  id TEXT PRIMARY KEY,
  observer TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  raw_input TEXT NOT NULL,
  source TEXT NOT NULL,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  overall_confidence TEXT NOT NULL,
  status TEXT NOT NULL,
  review_confirmed INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS equipment (
  id TEXT PRIMARY KEY,
  observation_id TEXT NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  modality TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  brand TEXT,
  model TEXT,
  age_min INTEGER,
  age_max INTEGER,
  age_qualitative TEXT,
  installation_year INTEGER,
  status TEXT NOT NULL,
  confidence TEXT NOT NULL,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_equip_customer ON equipment(customer_id);
CREATE INDEX IF NOT EXISTS idx_equip_modality ON equipment(modality);
CREATE INDEX IF NOT EXISTS idx_equip_obs ON equipment(observation_id);
CREATE INDEX IF NOT EXISTS idx_obs_customer ON observations(customer_id);
`

export function openDb(dbPath: string = DB_PATH): Database.Database {
  mkdirSync(dirname(dbPath), { recursive: true })
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA)
  return db
}

/** Normalize accented characters for comparison (e.g., "Panamá" → "Panama") */
function normalizeAccents(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

export function findOrCreateCustomer(
  db: Database.Database,
  input: { name: string; city: string; country: string; site?: string },
): Customer {
  const existing = db
    .prepare('SELECT * FROM customers WHERE lower(name)=lower(?) AND lower(city)=lower(?) AND lower(country)=lower(?)')
    .get(input.name, input.city, input.country) as Record<string, unknown> | undefined
  if (existing) {
    if (input.site && !existing.site) {
      db.prepare('UPDATE customers SET site=? WHERE id=?').run(input.site, existing.id)
      return { ...mapCustomer(existing), site: input.site }
    }
    return mapCustomer(existing)
  }
  // Try again with accent-normalized comparison to avoid duplicates like "Panama" vs "Panamá"
  const normalizedName = normalizeAccents(input.name)
  const normalizedCity = normalizeAccents(input.city)
  const normalizedCountry = normalizeAccents(input.country)
  const existingNormalized = db
    .prepare('SELECT * FROM customers WHERE lower(name)=lower(?) AND lower(city)=lower(?) AND lower(country)=lower(?)')
    .get(normalizedName, normalizedCity, normalizedCountry) as Record<string, unknown> | undefined
  if (existingNormalized) {
    if (input.site && !existingNormalized.site) {
      db.prepare('UPDATE customers SET site=? WHERE id=?').run(input.site, existingNormalized.id)
      return { ...mapCustomer(existingNormalized), site: input.site }
    }
    return mapCustomer(existingNormalized)
  }
  const row: Customer = {
    id: crypto.randomUUID(),
    name: input.name,
    city: input.city,
    country: input.country,
    site: input.site,
    createdAt: new Date().toISOString(),
  }
  db.prepare(
    'INSERT INTO customers (id,name,city,country,site,created_at) VALUES (?,?,?,?,?,?)',
  ).run(row.id, row.name, row.city, row.country, row.site, row.createdAt)
  return row
}

export function insertObservation(
  db: Database.Database,
  obs: Observation,
): void {
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO observations
       (id,observer,observed_at,raw_input,source,customer_id,overall_confidence,status,review_confirmed,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      obs.id,
      obs.observer,
      obs.observedAt,
      obs.rawInput,
      obs.source,
      obs.customerId,
      obs.overallConfidence,
      obs.status,
      obs.reviewConfirmed ? 1 : 0,
      obs.createdAt,
    )
    for (const eq of obs.equipment) {
      db.prepare(
        `INSERT INTO equipment
         (id,observation_id,customer_id,modality,quantity,brand,model,age_min,age_max,age_qualitative,installation_year,status,confidence,notes)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        eq.id,
        eq.observationId,
        eq.customerId,
        eq.modality,
        eq.quantity,
        eq.brand,
        eq.model,
        eq.age?.min ?? null,
        eq.age?.max ?? null,
        eq.age?.qualitative ?? null,
        eq.age?.installationYear ?? null,
        eq.status,
        eq.confidence,
        eq.notes,
      )
    }
  })
  tx()
}

export function allCustomers(db: Database.Database): Customer[] {
  const rows = db.prepare('SELECT * FROM customers ORDER BY country, city, name').all() as Array<Record<string, unknown>>
  return rows.map(mapCustomer)
}

export function equipmentForCustomer(db: Database.Database, customerId: string): EquipmentObservation[] {
  const rows = db
    .prepare('SELECT * FROM equipment WHERE customer_id=? ORDER BY modality')
    .all(customerId) as Array<Record<string, unknown>>
  return rows.map(mapEquipment)
}

export function observationsForCustomer(db: Database.Database, customerId: string): Observation[] {
  const rows = db
    .prepare('SELECT * FROM observations WHERE customer_id=? ORDER BY observed_at DESC')
    .all(customerId) as Array<Record<string, unknown>>
  return rows.map(mapObservation)
}

export function equipmentForObservation(db: Database.Database, observationId: string): EquipmentObservation[] {
  const rows = db
    .prepare('SELECT * FROM equipment WHERE observation_id=?')
    .all(observationId) as Array<Record<string, unknown>>
  return rows.map(mapEquipment)
}

export function allObservations(db: Database.Database): Observation[] {
  const rows = db.prepare('SELECT * FROM observations ORDER BY observed_at DESC').all() as Array<Record<string, unknown>>
  return rows.map(mapObservation)
}

function mapCustomer(r: Record<string, unknown>): Customer {
  return {
    id: r.id as string,
    name: r.name as string,
    city: r.city as string,
    country: r.country as string,
    site: (r.site as string | null) ?? undefined,
    createdAt: r.created_at as string,
  }
}

function mapEquipment(r: Record<string, unknown>): EquipmentObservation {
  const age =
    r.age_min !== null || r.age_max !== null || r.age_qualitative !== null
      ? {
          min: (r.age_min as number | null) ?? undefined,
          max: (r.age_max as number | null) ?? undefined,
          qualitative: (r.age_qualitative as string | null) ?? undefined,
          installationYear: (r.installation_year as number | null) ?? undefined,
        }
      : undefined
  return {
    id: r.id as string,
    observationId: r.observation_id as string,
    customerId: r.customer_id as string,
    modality: r.modality as EquipmentObservation['modality'],
    quantity: r.quantity as number,
    brand: (r.brand as EquipmentObservation['brand'] | null) ?? 'Unknown',
    model: (r.model as EquipmentObservation['model'] | null) ?? 'Unknown',
    age,
    status: r.status as EquipmentObservation['status'],
    confidence: r.confidence as EquipmentObservation['confidence'],
    notes: (r.notes as string | null) ?? undefined,
  }
}

function mapObservation(r: Record<string, unknown>): Observation {
  return {
    id: r.id as string,
    observer: r.observer as string,
    observedAt: r.observed_at as string,
    rawInput: r.raw_input as string,
    source: r.source as Observation['source'],
    customerId: r.customer_id as string,
    equipment: [],
    overallConfidence: r.overall_confidence as Observation['overallConfidence'],
    status: r.status as Observation['status'],
    reviewConfirmed: Boolean(r.review_confirmed),
    createdAt: r.created_at as string,
  }
}

export type ChatSuggestions = ReturnType<typeof catalogSuggestions>

// Preserve callers while sourcing options exclusively from the immutable Excel export.
export function getChatSuggestions(_db: Database.Database): ChatSuggestions {
  return catalogSuggestions()
}

export function getModalitySuggestions(_db: Database.Database, modality: string): ChatSuggestions {
  return catalogSuggestions(modality)
}

export function clearDb(db: Database.Database): { deleted: number } {
  const deleted = db.prepare('SELECT COUNT(*) AS c FROM observations').get() as { c: number }
  db.exec('DELETE FROM equipment')
  db.exec('DELETE FROM observations')
  db.exec('DELETE FROM customers')
  return { deleted: deleted.c }
}
