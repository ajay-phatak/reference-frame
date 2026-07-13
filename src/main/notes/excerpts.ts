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

// A gap-analysis row, e.g.
//   "Art. standing-leg knee flex p90 (ceiling) — you  you=36.8  pro avg=105.7  ▼ -68.9"
// Unfavorable rows carry ▼. Partnership rows use "you=…" with no "— you"/"—
// partner" suffix. We rank by RELATIVE gap size since metrics have wildly
// different scales, and skip "— partner" rows (that's the dancer's partner).
const ROW_RE = /^(.*?)\s{2,}(?:you|partner)=(-?[\d.]+)\s+pro avg=(-?[\d.]+)\s+▼/

function parseGapRows(gapText: string): Gap[] {
  const best = new Map<string, number>()
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
    if (prev === undefined || relative > prev) best.set(label, relative)
  }
  return [...best.entries()].map(([label, relative]) => ({ label, relative }))
}

// Fallback when no --compare-pros gap table exists: the report's SUMMARY FLAGS
// block. Each flagged line ([!]/[~]) names a metric we can route via hubmap.
function parseSummaryFlags(reportText: string): Gap[] {
  const start = reportText.indexOf('SUMMARY FLAGS')
  if (start === -1) return []
  const tail = reportText.slice(start)
  const gaps: Gap[] = []
  for (const raw of tail.split(/\r?\n/)) {
    const line = raw.trim()
    if (!/^\[[!~]\]/.test(line)) continue
    gaps.push({ label: line, relative: 1 })
  }
  return gaps
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
  const gaps = (gapText ? parseGapRows(gapText) : parseSummaryFlags(reportText ?? ''))
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
    for (let i = 0; i < lines.length; i++) {
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
