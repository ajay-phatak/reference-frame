import { app, shell, dialog, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { EngineJob, EngineEvent, proRefsPath } from './engine'
import { loadConfig, saveConfig, dataDir, AppConfig } from './config'
import * as library from './library'
import type { RunOptions } from './library'

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

  ipcMain.handle('config:get', () => loadConfig())
  ipcMain.handle('config:set', (_e, patch: Partial<AppConfig>) => saveConfig(patch))

  ipcMain.handle('video:pickFile', async () => {
    const r = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'm4v', 'avi', 'mkv'] }]
    })
    return r.canceled ? null : r.filePaths[0]
  })

  // One active analysis at a time (nojohns activeFetch pattern) — the Analyze
  // view disables the Run button while a job is in flight, this is the
  // server-side backstop.
  let activeJob: EngineJob | null = null

  interface AnalyzeArgs {
    input: string
    me: 'left' | 'right'
    meId?: number | null
    role: 'lead' | 'follow'
    partner: boolean
    spotlight: boolean
    poseModel: string
    comparePros: boolean
    partnerName?: string | null
    seedMeIdx?: number | null
    seedPartnerIdx?: number | null
    runId?: string | null
  }

  ipcMain.handle('engine:analyze', async (event, opts: AnalyzeArgs) => {
    if (activeJob) return { ok: false, reason: 'busy' }

    const config = loadConfig()
    const runOptions: RunOptions = {
      me: opts.me,
      meId: opts.meId ?? null,
      role: opts.role,
      partner: opts.partner,
      spotlight: opts.spotlight,
      poseModel: opts.poseModel,
      comparePros: opts.comparePros
    }
    const partnerName = opts.partnerName ?? config.partnerName

    let runId: string
    let dir: string
    if (opts.runId) {
      const reused = library.beginRerun(dataDir(), opts.runId, runOptions, partnerName)
      if (!reused) return { ok: false, reason: 'run not found' }
      runId = reused.runId
      dir = reused.dir
    } else {
      const created = library.createRun(dataDir(), opts.input, runOptions, partnerName)
      runId = created.runId
      dir = created.dir
    }

    const args = [
      'analyze',
      opts.input,
      '--out-dir',
      dir,
      '--data-dir',
      dataDir(),
      '--me',
      opts.me,
      '--role',
      opts.role,
      '--pose-model',
      opts.poseModel
    ]
    if (opts.meId != null) args.push('--me-id', String(opts.meId))
    if (opts.partner) args.push('--partner')
    if (opts.spotlight) args.push('--spotlight')
    if (opts.comparePros) args.push('--compare-pros', '--pro-refs', proRefsPath())
    if (opts.seedMeIdx != null) args.push('--seed-me-idx', String(opts.seedMeIdx))
    if (opts.seedPartnerIdx != null) args.push('--seed-partner-idx', String(opts.seedPartnerIdx))

    const job = new EngineJob()
    activeJob = job
    let resultEvent: EngineEvent | undefined
    let errorMsg: string | undefined
    try {
      const exitCode = await job.run(args, (e: EngineEvent) => {
        if (e.event === 'result') resultEvent = e
        if (e.event === 'error' && typeof e.msg === 'string') errorMsg = e.msg
        event.sender.send('engine:event', e)
      })
      if (exitCode === 0 && resultEvent && resultEvent.kind === 'analysis') {
        const record = library.completeRun(dataDir(), runId, resultEvent as library.AnalysisResult)
        return {
          ok: true,
          runId,
          report: record?.resultPaths.reportPath ?? null,
          gap: record?.resultPaths.gapPath ?? null,
          tracking: record?.coverage ?? null
        }
      }
      const reason = errorMsg ?? `engine exited with code ${exitCode}`
      library.failRun(dataDir(), runId, reason)
      return { ok: false, runId, reason }
    } catch (err) {
      const reason = String(err)
      library.failRun(dataDir(), runId, reason)
      return { ok: false, runId, reason }
    } finally {
      activeJob = null
    }
  })

  ipcMain.handle('engine:cancel', () => {
    activeJob?.cancel()
    return true
  })

  ipcMain.handle('engine:doctor', async (event) => {
    let result: EngineEvent | null = null
    let error: EngineEvent | null = null
    const job = new EngineJob()
    const exitCode = await job.run(['doctor', '--data-dir', dataDir()], (e: EngineEvent) => {
      if (e.event === 'result') result = e
      if (e.event === 'error') error = e
      event.sender.send('engine:event', e)
    })
    return { exitCode, result, error }
  })

  ipcMain.handle('engine:setup', async (event, opts: { poseModel: string }) => {
    if (activeJob) return { ok: false, reason: 'busy' }

    let result: EngineEvent | null = null
    let error: EngineEvent | null = null
    const job = new EngineJob()
    activeJob = job
    try {
      const exitCode = await job.run(
        ['setup', '--data-dir', dataDir(), '--pose-model', opts.poseModel],
        (e: EngineEvent) => {
          if (e.event === 'result') result = e
          if (e.event === 'error') error = e
          event.sender.send('engine:event', e)
        }
      )
      return { exitCode, result, error }
    } finally {
      activeJob = null
    }
  })

  interface SeedPreviewArgs {
    input: string
    atSec: number
    poseModel: string
    runId?: string | null
    me: 'left' | 'right'
    role: 'lead' | 'follow'
    partner: boolean
    spotlight: boolean
    comparePros: boolean
    partnerName?: string | null
  }

  ipcMain.handle('engine:seedPreview', async (event, opts: SeedPreviewArgs) => {
    if (activeJob) return { ok: false, reason: 'busy' }

    let runId: string
    let dir: string
    if (opts.runId) {
      dir = library.runDirPath(dataDir(), opts.runId)
      if (!existsSync(dir)) return { ok: false, reason: 'run not found' }
      runId = opts.runId
    } else {
      const config = loadConfig()
      const runOptions: RunOptions = {
        me: opts.me,
        meId: null,
        role: opts.role,
        partner: opts.partner,
        spotlight: opts.spotlight,
        poseModel: opts.poseModel,
        comparePros: opts.comparePros
      }
      const partnerName = opts.partnerName ?? config.partnerName
      const created = library.createRun(dataDir(), opts.input, runOptions, partnerName)
      runId = created.runId
      dir = created.dir
    }

    const args = [
      'seed-preview',
      opts.input,
      '--at',
      String(opts.atSec),
      '--out-dir',
      dir,
      '--data-dir',
      dataDir(),
      '--pose-model',
      opts.poseModel
    ]

    const job = new EngineJob()
    activeJob = job
    let resultEvent: EngineEvent | undefined
    let errorMsg: string | undefined
    try {
      const exitCode = await job.run(args, (e: EngineEvent) => {
        if (e.event === 'result') resultEvent = e
        if (e.event === 'error' && typeof e.msg === 'string') errorMsg = e.msg
        event.sender.send('engine:event', e)
      })
      if (exitCode === 0 && resultEvent && resultEvent.kind === 'seed_preview') {
        const seedPngPath = String(resultEvent.seed_png ?? '')
        const image = `data:image/png;base64,${readFileSync(seedPngPath).toString('base64')}`
        return {
          ok: true,
          runId,
          dets: resultEvent.dets,
          frameIdx: resultEvent.frame_idx,
          tSec: resultEvent.t_sec,
          video: resultEvent.video_path,
          image
        }
      }
      const reason = errorMsg ?? `engine exited with code ${exitCode}`
      return { ok: false, runId, reason }
    } catch (err) {
      return { ok: false, runId, reason: String(err) }
    } finally {
      activeJob = null
    }
  })

  ipcMain.handle('library:list', () => library.list(dataDir()))
  ipcMain.handle('library:get', (_e, runId: string) => library.get(dataDir(), runId))
  ipcMain.handle('library:delete', (_e, runId: string) => ({
    ok: library.remove(dataDir(), runId)
  }))
  ipcMain.handle('library:openFolder', async (_e, runId: string) => {
    const dir = library.runDirPath(dataDir(), runId)
    const err = await shell.openPath(dir)
    return { ok: err === '' }
  })

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
