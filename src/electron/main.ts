import { app, BrowserWindow, Menu, dialog, shell, type MenuItemConstructorOptions } from 'electron'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { MosaicServer } from '../web-server.js'
import { initLogging, log, showCrashDialog } from './logging.js'
import { applySecurityPolicies, installNavigationGuards } from './security.js'
import { checkForUpdates, setupAutoUpdates } from './updates.js'

if (process.env['MOSAIC_USER_DATA_DIR']) {
  app.setPath('userData', resolve(process.env['MOSAIC_USER_DATA_DIR']))
}
app.setName('Mosaic')
app.setAppUserModelId('com.mosaic.app')
app.enableSandbox()

const isPackaged = app.isPackaged

// Resolve storage paths and the bundled model before the server modules load,
// because they capture env vars at import time.
process.env['MOSAIC_DATA_DIR'] ??= join(app.getPath('userData'), 'data')
process.env['MOSAIC_EVIDENCE_DIR'] ??= join(app.getPath('userData'), 'evidence')
process.env['MOSAIC_SEED_PATH'] ??= isPackaged
  ? join(process.resourcesPath, 'dummy_installed_base.json')
  : join(process.cwd(), 'data', 'dummy_installed_base.json')
process.env['QVAC_CONFIG_PATH'] ??= isPackaged
  ? join(process.resourcesPath, 'qvac.config.json')
  : join(process.cwd(), 'qvac.config.json')

const bundledModelPath = isPackaged
  ? join(process.resourcesPath, 'models', 'Qwen3-1.7B-Q4_0.gguf')
  : join(process.cwd(), 'assets', 'models', 'Qwen3-1.7B-Q4_0.gguf')
if (process.env['MOSAIC_EXTRACT_MODEL'] !== 'small' && existsSync(bundledModelPath)) {
  process.env['MOSAIC_MODEL_PATH'] ??= bundledModelPath
}

const iconPath = isPackaged
  ? join(process.resourcesPath, 'icon.ico')
  : join(process.cwd(), 'build', 'icon.ico')

let win: BrowserWindow | null = null
let running: MosaicServer | null = null
let appOrigin: string | undefined
let quitting = false

const allowedOrigin = (): string | undefined => appOrigin

function sendStatus(message: string, progress?: number): void {
  if (!win || win.isDestroyed()) return
  win.webContents.send('mosaic:status', { message, progress })
}

function buildMenu(): Menu {
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        { label: 'Open data folder', click: () => void shell.openPath(app.getPath('userData')) },
        { label: 'Open logs folder', click: () => void shell.openPath(app.getPath('logs')) },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        ...(isPackaged ? [] : [{ type: 'separator' as const }, { role: 'toggleDevTools' as const }]),
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Check for updates', enabled: isPackaged, click: () => void checkForUpdates() },
        { label: 'Open logs folder', click: () => void shell.openPath(app.getPath('logs')) },
      ],
    },
  ]
  return Menu.buildFromTemplate(template)
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    show: false,
    backgroundColor: '#0b1220',
    title: 'Mosaic',
    ...(existsSync(iconPath) ? { icon: iconPath } : {}),
    webPreferences: {
      preload: join(import.meta.dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
    },
  })
  window.once('ready-to-show', () => window.show())
  window.on('closed', () => { win = null })
  window.webContents.on('render-process-gone', (_event, details) => {
    log.error('Renderer process gone', details)
    showCrashDialog(`The window process stopped unexpectedly (${details.reason}).`)
  })
  if (!isPackaged) {
    window.webContents.on('before-input-event', (event, input) => {
      const isDevTools = input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')
      if (input.type === 'keyDown' && isDevTools) {
        window.webContents.toggleDevTools()
        event.preventDefault()
      }
    })
  }
  return window
}

async function bootstrap(): Promise<void> {
  Menu.setApplicationMenu(buildMenu())
  applySecurityPolicies(allowedOrigin)
  installNavigationGuards(allowedOrigin)

  win = createWindow()
  await win.loadFile(join(import.meta.dirname, 'loading.html'))

  try {
    const { seedFromXlsx } = await import('../store/seed.js')
    seedFromXlsx()
  } catch (error) {
    log.warn('Seed skipped', error)
  }

  const { startMosaicServer } = await import('../web-server.js')
  const server = await startMosaicServer({
    port: Number(process.env['PORT'] ?? 0),
    onModelProgress: (update) => {
      const pct = Math.round(update.percentage)
      sendStatus(pct >= 100 ? 'Preparing the chat…' : `Downloading on-device AI model… ${pct}%`, update.percentage)
    },
  })
  running = server
  appOrigin = `http://127.0.0.1:${server.port}`
  if (!win || win.isDestroyed()) return
  const { loadSettings } = await import('../settings.js')
  const initialPath = loadSettings().onboardingComplete ? '/' : '/onboarding'
  await win.loadURL(`${appOrigin}${initialPath}`)
  setupAutoUpdates(() => win)
}

app.on('child-process-gone', (_event, details) => {
  log.error('Child process gone', details)
})

initLogging()

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
      log.error('Fatal startup error', error)
      dialog.showErrorBox('Mosaic', error instanceof Error ? error.message : String(error))
      app.quit()
    })
}
