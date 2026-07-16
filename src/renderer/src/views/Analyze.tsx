import { useState } from 'react'
import type { AppConfig, EngineEvent, SeedDetection } from '../../../preload/index.d'

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

const STAGE_ORDER = [
  'download',
  'seed',
  'extract',
  'refine',
  'lift',
  'metrics',
  'report',
  'gap'
] as const
const STAGE_LABELS: Record<string, string> = {
  download: 'Download video',
  seed: 'Locate dancers',
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

function looksLikeYoutubeUrl(s: string): boolean {
  return /^https?:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)/i.test(s)
}

function Analyze({ config, onAnalyzed }: Props): React.JSX.Element {
  const [inputMode, setInputMode] = useState<'file' | 'url'>('file')
  const [filePath, setFilePath] = useState('')
  const [url, setUrl] = useState('')

  // Side has no config-driven default — it varies clip to clip, so 'left' is
  // just a sane starting point. Role defaults from the Settings/Onboarding
  // default; partner name is always per-run (J&J partners differ per clip).
  const [me, setMe] = useState<'left' | 'right'>('left')
  const [role, setRole] = useState<'lead' | 'follow'>(config.role)
  const [partnerName, setPartnerName] = useState('')
  const [partnerToggle, setPartnerToggle] = useState(false)
  const [spotlight, setSpotlight] = useState(false)
  const [comparePros, setComparePros] = useState(true)
  const [poseModel, setPoseModel] = useState(config.poseModel)

  const [running, setRunning] = useState(false)
  const [stageProgress, setStageProgress] = useState<Record<string, StageState>>({})
  const [logs, setLogs] = useState<string[]>([])
  const [showLog, setShowLog] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Crowd-mode seed picker: two-step flow (seed-preview -> analyze) so the
  // user can pick themselves out of a crowd shot before the real run starts.
  const [crowdMode, setCrowdMode] = useState(false)
  const [atSec, setAtSec] = useState(30)
  const [seedRunId, setSeedRunId] = useState<string | null>(null)
  const [seedImage, setSeedImage] = useState<string | null>(null)
  const [seedDets, setSeedDets] = useState<SeedDetection[] | null>(null)
  const [seedVideo, setSeedVideo] = useState<string | null>(null)
  const [seedFrameIdx, setSeedFrameIdx] = useState<number | undefined>(undefined)
  const [seedTSec, setSeedTSec] = useState<number | undefined>(undefined)
  const [seedMeIdx, setSeedMeIdx] = useState<number | null>(null)
  const [seedPartnerIdx, setSeedPartnerIdx] = useState<number | null>(null)
  const [seedLoading, setSeedLoading] = useState(false)
  const [seedError, setSeedError] = useState<string | null>(null)
  const [seedImgNatural, setSeedImgNatural] = useState<{ w: number; h: number } | null>(null)
  const [seedStageProgress, setSeedStageProgress] = useState<Record<string, StageState>>({})
  const [seedLogs, setSeedLogs] = useState<string[]>([])
  const [seedShowLog, setSeedShowLog] = useState(false)

  const pickFile = async (): Promise<void> => {
    const path = await window.api.pickVideoFile()
    if (path) setFilePath(path)
  }

  const input = inputMode === 'file' ? filePath : url.trim()

  const findUs = async (): Promise<void> => {
    if (!input || seedLoading) return
    setSeedLoading(true)
    setSeedError(null)
    setSeedStageProgress({})
    setSeedLogs([])

    const unsubscribe = window.api.onEngineEvent((e: EngineEvent) => {
      if (e.event === 'progress' && typeof e.stage === 'string') {
        const stage = e.stage
        setSeedStageProgress((prev) => ({
          ...prev,
          [stage]: {
            current: typeof e.current === 'number' ? e.current : 0,
            total: typeof e.total === 'number' ? e.total : 0,
            detail: typeof e.detail === 'string' ? e.detail : undefined,
            startedAt: prev[stage]?.startedAt ?? Date.now()
          }
        }))
      } else if (e.event === 'log') {
        setSeedLogs((prev) => [...prev, String(e.msg ?? '')])
      } else if (e.event === 'error') {
        setSeedError(String(e.msg ?? 'Engine error'))
      }
    })

    try {
      const res = await window.api.seedPreview({
        input,
        atSec,
        poseModel,
        runId: seedRunId,
        me,
        role,
        partner: partnerToggle,
        spotlight,
        comparePros,
        partnerName: partnerName.trim() || null
      })
      if (res.ok) {
        setSeedRunId(res.runId ?? null)
        setSeedImage(res.image ?? null)
        setSeedDets(res.dets ?? [])
        setSeedVideo(res.video ?? null)
        setSeedFrameIdx(res.frameIdx)
        setSeedTSec(res.tSec)
        setSeedMeIdx(null)
        setSeedPartnerIdx(null)
        setSeedImgNatural(null)
      } else {
        setSeedError(res.reason ?? 'Could not find dancers in this frame')
      }
    } catch (err) {
      setSeedError(String(err))
    } finally {
      unsubscribe()
      setSeedLoading(false)
    }
  }

  const onSeedImgLoad = (e: React.SyntheticEvent<HTMLImageElement>): void => {
    const img = e.currentTarget
    setSeedImgNatural({ w: img.naturalWidth, h: img.naturalHeight })
  }

  const clickSeedBox = (idx: number): void => {
    if (idx === seedMeIdx) {
      setSeedMeIdx(null)
      return
    }
    if (idx === seedPartnerIdx) {
      setSeedPartnerIdx(null)
      return
    }
    if (seedMeIdx === null) {
      setSeedMeIdx(idx)
    } else if (seedPartnerIdx === null) {
      setSeedPartnerIdx(idx)
    }
  }

  const resetPicks = (): void => {
    setSeedMeIdx(null)
    setSeedPartnerIdx(null)
  }

  const run = async (): Promise<void> => {
    if (!input || running) return
    if (crowdMode && (seedMeIdx == null || seedPartnerIdx == null)) return
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
        input: crowdMode ? (seedVideo ?? input) : input,
        me,
        role,
        partner: partnerToggle,
        spotlight,
        poseModel,
        comparePros,
        partnerName: partnerName.trim() || null,
        ...(crowdMode ? { runId: seedRunId, seedMeIdx, seedPartnerIdx } : {})
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

  const seedStages = Object.keys(seedStageProgress).sort(
    (a, b) =>
      STAGE_ORDER.indexOf(a as (typeof STAGE_ORDER)[number]) -
      STAGE_ORDER.indexOf(b as (typeof STAGE_ORDER)[number])
  )

  const runDisabled =
    !input || running || (crowdMode && (seedMeIdx == null || seedPartnerIdx == null))

  return (
    <div>
      <h1>Analyze</h1>
      <p className="muted">Run the analysis pipeline on a practice video.</p>

      <div className="card">
        <div className="row" style={{ marginBottom: 8 }}>
          <button
            className={`toggle-btn${inputMode === 'file' ? ' active' : ''}`}
            disabled={running}
            onClick={() => setInputMode('file')}
          >
            Video file
          </button>
          <button
            className={`toggle-btn${inputMode === 'url' ? ' active' : ''}`}
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
            {url.trim() && !looksLikeYoutubeUrl(url.trim()) && (
              <p className="tiny" style={{ color: 'var(--warning)', marginTop: 4 }}>
                Doesn&apos;t look like a YouTube URL — analysis may fail if this isn&apos;t a
                supported video link.
              </p>
            )}
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
            Partner name (optional)
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
          <label className="check-label">
            <input
              type="checkbox"
              checked={crowdMode}
              disabled={running}
              onChange={(e) => setCrowdMode(e.target.checked)}
            />{' '}
            Crowded floor? Pick yourself out of a crowd shot
          </label>
        </div>

        {crowdMode && (
          <div
            style={{
              marginTop: 16,
              borderTop: '1px solid var(--border-1)',
              paddingTop: 16
            }}
          >
            <h4>Pick yourself out of the crowd</h4>
            <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
              <label className="check-label">
                Timestamp (seconds)
                <br />
                <input
                  type="number"
                  min={0}
                  value={atSec}
                  disabled={seedLoading || running}
                  onChange={(e) => setAtSec(Number(e.target.value))}
                  style={{ width: 90 }}
                />
              </label>
              <button disabled={!input || seedLoading || running} onClick={findUs}>
                {seedLoading ? 'Finding…' : 'Find us'}
              </button>
            </div>

            {seedError && (
              <div className="callout" style={{ borderColor: 'var(--loss-border)' }}>
                <strong className="neg">Couldn&apos;t find dancers:</strong>{' '}
                <span className="neg">{seedError}</span>
              </div>
            )}

            {(seedLoading || seedStages.length > 0) && (
              <div style={{ marginTop: 12 }}>
                {seedStages.length === 0 && <p className="muted tiny">Starting…</p>}
                {seedStages.map((stage) => {
                  const s = seedStageProgress[stage]
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
                    </div>
                  )
                })}
                {seedLogs.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <button className="btn-sm" onClick={() => setSeedShowLog((v) => !v)}>
                      {seedShowLog ? 'Hide log' : `Show log (${seedLogs.length})`}
                    </button>
                    {seedShowLog && (
                      <pre className="log-tail">{seedLogs.slice(-200).join('\n')}</pre>
                    )}
                  </div>
                )}
              </div>
            )}

            {seedImage && (
              <div style={{ marginTop: 12 }}>
                {(seedTSec != null || seedFrameIdx != null) && (
                  <p className="muted tiny">
                    Frame at t≈{seedTSec?.toFixed(1) ?? '?'}s (frame #{seedFrameIdx ?? '?'})
                  </p>
                )}
                <div className="seed-frame">
                  <img
                    src={seedImage}
                    style={{ maxWidth: '100%', display: 'block' }}
                    onLoad={onSeedImgLoad}
                    alt="Seed frame with detected dancers"
                  />
                  {seedImgNatural &&
                    seedDets &&
                    seedDets.map((det) => {
                      const [x0, y0, x1, y1] = det.box
                      const boxCls =
                        det.idx === seedMeIdx
                          ? 'seed-box seed-box-me'
                          : det.idx === seedPartnerIdx
                            ? 'seed-box seed-box-partner'
                            : 'seed-box'
                      return (
                        <button
                          key={det.idx}
                          type="button"
                          className={boxCls}
                          style={{
                            left: `${(x0 / seedImgNatural.w) * 100}%`,
                            top: `${(y0 / seedImgNatural.h) * 100}%`,
                            width: `${((x1 - x0) / seedImgNatural.w) * 100}%`,
                            height: `${((y1 - y0) / seedImgNatural.h) * 100}%`
                          }}
                          onClick={() => clickSeedBox(det.idx)}
                        >
                          <span className="seed-box-label">{det.idx}</span>
                        </button>
                      )
                    })}
                </div>

                <div className="row" style={{ marginTop: 8, flexWrap: 'wrap', gap: 12 }}>
                  <label className="check-label">
                    You are #
                    <br />
                    <input
                      type="number"
                      value={seedMeIdx ?? ''}
                      onChange={(e) =>
                        setSeedMeIdx(e.target.value === '' ? null : Number(e.target.value))
                      }
                      style={{ width: 70 }}
                    />
                  </label>
                  <label className="check-label">
                    Partner is #
                    <br />
                    <input
                      type="number"
                      value={seedPartnerIdx ?? ''}
                      onChange={(e) =>
                        setSeedPartnerIdx(e.target.value === '' ? null : Number(e.target.value))
                      }
                      style={{ width: 70 }}
                    />
                  </label>
                  <button className="btn-sm" onClick={resetPicks}>
                    Reset picks
                  </button>
                </div>
                <p className="muted tiny" style={{ marginTop: 4 }}>
                  {seedMeIdx != null && seedPartnerIdx != null
                    ? `You: #${seedMeIdx} · Partner: #${seedPartnerIdx}`
                    : 'Click yourself, then your partner'}
                </p>
              </div>
            )}
          </div>
        )}

        <div className="row" style={{ marginTop: 16 }}>
          <button className="btn-primary" disabled={runDisabled} onClick={run}>
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
