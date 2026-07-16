import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'fs'
import { randomUUID } from 'crypto'

// User-managed pro baselines store (v0.2.0+), replacing the old bundled
// resources/pro_baselines/ — users add their own pro reference videos via the
// Pros tab. Lives at `${userData}/pro_baselines/`: a manifest (baselines.json,
// same shape the engine's baselines.load_manifest reads) plus one
// engine-written `<slug>.metrics.json` per pro (KB-scale — never pro videos
// or pose caches, which stay in the pros_work scratch dir and get deleted).

export function proBaselinesDir(): string {
  return join(app.getPath('userData'), 'pro_baselines')
}

// One entry in the manifest. `label`/`couple`/`lead_id`/`metrics` are exactly
// the engine's baselines.json schema (see engine/refframe_engine/baselines.py
// load_manifest) — `id`/`addedAt` are extra keys the engine ignores.
export interface ProEntry {
  id: string
  label: string
  couple: string
  lead_id: number
  // Filename only, relative to proBaselinesDir() — matches how the engine's
  // manifest resolves `metrics` relative to the manifest file's directory.
  metrics: string
  addedAt: string
}

// The engine's export-baseline result entry (baselines.py export_baseline():
// {"label", "couple", "lead_id", "metrics": <out.name>}) — already points at
// a metrics filename this module handed out via uniqueMetricsFilename.
export interface ExportedBaselineEntry {
  label: string
  couple: string
  lead_id: number
  metrics: string
}

function manifestPath(baseDir: string): string {
  return join(baseDir, 'baselines.json')
}

// Graceful empty state: no manifest yet (fresh install, or every pro removed)
// reads as zero entries rather than an error.
export function list(baseDir: string = proBaselinesDir()): ProEntry[] {
  const p = manifestPath(baseDir)
  if (!existsSync(p)) return []
  try {
    const raw: unknown = JSON.parse(readFileSync(p, 'utf-8'))
    return Array.isArray(raw) ? (raw as ProEntry[]) : []
  } catch {
    return []
  }
}

function writeManifestAtomic(baseDir: string, entries: ProEntry[]): void {
  mkdirSync(baseDir, { recursive: true })
  const p = manifestPath(baseDir)
  const tmp = `${p}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(tmp, JSON.stringify(entries, null, 2))
  renameSync(tmp, p)
}

// Lowercase, ascii-safe, dash-separated slug — same shape as library.ts's
// internal slug() helper, kept local since the two aren't meant to share a
// module (library.ts stays scoped to runs, this to pros).
function slugify(text: string): string {
  const s = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return (s || 'pro').slice(0, 48)
}

// A metrics filename for a new pro, uniquified against the manifest's
// existing entries and (belt + suspenders) anything already on disk. Callers
// pass this as the basename of --out before invoking export-baseline.
export function uniqueMetricsFilename(label: string, baseDir: string = proBaselinesDir()): string {
  const base = slugify(label)
  const existing = new Set(list(baseDir).map((e) => e.metrics))
  let candidate = `${base}.metrics.json`
  let n = 2
  while (existing.has(candidate) || existsSync(join(baseDir, candidate))) {
    candidate = `${base}-${n}.metrics.json`
    n += 1
  }
  return candidate
}

// Append a new pro to the manifest atomically, given the engine's
// export-baseline result entry. Returns the full entry with its id + addedAt.
export function add(entry: ExportedBaselineEntry, baseDir: string = proBaselinesDir()): ProEntry {
  const full: ProEntry = {
    id: randomUUID(),
    label: entry.label,
    couple: entry.couple,
    lead_id: entry.lead_id,
    metrics: entry.metrics,
    addedAt: new Date().toISOString()
  }
  writeManifestAtomic(baseDir, [...list(baseDir), full])
  return full
}

// Drop an entry + best-effort delete its metrics file (a missing/stale file
// shouldn't fail the removal — the manifest is the source of truth).
export function remove(id: string, baseDir: string = proBaselinesDir()): boolean {
  const entries = list(baseDir)
  const idx = entries.findIndex((e) => e.id === id)
  if (idx === -1) return false
  const [removed] = entries.splice(idx, 1)
  writeManifestAtomic(baseDir, entries)
  try {
    const metricsFile = join(baseDir, removed.metrics)
    if (existsSync(metricsFile)) unlinkSync(metricsFile)
  } catch {
    // best-effort cleanup only
  }
  return true
}

// Manifest path iff the user has >=1 pro configured — callers should only
// pass --compare-pros/--pro-refs to the engine when this is non-null.
export function activeProRefs(baseDir: string = proBaselinesDir()): string | null {
  return list(baseDir).length > 0 ? manifestPath(baseDir) : null
}
