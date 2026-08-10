import { ArrowRight, Lightbulb } from 'lucide-react'
import { groupAt, orthogonalNeighbors, pointToCoordinate, samePoint } from '../board'
import {
  candidateReasoning,
  candidateQualityComparison,
  scoreImpactSummary,
  tacticsSummary,
  variationSummary,
} from '../candidateEvidence'
import type { BoardSize, CandidateMove, MovePreview, MoveRecord, Point, Stone, StoneColor } from '../types'

interface PowerTeacherProps {
  size: BoardSize
  stones: Stone[]
  toPlay: StoneColor
  selected: Point | null
  preview: MovePreview | null
  activeCandidate?: CandidateMove | null
  candidates: CandidateMove[]
  lastMove: MoveRecord | null
  ownershipAvailable: boolean
}

type TeachingSource = 'Exact rules' | 'Engine estimate' | 'Lesson guidance' | 'Teacher interpretation'

interface TeachingSentence {
  text: string
  source: TeachingSource
}

interface TeachingStep {
  label: 'Play' | 'Because' | 'Changes' | 'Opponent' | 'Then check' | 'Principle'
  sentences: TeachingSentence[]
}

function colorName(color: StoneColor): string {
  return color === 'black' ? 'Black' : 'White'
}

function candidateForPoint(candidates: CandidateMove[], point: Point | null): CandidateMove | undefined {
  if (!point) return undefined
  return candidates.find((candidate) => candidate.point != null && samePoint(candidate.point, point))
}

function sourceClass(source: TeachingSource): string {
  return source.toLowerCase().replace(/\s+/g, '-')
}

function principleFor(candidate: CandidateMove, size: BoardSize): string {
  if (candidate.kind === 'pass' || candidate.point == null) {
    return 'Pass only when continuing looks smaller than stopping or giving priority away; it does not prove every group is settled.'
  }
  if (candidate.tactics?.self_atari || (candidate.tactics?.resulting_liberties != null && candidate.tactics.resulting_liberties <= 2)) {
    return 'A low liberty count is a warning; read the opponent’s forcing reply before taking broad profit.'
  }
  if (candidate.intent === 'escape' || candidate.tactics?.friendly_groups_escaped_atari) {
    return 'A group with few options narrows your plan. Add options, connect, or sacrifice it when that trade is better.'
  }
  if (candidate.intent === 'claim' || candidate.intent === 'settle') {
    const nearCorner = candidate.point.x <= 1 || candidate.point.y <= 1 || candidate.point.x >= size - 2 || candidate.point.y >= size - 2
    return nearCorner
      ? 'A corner can be efficient because two edges help, but first compare every concrete local danger.'
      : 'A settling move should create useful options now; location alone does not make a group safe.'
  }
  if (candidate.intent === 'pressure' || candidate.intent === 'reduce') {
    return 'Influence is useful only when it has a target or a realistic way to convert into safety, attack, or points.'
  }
  if (candidate.intent === 'connect') {
    return 'Connection is valuable when shared liberties and coordination outweigh the loss of speed.'
  }
  return 'Choose by comparing a forcing reply and your follow-up, not by how impressive one stone looks alone.'
}

function candidateSteps(
  size: BoardSize,
  toPlay: StoneColor,
  candidate: CandidateMove,
  topCandidate?: CandidateMove,
): TeachingStep[] {
  const reasoning = candidateReasoning(candidate)
  const pv = variationSummary(candidate, size)
  const changes: TeachingSentence[] = candidate.tactics
    ? [{ source: 'Exact rules', text: tacticsSummary(candidate.tactics, candidate.kind === 'pass' || candidate.point == null) }]
    : [{ source: 'Teacher interpretation', text: reasoning.changes }]
  if (candidate.score && candidate.engine_analyzed && size === 9) {
    changes.push({ source: 'Engine estimate', text: scoreImpactSummary(candidate.score, toPlay) })
  }
  const because: TeachingSentence[] = [{ source: 'Teacher interpretation', text: reasoning.why }]
  const engineRank = candidate.evaluation?.order != null ? candidate.evaluation.order + 1 : null
  const qualityComparison = candidateQualityComparison(candidate, topCandidate, toPlay)
  if (size === 9 && candidate.engine_analyzed && engineRank != null) {
    because.push({
      source: 'Engine estimate',
      text: `KataGo ranks ${candidate.coordinate} #${engineRank}${candidate.evaluation?.visits != null ? `; this child received ${candidate.evaluation.visits.toLocaleString()} visits` : ''}.`,
    })
  }
  if (size === 9 && candidate.engine_analyzed && qualityComparison) {
    because.push({
      source: 'Engine estimate',
      text: qualityComparison,
    })
  }

  const opponent = pv
    ? [{
        source: candidate.engine_analyzed && size === 9 ? 'Engine estimate' as const : 'Teacher interpretation' as const,
        text: `${candidate.engine_analyzed && size === 9 ? 'One engine main line (not forced)' : 'One authored line to examine'}: ${pv}`,
      }]
    : candidate.main_line_reply
      ? [{
          source: candidate.engine_analyzed && size === 9 ? 'Engine estimate' as const : 'Teacher interpretation' as const,
          text: `${candidate.engine_analyzed && size === 9 ? 'Reply in one engine line (not forced)' : 'Reply to examine'}: ${candidate.main_line_reply}`,
        }]
      : [{ source: 'Teacher interpretation' as const, text: 'No reply line was supplied. Check the opponent’s most forcing capture, cut, or liberty-reducing move.' }]

  return [
    { label: 'Play', sentences: [{ source: 'Lesson guidance', text: `${colorName(toPlay)} ${candidate.coordinate}: ${candidate.title}.` }] },
    { label: 'Because', sentences: because },
    { label: 'Changes', sentences: changes },
    { label: 'Opponent', sentences: opponent },
    { label: 'Then check', sentences: [{ source: 'Teacher interpretation', text: reasoning.next }] },
    { label: 'Principle', sentences: [{ source: 'Lesson guidance', text: principleFor(candidate, size) }] },
  ]
}

