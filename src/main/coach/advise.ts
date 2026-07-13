// Advisor-response parsing, shared by both coach backends. The system prompt
// asks the model to end its session review with one fenced json block listing
// the gaps; the UI renders those as editable focus cards and shows the prose
// without the fence.

export interface CoachGap {
  gap: string
  evidence: string
  suggestion: string
}

export interface ParsedAdvice {
  prose: string
  gaps: CoachGap[]
}

export function parseAdvice(text: string): ParsedAdvice {
  const m = text.match(/```json\s*([\s\S]*?)```\s*$/)
  if (!m || m.index === undefined) return { prose: text.trim(), gaps: [] }
  let gaps: CoachGap[] = []
  try {
    const parsed = JSON.parse(m[1])
    if (Array.isArray(parsed?.gaps)) {
      gaps = parsed.gaps
        .filter(
          (g: unknown): g is Record<string, unknown> =>
            typeof g === 'object' &&
            g !== null &&
            typeof (g as Record<string, unknown>).gap === 'string' &&
            typeof (g as Record<string, unknown>).suggestion === 'string'
        )
        .map((g) => ({
          gap: String(g.gap),
          evidence: typeof g.evidence === 'string' ? g.evidence : '',
          suggestion: String(g.suggestion)
        }))
    }
  } catch {
    // malformed json — prose still stands, cards just don't render
  }
  return { prose: text.slice(0, m.index).trim(), gaps }
}
