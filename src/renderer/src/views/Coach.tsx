import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  AppConfig,
  CoachModel,
  CoachResult,
  CoachStatus,
  CoachUsage,
  RunRecord
} from '../../../preload/index.d'
import { friendlyError } from './engineProgress'
import { LoadError } from './shared'

const MODEL_LABELS: Record<CoachModel, string> = {
  sonnet: 'Sonnet — fast, recommended',
  haiku: 'Haiku — cheapest',
  opus: 'Opus — deepest read'
}

interface FocusCard {
  gap: string
  evidence: string
  suggestion: string
  plan: string
}

interface Turn {
  role: 'user' | 'assistant'
  text: string
  usage?: CoachUsage
}

const REASON_TEXT: Record<string, string> = {
  no_key: 'No API key configured — add one in Settings.',
  bad_key: 'The API key was rejected — check it in Settings.',
  rate_limited: 'Rate limited by the API — wait a moment and try again.',
  refusal: 'The model declined to answer that — try rephrasing.',
  run_not_found: 'That run could not be found — pick another from the list.',
  no_report: 'That run has no report yet — analyze it first.',
  no_conversation: 'Generate a report first, then ask follow-ups.',
  busy: 'A response is already in progress.',
  cli_not_logged_in: 'Claude Code is not logged in — run `claude` in a terminal and log in first.',
  cli_timeout: 'Claude Code took too long to respond — try again.'
}

function CostLine({ usage }: { usage: CoachUsage }): React.JSX.Element {
  return (
    <div className="tiny muted" style={{ marginTop: 6 }}>
      ${usage.costUsd.toFixed(3)} this response · ${usage.monthUsd.toFixed(2)} this month
      {usage.cacheReadTokens > 0 && ' · cached'}
    </div>
  )
}

function runLabel(r: RunRecord): string {
  const date = r.createdAt.slice(0, 10)
  return `${r.videoName} · ${date}`
}

interface Props {
  initialRunId?: string
  // Views stay mounted; refetch status + runs each time this tab is shown.
  active: boolean
  // Coach writes coachModel to config — hand the result up so Settings (which
  // mirrors config) doesn't revert it on its next Save.
  onConfigChange: (config: AppConfig) => void
}

