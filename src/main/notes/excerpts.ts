// Read-only notes excerpting for the coach. Given a run's gap-analysis text
// (and the report's SUMMARY FLAGS as a fallback), it finds the dancer's top
// unfavorable gaps, maps each to search terms via the hubmap, and greps their
// notes folder for matching bullet lines — handing the coach the dancer's own
// prior instruction for closing each gap. It NEVER writes and never invents:
// the coach may only cite what appears in what this returns.

import { join, basename } from 'path'
import { readdirSync, readFileSync, statSync } from 'fs'
import { termsForGap } from './hubmap'

const MAX_FILES = 2000 // sanity cap so a huge vault can't stall a report
const MAX_BYTES = 12 * 1024 // ~12 KB budget for the excerpt block
const MAX_GAPS = 4 // top unfavorable gaps to bridge
const MAX_PER_FILE = 6 // don't let one note dominate the budget

interface Gap {
  label: string
  relative: number
}

// Exported row shape for blocks.ts's session-summary table — it wants the
// actual you/pro numbers, not just the ranking this module uses internally.
export interface GapRow {
  label: string
  you: number
  pro: number
  relative: number
}

// A gap-analysis row, e.g.
//   "Art. standing-leg knee flex p90 (ceiling) — you  you=36.8  pro avg=105.7  ▼ -68.9"
// Unfavorable rows carry ▼ — the regex requires it, so favorable (▲) rows
// never match and are implicitly excluded. Partnership rows use "you=…" with
// no "— you"/"— partner" suffix. We rank by RELATIVE gap size since metrics
// have wildly different scales, and skip "— partner" rows (that's the
// dancer's partner, not the dancer).
const ROW_RE = /^(.*?)\s{2,}(?:you|partner)=(-?[\d.]+)\s+pro avg=(-?[\d.]+)\s+▼/

// Exported for reuse by blocks.ts's renderRunBlock, which needs the same row
// parsing plus the raw you/pro values for its markdown table. Keep this the
// single source of truth for gap-row parsing — buildExcerpts below only ever
// reads .label/.relative off the result, so its behavior is unchanged.
export function parseGapRows(gapText: string): GapRow[] {
  const best = new Map<string, GapRow>()
  for (const raw of gapText.split(/\r?\n/)) {
    const line = raw.trimEnd()
    const m = line.match(ROW_RE)
    if (!m) continue
    let label = m[1].trim()
    if (/—\s*partner\s*$/i.test(label)) continue // partner's own rows — skip
    label = label.replace(/\s*—\s*(you|partner)\s*$/i, '').trim()
    const you = parseFloat(m[2])
    const pro = parseFloat(m[3])
    if (!isFinite(you) || !isFinite(pro)) continue
    const relative = Math.abs(you - pro) / (Math.abs(pro) + Math.abs(you) + 1e-9)
    const prev = best.get(label)
    if (prev === undefined || relative > prev.relative) best.set(label, { label, you, pro, relative })
  }
  return [...best.values()]
}

// Fallback when no --compare-pros gap table exists: the report's SUMMARY FLAGS
// block. Each flagged line ([!]/[~]) names a metric we can route via hubmap.
// Exported (flagged lines only) so blocks.ts can render the same fallback as
// plain bullets when a run has no gap table.
export function parseSummaryFlags(reportText: string): string[] {
  const start = reportText.indexOf('SUMMARY FLAGS')
  if (start === -1) return []
  const tail = reportText.slice(start)
  const lines: string[] = []
  for (const raw of tail.split(/\r?\n/)) {
    const line = raw.trim()
    if (!/^\[[!~]\]/.test(line)) continue
    lines.push(line)
  }
  return lines
}

// Recursively collect *.md paths under root, breadth-capped.
function collectMarkdown(root: string): string[] {
  const out: string[] = []
  const stack = [root]
  while (stack.length && out.length < MAX_FILES) {
    const dir = stack.pop() as string
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (const name of entries) {
      if (name.startsWith('.')) continue
      const full = join(dir, name)
      let st: ReturnType<typeof statSync>
      try {
        st = statSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) stack.push(full)
      else if (name.toLowerCase().endsWith('.md')) out.push(full)
      if (out.length >= MAX_FILES) break
    }
  }
  return out
}

