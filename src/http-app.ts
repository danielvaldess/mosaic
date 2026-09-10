import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { z } from 'zod'
import { Conversation } from './agent/conversation.js'
import type { Extraction } from './types.js'
import { allCustomers, getChatSuggestions } from './store/db.js'
import { customer360, globalStats, queryInstalledBase } from './insights/insights.js'
import { loadSettings, saveSettings, type AppSettings } from './settings.js'

const requestSchema = z.object({
  message: z.string().trim().min(1).max(8000),
  sessionId: z.string().uuid().optional(),
  question: z.string().max(1000).optional(),
  lang: z.enum(['en', 'es', 'pt', 'fr', 'de', 'it', 'nl']).optional(),
})

const settingsSchema = z.object({
  name: z.string().trim().min(1).max(80),
  language: z.enum(['en', 'es']),
  location: z.object({
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    accuracy: z.number().nonnegative().optional(),
    city: z.string().trim().max(120).optional(),
    country: z.string().trim().max(120).optional(),
  }).optional(),
})

class HttpError extends Error { constructor(public status: number, message: string) { super(message) } }

async function readBody<T>(req: IncomingMessage, schema: z.ZodType<T>, errorMessage: string): Promise<T> {
  let size = 0
  const chunks: Buffer[] = []
  await new Promise<void>((resolve, reject) => {
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 64000) { reject(new HttpError(413, 'Request too large')); return }
      chunks.push(chunk)
    })
    req.on('end', resolve)
    req.on('error', reject)
    req.on('aborted', () => reject(new HttpError(400, 'Request aborted')))
  })
  try { return schema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
  catch { throw new HttpError(400, errorMessage) }
}

export interface SettingsStore {
  get: () => AppSettings
  save: (settings: AppSettings) => AppSettings
}

export function createApp(options: {
  db: Database.Database; extract: (text: string) => Promise<Extraction>
  chatHtml: string; dashboardHtml: string; evidence: () => string; autoSave?: boolean
  onboardingHtml?: string
  logoPng?: Buffer
  settingsStore?: SettingsStore
  ready?: () => { ready: boolean; progress: number }
}) {
  const sessions = new Map<string, { conversation: Conversation; touched: number }>()
  const settingsStore = options.settingsStore ?? { get: loadSettings, save: saveSettings }
  let busy = false
  function json(res: ServerResponse, data: unknown, status = 200) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
    res.end(JSON.stringify(data))
  }
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost')
      if (req.method === 'POST' && url.pathname === '/api/settings') {
        if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) throw new HttpError(403, 'Origin not allowed')
        const body = await readBody(req, settingsSchema, 'Invalid settings payload.')
        const saved = settingsStore.save({ ...settingsStore.get(), ...body, onboardingComplete: true })
        json(res, saved)
        return
      }
      if (req.method === 'POST' && ['/api/chat', '/api/followup'].includes(url.pathname)) {
        if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) throw new HttpError(403, 'Origin not allowed')
        const body = await readBody(req, requestSchema, 'Invalid request: provide a message and a valid sessionId when continuing.')
        if (busy) throw new HttpError(409, 'Another observation is being processed. Please retry shortly.')
        const now = Date.now()
        for (const [id, session] of sessions) if (now - session.touched > 3600000) sessions.delete(id)
        let session = body.sessionId ? sessions.get(body.sessionId) : undefined
        if (body.sessionId && !session) throw new HttpError(410, 'Conversation expired. Start a new observation.')
        const sessionId = body.sessionId ?? randomUUID()
        if (!session) {
          if (sessions.size >= 100) throw new HttpError(503, 'Too many active conversations. Retry later.')
          const settings = settingsStore.get()
          const observer = settings.name ?? process.env.MOSAIC_OBSERVER ?? 'Web User'
          const conv = new Conversation(options.db, options.extract, observer, options.autoSave)
          // The language chosen during onboarding is locked for every conversation.
          const locked = settings.language ?? body.lang
          if (locked) conv.setLockedLanguage(locked)
          session = { conversation: conv, touched: now }
          sessions.set(sessionId, session)
        }
        busy = true
        try {
          const reply = await session.conversation.turn(body.message, body.question, body.lang)
          session.touched = Date.now()
          json(res, { ...reply, reply: reply.message, sessionId, ms: Date.now() - now })
        } finally { busy = false }
        return
      }
      if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed')
      if (url.pathname === '/onboarding') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'X-Content-Type-Options': 'nosniff' })
        res.end(options.onboardingHtml ?? options.chatHtml)
      } else if (['/', '/index.html', '/dashboard'].includes(url.pathname)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'X-Content-Type-Options': 'nosniff' })
        res.end(url.pathname === '/dashboard' ? options.dashboardHtml : options.chatHtml)
      } else if (url.pathname === '/mosaic-logo.png' && options.logoPng) {
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' })
        res.end(options.logoPng)
      } else if (url.pathname === '/api/settings') json(res, settingsStore.get())
      else if (url.pathname === '/api/ready') json(res, options.ready?.() ?? { ready: true, progress: 100 })
      else if (url.pathname === '/api/stats') json(res, globalStats(options.db))
      else if (url.pathname === '/api/customers') json(res, allCustomers(options.db).map(c => customer360(options.db, c)))
      else if (url.pathname === '/api/customers/refresh') json(res, globalStats(options.db).refreshCandidates)
      else if (url.pathname === '/api/suggestions') json(res, getChatSuggestions(options.db))
      else if (url.pathname === '/api/query') {
        const q = url.searchParams.get('q')?.trim()
        if (!q) throw new HttpError(400, 'q parameter required')
        json(res, queryInstalledBase(options.db, q))
      } else if (url.pathname === '/api/evidence') {
        res.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename=evidence.csv' })
        res.end(options.evidence())
      } else throw new HttpError(404, 'Not found')
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500
      if (status === 500) console.error(error)
      if (!res.destroyed && !res.headersSent) json(res, { error: status === 500 ? 'Could not process the observation. Please retry.' : (error as Error).message }, status)
    }
  })
}
