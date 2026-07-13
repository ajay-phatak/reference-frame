import { useEffect, useState } from 'react'
import type { AppConfig, UpdateCheck } from '../../preload/index.d'
import Analyze from './views/Analyze'
import Library from './views/Library'
import Onboarding from './views/Onboarding'
import Report from './views/Report'
import Settings from './views/Settings'

const VIEWS = ['Analyze', 'Library', 'Coach', 'Settings'] as const
type View = (typeof VIEWS)[number]

function App(): React.JSX.Element {
  const [view, setView] = useState<View>('Analyze')
  const [update, setUpdate] = useState<UpdateCheck | null>(null)
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [runId, setRunId] = useState<string | null>(null)

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
    setView(v)
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
                <Report runId={runId} onBack={() => setRunId(null)} />
              ) : (
                <Library onOpen={openRun} />
              ))}
            {view === 'Coach' && (
              <>
                <h1>Coach</h1>
                <p className="muted">AI coaching on your gap analysis — coming soon.</p>
              </>
            )}
            {view === 'Settings' && <Settings config={config} onSaved={setConfig} />}
          </>
        )}
      </main>
    </div>
  )
}

export default App
