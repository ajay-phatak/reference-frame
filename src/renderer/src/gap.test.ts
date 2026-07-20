import { describe, expect, it } from 'vitest'
import { aggregateGap, parseGap, type ParsedGap } from './gap'

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

const SINGLE_COUPLE = `
========================================================================
  GAP ANALYSIS vs PRO REFERENCES  (broken out per couple)
========================================================================

------------------------------------------------------------------------
  vs Solo/Only  —  averaged over 1 clip: Only Clip (90 BPM)
------------------------------------------------------------------------
  -- YOU (LEAD) --
  Rise/fall typical (bounce on avg steps) — you   you=0.0200  pro avg=0.0187  ▲ +0.0013

========================================================================`

describe('aggregateGap', () => {
  it('builds a multi-couple band with correct min/max/n for a label present in every couple', () => {
    const aggregated = aggregateGap(parseGap(SAMPLE))
    const section = aggregated.sections.find((s) => s.heading === 'YOU (LEAD)')!
    const row = section.rows.find(
      (r) => r.label === 'Rise/fall typical (bounce on avg steps) — you'
    )!

    expect(row.plottable).toBe(true)
    expect(row.you).toBeCloseTo(0.02)
    expect(row.n).toBe(2)
    expect(row.proMin).toBeCloseTo(0.0187)
    expect(row.proMax).toBeCloseTo(0.0208)
    expect(row.points.map((p) => p.couple).sort()).toEqual(
      ['Jordan/Tatiana', 'Semion/Maria'].sort()
    )
    // Semion/Maria favorable (▲ +0.0013), Jordan/Tatiana not (▼ -0.0008) — a
    // 1-of-2 tie is broken toward favorable (favorableCount * 2 >= n), and
    // delta is the average of the two per-couple deltas.
    expect(row.favorable).toBe(true)
    expect(row.delta).toBeCloseTo(0.00025, 5)
  })

  it('aggregates a label present in only one couple over just that couple (n reflects it)', () => {
    const aggregated = aggregateGap(parseGap(SAMPLE))
    const section = aggregated.sections.find((s) => s.heading === 'YOU (LEAD)')!
    // "1-foot balance % — you" only appears under Semion/Maria, not Jordan/Tatiana.
    const row = section.rows.find((r) => r.label === '1-foot balance % — you')!

    expect(row.plottable).toBe(true)
    expect(row.n).toBe(1)
    expect(row.proMin).toBeCloseTo(24.0)
    expect(row.proMax).toBeCloseTo(24.0)
    expect(row.favorable).toBe(false)
  })

  it('preserves section grouping and per-row notes', () => {
    const aggregated = aggregateGap(parseGap(SAMPLE))
    expect(aggregated.sections.map((s) => s.heading)).toEqual([
      'YOU (LEAD)',
      'PARTNER (FOLLOW)',
      'PARTNERSHIP (both)'
    ])
    const partnership = aggregated.sections.find((s) => s.heading === 'PARTNERSHIP (both)')!
    const travel = partnership.rows.find((r) => r.label === 'Floor travel range (BH)')!
    expect(travel.note).toContain('not spotlight')
  })

  it('degrades a single-couple report to n=1 bands (the plain-pair case)', () => {
    const aggregated = aggregateGap(parseGap(SINGLE_COUPLE))
    const row = aggregated.sections[0].rows[0]

    expect(row.plottable).toBe(true)
    expect(row.n).toBe(1)
    expect(row.proMin).toBe(row.proMax)
    expect(row.proMin).toBeCloseTo(0.0187)
    expect(row.favorable).toBe(true)
    expect(row.delta).toBeCloseTo(0.0013, 3)
  })

  it('flags a row unplottable when you/pro cannot be read as numbers', () => {
    const parsed: ParsedGap = {
      title: null,
      subtitle: [],
      couples: [
        {
          couple: 'Bad/Data',
          clipsSummary: 'averaged over 1 clip',
          sections: [
            {
              heading: null,
              rows: [
                {
                  label: 'Broken metric',
                  you: NaN,
                  pro: NaN,
                  favorable: true,
                  delta: NaN,
                  note: ''
                }
              ]
            }
          ]
        }
      ]
    }

    const aggregated = aggregateGap(parsed)
    const row = aggregated.sections[0].rows[0]
    expect(row.plottable).toBe(false)
    expect(row.you).toBeNull()
    expect(row.n).toBe(0)
    expect(row.proMin).toBeNull()
    expect(row.proMax).toBeNull()
  })

  it('still bands a row when some couples have unparseable values and others do not', () => {
    const parsed: ParsedGap = {
      title: null,
      subtitle: [],
      couples: [
        {
          couple: 'Good/Data',
          clipsSummary: 'averaged over 1 clip',
          sections: [
            {
              heading: null,
              rows: [{ label: 'Metric', you: 1, pro: 2, favorable: false, delta: -1, note: '' }]
            }
          ]
        },
        {
          couple: 'Bad/Data',
          clipsSummary: 'averaged over 1 clip',
          sections: [
            {
              heading: null,
              rows: [{ label: 'Metric', you: 1, pro: NaN, favorable: false, delta: NaN, note: '' }]
            }
          ]
        }
      ]
    }

    const aggregated = aggregateGap(parsed)
    const row = aggregated.sections[0].rows[0]
    expect(row.plottable).toBe(true)
    expect(row.n).toBe(1)
    expect(row.proMin).toBeCloseTo(2)
    expect(row.proMax).toBeCloseTo(2)
  })
})