function selectedSteps(
  size: BoardSize,
  stones: Stone[],
  toPlay: StoneColor,
  selected: Point,
  preview: MovePreview | null,
): TeachingStep[] {
  const coordinate = pointToCoordinate(selected, size)
  if (!preview || !samePoint(preview.point, selected)) {
    return [
      { label: 'Play', sentences: [{ source: 'Lesson guidance', text: `Inspect ${colorName(toPlay)} at ${coordinate}; nothing has been placed.` }] },
      { label: 'Because', sentences: [{ source: 'Teacher interpretation', text: 'Hold the question until the rules preview returns.' }] },
      { label: 'Changes', sentences: [{ source: 'Exact rules', text: 'The legal result is still pending, so no capture or liberty claim is made.' }] },
      { label: 'Opponent', sentences: [{ source: 'Teacher interpretation', text: 'Wait for position-bound evidence before reading a reply.' }] },
      { label: 'Then check', sentences: [{ source: 'Lesson guidance', text: 'Keep this point selected until the preview finishes.' }] },
      { label: 'Principle', sentences: [{ source: 'Lesson guidance', text: 'Verify first; explain second.' }] },
    ]
  }

  if (!preview.legal) {
    return [
      { label: 'Play', sentences: [{ source: 'Exact rules', text: `${coordinate} is not legal now.` }] },
      { label: 'Because', sentences: [{ source: 'Exact rules', text: preview.reason ?? 'The rules service rejected this move.' }] },
      { label: 'Changes', sentences: [{ source: 'Exact rules', text: 'No stone is placed and the board does not change.' }] },
      { label: 'Opponent', sentences: [{ source: 'Exact rules', text: 'There is no reply to an illegal move.' }] },
      { label: 'Then check', sentences: [{ source: 'Lesson guidance', text: 'Choose another empty intersection.' }] },
      { label: 'Principle', sentences: [{ source: 'Lesson guidance', text: 'A strategic idea matters only after legality is settled.' }] },
    ]
  }

  const exactChanges: string[] = []
  if (preview.captures.length) exactChanges.push(`captures ${preview.captures.length} stone${preview.captures.length === 1 ? '' : 's'}`)
  if (preview.resulting_liberties != null) exactChanges.push(`leaves the new string ${preview.resulting_liberties} libert${preview.resulting_liberties === 1 ? 'y' : 'ies'}`)
  const adjacentGroups = orthogonalNeighbors(selected, size)
    .map((neighbor) => groupAt(stones, neighbor, size))
    .filter((group): group is NonNullable<typeof group> => group != null)
  const fewestAdjacentLiberties = adjacentGroups.length
    ? Math.min(...adjacentGroups.map((group) => group.liberties.length))
    : null
  return [
    { label: 'Play', sentences: [{ source: 'Exact rules', text: `${colorName(toPlay)} can legally play ${coordinate}; the stone is still only a preview.` }] },
    { label: 'Because', sentences: [{ source: 'Teacher interpretation', text: 'Name the job this move should do before judging it.' }] },
    { label: 'Changes', sentences: [{ source: 'Exact rules', text: exactChanges.length ? `It ${exactChanges.join(' and ')}.` : 'No capture was reported; compare the resulting liberties and connections.' }] },
    { label: 'Opponent', sentences: [{ source: 'Teacher interpretation', text: 'No engine line is attached. Check the opponent’s most forcing capture, cut, or liberty reduction.' }] },
    { label: 'Then check', sentences: [{ source: 'Teacher interpretation', text: fewestAdjacentLiberties != null ? `The adjacent group with the fewest current liberties has ${fewestAdjacentLiberties}; check whether it is actually urgent before comparing the preview’s ${preview.resulting_liberties ?? 'unreported'} liberties.` : 'Compare a concrete local reply before a broad follow-up.' }] },
    { label: 'Principle', sentences: [{ source: 'Lesson guidance', text: 'A group in atari is urgent; otherwise compare the concrete cost of answering now or later.' }] },
  ]
}

