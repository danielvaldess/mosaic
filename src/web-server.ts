import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { openDb, findOrCreateCustomer, allCustomers } from './store/db.js'
import { extractObservation, loadExtractionModel, unloadExtractionModel } from './extract/extractor.js'
import { handleObservation, type AgentReply } from './agent/agent.js'
import { customer360, globalStats, queryInstalledBase } from './insights/insights.js'
import { initEvidence, exportEvidenceCsv } from './evidence/logger.js'

const PORT = Number(process.env.PORT ?? 4174)
const DB = openDb()
let MODEL_ID = ''

const HTML = readFileSync(join(process.cwd(), 'src', 'web', 'chat.html'), 'utf8')

function json(res: ServerResponse, data: unknown, code = 200) {
  res.writeHead(code, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => resolve(body))
  })
}

async function handleChat(req: IncomingMessage, res: ServerResponse) {
  const body = await readBody(req)
  const { message, history = [] } = JSON.parse(body)

  if (!message) {
    json(res, { error: 'message required' }, 400)
    return
  }

  const start = Date.now()
  const { extraction } = await extractObservation(message, MODEL_ID)

  if (!extraction.customer?.name) {
    json(res, {
      reply: 'Which customer/hospital are you at?',
      needCustomerInfo: true,
      extraction,
      ms: Date.now() - start,
    })
    return
  }

  const customer = findOrCreateCustomer(DB, {
    name: extraction.customer.name!,
    city: extraction.customer.city ?? 'Unknown',
    country: extraction.customer.country ?? 'Unknown',
    site: extraction.customer.site,
  })

  const reply: AgentReply = handleObservation({
    db: DB,
    extraction,
    customer,
    observer: process.env.FIELDSIGHT_OBSERVER ?? 'Web User',
    observedAt: new Date().toISOString(),
    rawInput: message,
    source: 'Text',
    autoSave: process.env.FIELDSIGHT_AUTOSAVE === '1',
  })

  json(res, {
    reply: reply.message,
    followUps: reply.followUps,
    observation: reply.observation,
    saved: reply.saved,
    duplicates: reply.duplicates,
    ms: Date.now() - start,
  })
}

async function handleFollowUp(req: IncomingMessage, res: ServerResponse) {
  const body = await readBody(req)
  const { originalInput, followUpQuestion, answer, customerInfo } = JSON.parse(body)

  const start = Date.now()
  const combinedInput = `${originalInput}. Follow-up: ${followUpQuestion} -> ${answer}`
  const { extraction } = await extractObservation(combinedInput, MODEL_ID)

  if (customerInfo) {
    extraction.customer = { ...extraction.customer, ...customerInfo }
  }

  if (!extraction.customer?.name) {
    json(res, { error: 'Customer info required' }, 400)
    return
  }

  const customer = findOrCreateCustomer(DB, {
    name: extraction.customer.name!,
    city: extraction.customer.city ?? 'Unknown',
    country: extraction.customer.country ?? 'Unknown',
    site: extraction.customer.site,
  })

  const reply: AgentReply = handleObservation({
    db: DB,
    extraction,
    customer,
    observer: process.env.FIELDSIGHT_OBSERVER ?? 'Web User',
    observedAt: new Date().toISOString(),
    rawInput: combinedInput,
    source: 'Text',
    autoSave: process.env.FIELDSIGHT_AUTOSAVE === '1',
  })

  json(res, {
    reply: reply.message,
    followUps: reply.followUps,
    observation: reply.observation,
    saved: reply.saved,
    duplicates: reply.duplicates,
    ms: Date.now() - start,
  })
}

function handleQuery(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url!, `http://${req.headers.host}`)
  const q = url.searchParams.get('q') ?? ''
  if (!q) {
    json(res, { error: 'q parameter required' }, 400)
    return
  }
  const result = queryInstalledBase(DB, q)
  json(res, result)
}

async function main() {
  initEvidence()
  console.log('Loading AI model (GPU)...')
  MODEL_ID = await loadExtractionModel()
  console.log('Model loaded.')

  createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`)

    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(HTML)
      return
    }

    if (url.pathname === '/api/chat' && req.method === 'POST') {
      await handleChat(req, res)
      return
    }

    if (url.pathname === '/api/followup' && req.method === 'POST') {
      await handleFollowUp(req, res)
      return
    }

    if (url.pathname === '/api/stats') {
      json(res, globalStats(DB))
      return
    }

    if (url.pathname === '/api/customers') {
      const all = allCustomers(DB)
      json(res, all.map((c) => customer360(DB, c)))
      return
    }

    if (url.pathname === '/api/query') {
      handleQuery(req, res)
      return
    }

    if (url.pathname === '/api/evidence') {
      const csv = exportEvidenceCsv()
      res.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename=evidence.csv' })
      res.end(csv)
      return
    }

    json(res, { error: 'not found' }, 404)
  }).listen(PORT, () => {
    console.log(`\nFieldSight Web → http://localhost:${PORT}`)
    console.log('Open in your browser to start chatting with the AI.\n')
  })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
