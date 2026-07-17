import { app, shell, dialog, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, rmSync } from 'fs'
import { randomUUID } from 'crypto'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { EngineJob, EngineEvent } from './engine'
import { loadConfig, saveConfig, dataDir, AppConfig } from './config'
import * as library from './library'
import type { RunOptions } from './library'
import * as pros from './pros'
import { setKey, clearKey, keyStatus } from './coach/key'
import { parseAdvice, type CoachGap } from './coach/advise'
import {
  generateReport,
  chat,
  resetConversation,
  hasConversation,
  type AdviseInputs
} from './coach/client'
import {
  detectCli,
  cliGenerateReport,
  cliChat,
  resetCliConversation,
  hasCliConversation
} from './coach/cli'
import { renderPreviousFocuses, saveFocusGroup, readFocusGroups } from './coach/focuses'
import { buildExcerpts } from './notes/excerpts'
import { upsertBlock } from './notes/writer'
import {
  sessionRelPath,
  sessionDate,
  renderRunBlock,
  renderCoachBlock,
  renderFocusesBlock
} from './notes/blocks'

// Best-effort notes-folder write: gated on the opt-in toggle (a notes-write
// failure must never fail the underlying operation, so it's logged, not
// thrown).
function writeNoteBlock(
  cfg: AppConfig,
  opts: {
    relPath: string
    kind: string
    key: string
    content: string
    frontmatter?: Record<string, string>
  }
): void {
  if (!cfg.notesWriteEnabled || !cfg.notesFolder) return
  try {
    const res = upsertBlock({ notesFolder: cfg.notesFolder, ...opts })
    if (!res.ok) console.error('notes write failed:', res.reason)
  } catch (err) {
    console.error('notes write failed:', err)
  }
}

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

  // Sweep pros_work leftovers. A failed add-pro job deliberately keeps its
  // scratch dir (an immediate retry reuses the 25-48 MB pose cache), but
  // nothing running at startup can still want one.
  try {
    rmSync(join(dataDir(), 'pros_work'), { recursive: true, force: true })
  } catch {
    // best-effort — a locked file just delays cleanup to the next launch
  }

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

    const runOptions: RunOptions = {
      me: opts.me,
      meId: opts.meId ?? null,
      role: opts.role,
      partner: opts.partner,
      spotlight: opts.spotlight,
      poseModel: opts.poseModel,
      comparePros: opts.comparePros
    }
    const partnerName = opts.partnerName ?? null

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
    // Only compare against pros the user actually configured (Pros tab) — a
    // missing/empty manifest is handled gracefully by the engine, but there's
    // no point spawning the comparison at all with zero pros.
    if (opts.comparePros) {
      const refs = pros.activeProRefs()
      if (refs) args.push('--compare-pros', '--pro-refs', refs)
    }
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
        if (record) {
          const detail = library.get(dataDir(), runId)
          writeNoteBlock(loadConfig(), {
            relPath: sessionRelPath(runId, record.createdAt),
            kind: 'run',
            key: runId,
            content: renderRunBlock({
              run: record,
              reportText: detail?.reportText ?? null,
              gapText: detail?.gapText ?? null
            }),
            frontmatter: { generator: 'refframe', date: sessionDate(runId, record.createdAt) }
          })
        }
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
      const runOptions: RunOptions = {
        me: opts.me,
        meId: null,
        role: opts.role,
        partner: opts.partner,
        spotlight: opts.spotlight,
        poseModel: opts.poseModel,
        comparePros: opts.comparePros
      }
      const partnerName = opts.partnerName ?? null
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

  // ------------------------------------------------------------------------
  // Pros (v0.2.0) — user-managed pro baselines. Adding a pro is its own job:
  // seed-preview (pick the LEAD, then the partner) -> analyze (role forced to
  // "lead" so the manifest's lead_id lines up with the engine's you_id_raw
  // semantics, compare-pros always off) -> export-baseline. Both engine
  // invocations write into a scratch pros_work/<jobId> dir (never the runs
  // library); on success only the KB-scale metrics JSON survives — the
  // pose cache (25-48 MB) is deleted along with the rest of the scratch dir.
  // ------------------------------------------------------------------------

  ipcMain.handle('pros:list', () => pros.list())
  ipcMain.handle('pros:remove', (_e, id: string) => ({ ok: pros.remove(id) }))

  function prosWorkDir(jobId: string): string {
    return join(dataDir(), 'pros_work', jobId)
  }

  interface ProSeedPreviewArgs {
    input: string
    atSec: number
    poseModel: string
    jobId?: string | null
  }

  ipcMain.handle('pros:seedPreview', async (event, opts: ProSeedPreviewArgs) => {
    if (activeJob) return { ok: false, reason: 'busy' }

    const jobId = opts.jobId ?? randomUUID()
    const dir = prosWorkDir(jobId)

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
        event.sender.send('pros:event', e)
      })
      if (exitCode === 0 && resultEvent && resultEvent.kind === 'seed_preview') {
        const seedPngPath = String(resultEvent.seed_png ?? '')
        const image = `data:image/png;base64,${readFileSync(seedPngPath).toString('base64')}`
        return {
          ok: true,
          jobId,
          dets: resultEvent.dets,
          frameIdx: resultEvent.frame_idx,
          tSec: resultEvent.t_sec,
          video: resultEvent.video_path,
          image
        }
      }
      const reason = errorMsg ?? `engine exited with code ${exitCode}`
      return { ok: false, jobId, reason }
    } catch (err) {
      return { ok: false, jobId, reason: String(err) }
    } finally {
      activeJob = null
    }
  })

  interface AddProArgs {
    jobId: string
    input: string
    poseModel: string
    seedMeIdx: number
    seedPartnerIdx: number
    label: string
    couple: string
  }

  ipcMain.handle('pros:add', async (event, opts: AddProArgs) => {
    if (activeJob) return { ok: false, reason: 'busy' }

    const dir = prosWorkDir(opts.jobId)
    if (!existsSync(dir)) return { ok: false, reason: 'Job not found — run seed preview first' }

    const label = opts.label.trim()
    const couple = opts.couple.trim()
    if (!label || !couple) return { ok: false, reason: 'Label and couple are required' }

    const analyzeArgs = [
      'analyze',
      opts.input,
      '--out-dir',
      dir,
      '--data-dir',
      dataDir(),
      '--me',
      'left',
      '--role',
      'lead',
      '--pose-model',
      opts.poseModel,
      '--seed-me-idx',
      String(opts.seedMeIdx),
      '--seed-partner-idx',
      String(opts.seedPartnerIdx)
    ]
    // compare-pros is deliberately never passed here — a pro baseline is
    // never itself compared against the pro library.

    const analyzeJob = new EngineJob()
    activeJob = analyzeJob
    let analyzeResult: EngineEvent | undefined
    let analyzeErrorMsg: string | undefined
    try {
      const analyzeExit = await analyzeJob.run(analyzeArgs, (e: EngineEvent) => {
        if (e.event === 'result') analyzeResult = e
        if (e.event === 'error' && typeof e.msg === 'string') analyzeErrorMsg = e.msg
        event.sender.send('pros:event', e)
      })
      if (analyzeExit !== 0 || !analyzeResult || analyzeResult.kind !== 'analysis') {
        return { ok: false, reason: analyzeErrorMsg ?? `engine exited with code ${analyzeExit}` }
      }

      const posesPath = String(analyzeResult.poses_path)
      const videoPath = String(analyzeResult.video_path)
      const leadId = Number(analyzeResult.you_id_raw)

      const metricsFilename = pros.uniqueMetricsFilename(label)
      const outPath = join(pros.proBaselinesDir(), metricsFilename)

      const exportArgs = [
        'export-baseline',
        videoPath,
        posesPath,
        '--label',
        label,
        '--couple',
        couple,
        '--lead-id',
        String(leadId),
        '--out',
        outPath
      ]

      const exportJob = new EngineJob()
      activeJob = exportJob
      let exportResult: EngineEvent | undefined
      let exportErrorMsg: string | undefined
      const exportExit = await exportJob.run(exportArgs, (e: EngineEvent) => {
        if (e.event === 'result') exportResult = e
        if (e.event === 'error' && typeof e.msg === 'string') exportErrorMsg = e.msg
        event.sender.send('pros:event', e)
      })
      if (
        exportExit !== 0 ||
        !exportResult ||
        exportResult.kind !== 'export_baseline' ||
        !exportResult.entry
      ) {
        return { ok: false, reason: exportErrorMsg ?? `engine exited with code ${exportExit}` }
      }

      const entry = exportResult.entry as pros.ExportedBaselineEntry
      const added = pros.add(entry)

      rmSync(dir, { recursive: true, force: true })

      return { ok: true, pro: added }
    } catch (err) {
      return { ok: false, reason: String(err) }
    } finally {
      activeJob = null
    }
  })

  // ------------------------------------------------------------------------
  // Coach (phase 4) — two backends (Anthropic API / local Claude Code CLI),
  // notes-folder excerpts, and the dated-focus loop.
  // ------------------------------------------------------------------------

  // Notes folder picker. Reading is always-on once a folder is set (the coach
  // cites markdown lesson notes from it); writing session/coach notes back
  // into it is a separate opt-in toggle (notesWriteEnabled). The path is
  // stored in config (not a secret).
  ipcMain.handle('notes:pickFolder', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })

  // API key: plaintext crosses IPC only inbound (set); status returns
  // configured + last4, never the key itself.
  ipcMain.handle('coach:setKey', (_e, key: string) => setKey(key))
  ipcMain.handle('coach:clearKey', () => clearKey())
  ipcMain.handle('coach:keyStatus', () => keyStatus())
  ipcMain.handle('coach:detectCli', () => detectCli())

  // Backend readiness in one call: which backend is selected + whether it can
  // actually serve a request right now.
  ipcMain.handle('coach:status', async () => {
    const { coachBackend, coachModel, notesFolder, notesWriteEnabled } = loadConfig()
    const key = keyStatus()
    const cli = await detectCli()
    return {
      backend: coachBackend,
      model: coachModel,
      keyConfigured: key.configured,
      cliFound: cli.found,
      cliVersion: cli.version,
      notesConfigured: !!notesFolder,
      notesWritable: !!notesFolder && notesWriteEnabled,
      ready: coachBackend === 'claude-cli' ? cli.found : key.configured
    }
  })

  // Coaching report on a library run. Deltas stream over coach:delta; the
  // invoke resolves with the final prose + parsed gaps + usage/cost.
  ipcMain.handle('coach:report', async (event, runId: string) => {
    const detail = library.get(dataDir(), runId)
    if (!detail) return { ok: false, reason: 'run_not_found' }
    if (!detail.reportText) return { ok: false, reason: 'no_report' }
    const { run, reportText, gapText } = detail
    const cfg = loadConfig()
    const onDelta = (text: string): void => event.sender.send('coach:delta', text)

    // Notes excerpts (optional) and the dancer's previous focuses close the
    // loop: the coach cites their own lessons and builds on prior commitments.
    const practiceNotes = cfg.notesFolder
      ? buildExcerpts({ notesFolder: cfg.notesFolder, gapText, reportText })
      : null
    const previousFocuses = renderPreviousFocuses(join(dataDir(), 'coach'))

    const inputs: AdviseInputs = {
      reportTxt: reportText,
      gapTxt: gapText,
      context: {
        role: run.options.role,
        userName: cfg.userName || null,
        partnerName: run.partnerName,
        spotlight: run.options.spotlight,
        coverage: run.coverage
      },
      practiceNotes,
      previousFocuses
    }
    const res =
      cfg.coachBackend === 'claude-cli'
        ? await cliGenerateReport(inputs, cfg.coachModel, onDelta)
        : await generateReport(inputs, cfg.coachModel, onDelta)
    if (!res.ok || !res.text) return res
    const { prose, gaps }: { prose: string; gaps: CoachGap[] } = parseAdvice(res.text)
    writeNoteBlock(cfg, {
      relPath: sessionRelPath(runId, run.createdAt),
      kind: 'coach',
      key: runId,
      content: renderCoachBlock({ date: new Date().toISOString().slice(0, 10), prose, gaps }),
      frontmatter: { generator: 'refframe', date: sessionDate(runId, run.createdAt) }
    })
    return { ...res, text: prose, gaps }
  })

  ipcMain.handle('coach:chat', (event, text: string) => {
    const onDelta = (t: string): void => event.sender.send('coach:delta', t)
    const { coachBackend, coachModel } = loadConfig()
    return coachBackend === 'claude-cli'
      ? cliChat(text, coachModel, onDelta)
      : chat(text, coachModel, onDelta)
  })

  ipcMain.handle('coach:reset', () => {
    resetConversation()
    resetCliConversation()
    return true
  })

  ipcMain.handle('coach:hasConversation', () => hasConversation() || hasCliConversation())

  // Save the focuses the dancer agreed to as a dated group under
  // data/coach/focuses.json (last 3 kept, fed back into the next report).
  ipcMain.handle(
    'coach:saveFocuses',
    (_e, payload: { date?: string; prose: string; focuses: { gap: string; plan: string }[] }) => {
      const date =
        payload.date && payload.date.trim() ? payload.date : new Date().toISOString().slice(0, 10)
      try {
        const result = saveFocusGroup(join(dataDir(), 'coach'), {
          date,
          prose: payload.prose,
          focuses: payload.focuses
        })
        if (result.ok) {
          // focuses.json stays the source of truth the coach prompt reads;
          // this is a Progress.md mirror for the dancer's own notes folder.
          const groups = readFocusGroups(join(dataDir(), 'coach'))
          writeNoteBlock(loadConfig(), {
            relPath: 'Progress.md',
            kind: 'focuses',
            key: 'current',
            content: renderFocusesBlock(groups),
            frontmatter: { generator: 'refframe', date: new Date().toISOString().slice(0, 10) }
          })
        }
        return result
      } catch (err) {
        return { ok: false, reason: String(err) }
      }
    }
  )

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
