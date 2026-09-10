import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { z } from 'zod'
import { Conversation } from './agent/conversation.js'
import type { Extraction } from './types.js'
import { allCustomers, getChatSuggestions } from './store/db.js'
import { customer360, globalStats, queryInstalledBase } from './insights/insights.js'

const requestSchema = z.object({
  message: z.string().trim().min(1).max(8000),
  sessionId: z.string().uuid().optional(),
  question: z.string().max(1000).optional(),
  lang: z.enum(['en', 'es', 'pt', 'fr', 'de', 'it', 'nl']).optional(),
})
class HttpError extends Error { constructor(public status: number, message: string) { super(message) } }

async function readBody(req: IncomingMessage) {
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
  try { return requestSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
  catch { throw new HttpError(400, 'Invalid request: provide a message and a valid sessionId when continuing.') }
}

export function createApp(options: {
  db: Database.Database; extract: (text: string) => Promise<Extraction>
  chatHtml: string; dashboardHtml: string; evidence: () => string; autoSave?: boolean
}) {
  const sessions = new Map<string, { conversation: Conversation; touched: number }>()
  let busy = false
  function json(res: ServerResponse, data: unknown, status = 200) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
    res.end(JSON.stringify(data))
  }
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost')
      if (req.method === 'POST' && ['/api/chat', '/api/followup'].includes(url.pathname)) {
        if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) throw new HttpError(403, 'Origin not allowed')
        const body = await readBody(req)
        if (busy) throw new HttpError(409, 'Another observation is being processed. Please retry shortly.')
        const now = Date.now()
        for (const [id, session] of sessions) if (now - session.touched > 3600000) sessions.delete(id)
        let session = body.sessionId ? sessions.get(body.sessionId) : undefined
        if (body.sessionId && !session) throw new HttpError(410, 'Conversation expired. Start a new observation.')
        const sessionId = body.sessionId ?? randomUUID()
        if (!session) {
          if (sessions.size >= 100) throw new HttpError(503, 'Too many active conversations. Retry later.')
          const conv = new Conversation(options.db, options.extract, process.env.FIELDSIGHT_OBSERVER ?? 'Web User', options.autoSave)
          if (body.lang) conv.setLockedLanguage(body.lang)
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
      if (['/', '/index.html', '/dashboard'].includes(url.pathname)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'X-Content-Type-Options': 'nosniff' })
        res.end(url.pathname === '/dashboard' ? options.dashboardHtml : options.chatHtml)
      } else if (url.pathname === '/api/stats') json(res, globalStats(options.db))
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
