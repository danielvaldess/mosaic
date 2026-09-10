import { contextBridge, ipcRenderer } from 'electron'

interface LauncherStatus {
  message: string
  progress?: number
}

contextBridge.exposeInMainWorld('fieldsight', {
  onStatus: (callback: (status: LauncherStatus) => void): void => {
    ipcRenderer.on('fieldsight:status', (_event, status: LauncherStatus) => callback(status))
  },
})
