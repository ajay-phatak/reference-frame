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
