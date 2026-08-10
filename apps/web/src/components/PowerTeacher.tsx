import { ArrowRight, Lightbulb } from 'lucide-react'
import { groupAt, pointToCoordinate, samePoint } from '../board'
import type { BoardSize, CandidateMove, MovePreview, MoveRecord, Point, Stone, StoneColor } from '../types'
import { EvidenceBadge } from './EnergyLenses'

interface PowerTeacherProps {
  size: BoardSize
  stones: Stone[]
  toPlay: StoneColor
  selected: Point | null
  preview: MovePreview | null
  candidates: CandidateMove[]
  lastMove: MoveRecord | null
  ownershipAvailable: boolean
}

interface TeachingStep {
  label: string
  text: string
}

function colorName(color: StoneColor): string {
  return color === 'black' ? 'Black' : 'White'
}

function candidateForPoint(candidates: CandidateMove[], point: Point | null): CandidateMove | undefined {
  if (!point) return undefined
  return candidates.find((candidate) => samePoint(candidate.point, point))
}

function nearestOpponentCoordinate(
  stones: Stone[],
  color: StoneColor,
  anchor: Point,
  size: BoardSize,
  excluded: Point[] = [],
): string | null {
  const nearest = stones
    .filter((stone) => stone.color !== color && !excluded.some((point) => samePoint(point, stone)))
    .sort((left, right) => {
      const leftDistance = Math.abs(left.x - anchor.x) + Math.abs(left.y - anchor.y)
      const rightDistance = Math.abs(right.x - anchor.x) + Math.abs(right.y - anchor.y)
      return leftDistance - rightDistance || left.y - right.y || left.x - right.x
    })[0]
  return nearest ? pointToCoordinate(nearest, size) : null
}

function sourceLabel(size: BoardSize, candidate: CandidateMove | undefined, ownershipAvailable: boolean) {
  if (size < 9) return { kind: 'metaphor' as const, text: `Authored ${size}×${size} view · no KataGo claim` }
  if (candidate?.verified) return { kind: 'engine' as const, text: 'KataGo candidate + rules facts' }
  if (ownershipAvailable) return { kind: 'engine' as const, text: 'KataGo ownership + rules facts' }
  return { kind: 'metaphor' as const, text: 'Deterministic teaching view' }
}

function selectedSteps(
  size: BoardSize,
  stones: Stone[],
  toPlay: StoneColor,
  selected: Point,
  preview: MovePreview | null,
  candidate: CandidateMove | undefined,
): TeachingStep[] {
  const coordinate = pointToCoordinate(selected, size)
  if (!preview || !samePoint(preview.point, selected)) {
    return [
      { label: 'Place here', text: `${colorName(toPlay)} at ${coordinate}; the rules check is still running.` },
      { label: 'What changes', text: 'Wait for the legal result before reading the cloud as a preview.' },
      { label: 'Likely reply', text: 'Wait for the position-bound preview before reading a reply.' },
      { label: 'Do next', text: 'Keep this point selected until the preview finishes.' },
    ]
  }

  if (!preview.legal) {
    return [
      { label: 'Place here', text: `${coordinate} is not legal now.` },
      { label: 'What changes', text: preview.reason ?? 'The rules service rejected this move.' },
      { label: 'Likely reply', text: 'None—the stone cannot be placed.' },
      { label: 'Do next', text: 'Choose another empty intersection.' },
    ]
  }

  const exactChanges: string[] = []
  if (preview.captures.length) exactChanges.push(`captures ${preview.captures.length} stone${preview.captures.length === 1 ? '' : 's'}`)
  if (preview.resulting_liberties != null) exactChanges.push(`leaves the new string ${preview.resulting_liberties} libert${preview.resulting_liberties === 1 ? 'y' : 'ies'}`)
  const change = exactChanges.length
    ? `Rules check: it ${exactChanges.join(' and ')}. The ${toPlay === 'black' ? 'blue' : 'warm'} cloud grows most nearby, then fades.`
    : candidate?.summary
      ? `${candidate.summary} The cloud shows nearby presence, not secured points.`
      : `The ${toPlay === 'black' ? 'blue' : 'warm'} cloud grows most near ${coordinate}, then fades; it does not claim territory.`
  const nearestOpponent = nearestOpponentCoordinate(stones, toPlay, selected, size, preview.captures)
  const replyStep = candidate?.likely_reply
    ? { label: 'Likely reply', text: candidate.likely_reply }
    : {
        label: 'Likely reply',
        text: nearestOpponent
          ? `No reply line was supplied. Watch the nearest opposing stone at ${nearestOpponent}; check any reply that removes a liberty or cuts a connection.`
          : 'No reply line was supplied. After placing, watch for the opponent’s closest forcing approach before following up.',
      }

  return [
    { label: 'Place here', text: `${colorName(toPlay)} at ${coordinate}.` },
    { label: 'What changes', text: change },
    replyStep,
    { label: 'Do next', text: candidate?.risk ? `Before committing, check: ${candidate.risk}` : 'Compare one nearby point, then commit the clearer plan.' },
  ]
}

