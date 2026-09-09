import { afterEach, expect, it, vi } from 'vitest'
import { createApp } from '../src/http-app.js'
import { openDb, allObservations } from '../src/store/db.js'
import type { Extraction } from '../src/types.js'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup() })
async function setup() {
  const db = openDb(':memory:')
  const extract = vi.fn(async (_text: string): Promise<Extraction> => ({ customer: {name: 'Hospital'}, equipment: [{modality: 'MR', quantity: 2}] }))
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
