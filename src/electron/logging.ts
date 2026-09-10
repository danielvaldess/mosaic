import { app, dialog } from 'electron'
import log from 'electron-log/main'

/**
 * File logging lives in the OS app-log folder (Electron's `logs` path), with
 * catching handlers installed for uncaught main-process errors.
 */
export function initLogging(): void {
  log.transports.file.level = 'info'
  log.transports.console.level = app.isPackaged ? false : 'debug'
  log.initialize()
  log.errorHandler.startCatching({ showDialog: false })
  log.info(`Mosaic ${app.getVersion()} starting (packaged=${app.isPackaged})`)
}

export function showCrashDialog(message: string): void {
  dialog.showErrorBox('Mosaic', `${message}\n\nLogs: ${app.getPath('logs')}`)
}

export { log }
