import { useEffect, useState } from 'react'
import type { AppConfig, UpdateCheck } from '../../preload/index.d'
import Analyze from './views/Analyze'
import Coach from './views/Coach'
import Library from './views/Library'
import Onboarding from './views/Onboarding'
import Pros from './views/Pros'
import Report from './views/Report'
import Settings from './views/Settings'

const VIEWS = ['Analyze', 'Library', 'Pros', 'Coach', 'Settings'] as const
type View = (typeof VIEWS)[number]

function App(): React.JSX.Element {
  const [view, setView] = useState<View>('Analyze')
  const [update, setUpdate] = useState<UpdateCheck | null>(null)
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [runId, setRunId] = useState<string | null>(null)
  const [coachRunId, setCoachRunId] = useState<string | null>(null)
  const [analyzeBusy, setAnalyzeBusy] = useState(false)
  const [prosBusy, setProsBusy] = useState(false)

  useEffect(() => {
    window.api.checkUpdate().then((u) => {
      if (u.newer) setUpdate(u)
    })
    window.api.getConfig().then(setConfig)
  }, [])

  // Analyze success and Library card clicks both land here; the Report view
  // is reached through Library rather than being its own nav tab.
  const openRun = (id: string): void => {
    setRunId(id)
    setView('Library')
  }

  const goTo = (v: View): void => {
    setRunId(null)
    setCoachRunId(null)
    setView(v)
  }

  // "Ask the coach" on a Report hands off to the Coach view, seeded to that
  // run instead of the newest one.
  const askCoach = (id: string): void => {
    setCoachRunId(id)
    setView('Coach')
  }

  if (config && !config.onboarded) {
    return <Onboarding onDone={setConfig} />
  }

  // Busy dots let the nav show that a long engine job is still running in a
  // tab the user has clicked away from.
  const busyFor: Partial<Record<View, boolean>> = { Analyze: analyzeBusy, Pros: prosBusy }

  return (
    <div className="app">
      <nav className="nav">
        <span className="brand">Reference Frame</span>
        {VIEWS.map((v) => (
          <button key={v} onClick={() => goTo(v)} className={view === v ? 'active' : undefined}>
            {v}
            {busyFor[v] && (
              <span className="busy-dot" title="job running">
                ●
              </span>
            )}
          </button>
        ))}
      </nav>
      <main className="main">
        {update && (
          <div className="banner-info">
            v{update.latest} is available (you have v{update.current}) —{' '}
            <a href={update.url} target="_blank" rel="noreferrer">
              download it here
            </a>
            .{' '}
            <button className="btn-sm" style={{ marginLeft: 8 }} onClick={() => setUpdate(null)}>
              Dismiss
            </button>
          </div>
        )}

        {!config ? (
          <p className="muted">Loading…</p>
        ) : (
          <>
            {/* All five views stay mounted (display: none when inactive) so a
                long-running engine job's local state and event subscription
                survive the user switching tabs. Report keeps its previous
                remount-on-click behaviour, nested inside the Library slot. */}
            <div hidden={view !== 'Analyze'}>
              <Analyze
                config={config}
                onAnalyzed={openRun}
                active={view === 'Analyze'}
                onBusyChange={setAnalyzeBusy}
              />
            </div>
            <div hidden={view !== 'Library'}>
              {runId ? (
                <Report runId={runId} onBack={() => setRunId(null)} onAskCoach={askCoach} />
              ) : (
                <Library onOpen={openRun} active={view === 'Library'} />
              )}
            </div>
            <div hidden={view !== 'Pros'}>
              <Pros config={config} active={view === 'Pros'} onBusyChange={setProsBusy} />
            </div>
            <div hidden={view !== 'Coach'}>
              <Coach initialRunId={coachRunId ?? undefined} />
            </div>
            <div hidden={view !== 'Settings'}>
              <Settings config={config} onSaved={setConfig} />
            </div>
          </>
        )}
      </main>
    </div>
  )
}

export default App
