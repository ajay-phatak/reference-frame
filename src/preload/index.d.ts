import { ElectronAPI } from '@electron-toolkit/preload'

// NDJSON event contract shared with the refframe-engine sidecar.
export interface EngineEvent {
  event: 'progress' | 'log' | 'result' | 'error'
  stage?: string
  current?: number
  total?: number
  detail?: string
  msg?: string
  level?: string
  code?: string
  kind?: string
  [key: string]: unknown
}

export interface AppConfig {
  role: 'lead' | 'follow'
  defaultMe: 'left' | 'right'
  partnerName: string | null
  poseModel: 'n' | 's' | 'm' | 'l' | 'x'
  notesFolder: string | null
  coachBackend: 'api' | 'claude-cli'
  coachModel: 'opus' | 'sonnet' | 'haiku'
  onboarded: boolean
}

export interface UpdateCheck {
  current: string
  latest: string | null
  newer: boolean
  url?: string
}

export interface AnalyzeOptions {
  input: string
  me: 'left' | 'right'
  meId?: number | null
  role: 'lead' | 'follow'
  partner: boolean
  spotlight: boolean
  poseModel: 'n' | 's' | 'm' | 'l' | 'x'
  comparePros: boolean
  partnerName?: string | null
}

export interface AnalyzeResult {
  ok: boolean
  runId?: string
  reason?: string
  report?: string | null
  gap?: string | null
  tracking?: Record<string, number | null> | null
}

export interface DoctorCheck {
  ok: boolean
  path?: string
  error?: string
  version?: string
  size_bytes?: number
  entries?: number
  [key: string]: unknown
}

export interface DoctorResult {
  exitCode: number
  result:
    | ({
        ok: boolean
      } & Record<string, DoctorCheck>)
    | null
  error: { msg?: string; code?: string } | null
}

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
  coverage: Record<string, number | null> | null
  error: string | null
}

export interface RunDetail {
  run: RunRecord
  reportText: string | null
  gapText: string | null
}

export interface ReferenceFrameApi {
  checkUpdate: () => Promise<UpdateCheck>
  getConfig: () => Promise<AppConfig>
  setConfig: (patch: Partial<AppConfig>) => Promise<AppConfig>
  pickVideoFile: () => Promise<string | null>
  analyze: (opts: AnalyzeOptions) => Promise<AnalyzeResult>
  cancelAnalyze: () => Promise<boolean>
  doctor: () => Promise<DoctorResult>
  libraryList: () => Promise<RunRecord[]>
  libraryGet: (runId: string) => Promise<RunDetail | null>
  libraryDelete: (runId: string) => Promise<{ ok: boolean }>
  libraryOpenFolder: (runId: string) => Promise<{ ok: boolean }>
  onEngineEvent: (cb: (e: EngineEvent) => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: ReferenceFrameApi
  }
}
