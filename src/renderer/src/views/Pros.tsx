import { useCallback, useEffect, useState } from 'react'
import type { AppConfig, EngineEvent, ProEntry, SeedDetection } from '../../../preload/index.d'
import {
  looksLikeYoutubeUrl,
  makeSeedBoxClickHandler,
  sortedStages,
  type StageState
} from './engineProgress'
import { ProgressBlock, SeedPicker, VideoInput } from './shared'

interface Props {
  config: AppConfig
  active: boolean
  onBusyChange?: (busy: boolean) => void
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

function Pros({ config, active, onBusyChange }: Props): React.JSX.Element {
  const [pros, setPros] = useState<ProEntry[] | null>(null)
  const [adding, setAdding] = useState(false)

  const refresh = useCallback((): void => {
    window.api.prosList().then(setPros)
  }, [])

  // Refetch on mount and whenever this tab becomes visible again — an
  // add-pro job can finish while the user is on another tab.
  useEffect(() => {
    if (active) refresh()
  }, [active, refresh])

  const removePro = async (e: React.MouseEvent, id: string): Promise<void> => {
    e.stopPropagation()
    if (!window.confirm('Remove this pro? This cannot be undone.')) return
    await window.api.prosRemove(id)
    refresh()
  }

  // --- "add a pro" flow: pick video -> label/couple -> seed-pick lead+partner
  // -> progress (analyze -> export-baseline, chained server-side) -> done ---
  const [inputMode, setInputMode] = useState<'file' | 'url'>('file')
  const [filePath, setFilePath] = useState('')
  const [url, setUrl] = useState('')
  const [label, setLabel] = useState('')
  const [couple, setCouple] = useState('')
  const [poseModel] = useState(config.poseModel)
  const [atSec, setAtSec] = useState(30)

  const [jobId, setJobId] = useState<string | null>(null)
  const [seedImage, setSeedImage] = useState<string | null>(null)
  const [seedDets, setSeedDets] = useState<SeedDetection[] | null>(null)
  const [seedVideo, setSeedVideo] = useState<string | null>(null)
  const [seedFrameIdx, setSeedFrameIdx] = useState<number | undefined>(undefined)
  const [seedTSec, setSeedTSec] = useState<number | undefined>(undefined)
  const [leadIdx, setLeadIdx] = useState<number | null>(null)
  const [partnerIdx, setPartnerIdx] = useState<number | null>(null)
  const [seedImgNatural, setSeedImgNatural] = useState<{ w: number; h: number } | null>(null)
  const [seedLoading, setSeedLoading] = useState(false)
  const [seedError, setSeedError] = useState<string | null>(null)
  const [seedStageProgress, setSeedStageProgress] = useState<Record<string, StageState>>({})
  const [seedLogs, setSeedLogs] = useState<string[]>([])
  const [seedShowLog, setSeedShowLog] = useState(false)

  const [submitting, setSubmitting] = useState(false)
  const [stageProgress, setStageProgress] = useState<Record<string, StageState>>({})
  const [logs, setLogs] = useState<string[]>([])
  const [showLog, setShowLog] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Nav dot: this view is "busy" while its seed-preview or add job is in
  // flight, so switching away still shows something is running.
  useEffect(() => {
    onBusyChange?.(seedLoading || submitting)
  }, [seedLoading, submitting, onBusyChange])

  const pickFile = async (): Promise<void> => {
    const path = await window.api.pickVideoFile()
    if (path) setFilePath(path)
  }

  const input = inputMode === 'file' ? filePath : url.trim()

  const resetAddFlow = (): void => {
    setInputMode('file')
    setFilePath('')
    setUrl('')
    setLabel('')
    setCouple('')
    setAtSec(30)
    setJobId(null)
    setSeedImage(null)
    setSeedDets(null)
    setSeedVideo(null)
    setSeedFrameIdx(undefined)
    setSeedTSec(undefined)
    setLeadIdx(null)
    setPartnerIdx(null)
    setSeedImgNatural(null)
    setSeedError(null)
    setSeedStageProgress({})
    setSeedLogs([])
    setErrorMsg(null)
    setStageProgress({})
    setLogs([])
  }

  const cancelAdding = (): void => {
    resetAddFlow()
    setAdding(false)
  }

  const findPair = async (): Promise<void> => {
    if (!input || seedLoading) return
    setSeedLoading(true)
    setSeedError(null)
    setSeedStageProgress({})
    setSeedLogs([])

    const unsubscribe = window.api.onProsEvent((e: EngineEvent) => {
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
      const res = await window.api.prosSeedPreview({ input, atSec, poseModel, jobId })
      if (res.ok) {
        setJobId(res.jobId ?? null)
        setSeedImage(res.image ?? null)
        setSeedDets(res.dets ?? [])
        setSeedVideo(res.video ?? null)
        setSeedFrameIdx(res.frameIdx)
        setSeedTSec(res.tSec)
        setLeadIdx(null)
        setPartnerIdx(null)
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

  const clickSeedBox = makeSeedBoxClickHandler(leadIdx, partnerIdx, setLeadIdx, setPartnerIdx)

  const resetPicks = (): void => {
    setLeadIdx(null)
    setPartnerIdx(null)
  }

  const submit = async (): Promise<void> => {
    if (!jobId || leadIdx == null || partnerIdx == null || submitting) return
    if (!label.trim() || !couple.trim()) {
      setErrorMsg('Label and couple are required')
      return
    }
    setSubmitting(true)
    setErrorMsg(null)
    setStageProgress({})
    setLogs([])

    const unsubscribe = window.api.onProsEvent((e: EngineEvent) => {
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
      const res = await window.api.prosAdd({
        jobId,
        input: seedVideo ?? input,
        poseModel,
        seedMeIdx: leadIdx,
        seedPartnerIdx: partnerIdx,
        label: label.trim(),
        couple: couple.trim()
      })
      if (res.ok) {
        refresh()
        cancelAdding()
      } else {
        setErrorMsg(res.reason ?? 'Could not add this pro')
      }
    } catch (err) {
      setErrorMsg(String(err))
    } finally {
      unsubscribe()
      setSubmitting(false)
    }
  }

  const cancel = (): void => {
    window.api.cancelAnalyze()
  }

  const stages = sortedStages(stageProgress)
  const seedStages = sortedStages(seedStageProgress)

  const submitDisabled =
    !jobId || leadIdx == null || partnerIdx == null || submitting || !label.trim() || !couple.trim()

  return (
    <div>
      <h1>Pros</h1>
      <p className="muted">
        Add videos of the pros you want to emulate — your runs will be compared against them.
      </p>

      {pros === null ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          {pros.length === 0 && !adding && (
            <div className="callout">
              No pros added yet — click <strong>Add a pro</strong> to get started.
            </div>
          )}
          {pros.map((p) => (
            <div className="card" key={p.id}>
              <div className="row-between">
                <h3 className="h-inline">{p.label}</h3>
                <button className="btn-sm" onClick={(e) => removePro(e, p.id)}>
                  Delete
                </button>
              </div>
              <p className="muted small" style={{ margin: 0 }}>
                {p.couple} · added {fmtDate(p.addedAt)}
              </p>
            </div>
          ))}
        </>
      )}

      {!adding && (
        <div className="row" style={{ marginTop: 16 }}>
          <button className="btn-primary" onClick={() => setAdding(true)}>
            Add a pro
          </button>
        </div>
      )}

      {adding && (
        <div className="card" style={{ marginTop: 16 }}>
          <h4>Add a pro</h4>

          <VideoInput
            inputMode={inputMode}
            setInputMode={setInputMode}
            filePath={filePath}
            onPickFile={pickFile}
            url={url}
            setUrl={setUrl}
            disabled={submitting || seedLoading}
          />
          {inputMode === 'url' && url.trim() && !looksLikeYoutubeUrl(url.trim()) && (
            <p className="tiny" style={{ color: 'var(--warning)', marginTop: 4 }}>
              Doesn&apos;t look like a YouTube URL — analysis may fail if this isn&apos;t a
              supported video link.
            </p>
          )}

          <div className="row" style={{ marginTop: 12, flexWrap: 'wrap', gap: 16 }}>
            <label className="check-label">
              Label
              <br />
              <input
                value={label}
                disabled={submitting}
                placeholder="e.g. Semion & Maria — WOTP 2024"
                onChange={(e) => setLabel(e.target.value)}
              />
            </label>
            <label className="check-label">
              Couple
              <br />
              <input
                value={couple}
                disabled={submitting}
                placeholder="e.g. Semion & Maria"
                onChange={(e) => setCouple(e.target.value)}
              />
            </label>
          </div>

          <div style={{ marginTop: 16, borderTop: '1px solid var(--border-1)', paddingTop: 16 }}>
            <h4>Find the couple</h4>
            <p className="muted tiny">
              Pick a timestamp where both dancers are fully in frame and clearly separated — not
              overlapping, mid-lift, or hidden behind anyone. Then click the LEAD of the couple
              first, then the partner.
            </p>
            <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
              <label className="check-label">
                Timestamp (seconds)
                <br />
                <input
                  type="number"
                  min={0}
                  value={atSec}
                  disabled={seedLoading || submitting}
                  onChange={(e) => setAtSec(Number(e.target.value))}
                  style={{ width: 90 }}
                />
              </label>
              <button disabled={!input || seedLoading || submitting} onClick={findPair}>
                {seedLoading ? 'Finding…' : 'Find dancers'}
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
                <ProgressBlock
                  stages={seedStages}
                  stageProgress={seedStageProgress}
                  logs={seedLogs}
                  showLog={seedShowLog}
                  onToggleLog={() => setSeedShowLog((v) => !v)}
                />
              </div>
            )}

            {seedImage && (
              <div style={{ marginTop: 12 }}>
                {(seedTSec != null || seedFrameIdx != null) && (
                  <p className="muted tiny">
                    Frame at t≈{seedTSec?.toFixed(1) ?? '?'}s (frame #{seedFrameIdx ?? '?'})
                  </p>
                )}
                <SeedPicker
                  image={seedImage}
                  dets={seedDets ?? []}
                  imgNatural={seedImgNatural}
                  onImgLoad={onSeedImgLoad}
                  firstIdx={leadIdx}
                  secondIdx={partnerIdx}
                  onClickBox={clickSeedBox}
                />

                <div className="row" style={{ marginTop: 8, flexWrap: 'wrap', gap: 12 }}>
                  <label className="check-label">
                    Lead is #
                    <br />
                    <input
                      type="number"
                      value={leadIdx ?? ''}
                      onChange={(e) =>
                        setLeadIdx(e.target.value === '' ? null : Number(e.target.value))
                      }
                      style={{ width: 70 }}
                    />
                  </label>
                  <label className="check-label">
                    Partner is #
                    <br />
                    <input
                      type="number"
                      value={partnerIdx ?? ''}
                      onChange={(e) =>
                        setPartnerIdx(e.target.value === '' ? null : Number(e.target.value))
                      }
                      style={{ width: 70 }}
                    />
                  </label>
                  <button className="btn-sm" onClick={resetPicks}>
                    Reset picks
                  </button>
                </div>
                <p className="muted tiny" style={{ marginTop: 4 }}>
                  {leadIdx != null && partnerIdx != null
                    ? `Lead: #${leadIdx} · Partner: #${partnerIdx}`
                    : 'Click the lead, then the partner'}
                </p>
              </div>
            )}
          </div>

          {errorMsg && (
            <div className="callout" style={{ borderColor: 'var(--loss-border)', marginTop: 16 }}>
              <strong className="neg">Error:</strong> <span className="neg">{errorMsg}</span>
            </div>
          )}

          {(submitting || stages.length > 0) && (
            <div style={{ marginTop: 16, borderTop: '1px solid var(--border-1)', paddingTop: 16 }}>
              <h4>Progress</h4>
              <ProgressBlock
                stages={stages}
                stageProgress={stageProgress}
                logs={logs}
                showLog={showLog}
                onToggleLog={() => setShowLog((v) => !v)}
              />
            </div>
          )}

          <div className="row" style={{ marginTop: 16 }}>
            <button className="btn-primary" disabled={submitDisabled} onClick={submit}>
              {submitting ? 'Adding…' : 'Add pro'}
            </button>
            {submitting ? (
              <button onClick={cancel}>Cancel</button>
            ) : (
              <button onClick={cancelAdding}>Cancel</button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default Pros
