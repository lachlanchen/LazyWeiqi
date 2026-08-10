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
import type { BoardSize, CandidateMove, StoneColor } from '../types'

interface CandidateCardsProps {
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
        <span>Select an empty point to compare its consequences.</span>
      </div>
    )
  }

  return (
    <div className="candidate-list" data-testid="candidate-list" aria-label="Candidate move comparison">
      {candidates.slice(0, 3).map((candidate) => {
        const selected = selectedCandidateId === candidate.id
        const inspecting = inspectedCandidateId === candidate.id
        const suggested = suggestedCandidateId === candidate.id
        const suggestedRank = Number.isInteger(candidate.evaluation?.order) && (candidate.evaluation?.order ?? -1) >= 0
          ? `KataGo order ${(candidate.evaluation?.order ?? 0) + 1}`
          : 'KataGo-ranked'
        const expanded = selected || inspecting || suggested
        const reasoning = candidateReasoning(candidate)
        const pv = variationSummary(candidate, boardSize)
        const evaluation = candidate.evaluation ? evaluationSummary(candidate.evaluation) : null
        const engineEvidenceAllowed = boardSize === 9 && candidate.engine_analyzed === true
        const engineRank = candidate.evaluation?.order != null ? candidate.evaluation.order + 1 : null
        const topCandidate = candidates.find((item) => item.evaluation?.order === 0)
        const qualityComparison = candidateQualityComparison(candidate, topCandidate, toPlay)
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
            aria-label={`${suggested ? 'Suggested first stone. ' : ''}${candidate.coordinate}, ${candidate.title}. Inspect this candidate; click or press Enter to select its non-committing move preview.`}
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
                <span className="intent-tag">{candidate.intent}</span>
                {candidate.legal_verified === true && <CheckCircle2 size={14} aria-label="Rules-legal server candidate" />}
              </span>
              {suggested && (
                <span className="candidate-suggestion-badge" data-testid="suggested-first-stone-card">
                  Suggested first stone · {candidate.engine_analyzed ? suggestedRank : 'teacher fallback'}
                </span>
              )}
              <span className="intent-provenance">Teacher hypothesis · possible job</span>
              <span className="candidate-summary">{candidate.summary}</span>
              {candidate.main_line_reply && (
                <span className="candidate-detail"><ArrowRight size={13} aria-hidden="true" /> {candidate.engine_analyzed && boardSize === 9 ? 'Reply in one engine line (not forced)' : 'Reply to examine'}: {candidate.main_line_reply}</span>
              )}
              {candidate.risk && (
                <span className="candidate-detail risk"><ShieldAlert size={13} aria-hidden="true" /> Risk: {candidate.risk}</span>
              )}
              {!candidate.engine_analyzed && (
                <span className="candidate-detail"><ShieldAlert size={13} aria-hidden="true" /> No engine support is claimed.</span>
              )}

              <span
                id={analysisId}
                className="candidate-analysis"
                data-testid={`candidate-analysis-${candidate.id}`}
                data-visible={expanded}
                aria-hidden={!expanded}
              >
                <span className="candidate-reasoning-row"><b>Why here <em>Teacher interpretation</em></b><span>{reasoning.why}</span></span>
                {!candidate.tactics && <span className="candidate-reasoning-row"><b>What changes <em>Teacher interpretation</em></b><span>{reasoning.changes}</span></span>}
                <span className="candidate-reasoning-row"><b>Next calculation <em>Teacher interpretation</em></b><span>{reasoning.next}</span></span>

                {candidate.tactics && (
                  <span className="candidate-evidence-block exact" data-testid={`candidate-tactics-${candidate.id}`}>
                    <span><b>Rules facts</b><em>Exact</em></span>
                    <span>{tacticsSummary(candidate.tactics, candidate.kind === 'pass' || candidate.point == null)}</span>
                  </span>
                )}

                {candidate.score && engineEvidenceAllowed && (
                  <span
                    className="candidate-evidence-block engine"
                    data-testid={`candidate-score-${candidate.id}`}
                    data-perspective={candidate.score.perspective}
                  >
                    <span><b>Score forecast comparison</b><em>Engine estimate · {candidate.score.perspective} perspective</em></span>
                    <span>{scoreImpactSummary(candidate.score, toPlay)}</span>
                    {qualityComparison && <span>{qualityComparison}</span>}
                    <small>{scoreVolatilitySummary(candidate.score)}</small>
                  </span>
                )}

                {evaluation && engineEvidenceAllowed && (
                  <span className="candidate-evaluation" data-testid={`candidate-evaluation-${candidate.id}`}>
                    {engineRank != null && <>KataGo ranks {candidate.coordinate} #{engineRank}{candidate.evaluation?.visits != null ? `; this child received ${candidate.evaluation.visits.toLocaleString()} visits` : ''}. </>}
                    {evaluation} This supports comparison; it is not a territory fact.
                  </span>
                )}

                {(candidate.ownership_after?.length || candidate.ownership_delta?.length) && engineEvidenceAllowed && (
                  <span className="candidate-field-status" data-testid={`candidate-field-status-${candidate.id}`}>
                    <b>Board field</b>
                    <span>
                      {candidate.ownership_after?.length ? 'After-move ownership' : ''}
                      {candidate.ownership_after?.length && candidate.ownership_delta?.length ? ' + ' : ''}
                      {candidate.ownership_delta?.length ? 'Δ ownership shape' : ''}
                    </span>
                    <small>{candidateVariationAvailable
                      ? 'Black-positive engine estimate; variation across searched continuations is shown cell by cell.'
                      : 'Black-positive engine estimate; no continuation-variation map was supplied, so no stability claim is made.'}</small>
                  </span>
                )}

                {!engineEvidenceAllowed && (candidate.score || candidate.ownership_after?.length || candidate.ownership_delta?.length) && (
                  <span className="candidate-small-board-honesty" role="note">
                    Engine comparison is hidden: this {boardSize}×{boardSize} lesson is an authored teaching view.
                  </span>
                )}

                {pv && (
                  <span className="candidate-pv-text" data-testid={`candidate-pv-text-${candidate.id}`}>
                    <b>Read next</b><span>{pv}</span>
                  </span>
                )}
              </span>
            </span>
          </button>
        )
      })}
      <p className="candidate-interaction-hint">Hover or focus to inspect. Tap, click, or press Enter to keep a non-committing preview.</p>
    </div>
  )
}
