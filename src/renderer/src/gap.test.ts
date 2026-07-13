import { describe, expect, it } from 'vitest'
import { parseGap } from './gap'

const SAMPLE = `
========================================================================
  GAP ANALYSIS vs PRO REFERENCES  (broken out per couple)
  you = Dancer 1 (lead); rows compare you vs each couple's LEAD
  partner = the follow; partner rows compare vs each couple's FOLLOW
========================================================================

------------------------------------------------------------------------
  vs Semion/Maria  —  averaged over 3 clips: WOTP 2024 (86 BPM), Oslo 2025 (83 BPM), Winter White 2024 (99 BPM)
------------------------------------------------------------------------
  -- YOU (LEAD) --
  Rise/fall typical (bounce on avg steps) — you   you=0.0200  pro avg=0.0187  ▲ +0.0013
  1-foot balance % — you                          you=5.2  pro avg=24.0  ▼ -18.8
  -- PARTNER (FOLLOW) --
  Rise/fall typical (bounce on avg steps) — partner  partner=0.0197  pro avg=0.0190  ▲ +0.0007
  -- PARTNERSHIP (both) --
  Partner distance variance                       you=0.765  pro avg=0.722  ▲ +0.043
  Floor travel range (BH)                         you=3.388  pro avg=2.161  ▲ +1.227   (not spotlight — lower expected)

------------------------------------------------------------------------
  vs Jordan/Tatiana  —  averaged over 1 clip: Jordan/Tatiana (99 BPM)
------------------------------------------------------------------------
  -- YOU (LEAD) --
  Rise/fall typical (bounce on avg steps) — you   you=0.0200  pro avg=0.0208  ▼ -0.0008

========================================================================`

describe('parseGap', () => {
  it('splits couples in order', () => {
    const parsed = parseGap(SAMPLE)
    expect(parsed.couples.map((c) => c.couple)).toEqual(['Semion/Maria', 'Jordan/Tatiana'])
  })

  it('captures the clip summary per couple', () => {
    const parsed = parseGap(SAMPLE)
    expect(parsed.couples[0].clipsSummary).toContain('averaged over 3 clips')
    expect(parsed.couples[1].clipsSummary).toContain('averaged over 1 clip')
  })

  it('groups rows under section headings', () => {
    const parsed = parseGap(SAMPLE)
    const sections = parsed.couples[0].sections
    expect(sections.map((s) => s.heading)).toEqual([
      'YOU (LEAD)',
      'PARTNER (FOLLOW)',
      'PARTNERSHIP (both)'
    ])
    expect(sections[0].rows).toHaveLength(2)
  })

  it('parses numeric values and favorable direction from the arrow', () => {
    const parsed = parseGap(SAMPLE)
    const row = parsed.couples[0].sections[0].rows[0]
    expect(row.label).toBe('Rise/fall typical (bounce on avg steps) — you')
    expect(row.you).toBeCloseTo(0.02)
    expect(row.pro).toBeCloseTo(0.0187)
    expect(row.favorable).toBe(true)

    const badRow = parsed.couples[0].sections[0].rows[1]
    expect(badRow.favorable).toBe(false)
  })

  it('preserves trailing notes like the spotlight caveat', () => {
    const parsed = parseGap(SAMPLE)
    const partnership = parsed.couples[0].sections[2].rows
    expect(partnership[1].note).toContain('not spotlight')
  })

  it('exposes the header title', () => {
    const parsed = parseGap(SAMPLE)
    expect(parsed.title).toContain('GAP ANALYSIS')
  })
})
