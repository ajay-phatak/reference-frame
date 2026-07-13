import { useEffect, useState } from 'react'
import type { AppConfig, RunDetail } from '../../../preload/index.d'
import { parseGap, type GapRow } from '../gap'

// A YouTube URL has no captured title anywhere in run.json — show a small
// "YouTube <id>" chip instead, reusing the same 11-char-id regex library.ts's
// stemFromInput uses so the id we show matches the one baked into the runId.
function sourceLabel(source: RunDetail['run']['source'], input: string): string | null {
  if (source !== 'url') return null
  const m = input.match(/(?:v=|youtu\.be\/)([A-Za-z0-9_-]{11})/)
  return m ? `YouTube ${m[1]}` : input.length > 40 ? `${input.slice(0, 40)}…` : input
}

interface Props {
  runId: string
  onBack: () => void
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function GapRowLine({ row }: { row: GapRow }): React.JSX.Element {
  return (
    <tr>
      <td>{row.label}</td>
      <td className="mono">{row.you}</td>
      <td className="mono muted">{row.pro}</td>
      <td>
        <span className={`chip ${row.favorable ? 'chip-good' : 'chip-bad'}`}>
          {row.delta >= 0 ? '+' : ''}
          {row.delta.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}
        </span>
        {row.note && <span className="muted tiny"> {row.note}</span>}
      </td>
    </tr>
  )
}

function Report({ runId, onBack }: Props): React.JSX.Element {
  // Keyed by runId so a fetch for a stale runId (still resolving after the
  // user picked a different run) never clobbers newer state, and "loading"
  // is derivable without a synchronous setState at the top of the effect.
  const [loaded, setLoaded] = useState<{ runId: string; detail: RunDetail | null } | null>(null)
  const [swapping, setSwapping] = useState(false)
  const [swapError, setSwapError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    window.api.libraryGet(runId).then((d) => {
      if (!cancelled) setLoaded({ runId, detail: d })
    })
    return () => {
      cancelled = true
    }
  }, [runId])

  const loading = loaded === null || loaded.runId !== runId
  const detail = loading ? null : loaded.detail

  if (loading) return <p className="muted">Loading…</p>
  if (!detail) {
    return (
      <div>
        <button onClick={onBack}>← Library</button>
        <p className="neg">Run not found.</p>
      </div>
    )
  }

  const { run, reportText, gapText } = detail

  // NOTE (engine limitation, verified against run.py): run.json's youId is
  // NOT the raw pre-orientation tracked-dancer id — after orientation the
  // engine always reassigns you_id = 1 if role=="lead" else 2, a constant
  // derived purely from role. So `otherId = 3 - youId` (equivalently
  // youId===1 ? 2 : 1) is a best-effort "the other physical dancer" guess,
  // not a guaranteed complementary pick — a rerun with --me-id otherId can
  // land back on the SAME physical dancer. This is the best available
  // behavior without an engine change.
  const swapDancers = async (): Promise<void> => {
    if (run.status !== 'done' || run.youId == null) return
    const otherId = run.youId === 1 ? 2 : 1
    setSwapping(true)
    setSwapError(null)
    try {
      const res = await window.api.analyze({
        input: run.resultPaths.videoPath ?? run.input,
        me: run.options.me,
        meId: otherId,
        role: run.options.role,
        partner: run.options.partner,
        spotlight: run.options.spotlight,
        poseModel: run.options.poseModel as AppConfig['poseModel'],
        comparePros: run.options.comparePros,
        partnerName: run.partnerName,
        runId: run.runId
      })
      if (res.ok) {
        const d = await window.api.libraryGet(runId)
        setLoaded({ runId, detail: d })
      } else {
        setSwapError(res.reason ?? 'Swap failed')
      }
    } catch (err) {
      setSwapError(String(err))
    } finally {
      setSwapping(false)
    }
  }

  const srcLabel = sourceLabel(run.source, run.input)
  const coverage = run.coverage
  const lowCoverage =
    coverage != null && Object.values(coverage).some((v) => typeof v === 'number' && v < 80)

  const gap = gapText ? parseGap(gapText) : null

  return (
    <div>
      <div className="row-between">
        <button onClick={onBack}>← Library</button>
        <div className="row">
          <button disabled title="Coming in phase 4">
            Ask the coach
          </button>
          <button
            disabled={run.status !== 'done' || run.youId == null || swapping}
            onClick={swapDancers}
          >
            {swapping ? 'Re-running with the other dancer…' : 'Not me? Swap dancers'}
          </button>
          <button onClick={() => window.api.libraryOpenFolder(runId)}>Open folder</button>
        </div>
      </div>

      <h1>{run.videoName}</h1>
      <p className="subtitle">
        {fmtDate(run.createdAt)} · {run.options.role} · {run.partnerName ?? 'no partner name'}
        {run.options.spotlight && (
          <span className="chip chip-even" style={{ marginLeft: 8 }}>
            spotlight
          </span>
        )}
        {srcLabel && (
          <span className="chip chip-even" style={{ marginLeft: 8 }}>
            {srcLabel}
          </span>
        )}
      </p>

      {swapError && (
        <div className="callout" style={{ borderColor: 'var(--loss-border)' }}>
          <strong className="neg">Swap failed:</strong> <span className="neg">{swapError}</span>
        </div>
      )}

      {run.status === 'error' && (
        <div className="callout" style={{ borderColor: 'var(--loss-border)' }}>
          <strong className="neg">Analysis failed:</strong>{' '}
          <span className="neg">{run.error ?? 'unknown error'}</span>
        </div>
      )}
      {run.status === 'pending' && (
        <div className="callout">This run never finished (app closed mid-analysis?).</div>
      )}

      {lowCoverage && (
        <div className="banner-info" style={{ borderColor: 'var(--warning-border)' }}>
          Tracking coverage is below 80% for at least one dancer — per-dancer numbers are
          approximate.
        </div>
      )}

      {reportText && (
        <>
          <h3>Report</h3>
          <pre className="report-text">{reportText}</pre>
        </>
      )}

      {gap && (
        <>
          <h3>Gap analysis vs pro references</h3>
          {gap.couples.map((c) => (
            <div className="card" key={c.couple}>
              <h4 style={{ marginTop: 0 }}>{c.couple}</h4>
              <p className="muted tiny">{c.clipsSummary}</p>
              {c.sections.map((s, i) => (
                <div key={i} style={{ marginBottom: 12 }}>
                  {s.heading && <p className="eyebrow">{s.heading}</p>}
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Metric</th>
                        <th>You</th>
                        <th>Pro avg</th>
                        <th>Gap</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.rows.map((row, j) => (
                        <GapRowLine row={row} key={j} />
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          ))}
        </>
      )}

      {!reportText && !gap && run.status === 'done' && (
        <p className="muted">No report text found on disk for this run.</p>
      )}
    </div>
  )
}

export default Report
