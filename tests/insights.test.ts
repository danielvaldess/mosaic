import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { openDb, allCustomers } from '../src/store/db.js'
import { customer360, globalStats, queryInstalledBase } from '../src/insights/insights.js'
import { seedFromXlsx } from '../src/store/seed.js'

let db: ReturnType<typeof openDb>

beforeAll(async () => {
  db = openDb(':memory:')
  await seedFromXlsx(db)
})

afterAll(() => {
  db.close()
})

describe('customer360', () => {
  it('aggregates equipment per customer', () => {
    const c = allCustomers(db).find((x) => x.name === 'Hospital DemoCare Pacific')
    expect(c).toBeDefined()
    const c360 = customer360(db, c!)
    expect(c360.totalUnits).toBeGreaterThan(0)
    const mr = c360.equipment.find((e) => e.modality === 'MR')
    expect(mr?.totalQuantity).toBe(2)
    expect(mr?.brands).toContain('NovaMed')
  })

  it('detects refresh opportunities for aging equipment', () => {
    const c = allCustomers(db).find((x) => x.name === 'Clinica DemoCare Andes')
    const c360 = customer360(db, c!)
    expect(c360.refreshOpportunity).toBe(true)
  })
})

describe('globalStats', () => {
  it('computes totals from seeded data', () => {
    const s = globalStats(db)
    expect(s.totalObservations).toBe(20)
    expect(s.totalCustomers).toBe(13)
    expect(s.byModality.CT).toBe(12)
    expect(s.byModality.MR).toBe(15)
    expect(s.byModality.Ultrasound).toBe(23)
  })
})

describe('queryInstalledBase', () => {
  it('finds customers in Brazil with MR older than 7 years', () => {
    const res = queryInstalledBase(db, 'customers in Brazil with MR older than 7 years')
    expect(res.country).toBe('brazil')
    expect(res.modality).toBe('mr')
    expect(res.ageThreshold).toBe(7)
    expect(res.results.length).toBeGreaterThan(0)
    expect(res.results[0]!.customer.country).toBe('Brazil')
  })

  it('returns empty for impossible filters', () => {
    const res = queryInstalledBase(db, 'customers in Panama with X-Ray older than 30 years')
    expect(res.results).toHaveLength(0)
  })
})