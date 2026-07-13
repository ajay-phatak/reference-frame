import { describe, it, expect } from 'vitest'
import { parseAdvice } from './advise'

const REPORT = `Progress check: 1-foot balance moved 3.1% -> 5.2% since you committed to settling.

Headline: framing is healthy, but the standing-leg load is your ceiling gap.

How do you want to address these?

\`\`\`json
{"gaps": [
  {"gap": "Standing-leg load", "evidence": "p90 knee flex 37° vs pro 106°", "suggestion": "Drill sinking into the weighted leg on anchors."},
  {"gap": "Prep sequencing", "evidence": "prep->arrival 24.2% vs pro 49.1%", "suggestion": "Gather the free foot before the step, not after it grounds."}
]}
\`\`\`
`

describe('parseAdvice', () => {
  it('splits prose from the trailing json block', () => {
    const { prose, gaps } = parseAdvice(REPORT)
    expect(prose).toContain('standing-leg load is your ceiling gap')
    expect(prose).not.toContain('```json')
    expect(gaps).toHaveLength(2)
    expect(gaps[0].gap).toBe('Standing-leg load')
    expect(gaps[1].suggestion).toContain('Gather the free foot')
  })

  it('returns full text and no gaps when the block is missing', () => {
    const { prose, gaps } = parseAdvice('Just prose, no machine block.')
    expect(prose).toBe('Just prose, no machine block.')
    expect(gaps).toHaveLength(0)
  })

  it('survives malformed json', () => {
    const { prose, gaps } = parseAdvice('Read here.\n\n```json\n{not valid\n```')
    expect(prose).toBe('Read here.')
    expect(gaps).toHaveLength(0)
  })

  it('drops entries missing required fields', () => {
    const { gaps } = parseAdvice(
      'x\n\n```json\n{"gaps": [{"gap": "ok", "suggestion": "fine"}, {"gap": 5}, "junk"]}\n```'
    )
    expect(gaps).toHaveLength(1)
    expect(gaps[0].evidence).toBe('')
  })
})
