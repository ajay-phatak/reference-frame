import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'

export interface AppConfig {
  role: 'lead' | 'follow'
  defaultMe: 'left' | 'right'
  partnerName: string | null
  poseModel: 'n' | 's' | 'm' | 'l' | 'x'
  notesFolder: string | null
  // 'api' = Anthropic API key (credits); 'claude-cli' = spawn the user's
  // local Claude Code install (bills their Pro/Max plan). Wired in phase 4.
  coachBackend: 'api' | 'claude-cli'
  coachModel: 'opus' | 'sonnet' | 'haiku'
  onboarded: boolean
}

const DEFAULTS: AppConfig = {
  role: 'lead',
  defaultMe: 'left',
  partnerName: null,
  poseModel: 'm',
  notesFolder: null,
  coachBackend: 'api',
  coachModel: 'sonnet',
  // No Onboarding view yet (phase 3) — default to true so the shell renders
  // the main nav directly instead of gating on a screen that doesn't exist.
  onboarded: true
}

const configPath = (): string => join(app.getPath('userData'), 'config.json')

export const dataDir = (): string => join(app.getPath('userData'), 'data')

export function loadConfig(): AppConfig {
  try {
    const raw = JSON.parse(readFileSync(configPath(), 'utf-8'))
    return { ...DEFAULTS, ...raw }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveConfig(patch: Partial<AppConfig>): AppConfig {
  const merged = { ...loadConfig(), ...patch }
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(configPath(), JSON.stringify(merged, null, 2))
  return merged
}
