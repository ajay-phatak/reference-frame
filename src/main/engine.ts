import { spawn, ChildProcess } from 'child_process'
import { app } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'

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
    return {
      command: join(process.resourcesPath, 'engine', 'refframe-engine.exe'),
      baseArgs: [],
      cwd: join(process.resourcesPath, 'engine')
    }
  }
  const repoRoot = join(__dirname, '..', '..')
  const venvPython = join(repoRoot, 'engine', '.venv', 'Scripts', 'python.exe')
  return {
    command: existsSync(venvPython) ? venvPython : 'python',
    baseArgs: ['-m', 'refframe_engine'],
    cwd: join(repoRoot, 'engine')
  }
}

export class EngineJob {
  private child: ChildProcess | null = null

  run(args: string[], onEvent: (e: EngineEvent) => void): Promise<number> {
    const { command, baseArgs, cwd } = resolveEngine()
    return new Promise((resolve, reject) => {
      this.child = spawn(command, [...baseArgs, ...args, '--ndjson'], { cwd })

      let buffer = ''
      this.child.stdout!.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf-8')
        let nl: number
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).trim()
          buffer = buffer.slice(nl + 1)
          if (!line) continue
          try {
            onEvent(JSON.parse(line) as EngineEvent)
          } catch {
            onEvent({ event: 'log', level: 'debug', msg: line })
          }
        }
      })

      let stderr = ''
      this.child.stderr!.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf-8')
      })

      this.child.on('error', reject)
      this.child.on('close', (code) => {
        this.child = null
        if (code !== 0 && stderr.trim()) {
          onEvent({ event: 'error', code: 'engine_exit', msg: stderr.trim() })
        }
        resolve(code ?? -1)
      })
    })
  }

  cancel(): void {
    this.child?.kill()
  }
}
