import { useState } from 'react'
import type { AppConfig, EngineEvent } from '../../../preload/index.d'

interface Props {
  config: AppConfig
  onAnalyzed: (runId: string) => void
}

interface StageState {
  current: number
  total: number
  detail?: string
  startedAt: number
}

const STAGE_ORDER = ['download', 'extract', 'refine', 'lift', 'metrics', 'report', 'gap'] as const
const STAGE_LABELS: Record<string, string> = {
  download: 'Download video',
  extract: 'Detect poses',
  refine: 'Refine keypoints',
  lift: 'Lift to 3D',
  metrics: 'Compute metrics',
  report: 'Build report',
  gap: 'Compare vs pros'
}

function stagePct(s: StageState): number {
  if (s.total > 0) return Math.max(0, Math.min(100, Math.round((s.current / s.total) * 100)))
  return s.current > 0 ? 100 : 0
}

// ETA from the observed rate so far — only meaningful once a stage has moved
// past its first tick and knows its total (extract/refine/download; the
// discrete 0/1 stages skip this).
function etaLabel(s: StageState): string | null {
  if (s.total <= 1 || s.current <= 0) return null
  const elapsed = Date.now() - s.startedAt
  if (elapsed <= 0) return null
  const rate = s.current / elapsed
  if (rate <= 0) return null
  const remainingMs = (s.total - s.current) / rate
  const secs = Math.round(remainingMs / 1000)
  if (secs <= 0) return null
  return secs < 60 ? `~${secs}s left` : `~${Math.round(secs / 60)}m left`
}

