import { ArrowRight, CheckCircle2, Route, ShieldAlert } from 'lucide-react'
import type { CandidateMove } from '../types'

interface CandidateCardsProps {
  candidates: CandidateMove[]
  selectedCandidateId?: string | null
  onSelect: (candidate: CandidateMove) => void
  disabled?: boolean
}

export function CandidateCards({
  candidates,
  selectedCandidateId,
  onSelect,
  disabled = false,
}: CandidateCardsProps) {
  if (!candidates.length) {
    return (
      <div className="candidate-empty" data-testid="candidate-empty">
        <Route size={18} aria-hidden="true" />
        <span>Select an empty point to compare its consequences.</span>
      </div>
    )
  }

  return (
    <div className="candidate-list" data-testid="candidate-list">
      {candidates.slice(0, 3).map((candidate) => {
        const selected = selectedCandidateId === candidate.id
        return (
          <button
            key={candidate.id}
            type="button"
            className={`candidate-card ${selected ? 'selected' : ''}`}
            onClick={() => onSelect(candidate)}
            disabled={disabled}
            data-testid={`candidate-${candidate.id}`}
            data-verified={candidate.verified}
          >
            <span className="candidate-coordinate">{candidate.coordinate}</span>
            <span className="candidate-body">
              <span className="candidate-title-row">
                <strong>{candidate.title}</strong>
                <span className="intent-tag">{candidate.intent}</span>
                {candidate.verified && <CheckCircle2 size={14} aria-label="Engine-supported server candidate" />}
              </span>
              <span className="candidate-summary">{candidate.summary}</span>
              {candidate.likely_reply && (
                <span className="candidate-detail"><ArrowRight size={13} /> Likely reply: {candidate.likely_reply}</span>
              )}
              {candidate.risk && (
                <span className="candidate-detail risk"><ShieldAlert size={13} /> Risk: {candidate.risk}</span>
              )}
              {!candidate.verified && (
                <span className="candidate-detail"><ShieldAlert size={13} /> No engine support is claimed.</span>
              )}
            </span>
          </button>
        )
      })}
    </div>
  )
}
