import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  getPath: (name: string) => ipcRenderer.invoke('app:getPath', name),
  getApiBaseUrl: () => ipcRenderer.invoke('app:getApiBaseUrl'),
  backupDatabase: () => ipcRenderer.invoke('app:backupDatabase'),
  restoreDatabase: () => ipcRenderer.invoke('app:restoreDatabase'),
  getDatabasePath: () => ipcRenderer.invoke('app:getDatabasePath'),
})

export interface ElectronAPI {
  getVersion: () => Promise<string>
  getPath: (name: string) => Promise<string>
  getApiBaseUrl: () => Promise<string>
  backupDatabase: () => Promise<{ success: boolean; path?: string; error?: string }>
  restoreDatabase: () => Promise<{ success: boolean; error?: string }>
  getDatabasePath: () => Promise<string>
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}
