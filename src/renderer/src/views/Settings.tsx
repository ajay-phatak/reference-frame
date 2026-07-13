import { useState } from 'react'
import type { AppConfig } from '../../../preload/index.d'

interface Props {
  config: AppConfig
  onSaved: (config: AppConfig) => void
}

function Settings({ config, onSaved }: Props): React.JSX.Element {
  const [role, setRole] = useState(config.role)
  const [defaultMe, setDefaultMe] = useState(config.defaultMe)
  const [partnerName, setPartnerName] = useState(config.partnerName ?? '')
  const [poseModel, setPoseModel] = useState(config.poseModel)
  const [saved, setSaved] = useState(false)

  const save = async (): Promise<void> => {
    const next = await window.api.setConfig({
      role,
      defaultMe,
      partnerName: partnerName.trim() || null,
      poseModel
    })
    onSaved(next)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div style={{ maxWidth: 560 }}>
      <h1>Settings</h1>

      <h4>Defaults</h4>
      <p className="muted small" style={{ marginTop: -8 }}>
        Pre-fills the Analyze form — change per-run any time.
      </p>

      <div className="row" style={{ flexWrap: 'wrap', gap: 16 }}>
        <label className="check-label">
          Your side
          <br />
          <select
            value={defaultMe}
            onChange={(e) => setDefaultMe(e.target.value as AppConfig['defaultMe'])}
          >
            <option value="left">Left</option>
            <option value="right">Right</option>
          </select>
        </label>
        <label className="check-label">
          Your role
          <br />
          <select value={role} onChange={(e) => setRole(e.target.value as AppConfig['role'])}>
            <option value="lead">Lead</option>
            <option value="follow">Follow</option>
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

      <h4 style={{ marginTop: 16 }}>Partner name</h4>
      <input
        style={{ width: '100%' }}
        value={partnerName}
        placeholder="optional"
        onChange={(e) => setPartnerName(e.target.value)}
      />

      <div style={{ marginTop: 16 }}>
        <button className="btn-primary" onClick={save}>
          Save
        </button>{' '}
        {saved && <span className="pos">Saved.</span>}
      </div>

      <h4>Notes folder</h4>
      <div className="callout">
        Point Reference Frame at a folder of markdown notes so the coach can cite your lessons —
        coming in phase 4.
      </div>

      <h4>AI coach</h4>
      <div className="callout">
        Anthropic API key or your local Claude Code install — coming in phase 4.
      </div>
    </div>
  )
}

export default Settings
