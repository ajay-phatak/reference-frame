// Gap-report bars for Report.tsx's "table view remains as a toggle" upgrade
// (plan v0.4.0 §4). Renders `aggregateGap`'s bands as hand-rolled SVG — no
// charting dependency. Each row gets its OWN scale: bounce lives in
// hundredths, BPM lives in the tens/hundreds, so a shared axis across rows
// would flatten most bars to invisible slivers. To keep that honest, the
// actual numbers are always printed next to the bar, never implied by it
// alone.
//
// Favorability coloring matches Report.tsx's gap table (chip-good/chip-bad,
// var(--win)/var(--loss)) — the engine's ▲/▼ is authoritative; this view
// never re-derives which direction is good, it only visualizes the numbers
// the parser already resolved.
import { useMemo } from 'react'
import { aggregateGap, type GapBandRow, type GapBandSection, type ParsedGap } from '../gap'

interface Props {
  gap: ParsedGap
}

const PLOT_WIDTH = 320
const ROW_HEIGHT = 28

function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return '—'
  const decimals = Math.abs(n) < 10 ? 3 : Math.abs(n) < 100 ? 2 : 1
  return n
    .toFixed(decimals)
    .replace(/(\.\d*?)0+$/, '$1')
    .replace(/\.$/, '')
}

function fmtDelta(n: number): string {
  return `${n >= 0 ? '+' : '-'}${fmtNum(Math.abs(n))}`
}

// Row-local linear scale — pads the domain a bit so markers at the edges
// don't sit flush against the row bounds, and never degenerates to a
// divide-by-zero when every value in the row happens to be equal.
function makeScale(domainMin: number, domainMax: number, width: number): (v: number) => number {
  let lo = domainMin
  let hi = domainMax
  if (hi <= lo) {
    const pad = Math.max(Math.abs(lo) * 0.1, 0.5)
    lo -= pad
    hi += pad
  } else {
    const pad = (hi - lo) * 0.12
    lo -= pad
    hi += pad
  }
  return (v: number): number => ((v - lo) / (hi - lo)) * width
}

function UnplottableRow({ row }: { row: GapBandRow }): React.JSX.Element {
  return (
    <div
      className="row-between"
      style={{ padding: '6px 0', borderBottom: '1px solid var(--border-1)' }}
    >
      <span>{row.label}</span>
      <span className="muted tiny">
        you={row.you !== null ? fmtNum(row.you) : '—'}
        {row.proMin !== null &&
          ` · pro ${fmtNum(row.proMin)}${row.proMax !== null && row.proMax !== row.proMin ? `–${fmtNum(row.proMax)}` : ''}`}
        {row.note && ` · ${row.note}`}
      </span>
    </div>
  )
}

function BandRow({ row }: { row: GapBandRow }): React.JSX.Element {
  if (!row.plottable) return <UnplottableRow row={row} />

  const you = row.you as number
  const proMin = row.proMin as number
  const proMax = row.proMax as number
  const single = row.n <= 1

  const domainMin = Math.min(you, proMin)
  const domainMax = Math.max(you, proMax)
  const scale = makeScale(domainMin, domainMax, PLOT_WIDTH)

  const favColor = row.favorable ? 'var(--win)' : 'var(--loss)'
  const midY = ROW_HEIGHT / 2

  return (
    <div style={{ padding: '10px 0', borderBottom: '1px solid var(--border-1)' }}>
      <div className="row-between">
        <span>{row.label}</span>
        <span className="row" style={{ gap: 8 }}>
          {!single && <span className="muted tiny">n={row.n}</span>}
          <span className={`chip ${row.favorable ? 'chip-good' : 'chip-bad'}`}>
            {row.delta !== null ? fmtDelta(row.delta) : '—'}
          </span>
        </span>
      </div>

      <svg
        viewBox={`0 0 ${PLOT_WIDTH + 16} ${ROW_HEIGHT}`}
        width="100%"
        height={ROW_HEIGHT}
        style={{ display: 'block', marginTop: 4 }}
      >
        <g transform="translate(8, 0)">
          <line x1={0} x2={PLOT_WIDTH} y1={midY} y2={midY} stroke="var(--border-1)" />

          {!single && (
            <>
              {/* pro min–max band, shaded neutral — it's a reference, not a verdict */}
              <rect
                x={Math.min(scale(proMin), scale(proMax))}
                y={midY - 4}
                width={Math.max(Math.abs(scale(proMax) - scale(proMin)), 1)}
                height={8}
                fill="var(--bg-3)"
                stroke="var(--border-2)"
              />
              {/* per-couple pro tick marks */}
              {row.points.map((p) => (
                <line
                  key={p.couple}
                  x1={scale(p.pro)}
                  x2={scale(p.pro)}
                  y1={midY - 7}
                  y2={midY + 7}
                  stroke="var(--text-3)"
                  strokeWidth={1.5}
                >
                  <title>{`${p.couple}: pro avg ${fmtNum(p.pro)}`}</title>
                </line>
              ))}
            </>
          )}

          {single && (
            <line
              x1={scale(row.points[0].pro)}
              x2={scale(row.points[0].pro)}
              y1={midY - 7}
              y2={midY + 7}
              stroke="var(--text-3)"
              strokeWidth={2}
            >
              <title>{`pro avg ${fmtNum(row.points[0].pro)}`}</title>
            </line>
          )}

          {/* "you" marker — colored by the engine's favorability, never re-derived here */}
          <circle
            cx={scale(you)}
            cy={midY}
            r={5}
            fill={favColor}
            stroke="var(--bg-0)"
            strokeWidth={1.5}
          />
        </g>
      </svg>

      <div className="row-between muted tiny" style={{ marginTop: 2 }}>
        <span>
          you={fmtNum(you)} · pro{' '}
          {single ? fmtNum(row.points[0].pro) : `${fmtNum(proMin)}–${fmtNum(proMax)}`}
        </span>
        {row.note && <span>{row.note}</span>}
      </div>
    </div>
  )
}

function Section({ section }: { section: GapBandSection }): React.JSX.Element {
  return (
    <div style={{ marginBottom: 16 }}>
      {section.heading && <p className="eyebrow">{section.heading}</p>}
      {section.rows.map((row) => (
        <BandRow row={row} key={row.label} />
      ))}
    </div>
  )
}

// Entry point: pass the already-parsed gap report (`parseGap(gapText)`,
// same value Report.tsx already builds for its table view) — this component
// aggregates internally, so callers never need to import `aggregateGap`
// themselves. One `<GapBars gap={gap} />` renders every couple's bands
// grouped by section; wrap it in whatever toggle/collapsible the caller
// wants alongside the existing table.
export function GapBars({ gap }: Props): React.JSX.Element {
  const aggregated = useMemo(() => aggregateGap(gap), [gap])
  return (
    <div>
      {aggregated.sections.map((section, i) => (
        <Section section={section} key={section.heading ?? i} />
      ))}
    </div>
  )
}
