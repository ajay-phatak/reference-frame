// AI coach client — direct Anthropic Messages API from the main process.
// One conversation at a time: a report request seeds it (system prompt +
// the run's report.txt + gap_analysis.txt + context + optional practice-notes
// excerpts + previous focuses), chat turns extend it. Text deltas stream to
// the renderer through a callback; the key never leaves this module's calls.

import Anthropic from '@anthropic-ai/sdk'
import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import coachSystemPrompt from '../../../prompts/coach-system.md?raw'
import { getKey } from './key'

const MAX_TOKENS_REPORT = 4096
const MAX_TOKENS_CHAT = 2048

// The engine already did the analysis — the model reads the report + gap table
// and writes advice, so sonnet is plenty for most users. $/MTok; cache write
// bills 1.25x input, cache read 0.1x.
export type CoachModel = 'opus' | 'sonnet' | 'haiku'
const MODELS: Record<CoachModel, { id: string; priceIn: number; priceOut: number }> = {
  opus: { id: 'claude-opus-4-8', priceIn: 5, priceOut: 25 },
  sonnet: { id: 'claude-sonnet-5', priceIn: 3, priceOut: 15 },
  haiku: { id: 'claude-haiku-4-5', priceIn: 1, priceOut: 5 }
}

export interface CoachUsage {
  inputTokens: number
  outputTokens: number
  cacheWriteTokens: number
  cacheReadTokens: number
  costUsd: number
  monthUsd: number
}

export interface CoachResult {
  ok: boolean
  reason?: string
  text?: string
  usage?: CoachUsage
}

// Everything the first (advise) turn needs, assembled by the IPC handler from
// the library run. Shared by both backends so the prompt is identical whether
// it goes over the API or the CLI's stdin.
export interface AdviseContext {
  role: 'lead' | 'follow'
  // The user's own name (config.userName), so the coach can address them —
  // null/empty when not set in Settings/Onboarding.
  userName: string | null
  partnerName: string | null
  spotlight: boolean
  // tracking coverage per role (0–100), from the run's run.json — low coverage
  // tells the model to lean on partnership/rhythm over per-limb metrics.
  coverage: Record<string, number | null> | null
}

export interface AdviseInputs {
  reportTxt: string
  gapTxt: string | null
  context: AdviseContext
  // matching bullets pulled from the user's notes folder (notes/excerpts.ts),
  // or null when no folder is configured / nothing matched.
  practiceNotes: string | null
  // last 3 dated focus groups from coach/focuses.json, pre-rendered, or null.
  previousFocuses: string | null
}

const coachDir = (): string => join(app.getPath('userData'), 'coach')

// ---------------------------------------------------------------------------
// Monthly spend counter (soft guardrail — the UI warns, nothing blocks)
// ---------------------------------------------------------------------------

const spendPath = (): string => join(coachDir(), 'spend.json')

function addSpend(usd: number): number {
  const month = new Date().toISOString().slice(0, 7)
  let rec = { month, usd: 0 }
  try {
    const read = JSON.parse(readFileSync(spendPath(), 'utf-8'))
    if (read.month === month) rec = read
  } catch {
    // first spend this month
  }
  rec.usd += usd
  mkdirSync(coachDir(), { recursive: true })
  writeFileSync(spendPath(), JSON.stringify(rec))
  return rec.usd
}

// ---------------------------------------------------------------------------
// Conversation state (one at a time; report starts fresh)
// ---------------------------------------------------------------------------

let messages: Anthropic.MessageParam[] = []
let transcriptPath: string | null = null
let busy = false

export const resetConversation = (): void => {
  messages = []
  transcriptPath = null
}

export const hasConversation = (): boolean => messages.length > 0

function costOf(usage: Anthropic.Usage, model: CoachModel): number {
  const { priceIn, priceOut } = MODELS[model]
  return (
    (usage.input_tokens * priceIn +
      usage.output_tokens * priceOut +
      (usage.cache_creation_input_tokens ?? 0) * priceIn * 1.25 +
      (usage.cache_read_input_tokens ?? 0) * priceIn * 0.1) /
    1_000_000
  )
}

function saveTranscript(model: CoachModel): void {
  try {
    if (!transcriptPath) {
      mkdirSync(coachDir(), { recursive: true })
      transcriptPath = join(coachDir(), `coach-${Date.now()}.json`)
    }
    writeFileSync(transcriptPath, JSON.stringify({ model: MODELS[model].id, messages }, null, 2))
  } catch {
    // transcripts are best-effort
  }
}

