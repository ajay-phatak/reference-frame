import { useCallback, useEffect, useState } from 'react'
import type { RunRecord } from '../../../preload/index.d'

interface Props {
  onOpen: (runId: string) => void
  onCompare: (runA: string, runB: string) => void
  active: boolean
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  } catch {
    return iso
  }
}

function statusClass(status: RunRecord['status']): string {
  if (status === 'done') return 'pos'
  if (status === 'error') return 'neg'
  return 'muted' // 'queued' and 'pending' both read as neutral, not error
}

// Prefer the captured YouTube title when the engine grabbed one; otherwise
// fall back to a small "YouTube <id>" chip, reusing the same 11-char-id regex
// library.ts's stemFromInput uses so the id we show matches the one baked
// into the runId.
function sourceLabel(
  source: RunRecord['source'],
  input: string,
  videoTitle: string | null
): string | null {
  if (source !== 'url') return null
  if (videoTitle) return videoTitle
  const m = input.match(/(?:v=|youtu\.be\/)([A-Za-z0-9_-]{11})/)
  return m ? `YouTube ${m[1]}` : input.length > 40 ? `${input.slice(0, 40)}…` : input
}

// Compare eligibility (plan-0.4.0 §5): a run needs structured metrics on
// disk to be either side of a comparison.
function compareEligible(run: RunRecord): boolean {
  return run.status === 'done' && run.resultPaths.metricsPath !== null
}

function Library({ onOpen, onCompare, active }: Props): React.JSX.Element {
  const [runs, setRuns] = useState<RunRecord[] | null>(null)
  // Set while picking run B for a comparison — holds run A's id. Non-null
  // puts the whole view into "pick B" mode (see header comment below).
  const [pickingA, setPickingA] = useState<string | null>(null)

  const refresh = useCallback((): void => {
    window.api.libraryList().then(setRuns)
  }, [])

  // Runs can finish while the user is elsewhere (keep-mounted views) —
  // refetch on mount and every time this tab becomes visible again.
  useEffect(() => {
    if (active) refresh()
  }, [active, refresh])

  // Queued/running status changes elsewhere (Analyze, another queued
  // submission finishing) should be reflected here live, not just on tab
  // switch — only while this tab is actually visible.
  useEffect(() => {
    if (!active) return
    return window.api.onQueueEvent(() => refresh())
  }, [active, refresh])

  const remove = async (e: React.MouseEvent, runId: string): Promise<void> => {
    e.stopPropagation()
    if (!window.confirm('Delete this run and all its files? This cannot be undone.')) return
    await window.api.libraryDelete(runId)
    refresh()
  }

  const cancelQueued = async (e: React.MouseEvent, runId: string): Promise<void> => {
    e.stopPropagation()
    await window.api.queueCancel(runId)
    refresh()
  }

  const startCompare = (e: React.MouseEvent, runId: string): void => {
    e.stopPropagation()
    setPickingA(runId)
  }

  // Card click dispatches to either normal open, or (while picking B) fires
  // the comparison — ineligible cards (not done / no metrics / the A run
  // itself) are dimmed and inert in that mode, handled by the caller.
  const handleCardClick = (run: RunRecord): void => {
    if (pickingA) {
      if (run.runId === pickingA || !compareEligible(run)) return
      onCompare(pickingA, run.runId)
      setPickingA(null)
      return
    }
    onOpen(run.runId)
  }

  if (runs === null) return <p className="muted">Loading…</p>

  const pickingRun = pickingA ? runs.find((r) => r.runId === pickingA) : undefined

  return (
    <div>
      <h1>Library</h1>
      <p className="muted">Your past runs and reports.</p>

      {pickingRun && (
        <div className="banner-info row-between">
          <span>
            Comparing <strong>{pickingRun.videoName}</strong> — pick the run to compare with.
          </span>
          <button className="btn-sm" onClick={() => setPickingA(null)}>
            Cancel
          </button>
        </div>
      )}

      {runs.length === 0 && (
        <div className="callout">
          No runs yet — head to <strong>Analyze</strong> to review your first video.
        </div>
      )}

      {runs.map((run) => {
        const srcLabel = sourceLabel(run.source, run.input, run.videoTitle)
        const eligible = compareEligible(run)
        const dimmed = pickingA !== null && (run.runId === pickingA || !eligible)
        return (
          <div
            className={`card card-click${dimmed ? ' card-dimmed' : ''}`}
            key={run.runId}
            onClick={() => {
              if (!dimmed) handleCardClick(run)
            }}
          >
            <div className="row-between">
              <h3 className="h-inline">
                {run.videoName}{' '}
                {run.options.spotlight && <span className="chip chip-even">spotlight</span>}{' '}
                {srcLabel && <span className="chip chip-even">{srcLabel}</span>}
              </h3>
              <div className="row">
                {eligible && !pickingA && (
                  <button className="btn-sm" onClick={(e) => startCompare(e, run.runId)}>
                    Compare
                  </button>
                )}
                {run.status === 'queued' && (
                  <button className="btn-sm" onClick={(e) => cancelQueued(e, run.runId)}>
                    Cancel
                  </button>
                )}
                <button className="btn-sm" onClick={(e) => remove(e, run.runId)}>
                  Delete
                </button>
              </div>
            </div>
            <p className="muted small" style={{ margin: 0 }}>
              {fmtDate(run.createdAt)} · {run.options.role} · {run.partnerName ?? 'no partner name'}{' '}
              · <span className={statusClass(run.status)}>{run.status}</span>
            </p>
          </div>
        )
      })}
    </div>
  )
}

export default Library
