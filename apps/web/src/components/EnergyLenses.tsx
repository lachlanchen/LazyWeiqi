import { Calculator, CircleDot, CloudSun, Eye, GitBranch, Map, Radio, TimerReset, Zap } from 'lucide-react'
import { useI18n, type MessageKey } from '../i18n'
import type { EnergyFacet, EvidenceKind } from '../types'
import type { EnergyLensId } from './WeiqiBoard'

const LENSES: Array<{
  id: EnergyLensId
  label: MessageKey
  canonical: MessageKey
  evidence: EvidenceKind
  icon: typeof CircleDot
}> = [
  { id: 'cloud', label: 'lens.cloud', canonical: 'lens.cloudTerm', evidence: 'metaphor', icon: CloudSun },
  { id: 'breath', label: 'lens.breath', canonical: 'lens.liberties', evidence: 'exact', icon: CircleDot },
  { id: 'bonds', label: 'lens.bonds', canonical: 'lens.connections', evidence: 'exact', icon: GitBranch },
  { id: 'shelter', label: 'lens.shelter', canonical: 'lens.eyeSpace', evidence: 'tactical', icon: Eye },
  { id: 'reach', label: 'lens.forecast', canonical: 'lens.ownership', evidence: 'engine', icon: Radio },
  { id: 'ground', label: 'lens.strong', canonical: 'lens.threshold', evidence: 'engine', icon: Map },
  { id: 'area', label: 'lens.area', canonical: 'lens.areaTerm', evidence: 'exact', icon: Calculator },
  { id: 'beat', label: 'lens.turn', canonical: 'lens.side', evidence: 'exact', icon: TimerReset },
  { id: 'pressure', label: 'lens.pressure', canonical: 'lens.atari', evidence: 'tactical', icon: Zap },
]

export function EvidenceBadge({ kind }: { kind: EvidenceKind }) {
  const { t } = useI18n()
  const labels: Record<EvidenceKind, MessageKey> = {
    exact: 'evidence.exact',
    tactical: 'evidence.tactical',
    engine: 'evidence.engine',
    model: 'evidence.model',
    teacher: 'evidence.teacher',
    metaphor: 'evidence.metaphor',
  }
  return <span className={`evidence-badge ${kind}`}>{t(labels[kind])}</span>
}

interface EnergyLensesProps {
  active: Set<EnergyLensId>
  onToggle: (id: EnergyLensId) => void
  facets?: EnergyFacet[]
  engineAvailable: boolean
}

export function EnergyLenses({ active, onToggle, facets = [], engineAvailable }: EnergyLensesProps) {
  const { t } = useI18n()
  const hasFacet = (id: EnergyLensId) => facets.some((facet) => facet.id === id)
  const visibleFacets = facets.filter((facet) => active.has(facet.id as EnergyLensId))
  return (
    <section className="energy-panel" data-testid="energy-lenses" data-active-count={active.size}>
      <div className="energy-heading">
        <div>
          <span className="eyebrow">{t('energy.views')}</span>
          <h3>{t('energy.title')}</h3>
        </div>
        <span className="no-score">{t('energy.noMagic')}</span>
      </div>
      <div className="lens-chips" aria-label={t('energy.overlays')}>
        {LENSES.map((lens) => {
          const Icon = lens.icon
          const isActive = active.has(lens.id)
          const blocked =
            (lens.evidence === 'engine' && !engineAvailable) ||
            ((lens.id === 'shelter' || lens.id === 'beat' || lens.id === 'pressure') && !hasFacet(lens.id))
          return (
            <button
              key={lens.id}
              type="button"
              aria-pressed={isActive}
              aria-disabled={blocked && !isActive}
              className={`lens-chip ${isActive ? 'active' : ''} ${blocked ? 'unavailable' : ''}`}
              onClick={() => (isActive || !blocked) && onToggle(lens.id)}
              title={blocked ? t('energy.noReading', { term: t(lens.canonical) }) : t(lens.canonical)}
              data-testid={`lens-${lens.id}`}
            >
              <Icon size={15} aria-hidden="true" />
              <span>{t(lens.label)}</span>
              <small>{t(lens.canonical)}</small>
            </button>
          )
        })}
      </div>
      {visibleFacets.length > 0 && (
        <div className="facet-readings">
          {visibleFacets.slice(0, 6).map((facet) => (
            <article key={`${facet.scope ?? 'current'}-${facet.id}-${facet.value}`} className="facet-reading" data-scope={facet.scope ?? 'current'} data-facet-id={facet.id}>
              <small className={`facet-scope ${facet.scope ?? 'current'}`}>
                {facet.scope === 'if_played' ? t('energy.ifPlayed') : t('energy.current')}
              </small>
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
