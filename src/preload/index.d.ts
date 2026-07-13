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
  seedMeIdx?: number | null
  seedPartnerIdx?: number | null
  runId?: string | null
}

export interface SeedPreviewOptions {
  input: string
  atSec: number
  poseModel: AppConfig['poseModel']
  runId?: string | null
  me: 'left' | 'right'
  role: 'lead' | 'follow'
  partner: boolean
  spotlight: boolean
  comparePros: boolean
  partnerName?: string | null
}

export interface SeedDetection {
  idx: number
  center: [number, number]
  box: [number, number, number, number]
  conf: number
}

export interface SeedPreviewResult {
  ok: boolean
  runId?: string
  reason?: string
  dets?: SeedDetection[]
  frameIdx?: number
  tSec?: number
  video?: string
  image?: string
}

export interface SetupResult {
  exitCode: number
  result: { data_dir: string; components: Record<string, Record<string, unknown>> } | null
  error: { msg?: string; code?: string } | null
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
  // Raw, pre-orientation tracked-dancer id (1|2) the engine resolved as "you"
  // — what --me-id selects. Use this (not youId) to pick the complementary
  // physical dancer for "swap dancers". Absent on runs predating this field.
  youIdRaw: number | null
  videoTitle: string | null
  coverage: Record<string, number | null> | null
  error: string | null
}

export interface RunDetail {
  run: RunRecord
  reportText: string | null
  gapText: string | null
}

// ---- Coach (phase 4) ----

export type CoachModel = 'opus' | 'sonnet' | 'haiku'

export interface CoachKeyStatus {
  configured: boolean
  last4?: string
}

export interface CliDetection {
  found: boolean
  version?: string
}

export interface CoachStatus {
  backend: 'api' | 'claude-cli'
  model: CoachModel
  keyConfigured: boolean
  cliFound: boolean
  cliVersion?: string
  notesConfigured: boolean
  ready: boolean
}

export interface CoachUsage {
  inputTokens: number
  outputTokens: number
  cacheWriteTokens: number
  cacheReadTokens: number
  costUsd: number
  monthUsd: number
}

export interface CoachGap {
  gap: string
  evidence: string
  suggestion: string
}

export interface CoachResult {
  ok: boolean
  reason?: string
  text?: string
  usage?: CoachUsage
  gaps?: CoachGap[]
}

export interface SetKeyResult {
  ok: boolean
  reason?: string
}

export interface SaveFocusesResult {
  ok: boolean
  reason?: string
  groups?: number
}

export interface SaveFocusesPayload {
  date?: string
  prose: string
  focuses: { gap: string; plan: string }[]
}

export interface ReferenceFrameApi {
  checkUpdate: () => Promise<UpdateCheck>
  getConfig: () => Promise<AppConfig>
  setConfig: (patch: Partial<AppConfig>) => Promise<AppConfig>
  pickVideoFile: () => Promise<string | null>
  analyze: (opts: AnalyzeOptions) => Promise<AnalyzeResult>
  cancelAnalyze: () => Promise<boolean>
  doctor: () => Promise<DoctorResult>
  setupModels: (opts: { poseModel: AppConfig['poseModel'] }) => Promise<SetupResult>
  seedPreview: (opts: SeedPreviewOptions) => Promise<SeedPreviewResult>
  libraryList: () => Promise<RunRecord[]>
  libraryGet: (runId: string) => Promise<RunDetail | null>
  libraryDelete: (runId: string) => Promise<{ ok: boolean }>
  libraryOpenFolder: (runId: string) => Promise<{ ok: boolean }>
  onEngineEvent: (cb: (e: EngineEvent) => void) => () => void
  // Coach (phase 4)
  pickNotesFolder: () => Promise<string | null>
  coachStatus: () => Promise<CoachStatus>
  coachKeyStatus: () => Promise<CoachKeyStatus>
  setCoachKey: (key: string) => Promise<SetKeyResult>
  clearCoachKey: () => Promise<{ ok: boolean }>
  detectClaudeCli: () => Promise<CliDetection>
  coachReport: (runId: string) => Promise<CoachResult>
  coachChat: (text: string) => Promise<CoachResult>
  coachReset: () => Promise<boolean>
  coachHasConversation: () => Promise<boolean>
  saveFocuses: (payload: SaveFocusesPayload) => Promise<SaveFocusesResult>
  onCoachDelta: (cb: (text: string) => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: ReferenceFrameApi
  }
}
