// Shared metric-resolution layer for the report/comparison views (plan-0.4.0
// §3, §5). Walks the registry (`src/renderer/src/metrics/registry.ts`)
// against a run's `MetricsSummary` and resolves each family + analyzed-
// dancer role to a concrete JSON path. Originally lived in MetricCards.tsx;
// extracted so Compare.tsx can resolve the SAME field against two different
// summaries without duplicating the resolution logic.
//
// `MetricDef.section` is a FAMILY, not always a literal top-level JSON key —
// resolving family + analyzed-dancer role to a concrete JSON path is this
// module's job (registry.ts's header says so explicitly). Three shapes show
// up in the metrics JSON (confirmed against engine/refframe_engine/run.py's
// `_cols_for`/`_gap_report`, which resolves the same ambiguity server-side
// for the gap table):
//   - leg_action / body_action: role-suffixed sections only
//     (`leg_action_lead`, `leg_action_follow`, ...).
//   - travel: SOME fields are role-suffixed (`travel_lead.slot_travel_range_bh`),
//     others are couple-level under the plain `travel` key
//     (`travel.couple_travel_range_bh`) — a field lives in exactly one place,
//     so trying the role-suffixed section first and falling back to the
//     plain one is safe.
//   - musicality / weight_countering / tracking_quality: literal top-level
//     keys (per registry.ts's header). tracking_quality nests one step
//     further (`.lead`/`.follow`); musicality and weight_countering instead
//     hardcode a handful of fields to an ABSOLUTE dancer via a `_a`/`_b` key
//     suffix (dancer 1 = lead = 'a', dancer 2 = follow = 'b', always — see
//     `_cols_for` — never "whichever role you picked"). Those become
//     partner-only cards when the analyzed dancer is the other role.
import type { MetricsSummary } from '../../../preload/index.d'
import { SECTION_ORDER, type MetricDef } from './registry'

export type Role = 'lead' | 'follow'

export function otherRole(role: Role): Role {
  return role === 'lead' ? 'follow' : 'lead'
}

// Families resolved via a role-suffixed section name (see header).
const SIDE_FAMILIES = new Set(['leg_action', 'body_action', 'travel'])

function asObj(v: unknown): MetricsSummary | undefined {
  return v !== null && typeof v === 'object' ? (v as MetricsSummary) : undefined
}

// Registry format functions expect a number; anything else (null, string,
// missing) renders as an em dash per plan-0.4.0 §3 ("numbers only").
export function formatValue(def: MetricDef, raw: unknown): string {
  return typeof raw === 'number' && Number.isFinite(raw) ? def.format(raw) : '—'
}

export interface ResolvedMetric {
  def: MetricDef
  value: unknown
  /** Same field, the other dancer — shown inline/secondary when partner is on. */
  partnerValue?: unknown
  /** Whole entry belongs to the partner (musicality/weight_countering _a/_b
   *  fields hardcoded to the other absolute role) — hidden unless partner is on. */
  partnerOnly?: boolean
}

// Returns null when this registry entry's field isn't present in `metrics` at
// all — callers skip it silently, matching engine-drift-safe registry design.
export function resolveMetric(
  metrics: MetricsSummary,
  def: MetricDef,
  role: Role
): ResolvedMetric | null {
  const family = def.section

  if (family === 'tracking_quality') {
    const sec = asObj(metrics[family])
    const own = asObj(sec?.[role])
    if (!own || !(def.key in own)) return null
    const other = asObj(sec?.[otherRole(role)])
    return { def, value: own[def.key], partnerValue: other?.[def.key] }
  }

  if (SIDE_FAMILIES.has(family)) {
    const primarySec = asObj(metrics[`${family}_${role}`])
    if (primarySec && def.key in primarySec) {
      const secondarySec = asObj(metrics[`${family}_${otherRole(role)}`])
      return { def, value: primarySec[def.key], partnerValue: secondarySec?.[def.key] }
    }
    const coupleSec = asObj(metrics[family]) // couple-level fallback (e.g. plain `travel`)
    if (coupleSec && def.key in coupleSec) return { def, value: coupleSec[def.key] }
    return null
  }

  // Literal sections: musicality, weight_countering.
  const sec = asObj(metrics[family])
  if (!sec || !(def.key in sec)) return null
  const value = sec[def.key]
  const suffix = def.key.match(/_(a|b)$/)?.[1]
  if (suffix) {
    const absRole: Role = suffix === 'a' ? 'lead' : 'follow'
    if (absRole !== role) return { def, value, partnerOnly: true }
  }
  return { def, value }
}

export const SECTION_LABELS: Record<(typeof SECTION_ORDER)[number], string> = {
  musicality: 'Musicality & timing',
  leg_action: 'Leg action',
  body_action: 'Body action',
  weight_countering: 'Connection',
  travel: 'Travel',
  tracking_quality: 'Tracking quality'
}
