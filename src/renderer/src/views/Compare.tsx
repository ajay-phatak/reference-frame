// Run A/B comparison view (plan-0.4.0 §5). Reached from Library, which
// picks the two runIds; loads both RunRecords + MetricsSummaries (no new
// IPC — `libraryGet`/`libraryMetrics` called twice) and walks the registry
// against BOTH summaries, resolving each field with its own run's role.
//
// Coloring here is OUR registry `direction` metadata, not the engine's gap
// ▲/▼ — see resolve.ts / registry.ts headers. This view never touches gap
// code.
import { useEffect, useState } from 'react'
import type { MetricsSummary, RunRecord } from '../../../preload/index.d'
import {
  METRIC_REGISTRY,
  SECTION_ORDER,
  type MetricDef,
  type MetricDirection
} from '../metrics/registry'
import { formatValue, resolveMetric, SECTION_LABELS } from '../metrics/resolve'
import { roleNoun } from './shared'

interface Props {
  runA: string
  runB: string
  onBack: () => void
}

interface SideState {
  loading: boolean
  run: RunRecord | null
  metrics: MetricsSummary | null
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

// Keyed by runId so a fetch for a stale runId (the user picked a different
// pair before this one resolved) never clobbers newer state — same pattern
// Report.tsx uses for its own run/metrics loads.
function useRunWithMetrics(runId: string): SideState {
  const [runState, setRunState] = useState<{ runId: string; run: RunRecord | null } | null>(null)
  const [metricsState, setMetricsState] = useState<{
    runId: string
    metrics: MetricsSummary | null
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    window.api.libraryGet(runId).then((d) => {
      if (!cancelled) setRunState({ runId, run: d ? d.run : null })
    })
    return () => {
      cancelled = true
    }
  }, [runId])

  useEffect(() => {
    let cancelled = false
    window.api.libraryMetrics(runId).then((m) => {
      if (!cancelled) setMetricsState({ runId, metrics: m })
    })
    return () => {
      cancelled = true
    }
  }, [runId])

  const runReady = runState !== null && runState.runId === runId
  const metricsReady = metricsState !== null && metricsState.runId === runId
  return {
    loading: !runReady || !metricsReady,
    run: runReady ? runState.run : null,
    metrics: metricsReady ? metricsState.metrics : null
  }
}

// Delta = B - A, formatted with the same precision/unit as the metric's own
// formatter but always explicitly signed (some formatters are already
// signed, e.g. `msv`/`signed()` — strip any leading '+' before re-adding it
// so we never double up).
function formatDelta(def: MetricDef, diff: number): string {
  if (diff === 0) return def.format(0).replace(/^\+/, '')
  const magnitude = def.format(Math.abs(diff)).replace(/^\+/, '')
  return diff > 0 ? `+${magnitude}` : `-${magnitude}`
}

// null = render as plain uncolored text (direction is 'target'/'neutral', or
// one side is missing so there's nothing to favor).
function deltaChipClass(direction: MetricDirection, diff: number): string | null {
  if (direction === 'higher') return diff > 0 ? 'chip-good' : diff < 0 ? 'chip-bad' : 'chip-even'
  if (direction === 'lower') return diff < 0 ? 'chip-good' : diff > 0 ? 'chip-bad' : 'chip-even'
  return null
}

function RunHeader({ label, run }: { label: string; run: RunRecord }): React.JSX.Element {
  return (
    <div className="card" style={{ flex: 1 }}>
      <p className="eyebrow">{label}</p>
      <h3 className="h-inline">{run.videoName}</h3>
      <p className="muted small" style={{ margin: 0 }}>
        {fmtDate(run.createdAt)} · {roleNoun(run.options.role)} ·{' '}
        {run.partnerName ?? 'no partner name'}
        {run.options.spotlight && (
          <span className="chip chip-even" style={{ marginLeft: 8 }}>
            spotlight
          </span>
        )}
      </p>
    </div>
  )
}

