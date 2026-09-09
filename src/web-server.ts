import { readFileSync } from 'node:fs'
import { openDb } from './store/db.js'
import { extractObservation, loadExtractionModel, unloadExtractionModel } from './extract/extractor.js'
import { initEvidence, exportEvidenceCsv } from './evidence/logger.js'
import { createApp } from './http-app.js'

async function main() {
  initEvidence()
  const db = openDb()
  let modelId: string
  try { modelId = await loadExtractionModel() }
  catch (error) { db.close(); throw error }
  const server = createApp({
    db, extract: async text => (await extractObservation(text, modelId)).extraction,
    chatHtml: readFileSync(new URL('./web/chat.html', import.meta.url), 'utf8'),
    dashboardHtml: readFileSync(new URL('./server/index.html', import.meta.url), 'utf8'),
    evidence: exportEvidenceCsv, autoSave: process.env.FIELDSIGHT_AUTOSAVE === '1',
  })
  let stopping = false
  const shutdown = () => {
    if (stopping) return
    stopping = true
    server.close(() => {
      void unloadExtractionModel(modelId).catch(console.error).finally(() => db.close())
    })
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
  server.once('error', error => { console.error(error); process.exitCode = 1; shutdown() })
  const port = Number(process.env.PORT ?? 4174)
  server.listen(port, '127.0.0.1', () => console.log(`FieldSight → http://localhost:${port}`))
}

main().catch(error => { console.error(error); process.exitCode = 1 })
