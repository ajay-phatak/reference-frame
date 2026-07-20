// Components shared between Analyze and Pros — both drive the same
// seed-preview -> analyze engine flow and need the same video-input control,
// per-stage progress display, and crowd-style seed picker. Plain helpers
// (stage math, url sniffing, etc.) live in engineProgress.ts instead — see
// that file's header for why the split.
import type { SeedDetection } from '../../../preload/index.d'
import { STAGE_LABELS, stagePct, etaLabel, type StageState } from './engineProgress'

// Display noun for a role value. The stored value stays 'lead'/'follow'
// (run.json, IPC, engine args all use it) — only user-facing text says
// leader/follower.
export function roleNoun(role: 'lead' | 'follow'): string {
  return role === 'lead' ? 'leader' : 'follower'
}

// --- Video file/URL input, with the app's selected-state highlight ---

interface VideoInputProps {
  inputMode: 'file' | 'url'
  setInputMode: (m: 'file' | 'url') => void
  filePath: string
  onPickFile: () => void
  url: string
  setUrl: (u: string) => void
  disabled: boolean
}

export function VideoInput({
  inputMode,
  setInputMode,
  filePath,
  onPickFile,
  url,
  setUrl,
  disabled
}: VideoInputProps): React.JSX.Element {
  return (
    <div>
      <div className="row" style={{ marginBottom: 8 }}>
        <button
          className={`toggle-btn${inputMode === 'file' ? ' active' : ''}`}
          disabled={disabled}
          onClick={() => setInputMode('file')}
        >
          Video file
        </button>
        <button
          className={`toggle-btn${inputMode === 'url' ? ' active' : ''}`}
          disabled={disabled}
          onClick={() => setInputMode('url')}
        >
          YouTube URL
        </button>
      </div>

      {inputMode === 'file' ? (
        <div className="row">
          <button disabled={disabled} onClick={onPickFile}>
            Choose video…
          </button>
          <span className="mono tiny muted">{filePath || 'No file selected'}</span>
        </div>
      ) : (
        <input
          style={{ width: '100%' }}
          placeholder="https://www.youtube.com/watch?v=…"
          value={url}
          disabled={disabled}
          onChange={(e) => setUrl(e.target.value)}
        />
      )}
    </div>
  )
}

// --- Per-stage progress bars + collapsible log tail ---

interface ProgressBlockProps {
  stages: string[]
  stageProgress: Record<string, StageState>
  logs: string[]
  showLog: boolean
  onToggleLog: () => void
}

export function ProgressBlock({
  stages,
  stageProgress,
  logs,
  showLog,
  onToggleLog
}: ProgressBlockProps): React.JSX.Element {
  return (
    <>
      {stages.length === 0 && <p className="muted tiny">Starting…</p>}
      {stages.map((stage) => {
        const s = stageProgress[stage]
        const pct = stagePct(s)
        const eta = etaLabel(s)
        return (
          <div key={stage} className="stage-row">
            <div className="row-between">
              <span className="small">{STAGE_LABELS[stage] ?? stage}</span>
              <span className="muted tiny">
                {pct}%{eta ? ` · ${eta}` : ''}
              </span>
            </div>
            <div className="bar-track">
              <div className="bar-fill" style={{ width: `${pct}%` }} />
            </div>
            {s.detail && <div className="muted tiny">{s.detail}</div>}
          </div>
        )
      })}

      {logs.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <button className="btn-sm" onClick={onToggleLog}>
            {showLog ? 'Hide log' : `Show log (${logs.length})`}
          </button>
          {showLog && <pre className="log-tail">{logs.slice(-200).join('\n')}</pre>}
        </div>
      )}
    </>
  )
}

// --- Seed picker: numbered detection boxes over a frame, click two in order ---

interface SeedPickerProps {
  image: string
  dets: SeedDetection[]
  imgNatural: { w: number; h: number } | null
  onImgLoad: (e: React.SyntheticEvent<HTMLImageElement>) => void
  firstIdx: number | null
  secondIdx: number | null
  onClickBox: (idx: number) => void
}

export function SeedPicker({
  image,
  dets,
  imgNatural,
  onImgLoad,
  firstIdx,
  secondIdx,
  onClickBox
}: SeedPickerProps): React.JSX.Element {
  return (
    <div className="seed-frame">
      <img
        src={image}
        style={{ maxWidth: '100%', display: 'block' }}
        onLoad={onImgLoad}
        alt="Seed frame with detected dancers"
      />
      {imgNatural &&
        dets.map((det) => {
          const [x0, y0, x1, y1] = det.box
          const boxCls =
            det.idx === firstIdx
              ? 'seed-box seed-box-me'
              : det.idx === secondIdx
                ? 'seed-box seed-box-partner'
                : 'seed-box'
          return (
            <button
              key={det.idx}
              type="button"
              className={boxCls}
              style={{
                left: `${(x0 / imgNatural.w) * 100}%`,
                top: `${(y0 / imgNatural.h) * 100}%`,
                width: `${((x1 - x0) / imgNatural.w) * 100}%`,
                height: `${((y1 - y0) / imgNatural.h) * 100}%`
              }}
              onClick={() => onClickBox(det.idx)}
            >
              <span className="seed-box-label">{det.idx}</span>
            </button>
          )
        })}
    </div>
  )
}