function Compare({ runA, runB, onBack }: Props): React.JSX.Element {
  const a = useRunWithMetrics(runA)
  const b = useRunWithMetrics(runB)

  if (a.loading || b.loading) {
    return (
      <div>
        <button onClick={onBack}>← Library</button>
        <p className="muted">Loading…</p>
      </div>
    )
  }

  if (!a.run || !b.run) {
    return (
      <div>
        <button onClick={onBack}>← Library</button>
        <p className="neg">One or both runs could not be found.</p>
      </div>
    )
  }

  const runA_ = a.run
  const runB_ = b.run
  const metricsA = a.metrics
  const metricsB = b.metrics

  const roleDiffers = runA_.options.role !== runB_.options.role
  const spotlightDiffers = runA_.options.spotlight !== runB_.options.spotlight
  const noApples = roleDiffers || spotlightDiffers

  // Group registry rows by section, resolving each against both summaries
  // with THAT run's own analyzed-dancer role.
  const sections =
    metricsA && metricsB
      ? SECTION_ORDER.map((section) => {
          const rows = METRIC_REGISTRY.filter((def) => def.section === section)
            .map((def) => {
              const resolvedA = resolveMetric(metricsA, def, runA_.options.role)
              const resolvedB = resolveMetric(metricsB, def, runB_.options.role)
              if (!resolvedA && !resolvedB) return null
              if (resolvedA?.partnerOnly || resolvedB?.partnerOnly) return null

              const aDisplay = resolvedA ? formatValue(def, resolvedA.value) : '—'
              const bDisplay = resolvedB ? formatValue(def, resolvedB.value) : '—'
              const aNum =
                resolvedA && typeof resolvedA.value === 'number' && Number.isFinite(resolvedA.value)
                  ? resolvedA.value
                  : null
              const bNum =
                resolvedB && typeof resolvedB.value === 'number' && Number.isFinite(resolvedB.value)
                  ? resolvedB.value
                  : null
              const diff = aNum !== null && bNum !== null ? bNum - aNum : null
              const deltaDisplay = diff !== null ? formatDelta(def, diff) : '—'
              const chipClass = diff !== null ? deltaChipClass(def.direction, diff) : null

              return { def, aDisplay, bDisplay, deltaDisplay, chipClass }
            })
            .filter((r): r is NonNullable<typeof r> => r !== null)
          return { section, rows }
        }).filter((s) => s.rows.length > 0)
      : []

  return (
    <div>
      <button onClick={onBack}>← Library</button>
      <h1>Compare runs</h1>

      <div className="row" style={{ alignItems: 'stretch', marginBottom: 16 }}>
        <RunHeader label="A" run={runA_} />
        <RunHeader label="B" run={runB_} />
      </div>

      {noApples && (
        <div className="banner-info">
          These runs differ in {roleDiffers ? 'role' : ''}
          {roleDiffers && spotlightDiffers ? ' and ' : ''}
          {spotlightDiffers ? 'spotlight mode' : ''} — numbers are still shown, but they may not be
          apples-to-apples.
        </div>
      )}

      {!metricsA || !metricsB ? (
        <p className="muted">
          No structured metrics for one or both runs — re-run the analysis on 0.4.0+.
        </p>
      ) : (
        sections.map(({ section, rows }) => (
          <div key={section} style={{ marginBottom: 20 }}>
            <p className="eyebrow">{SECTION_LABELS[section]}</p>
            <table className="table">
              <thead>
                <tr>
                  <th>Metric</th>
                  <th>A</th>
                  <th>B</th>
                  <th>Δ (B − A)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.def.key}>
                    <td>{row.def.label}</td>
                    <td className="mono">{row.aDisplay}</td>
                    <td className="mono">{row.bDisplay}</td>
                    <td>
                      {row.chipClass ? (
                        <span className={`chip ${row.chipClass}`}>{row.deltaDisplay}</span>
                      ) : (
                        <span className="mono muted">{row.deltaDisplay}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}
    </div>
  )
}

export default Compare
