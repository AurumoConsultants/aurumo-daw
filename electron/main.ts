import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import 'dotenv/config'
import { runChat } from './claude'
import electronUpdater from 'electron-updater'

const { autoUpdater } = electronUpdater

// dist-electron/main.js  ->  ../  is project root
process.env.APP_ROOT = path.join(__dirname, '..')

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL
const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

let win: BrowserWindow | null = null

// ---- lightweight config store (API key) ----
function configPath() {
  return path.join(app.getPath('userData'), 'config.json')
}
function readConfig(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf-8'))
  } catch {
    return {}
  }
}
function writeConfig(cfg: Record<string, string>) {
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2))
}
function getApiKey(): string | undefined {
  return readConfig().anthropicApiKey || process.env.ANTHROPIC_API_KEY
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 640,
    backgroundColor: '#0e0f13',
    title: 'Aurumo DAW',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

// ---- IPC ----
ipcMain.handle('settings:getKeyStatus', () => ({ hasKey: !!getApiKey() }))

ipcMain.handle('settings:setKey', (_e, key: string) => {
  const cfg = readConfig()
  cfg.anthropicApiKey = (key || '').trim()
  writeConfig(cfg)
  return { hasKey: !!getApiKey() }
})

ipcMain.handle('claude:chat', async (_e, payload: { messages: any[]; project: any }) => {
  const apiKey = getApiKey()
  if (!apiKey) {
    return { error: 'no_api_key', text: '', commands: [] }
  }
  try {
    return await runChat(apiKey, payload.messages, payload.project)
  } catch (err: any) {
    return { error: 'api_error', message: String(err?.message || err), text: '', commands: [] }
  }
})

// ---- auto-update (packaged builds only) ----
function sendUpdate(status: Record<string, unknown>) {
  win?.webContents.send('update:status', status)
}

function setupAutoUpdate() {
  if (VITE_DEV_SERVER_URL) return // no updates in dev
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => sendUpdate({ state: 'checking' }))
  autoUpdater.on('update-available', (info) => sendUpdate({ state: 'available', version: info.version }))
  autoUpdater.on('update-not-available', () => sendUpdate({ state: 'none' }))
  autoUpdater.on('download-progress', (p) => sendUpdate({ state: 'downloading', percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', (info) => sendUpdate({ state: 'ready', version: info.version }))
  autoUpdater.on('error', (err) => sendUpdate({ state: 'error', message: String(err?.message || err) }))

  autoUpdater.checkForUpdates().catch(() => {})
  // re-check every 6 hours while the app stays open
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 6 * 60 * 60 * 1000)
}

ipcMain.handle('update:check', async () => {
  if (VITE_DEV_SERVER_URL) return { state: 'dev' }
  try {
    await autoUpdater.checkForUpdates()
    return { ok: true }
  } catch (err: any) {
    return { ok: false, message: String(err?.message || err) }
  }
})

ipcMain.handle('update:restart', () => {
  autoUpdater.quitAndInstall()
})

app.whenReady().then(() => {
  createWindow()
  setupAutoUpdate()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
  win = null
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
