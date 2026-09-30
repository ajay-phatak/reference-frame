import { spawn, ChildProcess } from 'child_process'
import { app } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { killTree } from './procutil'

export interface EngineEvent {
  event: 'progress' | 'log' | 'result' | 'error'
  [key: string]: unknown
}

interface EngineCommand {
  command: string
  baseArgs: string[]
  cwd: string
}

// Dev runs the engine from the repo venv as `python -m refframe_engine`;
// packaged builds use the PyInstaller exe shipped in resources/engine.
function resolveEngine(): EngineCommand {
  if (app.isPackaged) {
    const binName = process.platform === 'win32' ? 'refframe-engine.exe' : 'refframe-engine'
    return {
      command: join(process.resourcesPath, 'engine', binName),
      baseArgs: [],
      cwd: join(process.resourcesPath, 'engine')
    }
  }
  const repoRoot = join(__dirname, '..', '..')
  const venvPython =
    process.platform === 'win32'
      ? join(repoRoot, 'engine', '.venv', 'Scripts', 'python.exe')
      : join(repoRoot, 'engine', '.venv', 'bin', 'python')
  return {
    command: existsSync(venvPython) ? venvPython : 'python',
    baseArgs: ['-m', 'refframe_engine'],
    cwd: join(repoRoot, 'engine')
  }
}

const MISSING_ENGINE_MSG =
  'The analysis engine is missing or was blocked (often by antivirus). Reinstall Reference Frame, or allow refframe-engine in your antivirus.'
const STDERR_CAP = 64 * 1024

export class EngineJob {
  private child: ChildProcess | null = null
  // Set by cancel() so callers can report "canceled" instead of the generic
  // non-zero-exit message the killed process produces.
  canceled = false

  run(args: string[], onEvent: (e: EngineEvent) => void): Promise<number> {
    const { command, baseArgs, cwd } = resolveEngine()
    return new Promise((resolve, reject) => {
      if (this.canceled) return resolve(-1)
      const child = spawn(command, [...baseArgs, ...args, '--ndjson'], { cwd, windowsHide: true })
      this.child = child

      let sawError = false
      const emit = (e: EngineEvent): void => {
        if (e.event === 'error') sawError = true
        onEvent(e)
      }
      const handleLine = (raw: string): void => {
        const line = raw.trim()
        if (!line) return
        try {
          emit(JSON.parse(line) as EngineEvent)
        } catch {
          emit({ event: 'log', level: 'debug', msg: line })
        }
      }

      let buffer = ''
      child.stdout!.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf-8')
        let nl: number
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl)
          buffer = buffer.slice(nl + 1)
          handleLine(line)
        }
      })

      // Only the tail matters for diagnostics; a chatty engine must not grow
      // this without bound.
      let stderr = ''
      child.stderr!.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf-8')
        if (stderr.length > STDERR_CAP) stderr = stderr.slice(-STDERR_CAP)
      })

      let settled = false
      child.on('error', (err: NodeJS.ErrnoException) => {
        if (settled) return
        settled = true
        this.child = null
        if (err.code === 'ENOENT' || err.code === 'EACCES' || err.code === 'EPERM') {
          reject(new Error(MISSING_ENGINE_MSG))
        } else {
          reject(err)
        }
      })
      child.on('close', (code) => {
        if (settled) return
        settled = true
        this.child = null
        if (buffer.trim()) handleLine(buffer)
        buffer = ''
        // An engine-emitted error event is the real reason; the stderr dump
        // is only the fallback when the engine died without saying anything.
        if (code !== 0 && !sawError && stderr.trim()) {
          onEvent({ event: 'error', code: 'engine_exit', msg: stderr.trim() })
        }
        resolve(code ?? -1)
      })
    })
  }

  cancel(): void {
    this.canceled = true
    killTree(this.child)
  }
}
