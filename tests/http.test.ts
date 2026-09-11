import { afterEach, expect, it, vi } from 'vitest'
import { createApp } from '../src/http-app.js'
import { openDb, allObservations, findOrCreateCustomer, clearDb } from '../src/store/db.js'
import type { Extraction } from '../src/types.js'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup() })
async function setup() {
  const db = openDb(':memory:')
  const extract = vi.fn(async (_text: string): Promise<Extraction> => ({ customer: {name: 'Hospital DemoCare Pacific'}, equipment: [{modality: 'MR', quantity: 2, brand: 'NovaMed', model: 'NM-MR 700', ageMin: 7}] }))
  const server = createApp({db, extract, chatHtml: '<h1>Chat</h1>', dashboardHtml: '<h1>Dashboard</h1>', evidence: () => 'csv'})
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as {port: number}
  const base = `http://127.0.0.1:${address.port}`
  cleanups.push(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); db.close() })
  const post = (body: unknown) => fetch(base + '/api/chat', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)})
  return {db, extract, base, post}
}
it('isolates conversations and confirms only the matching session', async () => {
  const {db, post, extract} = await setup()
  const a = await (await post({message: 'Two MR systems'})).json() as {sessionId: string}
  const b = await (await post({message: 'Two MR systems elsewhere'})).json() as {sessionId: string}
  expect(a.sessionId).not.toBe(b.sessionId)
  await post({message: 'confirm', sessionId: a.sessionId})
  await post({message: 'confirm', sessionId: a.sessionId})
  expect(allObservations(db)).toHaveLength(1)
  expect(extract).toHaveBeenCalledTimes(2)
})
it('returns validation errors and continues serving the dashboard', async () => {
  const {base, post} = await setup()
  expect((await post({message: 123})).status).toBe(400)
  expect((await post({message: 'x'.repeat(65000)})).status).toBe(413)
  expect((await fetch(base + '/api/chat', {method: 'POST', body: '{'})).status).toBe(400)
  expect((await post({message: 'hello', sessionId: crypto.randomUUID()})).status).toBe(410)
  expect(await (await fetch(base + '/dashboard')).text()).toBe('<h1>Dashboard</h1>')
})
it('recovers after inference failure', async () => {
  const {post, extract} = await setup()
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    extract.mockRejectedValueOnce(new Error('model error'))
    expect((await post({message: 'Two MR systems'})).status).toBe(500)
    expect((await post({message: 'Two MR systems'})).status).toBe(200)
  } finally { log.mockRestore() }
})

it('serves Excel options even when the live database is empty, polluted or cleared', async () => {
  const {db, base} = await setup()
  const read = async () => await (await fetch(base + '/api/suggestions')).json() as {hospitals: string[]; models: string[]; brands: string[]}
  const initial = await read()
  expect(initial.hospitals).toHaveLength(13)
  expect(initial.models).toHaveLength(20)
  expect(initial.brands).toContain('NovaMed')
  expect(initial.brands).not.toContain('Philips')
  findOrCreateCustomer(db, {name: 'Invented Hospital', city: 'Atlantis', country: 'Atlantis'})
  expect(await read()).toEqual(initial)
  clearDb(db)
  expect(await read()).toEqual(initial)
  const mr = await (await fetch(base + '/api/suggestions/modality?modality=MR')).json() as {models: string[]; ages: string[]}
  expect(mr.models).toContain('NM-MR 700')
  expect(mr.models).not.toContain('AH-CT 320')
  expect(mr.ages).toContain('7')
  const absent = await (await fetch(base + '/api/suggestions/modality?modality=X-Ray')).json() as {models: string[]; brands: string[]}
  expect(absent.models).toEqual([])
  expect(absent.brands).toEqual([])
})

it('validates direct API answers, rejects spoofed hints and saves only the completed catalog record', async () => {
  const {db, post, extract} = await setup()
  extract.mockResolvedValue({customer: {name: 'Hospital DemoCare Pacific'}, equipment:[{modality:'MR',quantity:2}]})
  const start = await (await post({message:'Two MR systems',lang:'es'})).json() as {sessionId:string;suggestions:string[]}
  expect(start.suggestions).toEqual(['NovaMed'])
  const rejected = await (await post({message:'Philips',sessionId:start.sessionId,intent:'notes',question:'notes',modality:'CT'})).json() as {suggestions:string[];observation?:unknown}
  expect(rejected.suggestions).toEqual(['NovaMed'])
  expect(rejected.observation).toBeUndefined()
  await post({message:'save anyway',sessionId:start.sessionId})
  expect(allObservations(db)).toHaveLength(0)
  for (const message of ['NovaMed','NM-MR 700','7','confirm']) await post({message,sessionId:start.sessionId})
  expect(allObservations(db)).toHaveLength(1)
  expect(extract).toHaveBeenCalledTimes(1)
})
