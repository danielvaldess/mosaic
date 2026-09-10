import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import type { ModelProgressUpdate } from '@qvac/sdk'
import { openDb } from './store/db.js'
import { createInference, type ExtractFn, type InferenceHandle } from './extract/provider.js'
import { setModelProgressListener } from './extract/extractor.js'
import { initEvidence, exportEvidenceCsv } from './evidence/logger.js'
import { createApp } from './http-app.js'

export interface MosaicServer {
  port: number
  ready: () => { ready: boolean; progress: number }
  close: () => Promise<void>
}

/**
 * Boots the API + chat UI and starts listening immediately. The model loads in
 * the background (the desktop shell shows onboarding/progress meanwhile); the
 * first inference waits for it through `extract`.
 */
export async function startMosaicServer(
  options: { port?: number; host?: string; onModelProgress?: (update: ModelProgressUpdate) => void } = {},
): Promise<MosaicServer> {
  initEvidence()
  const db = openDb()
  let modelReady = false
  let modelProgress = 0
  let inference: InferenceHandle | undefined
  let inferenceError: unknown

  const inferencePromise = createInference().then((handle) => {
    inference = handle
    modelReady = true
    modelProgress = 100
    return handle
  })
  inferencePromise.catch((error: unknown) => { inferenceError = error })

  setModelProgressListener((update) => {
    modelProgress = update.percentage
    options.onModelProgress?.(update)
  })

  const extract: ExtractFn = async (text) => {
    if (inferenceError) throw inferenceError
    const handle = inference ?? await inferencePromise
    return handle.extract(text)
  }

  const server = createApp({
    db, extract,
    chatHtml: readFileSync(new URL('./web/chat.html', import.meta.url), 'utf8'),
    dashboardHtml: readFileSync(new URL('./server/index.html', import.meta.url), 'utf8'),
    onboardingHtml: readFileSync(new URL('./web/onboarding.html', import.meta.url), 'utf8'),
    logoPng: readFileSync(new URL('./web/mosaic-logo.png', import.meta.url)),
    evidence: exportEvidenceCsv, autoSave: process.env.MOSAIC_AUTOSAVE === '1',
    ready: () => ({ ready: modelReady, progress: modelProgress }),
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
        setModelProgressListener(undefined)
        if (inference) {
          void inference.dispose().catch(console.error).finally(() => { db.close(); resolve() })
        } else {
          // Model still loading: never block shutdown on a background download.
          void inferencePromise.catch(() => {}).then(() => inference?.dispose()).catch(console.error)
          db.close()
          resolve()
        }
      })
    })
    return closing
  }
  return { port, ready: () => ({ ready: modelReady, progress: modelProgress }), close }
}

async function main() {
  const running = await startMosaicServer()
  console.log(`Mosaic → http://localhost:${running.port}`)
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
