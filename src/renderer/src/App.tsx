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

  return (
    <div className="app">
      <nav className="nav">
        <span className="brand">Reference Frame</span>
        {VIEWS.map((v) => (
          <button key={v} onClick={() => goTo(v)} className={view === v ? 'active' : undefined}>
            {v}
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
            {view === 'Analyze' && <Analyze config={config} onAnalyzed={openRun} />}
            {view === 'Library' &&
              (runId ? (
                <Report runId={runId} onBack={() => setRunId(null)} onAskCoach={askCoach} />
              ) : (
                <Library onOpen={openRun} />
              ))}
            {view === 'Pros' && <Pros config={config} />}
            {view === 'Coach' && <Coach initialRunId={coachRunId ?? undefined} />}
            {view === 'Settings' && <Settings config={config} onSaved={setConfig} />}
          </>
        )}
      </main>
    </div>
  )
}

export default App
