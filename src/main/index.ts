import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    backgroundColor: '#07090d',
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('app.referenceframe')

  // F12 devtools in dev, ignore CmdOrCtrl+R in production.
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Passive update check: compare the newest published GitHub release to the
  // running version. No downloading — the banner links to the releases page.
  // Full auto-update (electron-updater) is deferred until code signing.
  ipcMain.handle('update:check', async () => {
    const current = app.getVersion()
    try {
      const res = await fetch(
        'https://api.github.com/repos/ajay-phatak/reference-frame/releases/latest',
        { headers: { Accept: 'application/vnd.github+json' } }
      )
      if (!res.ok) return { current, latest: null, newer: false }
      const rel = (await res.json()) as { tag_name?: string; html_url?: string }
      const latest = (rel.tag_name ?? '').replace(/^v/, '')
      const toParts = (v: string): number[] => v.split('.').map((n) => parseInt(n, 10) || 0)
      const [c, l] = [toParts(current), toParts(latest)]
      const newer = latest !== '' && (l[0] - c[0] || l[1] - c[1] || l[2] - c[2]) > 0
      return { current, latest, newer, url: rel.html_url }
    } catch {
      return { current, latest: null, newer: false }
    }
  })

  // Stub — real config store (src/main/config.ts) lands with phase 2.
  ipcMain.handle('config:get', () => ({ onboarded: true }))

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