function currentSteps(
  size: BoardSize,
  stones: Stone[],
  toPlay: StoneColor,
  candidate: CandidateMove | undefined,
  lastMove: MoveRecord | null,
): TeachingStep[] {
  if (candidate) return candidateSteps(size, toPlay, candidate, candidate)
  const lastPoint = lastMove?.kind === 'play' ? lastMove.point ?? null : null
  const lastGroup = lastPoint ? groupAt(stones, lastPoint, size) : null
  return [
    { label: 'Play', sentences: [{ source: 'Lesson guidance', text: 'Select a candidate or an empty intersection; inspection never places a stone.' }] },
    { label: 'Because', sentences: [{ source: 'Lesson guidance', text: 'First find the group with the fewest liberties and ask whether it is urgent.' }] },
    { label: 'Changes', sentences: [{ source: 'Exact rules', text: lastGroup ? `The last move’s connected string has ${lastGroup.liberties.length} distinct liberties.` : 'No candidate-specific rules result is available yet.' }] },
    { label: 'Opponent', sentences: [{ source: 'Teacher interpretation', text: 'Look for capture, cut, atari, or a move that takes away your follow-up.' }] },
    { label: 'Then check', sentences: [{ source: 'Lesson guidance', text: 'Compare at least two candidates against the same forcing reply.' }] },
    { label: 'Principle', sentences: [{ source: 'Lesson guidance', text: 'Corners can be efficient, but urgency and whole-board direction decide when.' }] },
  ]
}

export function PowerTeacher({
  size,
  stones,
  toPlay,
  selected,
  preview,
  activeCandidate,
  candidates,
  lastMove,
  ownershipAvailable,
}: PowerTeacherProps) {
  const selectedCandidate = candidateForPoint(candidates, selected)
  const candidate = activeCandidate ?? selectedCandidate ?? (!selected ? candidates[0] : undefined)
  const steps = candidate
    ? candidateSteps(size, toPlay, candidate, candidates.find((item) => item.evaluation?.order === 0))
    : selected
      ? selectedSteps(size, stones, toPlay, selected, preview)
      : currentSteps(size, stones, toPlay, undefined, lastMove)
  const evidenceMode = size < 9
    ? `Authored ${size}×${size} view · no KataGo claim`
    : candidate
      ? candidate.engine_analyzed
        ? 'Rules + labeled engine forecasts'
        : 'Rules + teacher interpretation · no candidate engine claim'
      : ownershipAvailable
        ? 'Current-position ownership forecast + rules'
        : 'Rules + teacher interpretation'

  return (
    <section
      className="power-teacher"
      data-testid="power-teacher"
      data-active-candidate={candidate?.id ?? 'none'}
      aria-labelledby="power-teacher-title"
    >
      <header>
        <span className="power-teacher-icon" aria-hidden="true"><Lightbulb size={16} /></span>
        <div>
          <span className="eyebrow">Reason through this turn</span>
          <h3 id="power-teacher-title">From choice to next calculation</h3>
        </div>
        <span className="power-teacher-source">{evidenceMode}</span>
      </header>
      <ol className="power-teacher-steps">
        {steps.map((step, index) => (
          <li key={step.label}>
            <span className="step-number">{index + 1}</span>
            <div>
              <strong>{step.label}</strong>
              {step.sentences.map((sentence, sentenceIndex) => (
                <p key={`${sentence.source}-${sentenceIndex}`}>
                  <span className={`teaching-source ${sourceClass(sentence.source)}`}>{sentence.source}</span>
                  {sentence.text}
                </p>
              ))}
            </div>
            {index < steps.length - 1 && <ArrowRight className="step-arrow" size={14} aria-hidden="true" />}
          </li>
        ))}
      </ol>
      <p className="power-memory"><b>Remember:</b> exact rules facts, engine forecasts, and teacher interpretation answer different questions. A forecast is not territory already yours.</p>
    </section>
  )
}
