// Parser for the engine's `_gap_report` plain-text table (run.py) into a
// structure the Report view can render as colorized tables. Format sample:
//
//   ------------------------------------------------------------------------
//     vs Semion/Maria  —  averaged over 3 clips: WOTP 2024 (86 BPM), ...
//   ------------------------------------------------------------------------
//     -- YOU (LEAD) --
//     Rise/fall typical (bounce on avg steps) — you   you=0.0200  pro avg=0.0187  ▲ +0.0013
//     ...
//     -- PARTNERSHIP (both) --
//     Floor travel range (BH)                         you=3.388  pro avg=2.161  ▲ +1.227   (not spotlight — lower expected)
//
// Section headings ("-- YOU (LEAD) --") are only emitted when --partner was
// passed to the engine; without it, rows for a couple sit in one unnamed
// section. `▲` always means "you compare favorably" (run.py's _emit already
// resolves higher-is-better per metric before choosing the arrow), so rows
// can be colored directly off the arrow.

export interface GapRow {
  label: string
  you: number
  pro: number
  favorable: boolean
  delta: number
  note: string
}

export interface GapSection {
  heading: string | null
  rows: GapRow[]
}

export interface GapCouple {
  couple: string
  clipsSummary: string
  sections: GapSection[]
}

export interface ParsedGap {
  title: string | null
  subtitle: string[]
  couples: GapCouple[]
}

const ROW_RE =
  /^\s*(.+?)\s{2,}(?:you|partner)=([+-]?[\d.]+)\s+pro avg=([+-]?[\d.]+)\s+([▲▼])\s*([+-][\d.]+)\s*(.*)$/
const COUPLE_RE = /^\s*vs\s+(.+?)\s+—\s+(averaged over .*)$/
const SECTION_RE = /^\s*--\s*(.+?)\s*--\s*$/
const RULE_RE = /^\s*[=-]{8,}\s*$/

export function parseGap(text: string): ParsedGap {
  const lines = text.split('\n')
  const couples: GapCouple[] = []
  let title: string | null = null
  const subtitle: string[] = []
  let couple: GapCouple | null = null
  let section: GapSection | null = null
  let sawFirstCouple = false

  const ensureSection = (): GapSection => {
    if (!section) {
      section = { heading: null, rows: [] }
      couple?.sections.push(section)
    }
    return section
  }

  for (const raw of lines) {
    const line = raw.replace(/\r$/, '')
    if (RULE_RE.test(line)) continue
    if (!line.trim()) continue

    const coupleMatch = line.match(COUPLE_RE)
    if (coupleMatch) {
      couple = { couple: coupleMatch[1].trim(), clipsSummary: coupleMatch[2].trim(), sections: [] }
      couples.push(couple)
      section = null
      sawFirstCouple = true
      continue
    }

    const sectionMatch = line.match(SECTION_RE)
    if (sectionMatch && couple) {
      section = { heading: sectionMatch[1].trim(), rows: [] }
      couple.sections.push(section)
      continue
    }

    const rowMatch = line.match(ROW_RE)
    if (rowMatch && couple) {
      const [, label, youStr, proStr, arrow, , note] = rowMatch
      ensureSection().rows.push({
        label: label.trim(),
        you: parseFloat(youStr),
        pro: parseFloat(proStr),
        favorable: arrow === '▲',
        delta: parseFloat(youStr) - parseFloat(proStr),
        note: note.trim()
      })
      continue
    }

    if (!sawFirstCouple) {
      // Header block above the first couple: first non-rule line is the
      // title ("GAP ANALYSIS vs PRO REFERENCES  (broken out per couple)"),
      // remaining lines are the "you = Dancer N (...)" context lines.
      if (title === null) title = line.trim()
      else subtitle.push(line.trim())
    }
  }

  return { title, subtitle, couples }
}