function currentSteps(
  size: BoardSize,
  stones: Stone[],
  toPlay: StoneColor,
  candidate: CandidateMove | undefined,
  lastMove: MoveRecord | null,
): TeachingStep[] {
  if (!stones.length) {
    const replyStep = candidate?.likely_reply
      ? { label: 'Likely reply', text: candidate.likely_reply }
      : {
          label: 'Response to watch',
          text: 'No reply line yet. Preview the point, then watch whether the opponent takes another open corner or approaches yours.',
        }
    return [
      {
        label: 'Place here',
        text: candidate
          ? `Try ${candidate.coordinate}: ${candidate.title}.`
          : 'Try a corner first; two board edges already help enclose space.',
      },
      {
        label: 'What changes',
        text: candidate?.summary ?? 'A corner stone reaches nearby points while asking for fewer walls than a center stone.',
      },
      replyStep,
      {
        label: 'Do next',
        text: candidate?.risk ? `Preview it, then check: ${candidate.risk}` : 'Preview one corner and one center point; compare the clouds.',
      },
    ]
  }

  const lastPoint = lastMove?.kind === 'play' ? lastMove.point ?? null : null
  const lastGroup = lastPoint ? groupAt(stones, lastPoint, size) : null
  const lastText = lastPoint && lastMove
    ? `${colorName(lastMove.color)} placed ${pointToCoordinate(lastPoint, size)}.`
    : `The last turn was ${lastMove?.kind ?? 'recorded'}.`
  const fact = lastGroup
    ? `That connected string has ${lastGroup.liberties.length} distinct libert${lastGroup.liberties.length === 1 ? 'y' : 'ies'}; its cloud is strongest nearby.`
    : 'The colored cloud shows which stones are nearby; it does not settle ownership.'

  return [
    { label: 'Last move', text: lastText },
    { label: 'What changes', text: fact },
    {
      label: candidate ? 'Reply to examine' : 'Response to find',
      text: candidate
        ? `${colorName(toPlay)} can examine ${candidate.coordinate}: ${candidate.summary}`
        : 'No position-bound reply is available; select a point to create a preview.',
    },
    {
      label: 'Do next',
      text: candidate
        ? `Select ${candidate.coordinate}${candidate.risk ? ` and check: ${candidate.risk}` : ' and compare its liberties before placing.'}`
        : 'Find the group with the fewest liberties, then preview a nearby move.',
    },
  ]
}

export function PowerTeacher({
  size,
  stones,
  toPlay,
  selected,
  preview,
  candidates,
  lastMove,
  ownershipAvailable,
}: PowerTeacherProps) {
  const selectedCandidate = candidateForPoint(candidates, selected)
  const candidate = selectedCandidate ?? candidates[0]
  const source = sourceLabel(size, selectedCandidate ?? (!selected ? candidate : undefined), ownershipAvailable)
  const steps = selected
    ? selectedSteps(size, stones, toPlay, selected, preview, selectedCandidate)
    : currentSteps(size, stones, toPlay, candidate, lastMove)

  return (
    <section className="power-teacher" data-testid="power-teacher" aria-labelledby="power-teacher-title">
      <header>
        <span className="power-teacher-icon" aria-hidden="true"><Lightbulb size={16} /></span>
        <div>
          <span className="eyebrow">Read this turn</span>
          <h3 id="power-teacher-title">One move, four questions</h3>
        </div>
        <span className="power-teacher-source"><EvidenceBadge kind={source.kind} /> {source.text}</span>
      </header>
      <ol className="power-teacher-steps">
        {steps.map((step, index) => (
          <li key={step.label}>
            <span className="step-number">{index + 1}</span>
            <div><strong>{step.label}</strong><p>{step.text}</p></div>
            {index < steps.length - 1 && <ArrowRight className="step-arrow" size={14} aria-hidden="true" />}
          </li>
        ))}
      </ol>
      <p className="power-memory"><b>Remember:</b> a cloud shows nearby possibility. Count liberties and read replies before calling anything yours.</p>
    </section>
  )
}
