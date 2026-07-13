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
