import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { openDb, allCustomers } from './store/db.js'
import { customer360, globalStats } from './insights/insights.js'

const DB = openDb()
const PORT = Number(process.env.PORT ?? 4173)

const HTML = readFileSync(new URL('./server/index.html', import.meta.url), 'utf8')

function json(res: import('node:http').ServerResponse, data: unknown, code = 200) {
  res.writeHead(code, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`)

  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(HTML)
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
  if (url.pathname === '/api/customers/refresh') {
    const all = allCustomers(DB).map((c) => customer360(DB, c))
    json(res, all.filter((c) => c.refreshOpportunity))
    return
  }
  json(res, { error: 'not found' }, 404)
}).listen(PORT, '127.0.0.1', () => {
  console.log(`FieldSight dashboard → http://localhost:${PORT}`)
})

export default {} as unknown