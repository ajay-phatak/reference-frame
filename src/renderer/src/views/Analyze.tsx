import { useEffect, useRef, useState } from 'react'
import type { AppConfig, EngineEvent, QueueSnapshot, SeedDetection } from '../../../preload/index.d'
import {
  friendlyError,
  isCanceledMessage,
  looksLikeYoutubeUrl,
  makeSeedBoxClickHandler,
  sortedStages,
  validatePicks
} from './engineProgress'
import { ProgressBlock, SeedPicker, VideoInput } from './shared'
import { useEngineFeed } from './useEngineFeed'

interface Props {
  config: AppConfig
  onAnalyzed: (runId: string) => void
  active: boolean
  onBusyChange?: (busy: boolean) => void
}

function Analyze({ config, onAnalyzed, active, onBusyChange }: Props): React.JSX.Element {
  const [inputMode, setInputMode] = useState<'file' | 'url'>('file')
  const [filePath, setFilePath] = useState('')
  const [url, setUrl] = useState('')

  // Side has no config-driven default — it varies clip to clip, so 'left' is
  // just a sane starting point. Role defaults from the Settings/Onboarding
  // default; partner name is always per-run (J&J partners differ per clip).
  const [me, setMe] = useState<'left' | 'right'>('left')
  const [role, setRoleState] = useState<'lead' | 'follow'>(config.role)
  const [partnerName, setPartnerName] = useState('')
  const [partnerToggle, setPartnerToggle] = useState(false)
  const [spotlight, setSpotlight] = useState(false)
  const [comparePros, setComparePros] = useState(true)
  const [poseModel, setPoseModelState] = useState(config.poseModel)
  // Track whether the user changed role/poseModel in this form, so a changed
  // default in Settings only overrides fields they haven't touched.
  const roleEdited = useRef(false)
  const poseEdited = useRef(false)
  const setRole = (r: 'lead' | 'follow'): void => {
    roleEdited.current = true
    setRoleState(r)
  }
  const setPoseModel = (m: AppConfig['poseModel']): void => {
    poseEdited.current = true
    setPoseModelState(m)
  }
  useEffect(() => {
    if (!active) return
    if (!roleEdited.current) setRoleState(config.role)
    if (!poseEdited.current) setPoseModelState(config.poseModel)
  }, [active, config.role, config.poseModel])

  // Gap comparison needs at least one user-added pro (Pros tab) — with none
  // configured, force the toggle off and explain why instead of letting the
  // user flip on a control that silently does nothing. Refetch whenever this
  // tab becomes active (not just on mount) — with keep-mounted views, adding
  // a pro in the Pros tab should immediately un-gate the toggle on return.
  const [hasPros, setHasPros] = useState<boolean | null>(null)
  const [prosError, setProsError] = useState<string | null>(null)
  useEffect(() => {
    if (!active) return
    window.api
      .prosList()
      .then((list) => {
        setHasPros(list.length > 0)
        setProsError(null)
      })
      .catch((err) => {
        setHasPros(false)
        setProsError(friendlyError(err))
      })
  }, [active])

  const [running, setRunning] = useState(false)
  // Progress/log state is buffered (see useEngineFeed) so a burst of engine
  // events doesn't re-render this whole view per event.
  const feed = useEngineFeed()
  const seedFeed = useEngineFeed()
  const [showLog, setShowLog] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [canceledBanner, setCanceledBanner] = useState(false)

  // Multiple analyze() calls can now be in flight at once (submit, then
  // submit again while the first is still queued/running) — submissionSeq
  // identifies the MOST RECENT one; any setState from an earlier submission's
  // callback/resolution checks against it and no-ops if superseded, so an
  // older submission resolving late can never stomp what the view is
  // currently showing. activeUnsubRef holds the latest submission's
  // onEngineEvent unsubscribe so a brand-new submission can detach the
  // previous one immediately (both listen on the same shared 'engine:event'
  // channel — only the newest submission's listener should still be
  // updating the visible progress panel).
  const submissionSeq = useRef(0)
  const activeUnsubRef = useRef<(() => void) | null>(null)
  const inFlightRef = useRef<Set<string>>(new Set())

  // Queue state (v0.4.0 analyze queue): live snapshot of who's running/
  // waiting server-side, used for the queue-summary chip and to decide
  // whether submitting right now would run immediately or queue. 'phase'
  // additionally tracks THIS view's current submission specifically — it
  // starts as a guess from the snapshot at submit time, then flips to
  // 'running' the moment real engine output arrives for it (the queue can't
  // tell the renderer "your turn started" any other way — see AnalyzeArgs'
  // lack of an early runId).
  const [queueSnap, setQueueSnap] = useState<QueueSnapshot | null>(null)
  const [phase, setPhase] = useState<'idle' | 'queued' | 'running'>('idle')
  useEffect(() => {
    window.api
      .queueList()
      .then(setQueueSnap)
      .catch(() => {
        // Non-fatal: the queue chip just stays hidden until the next event.
      })
    return window.api.onQueueEvent(setQueueSnap)
  }, [])

  // With keep-mounted views, a run finishing while this tab is hidden must
  // NOT yank the user to the Report — stash the runId and surface a banner
  // instead, shown once they come back here.
  const activeRef = useRef(active)
  useEffect(() => {
    activeRef.current = active
  }, [active])
  const [finishedRunId, setFinishedRunId] = useState<string | null>(null)

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
  const [seedShowLog, setSeedShowLog] = useState(false)

  // Nav dot: this view is "busy" while an analysis or its seed-preview is in
  // flight, so switching away still shows something is running.
  useEffect(() => {
    onBusyChange?.(running || seedLoading)
  }, [running, seedLoading, onBusyChange])

  const pickFile = async (): Promise<void> => {
    const path = await window.api.pickVideoFile()
    if (path) {
      setFilePath(path)
      resetSeed()
    }
  }

  const input = inputMode === 'file' ? filePath : url.trim()

  // Everything derived from a seed-preview belongs to ONE video. When the
  // input changes, drop it — otherwise `seedVideo ?? input` would silently
  // analyze the previously previewed video.
  // seedEpoch lets an in-flight seed-preview notice that the input changed
  // under it and discard its (now stale) result.
  const seedEpoch = useRef(0)
  const resetSeed = (): void => {
    seedEpoch.current++
    setSeedRunId(null)
    setSeedImage(null)
    setSeedDets(null)
    setSeedVideo(null)
    setSeedFrameIdx(undefined)
    setSeedTSec(undefined)
    setSeedMeIdx(null)
    setSeedPartnerIdx(null)
    setSeedImgNatural(null)
    setSeedError(null)
    seedFeed.reset()
  }
  const changeInputMode = (m: 'file' | 'url'): void => {
    setInputMode(m)
    resetSeed()
  }
  const changeUrl = (u: string): void => {
    setUrl(u)
    resetSeed()
  }

  const findUs = async (): Promise<void> => {
    if (!input || seedLoading) return
    setSeedLoading(true)
    setSeedError(null)
    seedFeed.reset()
    const epoch = seedEpoch.current

    const unsubscribe = window.api.onEngineEvent((e: EngineEvent) => {
      if (seedFeed.handle(e)) return
      if (e.event === 'error') setSeedError(friendlyError(e.msg ?? 'Engine error'))
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
        comparePros: comparePros && hasPros === true,
        partnerName: partnerName.trim() || null
      })
      // The user switched videos while this preview ran — its frame belongs
      // to the old video, so discard it.
      if (seedEpoch.current !== epoch) return
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
      if (seedEpoch.current === epoch) setSeedError(friendlyError(err))
    } finally {
      unsubscribe()
      seedFeed.flush()
      setSeedLoading(false)
    }
  }

  const onSeedImgLoad = (e: React.SyntheticEvent<HTMLImageElement>): void => {
    const img = e.currentTarget
    setSeedImgNatural({ w: img.naturalWidth, h: img.naturalHeight })
  }

  const clickSeedBox = makeSeedBoxClickHandler(
    seedMeIdx,
    seedPartnerIdx,
    setSeedMeIdx,
    setSeedPartnerIdx
  )

  const resetPicks = (): void => {
    setSeedMeIdx(null)
    setSeedPartnerIdx(null)
  }

  const run = async (): Promise<void> => {
    if (!input) return
    if (crowdMode && validatePicks(seedMeIdx, seedPartnerIdx, seedDets) !== null) return

    // Synchronous double-click guard: React state (running) updates too late
    // to stop a second click in the same tick, and the button intentionally
    // stays enabled so more videos can be queued. Ignore a submission whose
    // exact inputs/options are already in flight.
    const sig = JSON.stringify([
      crowdMode ? (seedVideo ?? input) : input,
      me,
      role,
      partnerToggle,
      spotlight,
      poseModel,
      comparePros && hasPros === true,
      partnerName.trim(),
      crowdMode ? [seedRunId, seedMeIdx, seedPartnerIdx] : null
    ])
    if (inFlightRef.current.has(sig)) return
    inFlightRef.current.add(sig)

    const mySeq = ++submissionSeq.current
    // engine:event is one shared channel; the main process stamps this
    // submission's events with the token we pass to analyze() below, so the
    // listener can ignore another job's output (e.g. the previous submission
    // still running while this one waits in the queue).
    const myToken = crypto.randomUUID()
    // A brand-new submission always takes over the display — detach whatever
    // an earlier still-in-flight submission was listening with, so its
    // (superseded) progress can't keep painting over what's shown now.
    activeUnsubRef.current?.()
    setRunning(true)
    setErrorMsg(null)
    setCanceledBanner(false)
    feed.reset()
    setFinishedRunId(null)
    setPhase(
      queueSnap && (queueSnap.active !== null || queueSnap.waiting.length > 0)
        ? 'queued'
        : 'running'
    )

    const unsubscribe = window.api.onEngineEvent((e: EngineEvent) => {
      // Superseded by a newer submission — ignore (its own listener, not
      // this one, now owns the visible progress panel).
      if (submissionSeq.current !== mySeq) return
      // Not this submission's job — while we're queued, the currently
      // RUNNING job's events also arrive here; without this check they'd
      // flip the label to "Running…" and paint the wrong run's stages.
      if (e.clientToken !== myToken) return
      if (feed.handle(e)) {
        setPhase('running') // real engine output means it's actually our turn now
      } else if (e.event === 'error') {
        if (isCanceledMessage(e.msg)) setCanceledBanner(true)
        else setErrorMsg(friendlyError(e.msg ?? 'Engine error'))
      }
    })
    activeUnsubRef.current = unsubscribe

    try {
      const res = await window.api.analyze({
        input: crowdMode ? (seedVideo ?? input) : input,
        me,
        role,
        partner: partnerToggle,
        spotlight,
        poseModel,
        comparePros: comparePros && hasPros === true,
        partnerName: partnerName.trim() || null,
        clientToken: myToken,
        ...(crowdMode ? { runId: seedRunId, seedMeIdx, seedPartnerIdx } : {})
      })
      // A newer submission has since taken over — this one's result no
      // longer belongs on screen (see submissionSeq comment above). The run
      // itself already completed/failed server-side and is in the Library
      // regardless; there's just nothing left here to update.
      if (submissionSeq.current !== mySeq) return
      if (res.ok && res.runId) {
        // If the tab is hidden, jumping to the Report would yank the user
        // out of whatever they're doing — stash it and show a banner here
        // instead, surfaced next time they come back to Analyze.
        if (activeRef.current) {
          onAnalyzed(res.runId)
        } else {
          setFinishedRunId(res.runId)
        }
      } else if (isCanceledMessage(res.reason)) {
        // Canceled from the Library while still waiting in the queue — not a
        // failure, so no red error callout.
        setCanceledBanner(true)
      } else {
        setErrorMsg(friendlyError(res.reason ?? 'Analysis failed'))
      }
    } catch (err) {
      if (submissionSeq.current === mySeq) {
        if (isCanceledMessage(friendlyError(err))) setCanceledBanner(true)
        else setErrorMsg(friendlyError(err))
      }
    } finally {
      inFlightRef.current.delete(sig)
      if (activeUnsubRef.current === unsubscribe) activeUnsubRef.current = null
      unsubscribe()
      feed.flush()
      if (submissionSeq.current === mySeq) {
        setRunning(false)
        setPhase('idle')
      }
    }
  }

  const cancel = (): void => {
    window.api.cancelAnalyze()
  }

  const stages = sortedStages(feed.stageProgress)
  const seedStages = sortedStages(seedFeed.stageProgress)
  const picksProblem = validatePicks(seedMeIdx, seedPartnerIdx, seedDets)

  // Submitting while busy now queues instead of being blocked — the Run
  // button stays enabled while running (see submissionSeq above).
  const runDisabled = !input || (crowdMode && picksProblem !== null)

  // Seed-picking labels name the partner by their actual role — the role
  // selector tells us which one that is.
  const partnerWord = role === 'lead' ? 'follower' : 'leader'

  const busyElsewhere = queueSnap
    ? queueSnap.active !== null || queueSnap.waiting.length > 0
    : false
  const runLabel = running
    ? phase === 'running'
      ? 'Running…'
      : 'Queued…'
    : busyElsewhere
      ? 'Add to queue'
      : 'Run analysis'
  const queueSummary =
    queueSnap && (queueSnap.active !== null || queueSnap.waiting.length > 0)
      ? [
          queueSnap.active !== null ? '1 running' : null,
          queueSnap.waiting.length > 0 ? `${queueSnap.waiting.length} queued` : null
        ]
          .filter(Boolean)
          .join(' · ')
      : null

  return (
    <div>
      <h1>Analyze</h1>
      <p className="muted">Run the analysis pipeline on a practice video.</p>

      <div className="card">
        {/* Fields below stay editable while running/queued (v0.4.0 analyze
            queue) — each submission captures its own option values at click
            time, so preparing and submitting a second, different video while
            an earlier one is still outstanding is the whole point of the
            queue. Only the crowd-mode seed-picker stays gated on `running`
            below — seed-preview isn't queued server-side (still busy-rejects,
            see plan-0.4.0-structured-reports.md §6), so unlocking it would
            just trade this lock for a confusing "busy" error instead. */}
        <VideoInput
          inputMode={inputMode}
          setInputMode={changeInputMode}
          filePath={filePath}
          onPickFile={pickFile}
          url={url}
          setUrl={changeUrl}
          disabled={false}
        />
        {inputMode === 'url' && (
          <>
            <p className="muted tiny" style={{ marginTop: 4 }}>
              Downloads in-process before analysis starts.
            </p>
            {url.trim() && !looksLikeYoutubeUrl(url.trim()) && (
              <p className="tiny" style={{ color: 'var(--warning)', marginTop: 4 }}>
                Doesn&apos;t look like a YouTube URL — analysis may fail if this isn&apos;t a
                supported video link.
              </p>
            )}
          </>
        )}

        <h4>Options</h4>
        <div className="row" style={{ flexWrap: 'wrap', gap: 16 }}>
          <label className="check-label">
            Your side
            <br />
            <select value={me} onChange={(e) => setMe(e.target.value as 'left' | 'right')}>
              <option value="left">Left</option>
              <option value="right">Right</option>
            </select>
          </label>
          <label className="check-label">
            Your role
            <br />
            <select value={role} onChange={(e) => setRole(e.target.value as 'lead' | 'follow')}>
              <option value="lead">Leader</option>
              <option value="follow">Follower</option>
            </select>
          </label>
          <label className="check-label">
            Pose model
            <br />
            <select
              value={poseModel}
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
              onChange={(e) => setPartnerToggle(e.target.checked)}
            />{' '}
            Also analyze partner
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={spotlight}
              onChange={(e) => setSpotlight(e.target.checked)}
            />{' '}
            Spotlight
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={comparePros && hasPros === true}
              disabled={hasPros !== true}
              onChange={(e) => setComparePros(e.target.checked)}
            />{' '}
            Compare to pros
            {prosError && (
              <>
                {' '}
                <span className="neg tiny">— couldn&apos;t load pros: {prosError}</span>
              </>
            )}
            {hasPros === false && !prosError && (
              <>
                {' '}
                <span className="muted tiny">
                  — Add pros in the Pros tab to enable gap comparison
                </span>
              </>
            )}
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={crowdMode}
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
            <p className="muted tiny">
              Pick a timestamp where you and your partner are both fully in frame and clearly
              separated from other dancers.
            </p>
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
                <ProgressBlock
                  stages={seedStages}
                  stageProgress={seedFeed.stageProgress}
                  logs={seedFeed.logs}
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
                  firstIdx={seedMeIdx}
                  secondIdx={seedPartnerIdx}
                  onClickBox={clickSeedBox}
                />

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
                    Your {partnerWord} is #
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
                  {picksProblem === null
                    ? `You: #${seedMeIdx} · Your ${partnerWord}: #${seedPartnerIdx}`
                    : seedMeIdx == null || seedPartnerIdx == null
                      ? `Click yourself, then your ${partnerWord}`
                      : picksProblem}
                </p>
              </div>
            )}
          </div>
        )}

        <div className="row" style={{ marginTop: 16 }}>
          <button className="btn-primary" disabled={runDisabled} onClick={run}>
            {runLabel}
          </button>
          {/* Cancel kills the currently-active engine process — only valid
              while THIS submission is actually the one running, not while
              it's merely queued behind something else. */}
          {running && phase === 'running' && <button onClick={cancel}>Cancel</button>}
        </div>
        {queueSummary && (
          <p className="muted tiny" style={{ marginTop: 4 }}>
            {queueSummary}
          </p>
        )}
      </div>

      {finishedRunId && (
        <div className="banner-info">
          Analysis complete —{' '}
          <button
            className="btn-sm"
            onClick={() => {
              const id = finishedRunId
              setFinishedRunId(null)
              onAnalyzed(id)
            }}
          >
            View report
          </button>
        </div>
      )}

      {canceledBanner && <div className="banner-info">Canceled from the queue.</div>}

      {errorMsg && (
        <div className="callout" style={{ borderColor: 'var(--loss-border)' }}>
          <strong className="neg">Error:</strong> <span className="neg">{errorMsg}</span>
        </div>
      )}

      {(running || stages.length > 0) && (
        <div className="card">
          <h4>Progress</h4>
          <ProgressBlock
            stages={stages}
            stageProgress={feed.stageProgress}
            logs={feed.logs}
            showLog={showLog}
            onToggleLog={() => setShowLog((v) => !v)}
          />
        </div>
      )}
    </div>
  )
}

export default Analyze
