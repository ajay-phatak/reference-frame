// Structured metric cards for Report.tsx (plan-0.4.0 §3). Walks the registry
// (`src/renderer/src/metrics/registry.ts`) against a run's `MetricsSummary`
// and renders one card per resolvable field, grouped by `SECTION_ORDER`.
// Resolution logic (family + role -> concrete JSON path) lives in
// `../metrics/resolve.ts`, shared with Compare.tsx — see that module's
// header for the JSON-shape rundown.
import { useState } from 'react'
import type { MetricsSummary } from '../../../preload/index.d'
import { METRIC_REGISTRY, SECTION_ORDER } from '../metrics/registry'
import {
  formatValue,
  resolveMetric,
  SECTION_LABELS,
  type ResolvedMetric,
  type Role
} from '../metrics/resolve'

interface Props {
  metrics: MetricsSummary
  role: Role
  partner: boolean
}

export function MetricCards({ metrics, role, partner }: Props): React.JSX.Element | null {
  // Secondary values are labeled by the partner's actual role, not "partner" —
  // the analyzed dancer's role tells us which one that is.
  const partnerWord = role === 'lead' ? 'follower' : 'leader'
  const sections = SECTION_ORDER.map((section) => {
    const cards: ResolvedMetric[] = []
    for (const def of METRIC_REGISTRY) {
      if (def.section !== section) continue
      const resolved = resolveMetric(metrics, def, role)
      if (!resolved) continue
      if (resolved.partnerOnly && !partner) continue
      cards.push(resolved)
    }
    return { section, cards }
  }).filter((s) => s.cards.length > 0)

  if (sections.length === 0) return null

  return (
    <div>
      {sections.map(({ section, cards }) => (
        <div key={section} style={{ marginBottom: 20 }}>
          <p className="eyebrow">{SECTION_LABELS[section]}</p>
          <div className="metric-grid">
            {cards.map((c) => (
              <MetricCard
                key={c.def.key}
                resolved={c}
                showPartner={partner}
                partnerWord={partnerWord}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function MetricCard({
  resolved,
  showPartner,
  partnerWord
}: {
  resolved: ResolvedMetric
  showPartner: boolean
  partnerWord: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const { def, value, partnerValue, partnerOnly } = resolved
  const display = formatValue(def, value)
  const partnerDisplay =
    showPartner && !partnerOnly && partnerValue !== undefined
      ? formatValue(def, partnerValue)
      : null

  return (
    <div className={`card metric-card${partnerOnly ? ' metric-card-secondary' : ''}`}>
      <div className="row-between">
        <span className="small">
          {def.label}
          {partnerOnly && <span className="muted tiny"> · your {partnerWord}</span>}
        </span>
        <button
          type="button"
          className="btn-xs info-toggle"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={`What is ${def.label}?`}
        >
          ⓘ
        </button>
      </div>
      <div className="metric-value">{display}</div>
      {partnerDisplay && (
        <p className="muted tiny" style={{ margin: 0 }}>
          {partnerWord}: {partnerDisplay}
        </p>
      )}
      {open && (
        <div className="explainer">
          <p>
            <strong>What:</strong> {def.explainer.what}
          </p>
          <p>
            <strong>How it&apos;s measured:</strong> {def.explainer.how}
          </p>
          <p>
            <strong>Good looks like:</strong> {def.explainer.goodLooksLike}
          </p>
          <p>
            <strong>Common causes:</strong> {def.explainer.commonCauses}
          </p>
        </div>
      )}
    </div>
  )
}
