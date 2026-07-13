import { join, basename, extname } from 'path'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  rmSync,
  statSync
} from 'fs'

export interface RunOptions {
  me: 'left' | 'right'
  meId: number | null
  role: 'lead' | 'follow'
  partner: boolean
  spotlight: boolean
  poseModel: string
  comparePros: boolean
}

export interface RunRecord {
  runId: string
  input: string
  source: 'path' | 'url'
  videoName: string
  options: RunOptions
  partnerName: string | null
  status: 'pending' | 'done' | 'error'
  createdAt: string
  updatedAt: string
  resultPaths: {
    reportPath: string | null
    gapPath: string | null
    metricsPath: string | null
    posesPath: string | null
    videoPath: string | null
  }
  youId: number | null
  // Raw, pre-orientation tracked-dancer id (1|2) that the engine resolved as
  // "you" — i.e. exactly what --me-id selects. Unlike youId (which the engine
  // always normalises to 1 for lead / 2 for follow after orientation), this
  // is what "swap dancers" needs to pick the COMPLEMENTARY physical dancer.
  // Absent on runs from before this field existed.
  youIdRaw: number | null
  videoTitle: string | null
  coverage: Record<string, number | null> | null
  error: string | null
}

const pad = (n: number, len = 2): string => String(n).padStart(len, '0')

// yyyymmdd-HHMMss in local time, matching the plan's runId convention.
function timestamp(d = new Date()): string {
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  )
}

// Lowercase, ascii-safe, dash-separated slug, capped so run dirs stay tidy.
function slug(text: string): string {
  const s = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return (s || 'video').slice(0, 48)
}

// A YouTube URL has no local filename yet at run-creation time — fall back to
// the video id (same extraction the engine's download.py uses) or "video".
function stemFromInput(input: string): string {
  const isUrl = /^https?:\/\//i.test(input)
  if (!isUrl) return basename(input, extname(input))
  const m = input.match(/(?:v=|youtu\.be\/)([A-Za-z0-9_-]{11})/)
  return m ? m[1] : 'video'
}

export function makeRunId(input: string, at = new Date()): string {
  return `${timestamp(at)}-${slug(stemFromInput(input))}`
}

function libraryDir(dataDir: string): string {
  return join(dataDir, 'library')
}

export function runDirPath(dataDir: string, runId: string): string {
  return join(libraryDir(dataDir), runId)
}

function runJsonPath(dataDir: string, runId: string): string {
  return join(runDirPath(dataDir, runId), 'run.json')
}

function writeRun(dataDir: string, record: RunRecord): void {
  writeFileSync(runJsonPath(dataDir, record.runId), JSON.stringify(record, null, 2))
}

export function readRun(dataDir: string, runId: string): RunRecord | null {
  try {
    return JSON.parse(readFileSync(runJsonPath(dataDir, runId), 'utf-8')) as RunRecord
  } catch {
    return null
  }
}

// Create the run directory + initial run.json (status "pending"). Returns the
// runId and its output directory, ready to pass as --out-dir to the engine.
export function createRun(
  dataDir: string,
  input: string,
  options: RunOptions,
  partnerName: string | null
): { runId: string; dir: string } {
  const runId = makeRunId(input)
  const dir = runDirPath(dataDir, runId)
  mkdirSync(dir, { recursive: true })

  const now = new Date().toISOString()
  const record: RunRecord = {
    runId,
    input,
    source: /^https?:\/\//i.test(input) ? 'url' : 'path',
    videoName: stemFromInput(input),
    options,
    partnerName,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    resultPaths: {
      reportPath: null,
      gapPath: null,
      metricsPath: null,
      posesPath: null,
      videoPath: null
    },
    youId: null,
    youIdRaw: null,
    videoTitle: null,
    coverage: null,
    error: null
  }
  writeRun(dataDir, record)
  return { runId, dir }
}

export interface AnalysisResult {
  report_path?: string | null
  gap_path?: string | null
  metrics_path?: string | null
  poses_path?: string | null
  video_path?: string | null
  video_title?: string | null
  you_id?: number | null
  you_id_raw?: number | null
  coverage?: Record<string, number | null> | null
}

export function completeRun(
  dataDir: string,
  runId: string,
  result: AnalysisResult
): RunRecord | null {
  const record = readRun(dataDir, runId)
  if (!record) return null
  record.status = 'done'
  record.updatedAt = new Date().toISOString()
  record.resultPaths = {
    reportPath: result.report_path ?? null,
    gapPath: result.gap_path ?? null,
    metricsPath: result.metrics_path ?? null,
    posesPath: result.poses_path ?? null,
    videoPath: result.video_path ?? null
  }
  if (result.video_path) record.videoName = basename(result.video_path, extname(result.video_path))
  record.youId = result.you_id ?? null
  record.youIdRaw = result.you_id_raw ?? null
  // A rerun that reuses an already-downloaded YouTube file (e.g. the
  // swap-dancers rerun below) doesn't refetch the title — keep whatever
  // title a previous completion already captured instead of blanking it.
  record.videoTitle = result.video_title ?? record.videoTitle ?? null
  record.coverage = result.coverage ?? null
  writeRun(dataDir, record)
  return record
}

// Reuse an existing run dir for a rerun (crowd-mode seed flow's second call, or
// swap-dancers): updates options/partnerName, resets status to 'pending' so the
// UI reflects work in progress, but leaves resultPaths/youId/coverage from the
// previous completion in place until completeRun/failRun overwrite them (so a
// failed rerun doesn't blank out a previously-successful report).
export function beginRerun(
  dataDir: string,
  runId: string,
  options: RunOptions,
  partnerName: string | null
): { runId: string; dir: string } | null {
  const record = readRun(dataDir, runId)
  if (!record) return null
  record.options = options
  record.partnerName = partnerName
  record.status = 'pending'
  record.updatedAt = new Date().toISOString()
  writeRun(dataDir, record)
  return { runId, dir: runDirPath(dataDir, runId) }
}

export function failRun(dataDir: string, runId: string, reason: string): RunRecord | null {
  const record = readRun(dataDir, runId)
  if (!record) return null
  record.status = 'error'
  record.updatedAt = new Date().toISOString()
  record.error = reason
  writeRun(dataDir, record)
  return record
}

// Newest-first.
export function list(dataDir: string): RunRecord[] {
  const dir = libraryDir(dataDir)
  if (!existsSync(dir)) return []
  const entries: RunRecord[] = []
  for (const name of readdirSync(dir)) {
    if (!statSync(join(dir, name)).isDirectory()) continue
    const record = readRun(dataDir, name)
    if (record) entries.push(record)
  }
  return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

function readTextOrNull(path: string | null): string | null {
  if (!path) return null
  try {
    return readFileSync(path, 'utf-8')
  } catch {
    return null
  }
}

export function get(
  dataDir: string,
  runId: string
): { run: RunRecord; reportText: string | null; gapText: string | null } | null {
  const run = readRun(dataDir, runId)
  if (!run) return null
  return {
    run,
    reportText: readTextOrNull(run.resultPaths.reportPath),
    gapText: readTextOrNull(run.resultPaths.gapPath)
  }
}

export function remove(dataDir: string, runId: string): boolean {
  const dir = runDirPath(dataDir, runId)
  if (!existsSync(dir)) return false
  rmSync(dir, { recursive: true, force: true })
  return true
}
