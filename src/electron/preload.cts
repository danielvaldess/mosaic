import { contextBridge, ipcRenderer } from 'electron'

interface LauncherStatus {
  message: string
  progress?: number
}

contextBridge.exposeInMainWorld('mosaic', {
  onStatus: (callback: (status: LauncherStatus) => void): void => {
    ipcRenderer.on('mosaic:status', (_event, status: LauncherStatus) => callback(status))
  },
})
