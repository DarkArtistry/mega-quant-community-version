import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { spawn, ChildProcess } from 'child_process'
import fs from 'fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3001'

let mainWindow: BrowserWindow | null = null
let backendProcess: ChildProcess | null = null

function startBackendServer(): Promise<void> {
  return new Promise((resolve) => {
    const isDev = process.env.VITE_DEV_SERVER_URL !== undefined

    if (isDev) {
      const backendPath = path.join(__dirname, '../backend/src/server.ts')
      backendProcess = spawn('tsx', [backendPath], {
        stdio: 'inherit',
        shell: true,
        env: { ...process.env, NODE_ENV: 'development' },
      })

      backendProcess.on('error', (error) => {
        console.error('Backend server failed to start:', error)
      })

      backendProcess.on('exit', (code, signal) => {
        console.log(`Backend exited: code=${code}, signal=${signal}`)
        backendProcess = null
      })

      setTimeout(() => resolve(), 2000)
    } else {
      const backendDir = path.join(process.resourcesPath, 'backend')
      const nodeBinaryPath = path.join(process.resourcesPath, 'nodejs/bin/node')

      backendProcess = spawn(nodeBinaryPath, ['dist/server.js'], {
        cwd: backendDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, NODE_ENV: 'production' },
      })

      if (backendProcess.stdout) {
        backendProcess.stdout.on('data', (data) => console.log('[Backend]', data.toString()))
      }
      if (backendProcess.stderr) {
        backendProcess.stderr.on('data', (data) => console.error('[Backend]', data.toString()))
      }

      backendProcess.on('exit', (code, signal) => {
        console.log(`Backend exited: code=${code}, signal=${signal}`)
        backendProcess = null
      })

      // Health-check polling: wait for backend to respond before continuing
      const maxRetries = 30
      const retryInterval = 200
      let retries = 0

      const poll = () => {
        import('http').then(({ default: http }) => {
          const req = http.get('http://localhost:3001/health', (res) => {
            if (res.statusCode === 200) {
              console.log('[Backend] Health check passed')
              resolve()
            } else {
              retry()
            }
          })
          req.on('error', () => retry())
          req.setTimeout(1000, () => { req.destroy(); retry() })
        })
      }

      const retry = () => {
        retries++
        if (retries >= maxRetries) {
          console.warn('[Backend] Health check timed out after', maxRetries, 'retries, continuing anyway')
          resolve()
        } else {
          setTimeout(poll, retryInterval)
        }
      }

      poll()
    }
  })
}

function stopBackendServer() {
  if (backendProcess) {
    backendProcess.kill('SIGTERM')
    setTimeout(() => {
      if (backendProcess && !backendProcess.killed) {
        backendProcess.kill('SIGKILL')
      }
    }, 5000)
    backendProcess = null
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    backgroundColor: '#0f1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 15, y: 12 },
    show: false,
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(async () => {
  try {
    await startBackendServer()
  } catch (error) {
    console.error('Failed to start backend:', error)
  }
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => stopBackendServer())
app.on('will-quit', () => stopBackendServer())

// ============================================================================
// IPC Handlers
// ============================================================================

ipcMain.handle('app:getVersion', () => app.getVersion())
ipcMain.handle('app:getPath', (_, name: string) => app.getPath(name as any))
ipcMain.handle('app:getApiBaseUrl', () => API_BASE_URL)

// Database path helper
function getDatabasePath(): string {
  return path.join(app.getPath('userData'), 'megaquant.db')
}

ipcMain.handle('app:getDatabasePath', () => getDatabasePath())

ipcMain.handle('app:backupDatabase', async () => {
  const dbPath = getDatabasePath()
  if (!fs.existsSync(dbPath)) {
    return { success: false, error: 'Database file not found' }
  }

  const date = new Date().toISOString().split('T')[0]
  const result = await dialog.showSaveDialog(mainWindow!, {
    defaultPath: `megaquant-backup-${date}.db`,
    filters: [{ name: 'Database', extensions: ['db'] }],
  })

  if (result.canceled || !result.filePath) {
    return { success: false, error: 'Cancelled' }
  }

  try {
    fs.copyFileSync(dbPath, result.filePath)
    return { success: true, path: result.filePath }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle('app:restoreDatabase', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    filters: [{ name: 'Database', extensions: ['db'] }],
    properties: ['openFile'],
  })

  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, error: 'Cancelled' }
  }

  const dbPath = getDatabasePath()
  try {
    fs.copyFileSync(result.filePaths[0], dbPath)
    app.relaunch()
    app.quit()
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
})
