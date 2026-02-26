/// <reference types="vite/client" />

interface ElectronAPI {
  getVersion: () => Promise<string>
  getPath: (name: string) => Promise<string>
  getApiBaseUrl: () => Promise<string>
  backupDatabase: () => Promise<{ success: boolean; path?: string; error?: string }>
  restoreDatabase: () => Promise<{ success: boolean; error?: string }>
  getDatabasePath: () => Promise<string>
}

interface Window {
  electronAPI?: ElectronAPI
}
