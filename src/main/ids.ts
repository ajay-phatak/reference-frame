import type { AppConfig } from './config'

// Ids that end up in join(dir, id) (runId, jobId) come from the renderer —
// refuse anything that could climb out of the target directory.
const SAFE_ID = /^[\w.-]+$/
export function isSafeId(id: unknown): id is string {
  return (
    typeof id === 'string' &&
    id.length > 0 &&
    id.length <= 200 &&
    SAFE_ID.test(id) &&
    !id.includes('..')
  )
}

const ENUMS: Partial<Record<keyof AppConfig, readonly string[]>> = {
  role: ['lead', 'follow'],
  poseModel: ['n', 's', 'm', 'l', 'x'],
  coachBackend: ['api', 'claude-cli'],
  coachModel: ['opus', 'sonnet', 'haiku']
}
const STRINGS = ['userName'] as const
const BOOLS = ['notesWriteEnabled', 'onboarded'] as const

// Whitelist + type/enum check for config:set. Unknown keys and invalid values
// are dropped (not thrown) so a stale renderer can't wedge Settings.
export function sanitizeConfigPatch(patch: unknown): Partial<AppConfig> {
  const out: Record<string, unknown> = {}
  if (!patch || typeof patch !== 'object') return out
  const p = patch as Record<string, unknown>
  for (const [k, allowed] of Object.entries(ENUMS)) {
    if (typeof p[k] === 'string' && allowed!.includes(p[k] as string)) out[k] = p[k]
  }
  for (const k of STRINGS) if (typeof p[k] === 'string') out[k] = p[k]
  for (const k of BOOLS) if (typeof p[k] === 'boolean') out[k] = p[k]
  if (p.notesFolder === null || typeof p.notesFolder === 'string') {
    if ('notesFolder' in p) out.notesFolder = p.notesFolder
  }
  return out as Partial<AppConfig>
}
