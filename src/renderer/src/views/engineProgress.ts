// Plain (non-component) helpers shared between Analyze and Pros — split out
// of shared.tsx because react-refresh/only-export-components requires
// component files to export components only.

export interface StageState {
  current: number
  total: number
  detail?: string
  startedAt: number
}

export const STAGE_ORDER = [
  'download',
  'seed',
  'extract',
  'refine',
  'lift',
  'metrics',
  'report',
  'gap'
] as const

export const STAGE_LABELS: Record<string, string> = {
  download: 'Download video',
  seed: 'Locate dancers',
  extract: 'Detect poses',
  refine: 'Refine keypoints',
  lift: 'Lift to 3D',
  metrics: 'Compute metrics',
  report: 'Build report',
  gap: 'Compare vs pros'
}

export function stagePct(s: StageState): number {
  if (s.total > 0) return Math.max(0, Math.min(100, Math.round((s.current / s.total) * 100)))
  return s.current > 0 ? 100 : 0
}

// ETA from the observed rate so far — only meaningful once a stage has moved
// past its first tick and knows its total (extract/refine/download; the
// discrete 0/1 stages skip this).
export function etaLabel(s: StageState): string | null {
  if (s.total <= 1 || s.current <= 0) return null
  const elapsed = Date.now() - s.startedAt
  if (elapsed <= 0) return null
  const rate = s.current / elapsed
  if (rate <= 0) return null
  const remainingMs = (s.total - s.current) / rate
  const secs = Math.round(remainingMs / 1000)
  if (secs <= 0) return null
  return secs < 60 ? `~${secs}s left` : `~${Math.round(secs / 60)}m left`
}

export function sortedStages(stageProgress: Record<string, StageState>): string[] {
  return Object.keys(stageProgress).sort(
    (a, b) =>
      STAGE_ORDER.indexOf(a as (typeof STAGE_ORDER)[number]) -
      STAGE_ORDER.indexOf(b as (typeof STAGE_ORDER)[number])
  )
}

export function looksLikeYoutubeUrl(s: string): boolean {
  return /^https?:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)/i.test(s)
}

// Shared click-to-assign-first-then-second behaviour for a seed picker: click
// toggles off if re-clicking an already-assigned box, otherwise fills first
// then second.
export function makeSeedBoxClickHandler(
  firstIdx: number | null,
  secondIdx: number | null,
  setFirstIdx: (v: number | null) => void,
  setSecondIdx: (v: number | null) => void
): (idx: number) => void {
  return (idx: number) => {
    if (idx === firstIdx) {
      setFirstIdx(null)
      return
    }
    if (idx === secondIdx) {
      setSecondIdx(null)
      return
    }
    if (firstIdx === null) {
      setFirstIdx(idx)
    } else if (secondIdx === null) {
      setSecondIdx(idx)
    }
  }
}

// --- Error text ---

// Electron wraps main-process rejections as
// "Error invoking remote method 'x:y': Error: <real message>". Strip that
// wrapper (and any bare leading "Error: ") so users see the real message.
export function friendlyError(err: unknown): string {
  let msg = err instanceof Error ? err.message : String(err)
  msg = msg.replace(/^Error invoking remote method '[^']*':\s*/, '')
  msg = msg.replace(/^(?:[A-Za-z]*Error:\s*)+/, '')
  msg = msg.trim()
  return msg || 'Unknown error'
}

// The main process reports a user-initiated cancel as exactly "canceled".
export function isCanceledMessage(msg: string | null | undefined): boolean {
  return friendlyError(msg ?? '').toLowerCase() === 'canceled'
}

// --- Buffered progress/log state ---

export const MAX_LOG_LINES = 500

export function appendLog(logs: string[], msg: string, cap: number = MAX_LOG_LINES): string[] {
  const next = logs.concat(msg)
  return next.length > cap ? next.slice(next.length - cap) : next
}

export function applyProgress(
  prev: Record<string, StageState>,
  stage: string,
  e: { current?: unknown; total?: unknown; detail?: unknown },
  now: number = Date.now()
): Record<string, StageState> {
  return {
    ...prev,
    [stage]: {
      current: typeof e.current === 'number' ? e.current : 0,
      total: typeof e.total === 'number' ? e.total : 0,
      detail: typeof e.detail === 'string' ? e.detail : undefined,
      startedAt: prev[stage]?.startedAt ?? now
    }
  }
}

// --- Crowd-mode pick validation ---

// Picks must be two distinct detection indices that exist in the seed
// detections. Returns a user-facing problem, or null when valid.
export function validatePicks(
  a: number | null,
  b: number | null,
  dets: { idx: number }[] | null
): string | null {
  if (a == null || b == null) return 'Pick both dancers'
  if (a === b) return 'Pick two different dancers'
  const ids = new Set((dets ?? []).map((d) => d.idx))
  if (!ids.has(a) || !ids.has(b)) return 'Picked numbers must match a detected dancer'
  return null
}
