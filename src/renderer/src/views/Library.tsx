import { useEffect, useState } from 'react'
import type { RunRecord } from '../../../preload/index.d'

interface Props {
  onOpen: (runId: string) => void
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
  return 'muted'
}

function Library({ onOpen }: Props): React.JSX.Element {
  const [runs, setRuns] = useState<RunRecord[] | null>(null)

  const refresh = (): void => {
    window.api.libraryList().then(setRuns)
  }

  useEffect(refresh, [])

  const remove = async (e: React.MouseEvent, runId: string): Promise<void> => {
    e.stopPropagation()
    if (!window.confirm('Delete this run and all its files? This cannot be undone.')) return
    await window.api.libraryDelete(runId)
    refresh()
  }

  if (runs === null) return <p className="muted">Loading…</p>

  return (
    <div>
      <h1>Library</h1>
      <p className="muted">Your past runs and reports.</p>

      {runs.length === 0 && (
        <div className="callout">
          No runs yet — head to <strong>Analyze</strong> to review your first video.
        </div>
      )}

      {runs.map((run) => (
        <div className="card card-click" key={run.runId} onClick={() => onOpen(run.runId)}>
          <div className="row-between">
            <h3 className="h-inline">
              {run.videoName}{' '}
              {run.options.spotlight && <span className="chip chip-even">spotlight</span>}
            </h3>
            <button className="btn-sm" onClick={(e) => remove(e, run.runId)}>
              Delete
            </button>
          </div>
          <p className="muted small" style={{ margin: 0 }}>
            {fmtDate(run.createdAt)} · {run.options.role} · {run.partnerName ?? 'no partner name'} ·{' '}
            <span className={statusClass(run.status)}>{run.status}</span>
          </p>
        </div>
      ))}
    </div>
  )
}

export default Library