function Analyze({ config, onAnalyzed }: Props): React.JSX.Element {
  const [inputMode, setInputMode] = useState<'file' | 'url'>('file')
  const [filePath, setFilePath] = useState('')
  const [url, setUrl] = useState('')

  const [me, setMe] = useState<'left' | 'right'>(config.defaultMe)
  const [role, setRole] = useState<'lead' | 'follow'>(config.role)
  const [partnerName, setPartnerName] = useState(config.partnerName ?? '')
  const [partnerToggle, setPartnerToggle] = useState(false)
  const [spotlight, setSpotlight] = useState(false)
  const [comparePros, setComparePros] = useState(true)
  const [poseModel, setPoseModel] = useState(config.poseModel)

  const [running, setRunning] = useState(false)
  const [stageProgress, setStageProgress] = useState<Record<string, StageState>>({})
  const [logs, setLogs] = useState<string[]>([])
  const [showLog, setShowLog] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const pickFile = async (): Promise<void> => {
    const path = await window.api.pickVideoFile()
    if (path) setFilePath(path)
  }

  const input = inputMode === 'file' ? filePath : url.trim()

  const run = async (): Promise<void> => {
    if (!input || running) return
    setRunning(true)
    setErrorMsg(null)
    setStageProgress({})
    setLogs([])

    const unsubscribe = window.api.onEngineEvent((e: EngineEvent) => {
      if (e.event === 'progress' && typeof e.stage === 'string') {
        const stage = e.stage
        setStageProgress((prev) => ({
          ...prev,
          [stage]: {
            current: typeof e.current === 'number' ? e.current : 0,
            total: typeof e.total === 'number' ? e.total : 0,
            detail: typeof e.detail === 'string' ? e.detail : undefined,
            startedAt: prev[stage]?.startedAt ?? Date.now()
          }
        }))
      } else if (e.event === 'log') {
        setLogs((prev) => [...prev, String(e.msg ?? '')])
      } else if (e.event === 'error') {
        setErrorMsg(String(e.msg ?? 'Engine error'))
      }
    })

    try {
      const res = await window.api.analyze({
        input,
        me,
        role,
        partner: partnerToggle,
        spotlight,
        poseModel,
        comparePros,
        partnerName: partnerName.trim() || null
      })
      if (res.ok && res.runId) {
        onAnalyzed(res.runId)
      } else {
        setErrorMsg(res.reason ?? 'Analysis failed')
      }
    } catch (err) {
      setErrorMsg(String(err))
    } finally {
      unsubscribe()
      setRunning(false)
    }
  }

  const cancel = (): void => {
    window.api.cancelAnalyze()
  }

  const stages = Object.keys(stageProgress).sort(
    (a, b) =>
      STAGE_ORDER.indexOf(a as (typeof STAGE_ORDER)[number]) -
      STAGE_ORDER.indexOf(b as (typeof STAGE_ORDER)[number])
  )

  return (
    <div>
      <h1>Analyze</h1>
      <p className="muted">Run the analysis pipeline on a practice video.</p>

      <div className="card">
        <div className="row" style={{ marginBottom: 8 }}>
          <button
            className={inputMode === 'file' ? 'active' : undefined}
            disabled={running}
            onClick={() => setInputMode('file')}
          >
            Video file
          </button>
          <button
            className={inputMode === 'url' ? 'active' : undefined}
            disabled={running}
            onClick={() => setInputMode('url')}
          >
            YouTube URL
          </button>
        </div>

        {inputMode === 'file' ? (
          <div className="row">
            <button disabled={running} onClick={pickFile}>
              Choose video…
            </button>
            <span className="mono tiny muted">{filePath || 'No file selected'}</span>
          </div>
        ) : (
          <div>
            <input
              style={{ width: '100%' }}
              placeholder="https://www.youtube.com/watch?v=…"
              value={url}
              disabled={running}
              onChange={(e) => setUrl(e.target.value)}
            />
            <p className="muted tiny" style={{ marginTop: 4 }}>
              Downloads in-process before analysis starts — not yet verified end-to-end, but the
              engine supports it.
            </p>
          </div>
        )}

        <h4>Options</h4>
        <div className="row" style={{ flexWrap: 'wrap', gap: 16 }}>
          <label className="check-label">
            Your side
            <br />
            <select
              value={me}
              disabled={running}
              onChange={(e) => setMe(e.target.value as 'left' | 'right')}
            >
              <option value="left">Left</option>
              <option value="right">Right</option>
            </select>
          </label>
          <label className="check-label">
            Your role
            <br />
            <select
              value={role}
              disabled={running}
              onChange={(e) => setRole(e.target.value as 'lead' | 'follow')}
            >
              <option value="lead">Lead</option>
              <option value="follow">Follow</option>
            </select>
          </label>
          <label className="check-label">
            Pose model
            <br />
            <select
              value={poseModel}
              disabled={running}
              onChange={(e) => setPoseModel(e.target.value as AppConfig['poseModel'])}
            >
              <option value="n">n — fastest</option>
              <option value="s">s</option>
              <option value="m">m — balanced (default)</option>
              <option value="l">l</option>
              <option value="x">x — most accurate</option>
            </select>
          </label>
          <label className="check-label">
            Partner name
            <br />
            <input
              value={partnerName}
              disabled={running}
              placeholder="optional"
              onChange={(e) => setPartnerName(e.target.value)}
            />
          </label>
        </div>

        <div className="row" style={{ marginTop: 12, flexWrap: 'wrap' }}>
          <label className="check-label">
            <input
              type="checkbox"
              checked={partnerToggle}
              disabled={running}
              onChange={(e) => setPartnerToggle(e.target.checked)}
            />{' '}
            Also analyze partner
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={spotlight}
              disabled={running}
              onChange={(e) => setSpotlight(e.target.checked)}
            />{' '}
            Spotlight (no floor-travel penalty)
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={comparePros}
              disabled={running}
              onChange={(e) => setComparePros(e.target.checked)}
            />{' '}
            Compare to pros
          </label>
        </div>

        <div className="row" style={{ marginTop: 16 }}>
          <button className="btn-primary" disabled={!input || running} onClick={run}>
            {running ? 'Running…' : 'Run analysis'}
          </button>
          {running && <button onClick={cancel}>Cancel</button>}
        </div>
      </div>

      {errorMsg && (
        <div className="callout" style={{ borderColor: 'var(--loss-border)' }}>
          <strong className="neg">Error:</strong> <span className="neg">{errorMsg}</span>
        </div>
      )}

      {(running || stages.length > 0) && (
        <div className="card">
          <h4>Progress</h4>
          {stages.length === 0 && <p className="muted tiny">Starting…</p>}
          {stages.map((stage) => {
            const s = stageProgress[stage]
            const pct = stagePct(s)
            const eta = etaLabel(s)
            return (
              <div key={stage} className="stage-row">
                <div className="row-between">
                  <span className="small">{STAGE_LABELS[stage] ?? stage}</span>
                  <span className="muted tiny">
                    {pct}%{eta ? ` · ${eta}` : ''}
                  </span>
                </div>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${pct}%` }} />
                </div>
                {s.detail && <div className="muted tiny">{s.detail}</div>}
              </div>
            )
          })}

          {logs.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <button className="btn-sm" onClick={() => setShowLog((v) => !v)}>
                {showLog ? 'Hide log' : `Show log (${logs.length})`}
              </button>
              {showLog && <pre className="log-tail">{logs.slice(-200).join('\n')}</pre>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default Analyze