// --- Multi-pro band aggregation (Report's gap-bars view) -----------------
//
// Collapses the per-couple rows above into per-section, per-label bands:
// one "you" value (it's your own metric, not pro-dependent, so it should be
// identical across couples for the same label) plotted against the spread
// of each couple's pro avg. A label absent from some couples still
// aggregates over whichever couples DO have it (n reflects that count); a
// couple missing entirely collapses a row to n=1, the "plain pair" case.
// Rows whose you/pro can't be read as a number at all come back flagged
// `plottable: false` so the view can fall back to a plain table row instead
// of drawing a bar with no data behind it.

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    // Defensive: pull the leading numeric token out of a value that might
    // carry units or stray formatting (e.g. "5.2%") — GapRow.you/.pro are
    // typed as plain numbers today, but this keeps aggregateGap safe if a
    // future engine/text-format tweak lets something non-numeric through.
    const m = value.match(/-?\d+(?:\.\d+)?/)
    if (!m) return null
    const n = parseFloat(m[0])
    return Number.isFinite(n) ? n : null
  }
  return null
}

export interface GapBandPoint {
  couple: string
  pro: number
  favorable: boolean
  delta: number
  note: string
}

export interface GapBandRow {
  label: string
  you: number | null
  /** false when you/pro couldn't be parsed as numbers at all — render as a plain table row. */
  plottable: boolean
  /** one entry per couple that has this label AND a parseable pro value, in couple order. */
  points: GapBandPoint[]
  /** points.length — couple count backing the band (may be fewer than the report's total couples). */
  n: number
  proMin: number | null
  proMax: number | null
  /** majority vote across points' favorable flags (all agree in the common case). */
  favorable: boolean
  /** average of the per-couple deltas. */
  delta: number | null
  note: string
}

export interface GapBandSection {
  heading: string | null
  rows: GapBandRow[]
}

export interface AggregatedGap {
  title: string | null
  subtitle: string[]
  sections: GapBandSection[]
}

export function aggregateGap(parsed: ParsedGap): AggregatedGap {
  interface Bucket {
    label: string
    youRaw: unknown
    entries: {
      couple: string
      proRaw: unknown
      favorable: boolean
      deltaRaw: unknown
      note: string
    }[]
  }

  // Bucket by (section heading, label) in first-seen order across couples —
  // in practice every couple in one report shares the same section
  // structure (it's driven by --partner, not by which pro couple), but
  // nothing here assumes that.
  const sectionOrder: (string | null)[] = []
  const sectionBuckets = new Map<string | null, Map<string, Bucket>>()

  for (const couple of parsed.couples) {
    for (const section of couple.sections) {
      let rowMap = sectionBuckets.get(section.heading)
      if (!rowMap) {
        rowMap = new Map()
        sectionBuckets.set(section.heading, rowMap)
        sectionOrder.push(section.heading)
      }
      for (const row of section.rows) {
        let bucket = rowMap.get(row.label)
        if (!bucket) {
          bucket = { label: row.label, youRaw: row.you, entries: [] }
          rowMap.set(row.label, bucket)
        }
        bucket.entries.push({
          couple: couple.couple,
          proRaw: row.pro,
          favorable: row.favorable,
          deltaRaw: row.delta,
          note: row.note
        })
      }
    }
  }

  const sections: GapBandSection[] = sectionOrder.map((heading) => {
    const rowMap = sectionBuckets.get(heading)!
    const rows: GapBandRow[] = []
    for (const bucket of rowMap.values()) {
      const you = toFiniteNumber(bucket.youRaw)
      const points: GapBandPoint[] = []
      let note = ''
      for (const e of bucket.entries) {
        const pro = toFiniteNumber(e.proRaw)
        if (pro === null) continue // this couple's point can't be plotted; drop it, keep the rest
        const delta = toFiniteNumber(e.deltaRaw) ?? (you !== null ? you - pro : NaN)
        if (!note && e.note) note = e.note
        points.push({ couple: e.couple, pro, favorable: e.favorable, delta, note: e.note })
      }

      const n = points.length
      const proMin = n > 0 ? Math.min(...points.map((p) => p.pro)) : null
      const proMax = n > 0 ? Math.max(...points.map((p) => p.pro)) : null
      const favorableCount = points.filter((p) => p.favorable).length
      const favorable = n > 0 && favorableCount * 2 >= n
      const delta = n > 0 ? points.reduce((sum, p) => sum + p.delta, 0) / n : null
      const plottable = you !== null && n > 0

      rows.push({
        label: bucket.label,
        you,
        plottable,
        points,
        n,
        proMin,
        proMax,
        favorable,
        delta,
        note
      })
    }
    return { heading, rows }
  })

  return { title: parsed.title, subtitle: parsed.subtitle, sections }
}
