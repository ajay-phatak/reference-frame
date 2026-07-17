import { describe, it, expect } from 'vitest'
import type { RunRecord } from '../library'
import type { CoachGap } from '../coach/advise'
import type { FocusGroup } from '../coach/focuses'
import {
  sessionRelPath,
  sessionDate,
  renderRunBlock,
  renderCoachBlock,
  renderFocusesBlock
} from './blocks'

// Same fixture shape as excerpts.test.ts's GAP_TEXT: a mix of favorable (▲)
// and unfavorable (▼) rows, plus a partner row that must not surface.
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

function makeRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    runId: '20260716-142530-my-video',
    input: 'C:\\videos\\my-video.mp4',
    source: 'path',
    videoName: 'my-video.mp4',
    options: {
      me: 'left',
      meId: 1,
      role: 'lead',
      partner: true,
      spotlight: false,
      poseModel: 'rtmpose',
      comparePros: true
    },
    partnerName: 'Alex',
    status: 'done',
    createdAt: '2026-07-16T14:25:30.000Z',
    updatedAt: '2026-07-16T14:30:00.000Z',
    resultPaths: {
      reportPath: null,
      gapPath: null,
      metricsPath: null,
      posesPath: null,
      videoPath: null
    },
    youId: 1,
    youIdRaw: 1,
    videoTitle: null,
    coverage: null,
    error: null,
    ...overrides
  }
}

describe('sessionRelPath / sessionDate', () => {
  it('parses the date from a well-formed runId prefix', () => {
    expect(sessionRelPath('20260716-142530-my-video', '2020-01-01T00:00:00.000Z')).toBe(
      'Sessions/2026-07-16.md'
    )
    expect(sessionDate('20260716-142530-my-video', '2020-01-01T00:00:00.000Z')).toBe('2026-07-16')
  })

  it('falls back to the given ISO date when the runId prefix does not parse', () => {
    expect(sessionRelPath('not-a-run-id', '2026-03-04T10:00:00.000Z')).toBe('Sessions/2026-03-04.md')
    expect(sessionDate('not-a-run-id', '2026-03-04T10:00:00.000Z')).toBe('2026-03-04')
  })
})

describe('renderRunBlock', () => {
  it('renders a heading, meta line, and a gap table ranked by relative gap', () => {
    const out = renderRunBlock({ run: makeRun(), reportText: null, gapText: GAP_TEXT })
    expect(out).toContain('## Run my-video.mp4')
    expect(out).toContain('role: lead')
    expect(out).toContain('partner tracking: on (Alex)')
    expect(out).toContain('spotlight: off')
    expect(out).toContain('pros: compared')
    expect(out).toContain('| Metric | You | Pro avg |')
    // Unfavorable rows present.
    expect(out).toContain('standing-leg knee flex')
    expect(out).toContain('Posts detected')
    // Favorable (▲) row excluded.
    expect(out).not.toContain('Rise/fall typical')
    // Partner's own row excluded.
    expect(out).not.toContain('free knee-hip coordination')
  })

  it('prefers videoTitle over videoName when present', () => {
    const out = renderRunBlock({
      run: makeRun({ videoTitle: 'My Great Session' }),
      reportText: null,
      gapText: GAP_TEXT
    })
    expect(out).toContain('## Run My Great Session')
  })

  it('renders coverage percentages, normalizing 0..1 fractions', () => {
    const out = renderRunBlock({
      run: makeRun({ coverage: { you: 0.93, partner: 41 } }),
      reportText: null,
      gapText: null
    })
    expect(out).toContain('you 93%')
    expect(out).toContain('partner 41%')
  })

  it('falls back to SUMMARY FLAGS bullets when there is no gap table', () => {
    const out = renderRunBlock({ run: makeRun(), reportText: REPORT_TEXT, gapText: null })
    expect(out).toContain('### Summary flags')
    expect(out).toContain('negative hip→shoulder lag')
    expect(out).not.toContain('| Metric | You | Pro avg |')
  })

  it('notes when there is neither a gap table nor summary flags', () => {
    const out = renderRunBlock({ run: makeRun(), reportText: null, gapText: null })
    expect(out).toContain('_No gap comparison for this run._')
  })

  it('describes partner tracking off without a partner name', () => {
    const out = renderRunBlock({
      run: makeRun({ options: { ...makeRun().options, partner: false }, partnerName: null }),
      reportText: null,
      gapText: null
    })
    expect(out).toContain('partner tracking: off')
    expect(out).not.toContain('(Alex)')
  })
})

describe('renderCoachBlock', () => {
  it('renders the headline prose and suggested-focus bullets', () => {
    const gaps: CoachGap[] = [
      { gap: 'Standing-leg load', evidence: 'p90 knee flex 37 vs pro 106', suggestion: 'Drill sinking into the weighted leg.' }
    ]
    const out = renderCoachBlock({ date: '2026-07-16', prose: 'Framing is healthy overall.', gaps })
    expect(out).toContain("## Coach's read (2026-07-16)")
    expect(out).toContain('Framing is healthy overall.')
    expect(out).toContain('### Suggested focuses')
    expect(out).toContain('- **Standing-leg load** — Drill sinking into the weighted leg.')
  })

  it('omits the suggested-focuses section when there are no gaps', () => {
    const out = renderCoachBlock({ date: '2026-07-16', prose: 'All good.', gaps: [] })
    expect(out).not.toContain('### Suggested focuses')
  })
})

describe('renderFocusesBlock', () => {
  it('renders each group oldest-first with dated headings and bullets', () => {
    const groups: FocusGroup[] = [
      { date: '2026-07-01', prose: 'p1', focuses: [{ gap: 'Gap A', plan: 'Plan A' }] },
      { date: '2026-07-10', prose: 'p2', focuses: [{ gap: 'Gap B', plan: 'Plan B' }] }
    ]
    const out = renderFocusesBlock(groups)
    expect(out).toContain('## Focuses')
    const aIdx = out.indexOf('### 2026-07-01')
    const bIdx = out.indexOf('### 2026-07-10')
    expect(aIdx).toBeGreaterThan(-1)
    expect(bIdx).toBeGreaterThan(aIdx)
    expect(out).toContain('- **Gap A** — Plan A')
    expect(out).toContain('- **Gap B** — Plan B')
  })
})