// A term matches on a word boundary for single words (so "post" doesn't hit
// "poster") and as a plain case-insensitive substring for phrases.
function makeMatcher(terms: string[]): (line: string) => boolean {
  const singles = terms.filter((t) => !/\s/.test(t)).map((t) => t.toLowerCase())
  const phrases = terms.filter((t) => /\s/.test(t)).map((t) => t.toLowerCase())
  const wordRe =
    singles.length > 0
      ? new RegExp(
          '\\b(' + singles.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\b',
          'i'
        )
      : null
  return (line: string): boolean => {
    const l = line.toLowerCase()
    if (wordRe && wordRe.test(line)) return true
    return phrases.some((p) => l.includes(p))
  }
}

const isBullet = (line: string): boolean => /^\s*(?:[-*+]|\d+\.)\s+/.test(line)

// Our own writer.ts stamps managed <!-- refframe:begin/end kind key --> spans
// into the vault (see writer.ts). "run" blocks are our compact metrics/gap
// summary — if the coach re-read those as the dancer's own notes it would
// quote our output back at itself. "coach"/"focuses" blocks stay eligible:
// prior advice and agreed focuses are exactly what a coach should build on.
// Only "run" toggles the skip; other kinds are ignored entirely (fall through
// to normal bullet matching).
const RUN_BEGIN_RE = /^\s*<!--\s*refframe:begin\s+run\s+\S+\s*-->\s*$/
const RUN_END_RE = /^\s*<!--\s*refframe:end\s+run\s+\S+\s*-->\s*$/

/**
 * Build the <practice_notes> excerpt block for a run, or null when there's
 * nothing to show (no folder, no mapped gaps, or no matching bullets).
 */
export function buildExcerpts(opts: {
  notesFolder: string
  gapText: string | null
  reportText: string | null
}): string | null {
  const { notesFolder, gapText, reportText } = opts
  if (!notesFolder) return null

  // Rank the unfavorable gaps, take the top few, keep only mapped ones.
  // parseSummaryFlags now returns plain flag-line strings (blocks.ts reuses
  // it as-is for its own fallback), so wrap them back into the local Gap
  // shape here — every fallback line gets equal (1) rank, same as before.
  const gaps: Gap[] = (
    gapText
      ? parseGapRows(gapText).map((r) => ({ label: r.label, relative: r.relative }))
      : parseSummaryFlags(reportText ?? '').map((label) => ({ label, relative: 1 }))
  )
    .sort((a, b) => b.relative - a.relative)
    .filter((g) => termsForGap(g.label).length > 0)
    .slice(0, MAX_GAPS)
  if (gaps.length === 0) return null

  const terms = [...new Set(gaps.flatMap((g) => termsForGap(g.label)))]
  const matches = makeMatcher(terms)

  let files: string[]
  try {
    files = collectMarkdown(notesFolder)
  } catch {
    return null
  }

  const blocks: string[] = []
  let bytes = 0
  outer: for (const file of files) {
    let text: string
    try {
      text = readFileSync(file, 'utf-8')
    } catch {
      continue
    }
    const lines = text.split(/\r?\n/)
    const name = basename(file)
    const excerpts: string[] = []
    const seen = new Set<number>()
    let inRunBlock = false
    for (let i = 0; i < lines.length; i++) {
      if (RUN_BEGIN_RE.test(lines[i])) {
        inRunBlock = true
        continue
      }
      if (RUN_END_RE.test(lines[i])) {
        inRunBlock = false
        continue
      }
      if (inRunBlock) continue
      if (excerpts.length >= MAX_PER_FILE) break
      if (!isBullet(lines[i]) || !matches(lines[i])) continue
      if (seen.has(i)) continue
      // The matched bullet with ±1 line of context.
      const from = Math.max(0, i - 1)
      const to = Math.min(lines.length - 1, i + 1)
      const chunk: string[] = []
      for (let j = from; j <= to; j++) {
        if (seen.has(j)) continue
        seen.add(j)
        const t = lines[j].trim()
        if (t) chunk.push(t)
      }
      if (chunk.length) excerpts.push(chunk.join('\n'))
    }
    if (excerpts.length === 0) continue
    const block = `## ${name}\n${excerpts.join('\n')}`
    if (bytes + block.length > MAX_BYTES) {
      if (blocks.length === 0) blocks.push(block.slice(0, MAX_BYTES))
      break outer
    }
    blocks.push(block)
    bytes += block.length + 2
  }

  return blocks.length ? blocks.join('\n\n') : null
}
