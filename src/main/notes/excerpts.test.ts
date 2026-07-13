import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { buildExcerpts } from './excerpts'
import { termsForGap } from './hubmap'

// A trimmed gap table with a mix of ▲ (favorable) and ▼ (unfavorable) rows,
// plus a partner row that must be excluded from the dancer's gaps.
const GAP_TEXT = `
  -- YOU (LEAD) --
  Rise/fall typical (bounce on avg steps) — you   you=0.0200  pro avg=0.0187  ▲ +0.0013
  1-foot balance % — you                          you=5.2  pro avg=24.0  ▼ -18.8
  Art. standing-leg knee flex p90 (ceiling) — you  you=36.8  pro avg=105.7  ▼ -68.9
  Art. prep→arrival sequencing % — you            you=24.2  pro avg=49.1  ▼ -24.9
  Texture match (move vs song) — you              you=0.029  pro avg=0.142  ▼ -0.113
  -- PARTNER (FOLLOW) --
  Art. free knee-hip coordination — partner       partner=0.19  pro avg=0.72  ▼ -0.53
  -- PARTNERSHIP (both) --
  Posts detected                                  you=27  pro avg=71  ▼ -44
`

const REPORT_TEXT = `
========================================================================
  SUMMARY FLAGS
========================================================================

  [!] Lead — negative hip→shoulder lag (-342 ms): upper body leads lower
  [!] Partnership — low counter-balance: limited resistance/elastic connection
`

let vault: string

beforeAll(() => {
  vault = mkdtempSync(join(tmpdir(), 'rf-notes-'))
  mkdirSync(join(vault, 'West Coast Swing'), { recursive: true })
  // A note whose bullets speak to the standing-leg / posts / balance gaps.
  writeFileSync(
    join(vault, 'West Coast Swing', 'Keerigan 6-20-25.md'),
    [
      '# Keerigan lesson',
      '',
      '- Sit into the standing leg on your anchors — drive from the floor.',
      '  sub-note about compression into the floor',
      '- Commit your weight fully before the next step (balance).',
      '- Post with intent — a real anchor to stretch from.',
      '- Unrelated bullet about parking and coffee.'
    ].join('\n')
  )
  // A second note for the counter-balance flag fallback path.
  writeFileSync(
    join(vault, 'West Coast Swing', 'John Lindo 8-25-25.md'),
    ['# John Lindo', '', '- Lean away for counterbalance and shared weight.'].join('\n')
  )
  // A noise file that should not match any term.
  writeFileSync(join(vault, 'grocery.md'), '- milk\n- eggs\n')
})

afterAll(() => {
  rmSync(vault, { recursive: true, force: true })
})

describe('termsForGap', () => {
  it('routes specific rows before generic ones', () => {
    expect(termsForGap('Art. standing-leg knee flex p90 (ceiling)')).toContain(
      'sit into the standing leg'
    )
    // generic knee flex still resolves, but not to the standing-leg terms
    expect(termsForGap('Low knee flexion')).toContain('knee bend')
    expect(termsForGap('Posts detected')).toContain('post')
  })

  it('returns [] for an unmapped label', () => {
    expect(termsForGap('Some metric nobody mapped')).toEqual([])
  })
})

describe('buildExcerpts', () => {
  it('pulls matching bullets from the gap table, tagged by filename', () => {
    const out = buildExcerpts({ notesFolder: vault, gapText: GAP_TEXT, reportText: null })
    expect(out).not.toBeNull()
    expect(out).toContain('Keerigan 6-20-25.md')
    expect(out).toContain('Sit into the standing leg')
    expect(out).toContain('Post with intent')
    // ±1 line context is included
    expect(out).toContain('compression into the floor')
    // favorable rows and unrelated bullets are not pulled
    expect(out).not.toContain('coffee')
    expect(out).not.toContain('milk')
  })

  it('returns null when no notes folder is given', () => {
    expect(buildExcerpts({ notesFolder: '', gapText: GAP_TEXT, reportText: null })).toBeNull()
  })

  it('falls back to SUMMARY FLAGS when there is no gap table', () => {
    const out = buildExcerpts({ notesFolder: vault, gapText: null, reportText: REPORT_TEXT })
    expect(out).not.toBeNull()
    expect(out).toContain('counterbalance')
  })

  it('returns null when nothing matches', () => {
    const empty = mkdtempSync(join(tmpdir(), 'rf-empty-'))
    writeFileSync(join(empty, 'x.md'), '- totally unrelated content here\n')
    try {
      expect(buildExcerpts({ notesFolder: empty, gapText: GAP_TEXT, reportText: null })).toBeNull()
    } finally {
      rmSync(empty, { recursive: true, force: true })
    }
  })
})
