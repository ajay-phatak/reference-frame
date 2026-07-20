import { existsSync, readFileSync } from 'fs'

// Reader for the engine's per-run `<stem>_metrics.json` (written by
// dance_metrics.compute_all_metrics via run.py, see CLAUDE.md's engine
// section). Top level is a flat dict of section keys (leg_action_lead,
// travel, musicality, ...), each a nested dict of scalars plus some raw
// arrays (step_data time series). Electron-import-free and baseDir-free —
// same testability pattern as pros.ts — so this is unit-testable against a
// throwaway JSON file instead of a real run.

export type MetricsScalar = number | string | boolean | null

// Recursive: a section (or the summary itself) is scalars and/or nested
// objects of the same shape, arbitrarily deep (e.g.
// tracking_quality.lead.coverage_pct, movement_quality_detail.lead.dist_*.p50).
export interface MetricsSummary {
  [key: string]: MetricsScalar | MetricsSummary
}

function isScalar(v: unknown): v is MetricsScalar {
  return v === null || typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean'
}

// Keep scalar leaves and nested objects of scalars; drop arrays entirely
// (step_data etc. — a future release will want them for video-sync, not this
// one; see plan-0.4.0 §2). Unknown/extra keys pass through untouched, so
// engine drift in either direction degrades gracefully instead of breaking.
function pruneToScalars(value: object): MetricsSummary {
  const out: MetricsSummary = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (isScalar(v)) {
      out[k] = v
    } else if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = pruneToScalars(v)
    }
    // arrays (and anything else non-object/non-scalar) are dropped
  }
  return out
}

// Defensive by design: a missing file, unparseable JSON, or a non-object top
// level all yield null rather than throwing — metrics are a nice-to-have
// overlay on a run, never load-bearing for the rest of the app.
export function readMetrics(metricsPath: string): MetricsSummary | null {
  if (!existsSync(metricsPath)) return null
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(metricsPath, 'utf-8'))
  } catch {
    return null
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  return pruneToScalars(raw)
}