function Coach({ initialRunId, active, onConfigChange }: Props): React.JSX.Element {
  const [status, setStatus] = useState<CoachStatus | null>(null)
  const [runs, setRuns] = useState<RunRecord[]>([])
  const [runId, setRunId] = useState<string>('')
  const [turns, setTurns] = useState<Turn[]>([])
  const [streaming, setStreaming] = useState('')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [input, setInput] = useState('')
  const [cards, setCards] = useState<FocusCard[]>([])
  const [adviseProse, setAdviseProse] = useState('')
  const [saveStatus, setSaveStatus] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  // Refetch status + runs whenever the tab becomes active (a run may have
  // finished, or the backend/key/model changed in Settings, while it was
  // hidden). The current selection is kept if it's still valid; a fresh
  // "Ask the coach" hand-off (initialRunId not yet applied) wins over it.
  const appliedInitial = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!active) return
    let cancelled = false
    Promise.all([window.api.coachStatus(), window.api.libraryList()])
      .then(([st, list]) => {
        if (cancelled) return
        setStatus(st)
        setLoadError(null)
        const done = list.filter((r) => r.status === 'done' && r.resultPaths.reportPath)
        setRuns(done)
        const handoff =
          initialRunId && initialRunId !== appliedInitial.current ? initialRunId : undefined
        if (handoff) appliedInitial.current = handoff
        setRunId((cur) => {
          if (handoff && done.some((r) => r.runId === handoff)) return handoff
          if (cur && done.some((r) => r.runId === cur)) return cur
          return done.length > 0 ? done[0].runId : '' // newest-first
        })
      })
      .catch((err) => {
        if (!cancelled) setLoadError(friendlyError(err))
      })
    return () => {
      cancelled = true
    }
  }, [active, initialRunId, reloadKey])

  // A different run means a different conversation: drop the local turns and
  // the main-process chat history so follow-ups don't refer to the old run.
  const prevRunId = useRef('')
  useEffect(() => {
    const prev = prevRunId.current
    prevRunId.current = runId
    if (prev === '' || prev === runId) return
    setTurns([])
    setStreaming('')
    setCards([])
    setAdviseProse('')
    setSaveStatus('')
    setError('')
    window.api.coachReset().catch(() => {})
  }, [runId])

  const reload = useCallback((): void => setReloadKey((k) => k + 1), [])

  useEffect(() => window.api.onCoachDelta((text) => setStreaming((s) => s + text)), [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [streaming, turns])

  const finish = (res: CoachResult): void => {
    setStreaming('')
    if (res.ok && res.text !== undefined) {
      setTurns((t) => [...t, { role: 'assistant', text: res.text!, usage: res.usage }])
      // Only session reviews carry gaps — chat turns leave the cards alone.
      if (res.gaps) {
        setCards(res.gaps.map((g) => ({ ...g, plan: g.suggestion })))
        setAdviseProse(res.text)
      }
    } else {
      setError(
        REASON_TEXT[res.reason ?? ''] ?? `Insights failed: ${friendlyError(res.reason ?? 'unknown')}`
      )
    }
  }

  const report = async (): Promise<void> => {
    if (!runId) return
    setRunning(true)
    setError('')
    setTurns([])
    setStreaming('')
    setCards([])
    setSaveStatus('')
    try {
      finish(await window.api.coachReport(runId))
    } catch (err) {
      setStreaming('')
      setError(friendlyError(err))
    } finally {
      setRunning(false)
    }
  }

  const saveFocuses = async (): Promise<void> => {
    setSaveStatus('Saving…')
    try {
      const res = await window.api.saveFocuses({
        prose: adviseProse,
        focuses: cards.map(({ gap, plan }) => ({ gap, plan }))
      })
      setSaveStatus(
        res.ok
          ? 'Saved — these shape your next read.'
          : `Save failed: ${friendlyError(res.reason ?? 'unknown')}`
      )
    } catch (err) {
      setSaveStatus(`Save failed: ${friendlyError(err)}`)
    }
  }

  const send = async (): Promise<void> => {
    const text = input.trim()
    if (!text) return
    setInput('')
    setError('')
    setTurns((t) => [...t, { role: 'user', text }])
    setRunning(true)
    try {
      finish(await window.api.coachChat(text))
    } catch (err) {
      setStreaming('')
      setError(friendlyError(err))
    } finally {
      setRunning(false)
    }
  }

  if (status === null) {
    return loadError ? (
      <LoadError message={loadError} onRetry={reload} />
    ) : (
      <p className="muted">Loading…</p>
    )
  }

  if (!status.ready) {
    return (
      <div>
        <h1>Insights</h1>
        <div className="callout">
          <strong>AI insights</strong> — a plain-language read of what a run&apos;s numbers show,
          questions to bring to your teacher, and a chat to dig into the details. Not a substitute
          for lessons.{' '}
          {status.backend === 'claude-cli' ? (
            <>
              Claude Code wasn&apos;t detected on this machine — install it and log in with your
              Pro/Max account (reports are then covered by your plan), or switch Insights to an API
              key in Settings.
            </>
          ) : (
            <>
              Add an Anthropic API key in Settings — your key stays on this machine and you pay
              Anthropic directly (a report costs a few cents). Have a Claude Pro/Max plan? Pick the
              Claude Code backend in Settings instead and skip API credits entirely.
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', maxWidth: 760 }}>
      <div className="row" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
        <h1 className="h-inline">Insights</h1>
        <select
          value={runId}
          disabled={running || runs.length === 0}
          style={{ fontSize: 13, maxWidth: 320 }}
          onChange={(e) => setRunId(e.target.value)}
        >
          {runs.length === 0 && <option value="">No analyzed runs yet</option>}
          {runs.map((r) => (
            <option key={r.runId} value={r.runId}>
              {runLabel(r)}
            </option>
          ))}
        </select>
        <button className="btn-primary" disabled={running || !runId} onClick={report}>
          {turns.length === 0 ? 'Get insights on this run' : 'New report'}
        </button>
        <select
          value={status.model}
          disabled={running}
          style={{ fontSize: 12 }}
          onChange={async (e) => {
            const model = e.target.value as CoachModel
            try {
              const next = await window.api.setConfig({ coachModel: model })
              onConfigChange(next)
              setStatus({ ...status, model })
            } catch (err) {
              setError(`Couldn't change the model: ${friendlyError(err)}`)
            }
          }}
        >
          {(Object.keys(MODEL_LABELS) as CoachModel[]).map((m) => (
            <option key={m} value={m}>
              {MODEL_LABELS[m]}
            </option>
          ))}
        </select>
        {running && <span className="small dim">Thinking…</span>}
      </div>

      {turns.length === 0 && !streaming && !error && (
        <p className="muted">
          Reads the run&apos;s report and gap analysis, describes the biggest gaps in plain terms
          and drafts a question for your teacher on each — keep, edit, or replace them, then save.
          Saved questions shape the next read. If you set a notes folder in Settings, Insights
          cites your own lessons where they fit.
        </p>
      )}

      {turns.map((t, i) => (
        <div key={i} className="card" style={{ marginBottom: 8 }}>
          <div className="eyebrow" style={{ marginBottom: 4 }}>
            {t.role === 'user' ? 'You' : 'Insights'}
          </div>
          <div style={{ whiteSpace: 'pre-wrap' }}>{t.text}</div>
          {t.usage && <CostLine usage={t.usage} />}
          {!t.usage && t.role === 'assistant' && status.backend === 'claude-cli' && (
            <div className="tiny muted" style={{ marginTop: 6 }}>
              covered by your Claude plan
            </div>
          )}
        </div>
      ))}

      {streaming && (
        <div className="card" style={{ marginBottom: 8 }}>
          <div className="eyebrow" style={{ marginBottom: 4 }}>
            Insights
          </div>
          <div style={{ whiteSpace: 'pre-wrap' }}>{streaming.split('```json')[0]}</div>
        </div>
      )}

      {loadError && <p className="neg small">{loadError}</p>}
      {error && <p className="neg">{error}</p>}

      {cards.length > 0 && (
        <div style={{ marginTop: 8, marginBottom: 8 }}>
          <h3 className="eyebrow" style={{ margin: '12px 0 8px' }}>
            Questions for your teacher — keep each one or write your own
          </h3>
          {cards.map((c, i) => (
            <div key={i} className="card" style={{ marginBottom: 8 }}>
              <div style={{ marginBottom: 4 }}>
                <strong>{c.gap}</strong> <span className="muted tiny">{c.evidence}</span>
              </div>
              <textarea
                rows={2}
                className="small"
                style={{ width: '100%', padding: 6, boxSizing: 'border-box' }}
                value={c.plan}
                onChange={(e) =>
                  setCards((cs) => cs.map((x, j) => (j === i ? { ...x, plan: e.target.value } : x)))
                }
              />
              {c.plan !== c.suggestion && (
                <button
                  className="btn-xs"
                  onClick={() =>
                    setCards((cs) => cs.map((x, j) => (j === i ? { ...x, plan: x.suggestion } : x)))
                  }
                >
                  Reset to draft
                </button>
              )}
            </div>
          ))}
          <div className="row">
            <button
              className="btn-sm"
              disabled={running || cards.some((c) => !c.plan.trim())}
              onClick={saveFocuses}
            >
              Save questions
            </button>
            {saveStatus && (
              <span className={`small ${saveStatus.startsWith('Save failed') ? 'neg' : 'pos'}`}>
                {saveStatus}
              </span>
            )}
          </div>
        </div>
      )}

      {turns.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <input
            style={{ flex: 1, padding: 8 }}
            value={input}
            disabled={running}
            placeholder="Ask a follow-up…"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') send()
            }}
          />
          <button className="btn-primary" disabled={running || !input.trim()} onClick={send}>
            Send
          </button>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  )
}

export default Coach
