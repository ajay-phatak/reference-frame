// Pure markdown renderers for the notes writer — no fs, no Electron. Each
// function returns the CONTENT of a managed block only; writer.ts wraps it
// in the begin/end markers. Kept separate from writer.ts so the rendering
// logic (what a session/coach/focuses block looks like) is unit-testable
// without touching a filesystem at all.

import type { RunRecord } from '../library'
import type { CoachGap } from '../coach/advise'
import type { FocusGroup } from '../coach/focuses'
import { parseGapRows, parseSummaryFlags } from './excerpts'

const MAX_ROWS = 8

// runIds are `${yyyymmdd}-${HHMMss}-${slug}` (see makeRunId in library.ts) —
// parsing the date from the prefix means every rerun of the same run lands
// in the same Sessions/ file, even if wall-clock time has moved on.
const RUN_ID_DATE_RE = /^(\d{4})(\d{2})(\d{2})-\d{6}-/

function dateFromRunId(runId: string, fallbackIso: string): string {
  const m = runId.match(RUN_ID_DATE_RE)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  return fallbackIso.slice(0, 10)
}

export function sessionRelPath(runId: string, fallbackIso: string): string {
  return `Sessions/${dateFromRunId(runId, fallbackIso)}.md`
}

export function sessionDate(runId: string, fallbackIso: string): string {
  return dateFromRunId(runId, fallbackIso)
}

// Coverage values come straight from the engine and aren't normalized to a
// single scale — treat anything <=1 as a 0..1 fraction (multiply up) and
// anything else as an already-scaled 0..100 percentage. Simple by design:
// the only ambiguous case (a metric that's legitimately 0 or 1 point-something
// percent) doesn't occur for coverage, which is always a substantial share.
function formatCoveragePct(v: number): string {
  const pct = v <= 1 ? v * 100 : v
  return `${Math.round(pct)}%`
}

// Trim floating-point noise without hardcoding a unit — gap-table values
// span wildly different scales (ms, degrees, fractions, counts).
function formatNum(n: number): string {
  if (Number.isInteger(n)) return String(n)
  return n.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}

function metaLine(run: RunRecord): string {
  const parts: string[] = [`role: ${run.options.role}`]
  parts.push(
    run.options.partner
      ? `partner tracking: on${run.partnerName ? ` (${run.partnerName})` : ''}`
      : 'partner tracking: off'
  )
  parts.push(`spotlight: ${run.options.spotlight ? 'on' : 'off'}`)
  parts.push(`pros: ${run.options.comparePros ? 'compared' : 'not compared'}`)
  if (run.coverage) {
    const cov = Object.entries(run.coverage)
      .filter((e): e is [string, number] => e[1] !== null)
      .map(([k, v]) => `${k} ${formatCoveragePct(v)}`)
    if (cov.length > 0) parts.push(`coverage: ${cov.join(', ')}`)
  }
  return `_${parts.join(' · ')}_`
}

export function renderRunBlock(opts: {
  run: RunRecord
  reportText: string | null
  gapText: string | null
}): string {
  const { run, reportText, gapText } = opts
  const title = run.videoTitle ?? run.videoName
  const lines: string[] = [`## Run ${title}`, '', metaLine(run), '']

  const rows = gapText
    ? [...parseGapRows(gapText)].sort((a, b) => b.relative - a.relative).slice(0, MAX_ROWS)
    : []

  if (rows.length > 0) {
    lines.push('| Metric | You | Pro avg |')
    lines.push('| --- | --- | --- |')
    for (const r of rows) lines.push(`| ${r.label} | ${formatNum(r.you)} | ${formatNum(r.pro)} |`)
  } else {
    const flags = parseSummaryFlags(reportText ?? '').slice(0, MAX_ROWS)
    if (flags.length > 0) {
      lines.push('### Summary flags')
      for (const f of flags) lines.push(`- ${f}`)
    } else {
      lines.push('_No gap comparison for this run._')
    }
  }

  return lines.join('\n')
}

export function renderCoachBlock(opts: { date: string; prose: string; gaps: CoachGap[] }): string {
  const { date, prose, gaps } = opts
  const lines = [`## Coach's read (${date})`, '', prose.trim()]
  if (gaps.length > 0) {
    lines.push('', '### Suggested focuses')
    for (const g of gaps) lines.push(`- **${g.gap}** — ${g.suggestion}`)
  }
  return lines.join('\n')
}

// groups are oldest-first, as stored in focuses.json — rendered in that same
// order so the file reads chronologically top-to-bottom.
export function renderFocusesBlock(groups: FocusGroup[]): string {
  const lines = ['## Focuses']
  for (const g of groups) {
    lines.push('', `### ${g.date}`)
    for (const f of g.focuses) lines.push(`- **${f.gap}** — ${f.plan}`)
  }
  return lines.join('\n')
}
