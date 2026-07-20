import { useEffect, useState } from 'react'
import type { AppConfig, CliDetection, CoachKeyStatus } from '../../../preload/index.d'

interface Props {
  config: AppConfig
  onSaved: (config: AppConfig) => void
}

function Settings({ config, onSaved }: Props): React.JSX.Element {
  const [role, setRole] = useState(config.role)
  const [userName, setUserName] = useState(config.userName)
  const [poseModel, setPoseModel] = useState(config.poseModel)
  const [notesFolder, setNotesFolder] = useState(config.notesFolder ?? '')
  const [notesWriteEnabled, setNotesWriteEnabled] = useState(config.notesWriteEnabled)
  const [backend, setBackend] = useState(config.coachBackend)
  const [coachModel, setCoachModel] = useState(config.coachModel)
  const [saved, setSaved] = useState(false)

  const [keyInput, setKeyInput] = useState('')
  const [keyStatus, setKeyStatus] = useState<CoachKeyStatus | null>(null)
  const [keyError, setKeyError] = useState('')
  const [cli, setCli] = useState<CliDetection | null>(null)

  useEffect(() => {
    window.api.coachKeyStatus().then(setKeyStatus)
    window.api.detectClaudeCli().then(setCli)
  }, [])

  const browseNotes = async (): Promise<void> => {
    const picked = await window.api.pickNotesFolder()
    if (picked) setNotesFolder(picked)
  }

  const saveKey = async (): Promise<void> => {
    setKeyError('')
    const res = await window.api.setCoachKey(keyInput)
    if (!res.ok) {
      setKeyError(
        res.reason === 'encryption_unavailable'
          ? 'OS keychain unavailable — cannot store the key securely.'
          : `Could not save key (${res.reason ?? 'unknown'}).`
      )
      return
    }
    setKeyInput('')
    setKeyStatus(await window.api.coachKeyStatus())
  }

  const clearKey = async (): Promise<void> => {
    await window.api.clearCoachKey()
    setKeyStatus(await window.api.coachKeyStatus())
  }

  const save = async (): Promise<void> => {
    const next = await window.api.setConfig({
      role,
      userName: userName.trim(),
      poseModel,
      notesFolder: notesFolder.trim() || null,
      // Clearing the folder always turns writing off too — no orphaned
      // write-enabled-but-nowhere-to-write state.
      notesWriteEnabled: notesWriteEnabled && !!notesFolder.trim(),
      coachBackend: backend,
      coachModel
    })
    onSaved(next)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div style={{ maxWidth: 620 }}>
      <h1>Settings</h1>

      <h4>Defaults</h4>
      <p className="muted small" style={{ marginTop: -8 }}>
        Pre-fills the Analyze form — change per-run any time.
      </p>

      <div className="row" style={{ flexWrap: 'wrap', gap: 16 }}>
        <label className="check-label">
          Your role (default)
          <br />
          <select value={role} onChange={(e) => setRole(e.target.value as AppConfig['role'])}>
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
      </div>
      <p className="muted tiny" style={{ marginTop: 4 }}>
        Starting side and partner name aren&apos;t set here — they&apos;re per-video on Analyze.
      </p>

      <h4 style={{ marginTop: 16 }}>Your name</h4>
      <input style={{ width: '100%' }} value={userName} onChange={(e) => setUserName(e.target.value)} />

      <h4 style={{ marginTop: 16 }}>Notes folder</h4>
      <p className="muted small" style={{ marginTop: -8 }}>
        Point at a folder of markdown lesson notes and the coach will cite the bullets that relate
        to your gaps — quoting your own instructors, never inventing one. Writing session summaries
        and coach notes back into the folder only happens if you turn it on below.
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          style={{ flex: 1, padding: 6 }}
          value={notesFolder}
          placeholder="No folder set — coach uses the reports only"
          onChange={(e) => setNotesFolder(e.target.value)}
        />
        <button className="btn-sm" onClick={browseNotes}>
          Browse…
        </button>
        {notesFolder && (
          <button className="btn-sm" onClick={() => setNotesFolder('')}>
            Clear
          </button>
        )}
      </div>
      <label className="check-label" style={{ display: 'block', marginTop: 8 }}>
        <input
          type="checkbox"
          checked={notesWriteEnabled}
          disabled={!notesFolder.trim()}
          onChange={(e) => setNotesWriteEnabled(e.target.checked)}
        />{' '}
        Also write session summaries and coach notes into this folder
      </label>

      <h4 style={{ marginTop: 16 }}>AI coach</h4>
      <label className="check-label" style={{ marginBottom: 4, display: 'block' }}>
        <input
          type="radio"
          name="coachBackend"
          checked={backend === 'claude-cli'}
          onChange={() => setBackend('claude-cli')}
        />{' '}
        Claude Code — uses your Pro/Max plan, no API credits
        <span className={`tiny ${cli?.found ? 'pos' : 'warn'}`} style={{ marginLeft: 8 }}>
          {cli === null
            ? 'checking…'
            : cli.found
              ? `detected (${cli.version})`
              : 'not found — install Claude Code and log in'}
        </span>
      </label>
      <label className="check-label" style={{ display: 'block' }}>
        <input
          type="radio"
          name="coachBackend"
          checked={backend === 'api'}
          onChange={() => setBackend('api')}
        />{' '}
        Anthropic API key — pay-per-use credits
      </label>
      {backend === 'api' && (
        <div style={{ marginTop: 8 }}>
          <p className="muted small" style={{ marginTop: 0 }}>
            Stored encrypted with your OS keychain, only ever used to call the Anthropic API from
            this machine. Saved immediately — no need to hit Save.
          </p>
          {keyStatus?.configured ? (
            <div className="row">
              <span className="pos small">Key saved (····{keyStatus.last4 ?? ''})</span>
              <button className="btn-sm" onClick={clearKey}>
                Remove key
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="password"
                style={{ flex: 1, padding: 6 }}
                value={keyInput}
                placeholder="sk-ant-…"
                onChange={(e) => setKeyInput(e.target.value)}
              />
              <button className="btn-sm" disabled={!keyInput.trim()} onClick={saveKey}>
                Save key
              </button>
            </div>
          )}
          {keyError && <p className="neg small">{keyError}</p>}
        </div>
      )}

      <label className="check-label" style={{ marginTop: 12, display: 'block' }}>
        Coach model
        <br />
        <select
          value={coachModel}
          onChange={(e) => setCoachModel(e.target.value as AppConfig['coachModel'])}
        >
          <option value="sonnet">Sonnet — fast, recommended</option>
          <option value="haiku">Haiku — cheapest</option>
          <option value="opus">Opus — deepest read</option>
        </select>
      </label>

      <div style={{ marginTop: 16 }}>
        <button className="btn-primary" onClick={save}>
          Save
        </button>{' '}
        {saved && <span className="pos">Saved.</span>}
      </div>
    </div>
  )
}

export default Settings
