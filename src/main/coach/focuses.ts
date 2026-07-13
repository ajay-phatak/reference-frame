// Persistent focus loop. When the dancer saves the focuses they agreed to
// after a coaching report, they land here as a dated group in
// data/coach/focuses.json. The next report reads the last 3 groups back into
// <previous_focuses> so advice builds on what they committed to — the
// notes-folder equivalent of nojohns' Progress.md focuses block.

import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'

export interface Focus {
  gap: string
  plan: string
}

export interface FocusGroup {
  date: string
  prose: string
  focuses: Focus[]
}

const MAX_GROUPS = 3

const focusesPath = (coachDir: string): string => join(coachDir, 'focuses.json')

export function readFocusGroups(coachDir: string): FocusGroup[] {
  try {
    const parsed = JSON.parse(readFileSync(focusesPath(coachDir), 'utf-8'))
    return Array.isArray(parsed?.groups) ? (parsed.groups as FocusGroup[]) : []
  } catch {
    return []
  }
}

/** Render the last 3 groups for the <previous_focuses> prompt block, oldest
 *  first. Returns null when there's no history yet. */
export function renderPreviousFocuses(coachDir: string): string | null {
  const groups = readFocusGroups(coachDir)
  if (groups.length === 0) return null
  return groups
    .map((g) => {
      const items = g.focuses.map((f) => `- ${f.gap}: ${f.plan}`).join('\n')
      return `### Agreed focuses (${g.date})\n${items}`
    })
    .join('\n\n')
}

/** Append a new dated group and keep only the most recent MAX_GROUPS. */
export function saveFocusGroup(
  coachDir: string,
  group: FocusGroup
): { ok: boolean; groups: number } {
  const groups = readFocusGroups(coachDir)
  groups.push(group)
  const trimmed = groups.slice(-MAX_GROUPS)
  mkdirSync(coachDir, { recursive: true })
  writeFileSync(focusesPath(coachDir), JSON.stringify({ groups: trimmed }, null, 2))
  return { ok: true, groups: trimmed.length }
}
