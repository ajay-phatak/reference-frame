import { useEffect, useState } from 'react'
import type { AppConfig, EngineEvent } from '../../../preload/index.d'

interface Props {
  onDone: (config: AppConfig) => void
}

const COMPONENTS = ['yolo', 'rtmpose', 'videopose3d'] as const
type ComponentKey = (typeof COMPONENTS)[number]

const COMPONENT_LABELS: Record<ComponentKey, string> = {
  yolo: 'Person detector (YOLO, ~53 MB)',
  rtmpose: 'Pose refiner (RTMPose, ~40 MB)',
  videopose3d: '3D lifter (VideoPose3D, ~170 MB)'
}

function componentPct(idx: number, activeIdx: number, current: number, total: number): number {
  if (idx < activeIdx) return 100
  if (idx > activeIdx) return 0
  if (total > 0) return Math.max(0, Math.min(100, Math.round((current / total) * 100)))
  return current > 0 ? 100 : 0
}

// Steps: 1 welcome/your setup -> 2 model download -> 3 done. Step 2 kicks off
// `setup` immediately and auto-advances on success; a "set up later" escape
// hatch skips straight to the main app (models download on first analysis
// instead).
function Onboarding({ onDone }: Props): React.JSX.Element {
  const [step, setStep] = useState(1)

  const [role, setRole] = useState<AppConfig['role']>('lead')
  const [userName, setUserName] = useState('')

  const [running, setRunning] = useState(false)
  const [active, setActive] = useState<ComponentKey>('yolo')
  const [current, setCurrent] = useState(0)
  const [total, setTotal] = useState(0)
  const [logs, setLogs] = useState<string[]>([])
  const [showLog, setShowLog] = useState(false)
  const [setupError, setSetupError] = useState<string | null>(null)

  const runSetup = async (): Promise<void> => {
    setRunning(true)
    setSetupError(null)
    setActive('yolo')
    setCurrent(0)
    setTotal(0)
    setLogs([])

    const unsubscribe = window.api.onEngineEvent((e: EngineEvent) => {
      if (e.event === 'progress' && e.stage === 'weights') {
        const detail = typeof e.detail === 'string' ? e.detail : undefined
        if (detail === 'rtmpose') setActive('rtmpose')
        else if (detail === 'videopose3d') setActive('videopose3d')
        setCurrent(typeof e.current === 'number' ? e.current : 0)
        setTotal(typeof e.total === 'number' ? e.total : 0)
      } else if (e.event === 'log') {
        const msg = String(e.msg ?? '')
        setLogs((prev) => [...prev, msg])
        if (/rtmpose/i.test(msg)) setActive((prev) => (prev === 'yolo' ? 'rtmpose' : prev))
        if (/videopose3d/i.test(msg)) {
          setActive((prev) => (prev === 'videopose3d' ? prev : 'videopose3d'))
        }
      } else if (e.event === 'error') {
        setSetupError(String(e.msg ?? 'Setup failed'))
      }
    })

    try {
      const res = await window.api.setupModels({ poseModel: 'm' })
      if (res.exitCode === 0 && res.result && !res.error) {
        setStep(3)
      } else {
        setSetupError(res.error?.msg ?? `Setup failed (exit code ${res.exitCode})`)
      }
    } catch (err) {
      setSetupError(String(err))
    } finally {
      unsubscribe()
      setRunning(false)
    }
  }

  useEffect(() => {
    if (step !== 2) return
    // Deferred via a microtask (rather than calling runSetup synchronously
    // in the effect body) so the initial setState batch happens inside a
    // callback, not the effect's own call stack — same pattern as an
    // ordinary promise .then() handler.
    void Promise.resolve().then(() => runSetup())
    // Only re-run when the step changes to 2 (e.g. via Retry re-entering it
    // isn't how retry works — retry calls runSetup() directly).
  }, [step])

  const nextConfigPatch = (): Partial<AppConfig> => ({
    role,
    userName: userName.trim(),
    onboarded: true
  })

  const skip = async (): Promise<void> => {
    // Fire-and-forget: don't wait on the in-flight setup call. Cancel it so
    // we don't leave an orphaned download racing in the background.
    window.api.cancelAnalyze()
    const next = await window.api.setConfig(nextConfigPatch())
    onDone(next)
  }

  const finish = async (): Promise<void> => {
    const next = await window.api.setConfig(nextConfigPatch())
    onDone(next)
  }

  const activeIdx = COMPONENTS.indexOf(active)

  return (
    <div className="onboard">
      {step === 1 && (
        <section>
          <h1>Welcome to Reference Frame</h1>
          <p className="muted">
            A few quick questions so we can pre-fill your analyses — you can change any of this
            later in Settings.
          </p>

          <div className="card">
            <div className="row" style={{ flexWrap: 'wrap', gap: 16 }}>
              <label className="check-label">
                Your name
                <br />
                <input value={userName} onChange={(e) => setUserName(e.target.value)} />
              </label>
              <label className="check-label">
                Your role (default)
                <br />
                <select value={role} onChange={(e) => setRole(e.target.value as AppConfig['role'])}>
                  <option value="lead">Lead</option>
                  <option value="follow">Follow</option>
                </select>
              </label>
            </div>
            <p className="muted tiny" style={{ marginTop: 8 }}>
              Just a starting point for Analyze — change it per video any time (some people
              compete both roles). Starting side and partner name also live there, since they
              differ clip to clip.
            </p>
          </div>

          <div className="row" style={{ marginTop: 16 }}>
            <button className="btn-primary" onClick={() => setStep(2)}>
              Next
            </button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section>
          <h1>Setting up analysis models</h1>
          <p className="muted tiny">Downloads about 260 MB total — this only happens once.</p>

          <div className="card">
            {COMPONENTS.map((c, idx) => {
              const pct = componentPct(idx, activeIdx, current, total)
              return (
                <div key={c} className="stage-row">
                  <div className="row-between">
                    <span className="small">{COMPONENT_LABELS[c]}</span>
                    <span className="muted tiny">{pct}%</span>
                  </div>
                  <div className="bar-track">
                    <div className="bar-fill" style={{ width: `${pct}%` }} />
                  </div>
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

          {setupError && (
            <div className="callout" style={{ borderColor: 'var(--loss-border)' }}>
              <strong className="neg">Setup failed:</strong>{' '}
              <span className="neg">{setupError}</span>
              <div style={{ marginTop: 8 }}>
                <button className="btn-primary" disabled={running} onClick={runSetup}>
                  Retry
                </button>
              </div>
            </div>
          )}

          <div className="callout">
            You can skip this — analysis will download these models on first run instead.
          </div>
          <div className="row">
            <button onClick={skip}>Set up later</button>
          </div>
        </section>
      )}

      {step === 3 && (
        <section>
          <h1>You&apos;re all set</h1>
          <p className="muted">Models are ready. Head to Analyze to review your first video.</p>
          <div className="row" style={{ marginTop: 16 }}>
            <button className="btn-primary" onClick={finish}>
              Finish
            </button>
          </div>
        </section>
      )}
    </div>
  )
}

export default Onboarding
