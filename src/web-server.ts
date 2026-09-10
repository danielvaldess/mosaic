import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { openDb } from './store/db.js'
import { createInference } from './extract/provider.js'
import { initEvidence, exportEvidenceCsv } from './evidence/logger.js'
import { createApp } from './http-app.js'

export interface FieldSightServer {
  port: number
  close: () => Promise<void>
}

/**
 * Boots the API + chat UI and starts listening. Shared by the terminal
 * entrypoint (npm run web) and the Electron desktop shell, which passes
 * port 0 so the OS assigns a free port.
 */
export async function startFieldSightServer(
  options: { port?: number; host?: string } = {},
): Promise<FieldSightServer> {
  initEvidence()
  const db = openDb()
  const inference = await createInference()
  const server = createApp({
    db, extract: inference.extract,
    chatHtml: readFileSync(new URL('./web/chat.html', import.meta.url), 'utf8'),
    dashboardHtml: readFileSync(new URL('./server/index.html', import.meta.url), 'utf8'),
    evidence: exportEvidenceCsv, autoSave: process.env.FIELDSIGHT_AUTOSAVE === '1',
  })
  const host = options.host ?? '127.0.0.1'
  const requestedPort = options.port ?? Number(process.env.PORT ?? 4174)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(requestedPort, host, () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : requestedPort
  let closing: Promise<void> | undefined
  const close = () => {
    closing ??= new Promise<void>((resolve) => {
      server.close(() => {
        void inference.dispose().catch(console.error).finally(() => { db.close(); resolve() })
      })
    })
    return closing
  }
  return { port, close }
}

async function main() {
  const running = await startFieldSightServer()
  console.log(`FieldSight → http://localhost:${running.port}`)
  let stopping = false
  const shutdown = () => {
    if (stopping) return
    stopping = true
    void running.close().finally(() => process.exit(0))
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error); process.exitCode = 1 })
}
