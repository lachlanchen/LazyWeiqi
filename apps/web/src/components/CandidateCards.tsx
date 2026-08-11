import { useEffect, useState } from 'react'
import { ArrowRight, CheckCircle2, Route, ShieldAlert } from 'lucide-react'
import {
  candidateReasoning,
  candidateQualityComparison,
  evaluationSummary,
  scoreImpactSummary,
  scoreVolatilitySummary,
  tacticsSummary,
  variationSummary,
} from '../candidateEvidence'
import { useI18n, type MessageKey } from '../i18n'
import type { BoardSize, CandidateMove, StoneColor } from '../types'

interface CandidateCardsProps {
  compact?: boolean
  boardSize: BoardSize
  toPlay: StoneColor
  candidates: CandidateMove[]
  selectedCandidateId?: string | null
  inspectedCandidateId?: string | null
  suggestedCandidateId?: string | null
  onInspect: (candidate: CandidateMove | null) => void
  onSelect: (candidate: CandidateMove) => void
  disabled?: boolean
}

export function CandidateCards({
  compact = false,
  boardSize,
  toPlay,
  candidates,
  selectedCandidateId,
  inspectedCandidateId,
  suggestedCandidateId,
  onInspect,
  onSelect,
  disabled = false,
}: CandidateCardsProps) {
  const { locale, t } = useI18n()
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [latestModality, setLatestModality] = useState<'pointer' | 'focus'>('pointer')
  const activeInspectionId = latestModality === 'focus'
    ? focusedId ?? hoveredId
    : hoveredId ?? focusedId

  useEffect(() => {
    onInspect(candidates.find((candidate) => candidate.id === activeInspectionId) ?? null)
  }, [activeInspectionId, candidates, onInspect])

  if (!candidates.length) {
    return (
      <div className="candidate-empty" data-testid="candidate-empty">
        <Route size={18} aria-hidden="true" />
        <span>{t('candidate.empty')}</span>
      </div>
    )
  }

  return (
    <div className="candidate-list" data-testid="candidate-list" data-density={compact ? 'compact' : 'full'} aria-label={t('candidate.list')}>
      {candidates.slice(0, 3).map((candidate) => {
        const selected = selectedCandidateId === candidate.id
        const inspecting = inspectedCandidateId === candidate.id
        const suggested = suggestedCandidateId === candidate.id
        const suggestedRank = Number.isInteger(candidate.evaluation?.order) && (candidate.evaluation?.order ?? -1) >= 0
          ? t('candidate.engineOrder', { rank: (candidate.evaluation?.order ?? 0) + 1 })
          : t('candidate.engineRanked')
        const expanded = !compact && (selected || inspecting || suggested)
        const reasoning = candidateReasoning(candidate, locale)
        const pv = variationSummary(candidate, boardSize, locale)
        const evaluation = candidate.evaluation ? evaluationSummary(candidate.evaluation, locale) : null
        const engineEvidenceAllowed = boardSize === 9 && candidate.engine_analyzed === true
        const engineRank = candidate.evaluation?.order != null ? candidate.evaluation.order + 1 : null
        const topCandidate = candidates.find((item) => item.evaluation?.order === 0)
        const qualityComparison = candidateQualityComparison(candidate, topCandidate, toPlay, locale)
        const candidateVariationAvailable = Boolean(
          candidate.ownership_after?.length &&
          candidate.ownership_after.every((cell) => Number.isFinite(cell.variation ?? cell.uncertainty)),
        )
        const analysisId = `candidate-analysis-${candidate.id}`
        return (
          <button
            key={candidate.id}
            type="button"
            className={`candidate-card ${selected ? 'selected' : ''} ${inspecting ? 'inspecting' : ''} ${suggested ? 'suggested' : ''}`}
            onPointerEnter={(event) => {
              if (event.pointerType !== 'touch') {
                setHoveredId(candidate.id)
                setLatestModality('pointer')
              }
            }}
            onPointerLeave={(event) => {
              if (event.pointerType !== 'touch') {
                setHoveredId((current) => current === candidate.id ? null : current)
              }
            }}
            onFocus={() => {
              setFocusedId(candidate.id)
              setLatestModality('focus')
            }}
            onBlur={() => setFocusedId((current) => current === candidate.id ? null : current)}
            onClick={() => onSelect(candidate)}
            disabled={disabled}
            aria-pressed={selected}
            aria-expanded={expanded}
            aria-controls={analysisId}
            aria-label={t('candidate.inspectAria', { prefix: suggested ? `${t('candidate.suggested')}. ` : '', coordinate: candidate.coordinate, title: candidate.title })}
            data-testid={`candidate-${candidate.id}`}
            data-verified={candidate.verified}
            data-inspecting={inspecting}
            data-selected={selected}
            data-suggested={suggested}
            data-suggestion-source={suggested ? (candidate.engine_analyzed ? 'engine' : 'teacher') : undefined}
          >
            <span className="candidate-coordinate">{candidate.coordinate}</span>
            <span className="candidate-body">
              <span className="candidate-title-row">
                <strong>{candidate.title}</strong>
                <span className="intent-tag">{t(`intent.${candidate.intent}` as MessageKey)}</span>
                {candidate.legal_verified === true && <CheckCircle2 size={14} aria-label={t('candidate.rulesLegal')} />}
              </span>
              {suggested && (
                <span className="candidate-suggestion-badge" data-testid="suggested-first-stone-card">
                  {t('candidate.suggestedBadge', { source: candidate.engine_analyzed ? suggestedRank : t('candidate.teacherFallback') })}
                </span>
              )}
              <span className="intent-provenance">{t('candidate.intentProvenance')}</span>
              <span className="candidate-summary">{candidate.summary}</span>
              {candidate.main_line_reply && (
                <span className="candidate-detail"><ArrowRight size={13} aria-hidden="true" /> {candidate.engine_analyzed && boardSize === 9 ? t('candidate.replyEngine') : t('candidate.replyExamine')}: {candidate.main_line_reply}</span>
              )}
              {candidate.risk && (
                <span className="candidate-detail risk"><ShieldAlert size={13} aria-hidden="true" /> {t('candidate.risk')} {candidate.risk}</span>
              )}
              {!candidate.engine_analyzed && (
                <span className="candidate-detail"><ShieldAlert size={13} aria-hidden="true" /> {t('candidate.noEngine')}</span>
              )}

              <span
                id={analysisId}
                className="candidate-analysis"
                data-testid={`candidate-analysis-${candidate.id}`}
                data-visible={expanded}
                aria-hidden={!expanded}
              >
                <span className="candidate-reasoning-row"><b>{t('candidate.why')} <em>{t('candidate.teacherInterpretation')}</em></b><span>{reasoning.why}</span></span>
                {!candidate.tactics && <span className="candidate-reasoning-row"><b>{t('candidate.changes')} <em>{t('candidate.teacherInterpretation')}</em></b><span>{reasoning.changes}</span></span>}
                <span className="candidate-reasoning-row"><b>{t('candidate.next')} <em>{t('candidate.teacherInterpretation')}</em></b><span>{reasoning.next}</span></span>

                {candidate.tactics && (
                  <span className="candidate-evidence-block exact" data-testid={`candidate-tactics-${candidate.id}`}>
                    <span><b>{t('candidate.rulesFacts')}</b><em>{t('candidate.exact')}</em></span>
                    <span>{tacticsSummary(candidate.tactics, candidate.kind === 'pass' || candidate.point == null, locale)}</span>
                  </span>
                )}

                {candidate.score && engineEvidenceAllowed && (
                  <span
                    className="candidate-evidence-block engine"
                    data-testid={`candidate-score-${candidate.id}`}
                    data-perspective={candidate.score.perspective}
                  >
                    <span><b>{t('candidate.scoreComparison')}</b><em>{t('candidate.enginePerspective', { color: locale === 'en' ? candidate.score.perspective : candidate.score.perspective === 'black' ? t('board.black') : t('board.white') })}</em></span>
                    <span>{scoreImpactSummary(candidate.score, toPlay, locale)}</span>
                    {qualityComparison && <span>{qualityComparison}</span>}
                    <small>{scoreVolatilitySummary(candidate.score, locale)}</small>
                  </span>
                )}

                {evaluation && engineEvidenceAllowed && (
                  <span className="candidate-evaluation" data-testid={`candidate-evaluation-${candidate.id}`}>
                    {engineRank != null && <>{t('candidate.rank', { coordinate: candidate.coordinate, rank: engineRank, visits: candidate.evaluation?.visits != null ? t('candidate.visits', { count: candidate.evaluation.visits.toLocaleString(locale) }) : '' })}</>}
                    {evaluation} {t('candidate.supportsComparison')}
                  </span>
                )}

                {(candidate.ownership_after?.length || candidate.ownership_delta?.length) && engineEvidenceAllowed && (
                  <span className="candidate-field-status" data-testid={`candidate-field-status-${candidate.id}`}>
                    <b>{t('candidate.boardField')}</b>
                    <span>
                      {candidate.ownership_after?.length ? t('candidate.afterOwnership') : ''}
                      {candidate.ownership_after?.length && candidate.ownership_delta?.length ? ' + ' : ''}
                      {candidate.ownership_delta?.length ? t('candidate.deltaOwnership') : ''}
                    </span>
                    <small>{candidateVariationAvailable
                      ? t('candidate.variationSupplied')
                      : t('candidate.variationMissing')}</small>
                  </span>
                )}

                {!engineEvidenceAllowed && (candidate.score || candidate.ownership_after?.length || candidate.ownership_delta?.length) && (
                  <span className="candidate-small-board-honesty" role="note">
                    {t('candidate.smallBoardHidden', { size: boardSize })}
                  </span>
                )}

                {pv && (
                  <span className="candidate-pv-text" data-testid={`candidate-pv-text-${candidate.id}`}>
                    <b>{t('candidate.readNext')}</b><span>{pv}</span>
                  </span>
                )}
              </span>
            </span>
          </button>
        )
      })}
      <p className="candidate-interaction-hint">{t('candidate.interaction')}</p>
    </div>
  )
}
