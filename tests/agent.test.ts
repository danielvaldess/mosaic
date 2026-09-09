import { describe, it, expect, afterAll } from 'vitest'
import {
  buildObservation,
  detectDuplicates,
  planFollowUps,
  normalizeModality,
  filterModalitiesMentioned,
} from '../src/agent/agent.js'
import { openDb, findOrCreateCustomer, insertObservation, allCustomers } from '../src/store/db.js'
import type { Customer, Extraction } from '../src/types.js'

let db = openDb(':memory:')

afterAll(() => db.close())

const customer: Customer = {
  id: 'cust-1',
  name: 'Hospital DemoCare Pacific',
  city: 'Panama City',
  country: 'Panama',
  createdAt: new Date().toISOString(),
}

const now = new Date().toISOString()

function obs(overrides?: Partial<Parameters<typeof buildObservation>[0]>) {
  return buildObservation({
    extraction: {
      customer: { name: 'Hospital DemoCare Pacific', city: 'Panama City', country: 'Panama' },
      equipment: [{ modality: 'MR', quantity: 2, brand: 'NovaMed', ageMin: 7, ageMax: 8 }],
    },
    customer,
    observer: 'Field User 01',
    observedAt: now,
    rawInput: 'Two MR systems, NovaMed, around 7 years old.',
    source: 'Text',
    ...overrides,
  })
}

describe('normalizeModality', () => {
  it('maps synonyms to canonical modalities', () => {
    expect(normalizeModality('MRI')).toBe('MR')
    expect(normalizeModality('Magnetic Resonance')).toBe('MR')
    expect(normalizeModality('scanner')).toBe('CT')
    expect(normalizeModality('CT scanner')).toBe('CT')
    expect(normalizeModality('sonography')).toBe('Ultrasound')
    expect(normalizeModality('X-Ray')).toBe('X-Ray')
  })

  it('handles composite/verbose model output', () => {
    expect(normalizeModality('MRI/Magnetic Resonance')).toBe('MR')
    expect(normalizeModality('CT scanner (2)')).toBe('CT')
    expect(normalizeModality('magnetic resonance imaging systems')).toBe('MR')
  })

  it('returns undefined for unrecognized modalities (no hallucination passthrough)', () => {
    expect(normalizeModality('PET')).toBeUndefined()
    expect(normalizeModality('some random device')).toBeUndefined()
  })
})

describe('filterModalitiesMentioned', () => {
  it('drops hallucinated equipment not mentioned in the input', () => {
    const input = 'They have two MR systems and one CT.'
    const extraction: Extraction = {
      equipment: [
        { modality: 'MR', quantity: 2 },
        { modality: 'CT', quantity: 1 },
        { modality: 'X-Ray', quantity: 1 }, // invented by the model
      ],
    }
    const filtered = filterModalitiesMentioned(input, extraction)
    expect(filtered.equipment.map((e) => e.modality)).toEqual(['MR', 'CT'])
  })

  it('keeps equipment that is actually mentioned (including via synonym)', () => {
    const input = 'They have two MRI systems and one CT scanner.'
    const extraction: Extraction = {
      equipment: [{ modality: 'Magnetic Resonance', quantity: 2 }, { modality: 'CT', quantity: 1 }],
    }
    const filtered = filterModalitiesMentioned(input, extraction)
    expect(filtered.equipment).toHaveLength(2)
  })
})

