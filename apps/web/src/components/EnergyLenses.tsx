import { CircleDot, CloudSun, Eye, GitBranch, Map, Radio, TimerReset } from 'lucide-react'
import type { EnergyFacet, EvidenceKind } from '../types'
import type { EnergyLensId } from './WeiqiBoard'

const LENSES: Array<{
  id: EnergyLensId
  label: string
  canonical: string
  evidence: EvidenceKind
  icon: typeof CircleDot
}> = [
  { id: 'cloud', label: 'Cloud', canonical: 'Stone presence', evidence: 'metaphor', icon: CloudSun },
  { id: 'breath', label: 'Breath', canonical: 'Liberties', evidence: 'exact', icon: CircleDot },
  { id: 'bonds', label: 'Bonds', canonical: 'Connections', evidence: 'exact', icon: GitBranch },
  { id: 'shelter', label: 'Shelter', canonical: 'Eye space', evidence: 'tactical', icon: Eye },
  { id: 'reach', label: 'Reach', canonical: 'Influence', evidence: 'engine', icon: Radio },
  { id: 'ground', label: 'Ground', canonical: 'Stable ownership', evidence: 'engine', icon: Map },
  { id: 'beat', label: 'Beat', canonical: 'Initiative', evidence: 'tactical', icon: TimerReset },
]

export function EvidenceBadge({ kind }: { kind: EvidenceKind }) {
  const labels: Record<EvidenceKind, string> = {
    exact: 'Exact',
    tactical: 'Tactical read',
    engine: 'Engine estimate',
    model: 'Model explanation',
    metaphor: 'Metaphor',
  }
  return <span className={`evidence-badge ${kind}`}>{labels[kind]}</span>
}

interface EnergyLensesProps {
  active: Set<EnergyLensId>
  onToggle: (id: EnergyLensId) => void
  facets?: EnergyFacet[]
  engineAvailable: boolean
}

export function EnergyLenses({ active, onToggle, facets = [], engineAvailable }: EnergyLensesProps) {
  const hasFacet = (id: EnergyLensId) => facets.some((facet) => facet.id === id)
  const visibleFacets = facets.filter((facet) => active.has(facet.id as EnergyLensId))
  return (
    <section className="energy-panel" data-testid="energy-lenses" data-active-count={active.size}>
      <div className="energy-heading">
        <div>
          <span className="eyebrow">Board views</span>
          <h3>Turn one clear layer on or off</h3>
        </div>
        <span className="no-score">No magic score</span>
      </div>
      <div className="lens-chips" aria-label="Board teaching overlays">
        {LENSES.map((lens) => {
          const Icon = lens.icon
          const isActive = active.has(lens.id)
          const blocked =
            (lens.evidence === 'engine' && !engineAvailable) ||
            ((lens.id === 'shelter' || lens.id === 'beat') && !hasFacet(lens.id))
          return (
            <button
              key={lens.id}
              type="button"
              aria-pressed={isActive}
              aria-disabled={blocked && !isActive}
              className={`lens-chip ${isActive ? 'active' : ''} ${blocked ? 'unavailable' : ''}`}
              onClick={() => (isActive || !blocked) && onToggle(lens.id)}
              title={blocked ? `${lens.canonical} has no position-bound reading yet` : lens.canonical}
              data-testid={`lens-${lens.id}`}
            >
              <Icon size={15} aria-hidden="true" />
              <span>{lens.label}</span>
              <small>{lens.canonical}</small>
            </button>
          )
        })}
      </div>
      {visibleFacets.length > 0 && (
        <div className="facet-readings">
          {visibleFacets.slice(0, 4).map((facet) => (
            <article key={`${facet.id}-${facet.value}`} className="facet-reading">
              <div className="facet-reading-top">
                <strong>{facet.label}</strong>
                <EvidenceBadge kind={facet.evidence} />
              </div>
              <span className="facet-value">{facet.value}</span>
              {facet.change && <span className="facet-change">{facet.change}</span>}
              <p>{facet.explanation}</p>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
