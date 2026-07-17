// Managed-block writer for the user's notes folder (typically an Obsidian
// vault). Every write is scoped to a single marker-delimited span:
//   <!-- refframe:begin <kind> <key> -->
//   ...content...
//   <!-- refframe:end <kind> <key> -->
// Everything outside our own span is untouchable — the app is a guest in the
// dancer's vault, never a co-author of their prose. No Electron imports here
// (same baseDir-parameter pattern as pros.ts / excerpts.ts) so this stays
// unit-testable with plain temp dirs.

import { dirname, isAbsolute, resolve, sep } from 'path'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'

// Keys are runIds (yyyymmdd-HHMMss-slug) or literals like 'current'; kinds
// are short identifiers like 'run'/'coach'/'focuses'. Both go straight into
// an HTML comment, so anything outside this charset is rejected rather than
// risking a malformed or spoofable marker.
const TOKEN_RE = /^[A-Za-z0-9._-]+$/

function beginMarker(kind: string, key: string): string {
  return `<!-- refframe:begin ${kind} ${key} -->`
}

function endMarker(kind: string, key: string): string {
  return `<!-- refframe:end ${kind} ${key} -->`
}

type UpsertResult = { ok: true; path: string } | { ok: false; reason: string }

// Resolve relPath against notesFolder and confirm it can't escape — checked
// two ways: reject '..' segments and absolute paths outright (cheap, catches
// the obvious cases before touching the filesystem), then re-verify against
// the resolved absolute paths (catches anything the segment check missed,
// e.g. drive-relative Windows paths). Returns null on any violation.
function resolveSafePath(notesFolder: string, relPath: string): string | null {
  if (isAbsolute(relPath)) return null
  if (relPath.split(/[\\/]+/).includes('..')) return null
  const root = resolve(notesFolder)
  const target = resolve(root, relPath)
  if (target !== root && !target.startsWith(root + sep)) return null
  return target
}

// Render frontmatter as literal `key: value` lines, in the caller's
// insertion order — writer.ts only renders the map, it never decides what
// belongs in it (the caller supplies generator/date).
function renderFrontmatter(frontmatter: Record<string, string>): string {
  const keys = Object.keys(frontmatter)
  if (keys.length === 0) return ''
  const lines = keys.map((k) => `${k}: ${frontmatter[k]}`)
  return `---\n${lines.join('\n')}\n---\n\n`
}

// Atomic write: same tmp-file + renameSync pattern as pros.ts's
// writeManifestAtomic, so a crash mid-write can never leave a half-written
// notes file for Obsidian to pick up.
function writeAtomic(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(tmp, text, 'utf-8')
  renameSync(tmp, path)
}

export function upsertBlock(opts: {
  notesFolder: string
  relPath: string
  kind: string
  key: string
  content: string
  frontmatter?: Record<string, string>
}): UpsertResult {
  const { notesFolder, relPath, kind, key, content, frontmatter } = opts

  if (!TOKEN_RE.test(kind)) return { ok: false, reason: `invalid kind: ${kind}` }
  if (!TOKEN_RE.test(key)) return { ok: false, reason: `invalid key: ${key}` }

  const target = resolveSafePath(notesFolder, relPath)
  if (!target) return { ok: false, reason: `relPath escapes notesFolder: ${relPath}` }

  const begin = beginMarker(kind, key)
  const end = endMarker(kind, key)
  // Trim trailing blank lines off the caller's content so re-upserting the
  // same logical content always produces the exact same block bytes —
  // required for idempotence regardless of how the caller terminated it.
  const block = `${begin}\n${content.replace(/\s+$/, '')}\n${end}`

  const exists = existsSync(target)
  const text = exists ? readFileSync(target, 'utf-8') : ''

  const beginIdx = text.indexOf(begin)
  let newText: string

  if (beginIdx !== -1) {
    // Splice by raw string index so everything outside the span — including
    // exact whitespace — survives byte-for-byte, never a split/rejoin.
    const endIdx = text.indexOf(end, beginIdx)
    if (endIdx === -1) {
      return { ok: false, reason: `begin marker found without matching end marker in ${relPath}` }
    }
    const endOfEnd = endIdx + end.length
    newText = text.slice(0, beginIdx) + block + text.slice(endOfEnd)
  } else if (!exists) {
    newText = renderFrontmatter(frontmatter ?? {}) + block + '\n'
  } else {
    // Append: exactly one blank line between existing content and our block,
    // and the file always ends with a trailing newline.
    const trimmedExisting = text.replace(/\s+$/, '')
    newText = trimmedExisting.length > 0 ? `${trimmedExisting}\n\n${block}\n` : `${block}\n`
  }

  writeAtomic(target, newText)
  return { ok: true, path: target }
}