describe('buildObservation', () => {
  it('extracts structured equipment with status/confidence', () => {
    const o = obs()
    expect(o.equipment).toHaveLength(1)
    expect(o.equipment[0]!.modality).toBe('MR')
    expect(o.equipment[0]!.quantity).toBe(2)
    expect(o.equipment[0]!.brand).toBe('NovaMed')
    expect(o.equipment[0]!.age?.min).toBe(7)
  })

  it('marks qualitative age observations as Estimated', () => {
    const o = obs({
      extraction: {
        customer: { name: 'X' },
        equipment: [{ modality: 'CT', quantity: 1, ageQualitative: 'old' }],
      },
    })
    expect(o.equipment[0]!.status).toBe('Estimated')
    expect(o.equipment[0]!.confidence).toBe('Medium')
  })

  it('tolerates incomplete data (unknown brand stays Unknown, still valuable)', () => {
    const o = obs({
      extraction: {
        customer: { name: 'X' },
        equipment: [{ modality: 'Ultrasound', quantity: 5 }],
      },
    })
    expect(o.equipment[0]!.brand).toBe('Unknown')
    expect(o.equipment[0]!.status).toBe('Reported')
  })

  it('derives installation year from age against an independent literal', () => {
    const observedAt = new Date('2026-08-18T12:00:00.000Z').toISOString()
    const o = obs({
      observedAt,
      extraction: {
        customer: { name: 'X' },
        equipment: [{ modality: 'CT', quantity: 1, ageMin: 11 }],
      },
    })
    expect(o.equipment[0]!.age?.installationYear).toBe(2015)
  })
})

describe('planFollowUps', () => {
  it('prioritizes brand/model/age/quantity gaps', () => {
    const ups = planFollowUps({
      equipment: [{ modality: 'MR', quantity: 1 }],
      missingFields: [
        { field: 'brand', modality: 'MR', reason: 'not provided' },
        { field: 'approximate age', modality: 'MR', reason: 'not provided' },
      ],
    }, 'en')
    expect(ups[0]!.intent).toBe('brand')
    expect(ups[1]!.intent).toBe('age')
    expect(ups[0]!.question).toContain('brand')
  })
})

describe('detectDuplicates', () => {
  it('flags the same modality+brand+age for the same customer', () => {
    const cust = findOrCreateCustomer(db, { name: 'Hospital DemoCare Pacific', city: 'Panama City', country: 'Panama' })
    insertObservation(db, {
      id: 'obs-1',
      observer: 'u1',
      observedAt: new Date(Date.now() - 10 * 86400000).toISOString(),
      rawInput: 'seed',
      source: 'Text',
      customerId: cust.id,
      equipment: [{
        id: 'e1', observationId: 'obs-1', customerId: cust.id,
        modality: 'MR', quantity: 2, brand: 'NovaMed', model: 'NM-MR 700',
        age: { min: 7, max: 8 }, status: 'Reported', confidence: 'High',
      }],
      overallConfidence: 'High', status: 'Reported', reviewConfirmed: true,
      createdAt: new Date().toISOString(),
    })

    const candidate = buildObservation({
      extraction: {
        customer: { name: 'Hospital DemoCare Pacific', city: 'Panama City', country: 'Panama' },
        equipment: [{ modality: 'MR', quantity: 2, brand: 'NovaMed', model: 'NM-MR 700', ageMin: 8 }],
      },
      customer: cust,
      observer: 'u2',
      observedAt: now,
      rawInput: 'two MR',
      source: 'Voice',
    })
    candidate.customerId = cust.id

    const hits = detectDuplicates(db, candidate)
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0]!.existingObservationId).toBe('obs-1')
  })

  it('does not flag different customers', () => {
    const other = findOrCreateCustomer(db, { name: 'Hospital DemoCare Horizon', city: 'Sao Paulo', country: 'Brazil' })
    const candidate = obs()
    candidate.customerId = other.id
    expect(detectDuplicates(db, candidate)).toHaveLength(0)
  })
})

describe('database round-trip', () => {
  it('seeds and reads customers back with mapped fields', () => {
    const cust = findOrCreateCustomer(db, { name: 'Clinica Test', city: 'Quito', country: 'Ecuador' })
    expect(cust.name).toBe('Clinica Test')
    const back = allCustomers(db).find((c) => c.id === cust.id)
    expect(back?.country).toBe('Ecuador')
  })
})