async function runTurn(
  userContent: string,
  model: CoachModel,
  maxTokens: number,
  onDelta: (text: string) => void,
  fresh = false
): Promise<CoachResult> {
  // Guards come BEFORE any state change so a rejected turn never touches
  // the history of an in-flight request.
  const key = getKey()
  if (!key) return { ok: false, reason: 'no_key' }
  if (busy) return { ok: false, reason: 'busy' }
  busy = true
  if (fresh) resetConversation()
  messages.push({ role: 'user', content: userContent })
  try {
    const client = new Anthropic({ apiKey: key })
    const stream = client.messages.stream({
      model: MODELS[model].id,
      max_tokens: maxTokens,
      // Haiku 4.5 doesn't take adaptive thinking; opus/sonnet do.
      ...(model === 'haiku' ? {} : { thinking: { type: 'adaptive' as const } }),
      // Auto-cache the last cacheable block: the big report prefix caches on
      // the first call, each chat turn extends the cached prefix. Verify with
      // usage.cache_read_input_tokens > 0 on follow-up turns.
      cache_control: { type: 'ephemeral' },
      system: coachSystemPrompt,
      messages
    })
    stream.on('text', onDelta)
    const final = await stream.finalMessage()

    if (final.stop_reason === 'refusal') {
      // Don't keep a refused turn in history — let the user rephrase.
      messages.pop()
      return { ok: false, reason: 'refusal' }
    }

    messages.push({ role: 'assistant', content: final.content })
    saveTranscript(model)
    const text = final.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
    const costUsd = costOf(final.usage, model)
    return {
      ok: true,
      text,
      usage: {
        inputTokens: final.usage.input_tokens,
        outputTokens: final.usage.output_tokens,
        cacheWriteTokens: final.usage.cache_creation_input_tokens ?? 0,
        cacheReadTokens: final.usage.cache_read_input_tokens ?? 0,
        costUsd,
        monthUsd: addSpend(costUsd)
      }
    }
  } catch (err) {
    messages.pop() // drop the user turn that failed so a retry is clean
    if (err instanceof Anthropic.AuthenticationError) return { ok: false, reason: 'bad_key' }
    if (err instanceof Anthropic.RateLimitError) return { ok: false, reason: 'rate_limited' }
    if (err instanceof Anthropic.APIError) {
      return { ok: false, reason: `api_error: ${err.status} ${err.message}` }
    }
    return { ok: false, reason: String(err) }
  } finally {
    busy = false
  }
}

// Render the tracking coverage line for <context> — e.g. "lead 99.8%, follow
// 99.9%". Values come from run.json (percent of frames tracked per role).
function coverageLine(coverage: Record<string, number | null> | null): string {
  if (!coverage) return 'unknown'
  const parts = Object.entries(coverage)
    .filter(([, v]) => typeof v === 'number')
    .map(([k, v]) => `${k} ${(v as number).toFixed(1)}%`)
  return parts.length ? parts.join(', ') : 'unknown'
}

/** Shared first-turn content for both backends: the run's report + gap table,
 *  the analysis context, optional notes excerpts, and the dancer's previous
 *  focuses so advice builds on what they committed to. */
export function buildAdvisePrompt(inputs: AdviseInputs): string {
  const { reportTxt, gapTxt, context, practiceNotes, previousFocuses } = inputs
  const contextLines = [
    `- Name: ${context.userName ?? 'unknown'}`,
    `- Role: ${context.role}`,
    `- Partner: ${context.partnerName ?? 'unnamed'}`,
    `- Clip type: ${context.spotlight ? 'spotlight/showcase' : 'contained (prelim/practice)'}`,
    `- Tracking coverage: ${coverageLine(context.coverage)}`
  ]
  const parts = [
    'Here is my analysis report:\n\n```\n' + reportTxt + '\n```',
    gapTxt
      ? 'And the gap analysis vs the pro references:\n\n```\n' + gapTxt + '\n```'
      : '(No pro comparison was run.)',
    '<context>\n' + contextLines.join('\n') + '\n</context>'
  ]
  if (practiceNotes) {
    // Excerpts from the dancer's own lesson notes — cite only what appears here.
    parts.push('<practice_notes>\n' + practiceNotes + '\n</practice_notes>')
  }
  if (previousFocuses) {
    parts.push('<previous_focuses>\n' + previousFocuses + '\n</previous_focuses>')
  }
  parts.push('Review this session.')
  return parts.join('\n\n')
}

/** Start a fresh conversation and stream the advisor's session review. */
export async function generateReport(
  inputs: AdviseInputs,
  model: CoachModel,
  onDelta: (text: string) => void
): Promise<CoachResult> {
  return runTurn(buildAdvisePrompt(inputs), model, MAX_TOKENS_REPORT, onDelta, true)
}

/** Ask a follow-up on the current conversation. */
export async function chat(
  text: string,
  model: CoachModel,
  onDelta: (t: string) => void
): Promise<CoachResult> {
  if (messages.length === 0) return { ok: false, reason: 'no_conversation' }
  return runTurn(text, model, MAX_TOKENS_CHAT, onDelta)
}
