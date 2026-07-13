import { useEffect, useState } from 'react'
import type { UpdateCheck } from '../../preload/index.d'

const VIEWS = ['Analyze', 'Library', 'Coach', 'Settings'] as const
type View = (typeof VIEWS)[number]

function App(): React.JSX.Element {
  const [view, setView] = useState<View>('Analyze')
  const [update, setUpdate] = useState<UpdateCheck | null>(null)

  useEffect(() => {
    window.api.checkUpdate().then((u) => {
      if (u.newer) setUpdate(u)
    })
  }, [])

  return (
    <div className="app">
      <nav className="nav">
        <span className="brand">Reference Frame</span>
        {VIEWS.map((v) => (
          <button key={v} onClick={() => setView(v)} className={view === v ? 'active' : undefined}>
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
        {/* Placeholder shell — real views arrive in later phases. */}
        <h1>{view}</h1>
        <p className="muted">
          {view === 'Analyze' && 'Run the analysis pipeline on a practice video — coming soon.'}
          {view === 'Library' && 'Your past runs and reports — coming soon.'}
          {view === 'Coach' && 'AI coaching on your gap analysis — coming soon.'}
          {view === 'Settings' && 'Defaults, coach backend, and data folder — coming soon.'}
        </p>
      </main>
    </div>
  )
}

export default App
