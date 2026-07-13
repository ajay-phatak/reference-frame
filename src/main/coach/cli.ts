// Claude Code CLI coach backend — spawns the user's local `claude` install in
// headless print mode, so usage bills to their Pro/Max subscription instead
// of API credits. Same spawn-per-job + streamed-JSON-lines shape as the
// Python engine. IMPORTANT: this only ever runs the CLI the user installed
// and logged into themselves; it never touches Claude Code's stored OAuth
// token or calls the API with it.

import { spawn } from 'child_process'
import { app } from 'electron'
import { join } from 'path'
import { mkdirSync, existsSync } from 'fs'
import { homedir } from 'os'
import coachSystemPrompt from '../../../prompts/coach-system.md?raw'
import { buildAdvisePrompt, type AdviseInputs, type CoachModel, type CoachResult } from './client'

const TIMEOUT_MS = 5 * 60 * 1000 // reports can think for a while

// Claude Code session id for --resume (chat continuity). One at a time,
// mirroring the API backend.
let sessionId: string | null = null
let busy = false

export const resetCliConversation = (): void => {
  sessionId = null
}

export const hasCliConversation = (): boolean => sessionId !== null

export interface CliDetection {
  found: boolean
  version?: string
}

// The CLI often isn't on the PATH an Electron app inherits (the native
// installer uses ~/.local/bin, npm installs use %APPDATA%\npm) — probe the
// known locations first, fall back to PATH resolution via the shell.
function cliCommand(): string {
  const candidates = [
    join(homedir(), '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude'),
    ...(process.env.APPDATA ? [join(process.env.APPDATA, 'npm', 'claude.cmd')] : [])
  ]
  const found = candidates.find((c) => existsSync(c))
  return found ? `"${found}"` : 'claude'
}

export function detectCli(): Promise<CliDetection> {
  return new Promise((resolve) => {
    let out = ''
    let done = false
    const finish = (r: CliDetection): void => {
      if (!done) {
        done = true
        resolve(r)
      }
    }
    // shell:true so Windows can run the .cmd shim / quoted .exe path.
    const child = spawn(`${cliCommand()} --version`, { shell: true, windowsHide: true })
    const timer = setTimeout(() => {
      child.kill()
      finish({ found: false })
    }, 8000)
    child.stdout?.on('data', (d) => (out += d))
    child.on('error', () => {
      clearTimeout(timer)
      finish({ found: false })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      finish(code === 0 && out.trim() ? { found: true, version: out.trim() } : { found: false })
    })
  })
}

// One headless turn. The prompt goes over stdin so user content never hits
// the command line (Windows quoting + length limits); only fixed flags and a
// UUID ever appear as arguments.
function runCli(
  prompt: string,
  model: CoachModel,
  resume: string | null,
  onDelta: (text: string) => void
): Promise<CoachResult> {
  if (busy) return Promise.resolve({ ok: false, reason: 'busy' })
  busy = true

  // Isolated cwd: keeps Claude Code session files under our userData and out
  // of any real project (no stray CLAUDE.md context bleeding in).
  const cwd = join(app.getPath('userData'), 'coach')
  mkdirSync(cwd, { recursive: true })

  // Strip API credentials so the CLI can't silently bill API credits instead
  // of the subscription the user chose this backend for.
  const env = { ...process.env }
  delete env.ANTHROPIC_API_KEY
  delete env.ANTHROPIC_AUTH_TOKEN

  // Claude Code resolves the tier alias to whatever the user's plan offers
  // (e.g. opus needs Max — a plan without it errors, surfaced as cli_failed).
  const cmd =
    `${cliCommand()} -p --output-format stream-json --verbose --include-partial-messages` +
    ` --model ${model}` +
    (resume ? ` --resume ${resume}` : '')

  return new Promise((resolve) => {
    let settled = false
    let stderr = ''
    let buffer = ''
    let finalText: string | null = null
    let streamedText = ''

    const finish = (r: CoachResult): void => {
      if (!settled) {
        settled = true
        busy = false
        resolve(r)
      }
    }

    const child = spawn(cmd, { shell: true, cwd, env, windowsHide: true })
    const timer = setTimeout(() => {
      child.kill()
      finish({ ok: false, reason: 'cli_timeout' })
    }, TIMEOUT_MS)

    child.on('error', (err) => {
      clearTimeout(timer)
      finish({ ok: false, reason: `cli_failed: ${err.message}` })
    })

    child.stderr?.on('data', (d) => (stderr += d))

    child.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf-8')
      let nl: number
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        if (!line) continue
        let j: Record<string, unknown>
        try {
          j = JSON.parse(line)
        } catch {
          continue
        }
        if (j.type === 'system' && j.subtype === 'init' && typeof j.session_id === 'string') {
          sessionId = j.session_id
        } else if (j.type === 'stream_event') {
          // Raw Messages-API stream event wrapped by the CLI.
          const ev = j.event as
            { type?: string; delta?: { type?: string; text?: string } } | undefined
          if (
            ev?.type === 'content_block_delta' &&
            ev.delta?.type === 'text_delta' &&
            ev.delta.text
          ) {
            streamedText += ev.delta.text
            onDelta(ev.delta.text)
          }
        } else if (j.type === 'result') {
          if (typeof j.session_id === 'string') sessionId = j.session_id
          finalText = j.subtype === 'success' && typeof j.result === 'string' ? j.result : finalText
        }
      }
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0 && (finalText !== null || streamedText)) {
        finish({ ok: true, text: finalText ?? streamedText })
      } else if (/log ?in|authenticate|credentials|api key/i.test(stderr)) {
        finish({ ok: false, reason: 'cli_not_logged_in' })
      } else {
        finish({
          ok: false,
          reason: `cli_failed: exit ${code}${stderr ? ` — ${stderr.trim().slice(0, 200)}` : ''}`
        })
      }
    })

    child.stdin?.write(prompt, 'utf-8')
    child.stdin?.end()
  })
}

/** Start a fresh CLI conversation and stream the coaching report. */
export function cliGenerateReport(
  inputs: AdviseInputs,
  model: CoachModel,
  onDelta: (text: string) => void
): Promise<CoachResult> {
  if (busy) return Promise.resolve({ ok: false, reason: 'busy' })
  sessionId = null
  const prompt = [
    '<coaching_instructions>\n' + coachSystemPrompt + '\n</coaching_instructions>',
    'Follow the coaching instructions above for this whole conversation. Do not use any tools — everything you need is in this message.',
    buildAdvisePrompt(inputs)
  ].join('\n\n')
  return runCli(prompt, model, null, onDelta)
}

/** Ask a follow-up on the current CLI conversation. */
export function cliChat(
  text: string,
  model: CoachModel,
  onDelta: (t: string) => void
): Promise<CoachResult> {
  if (!sessionId) return Promise.resolve({ ok: false, reason: 'no_conversation' })
  return runCli(text, model, sessionId, onDelta)
}
