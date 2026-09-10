import { app, BrowserWindow, Menu, dialog, shell } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { FieldSightServer } from '../web-server.js'

app.setName('FieldSight')
app.setAppUserModelId('com.fieldsight.app')

const isPackaged = app.isPackaged

// Resolve storage paths and the demo-friendly model before the server modules
// load, because they capture env vars at import time.
process.env['FIELDSIGHT_EXTRACT_MODEL'] ??= 'small'
process.env['FIELDSIGHT_DATA_DIR'] ??= join(app.getPath('userData'), 'data')
process.env['FIELDSIGHT_EVIDENCE_DIR'] ??= join(app.getPath('userData'), 'evidence')
process.env['FIELDSIGHT_SEED_PATH'] ??= isPackaged
  ? join(process.resourcesPath, 'dummy_installed_base.json')
  : join(process.cwd(), 'data', 'dummy_installed_base.json')
process.env['QVAC_CONFIG_PATH'] ??= isPackaged
  ? join(process.resourcesPath, 'qvac.config.json')
  : join(process.cwd(), 'qvac.config.json')

const iconPath = isPackaged
  ? join(process.resourcesPath, 'icon.ico')
  : join(process.cwd(), 'build', 'icon.ico')

let win: BrowserWindow | null = null
let running: FieldSightServer | null = null
let quitting = false

function sendStatus(message: string, progress?: number): void {
  if (!win || win.isDestroyed()) return
  win.webContents.send('fieldsight:status', { message, progress })
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    show: false,
    backgroundColor: '#0b1220',
    title: 'FieldSight',
    ...(existsSync(iconPath) ? { icon: iconPath } : {}),
    webPreferences: {
      preload: join(import.meta.dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })
  window.once('ready-to-show', () => window.show())
  window.on('closed', () => { win = null })
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('before-input-event', (event, input) => {
    const isDevTools = input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')
    if (input.type === 'keyDown' && isDevTools) {
      window.webContents.toggleDevTools()
      event.preventDefault()
    }
  })
  return window
}

async function bootstrap(): Promise<void> {
  Menu.setApplicationMenu(null)
  win = createWindow()
  await win.loadFile(join(import.meta.dirname, 'loading.html'))

  try {
    const { seedFromXlsx } = await import('../store/seed.js')
    seedFromXlsx()
  } catch (error) {
    console.error('Seed skipped:', error)
  }

  const { setModelProgressListener } = await import('../extract/extractor.js')
  setModelProgressListener((update) => {
    const pct = Math.round(update.percentage)
    sendStatus(pct >= 100 ? 'Preparing the chat…' : `Downloading on-device AI model… ${pct}%`, update.percentage)
  })

  const { startFieldSightServer } = await import('../web-server.js')
  const server = await startFieldSightServer({ port: Number(process.env['PORT'] ?? 0) })
  running = server
  setModelProgressListener(undefined)
  if (!win || win.isDestroyed()) return
  await win.loadURL(`http://127.0.0.1:${server.port}/`)
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })
  app.on('window-all-closed', () => app.quit())
  app.on('before-quit', (event) => {
    if (!running || quitting) return
    event.preventDefault()
    quitting = true
    const server = running
    running = null
    void server.close().finally(() => app.quit())
  })
  app.whenReady()
    .then(bootstrap)
    .catch((error: unknown) => {
      console.error(error)
      dialog.showErrorBox('FieldSight', error instanceof Error ? error.message : String(error))
      app.quit()
    })
}
