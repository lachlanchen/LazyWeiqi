import { pointToCoordinate } from './board'
import type {
  BoardSize,
  CandidateEvaluation,
  CandidateMove,
  CandidateScoreImpact,
  CandidateTactics,
  StoneColor,
} from './types'

function colorName(color: StoneColor): string {
  return color === 'black' ? 'Black' : 'White'
}

function opponent(color: StoneColor): StoneColor {
  return color === 'black' ? 'white' : 'black'
}

function finite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function signedPoints(value: number): string {
  const normalized = Math.abs(value) < 0.05 ? 0 : value
  return `${normalized >= 0 ? '+' : '−'}${Math.abs(normalized).toFixed(1)}`
}

export function leadLabel(value: number, perspective: StoneColor): string {
  if (Math.abs(value) < 0.05) return 'Even'
  const leader = value > 0 ? perspective : opponent(perspective)
  return `${colorName(leader)} +${Math.abs(value).toFixed(1)}`
}

export function scoreImpactSummary(score: CandidateScoreImpact, mover?: StoneColor): string {
  const fixedPerspective = `Current-position smoothed final-score forecast: ${leadLabel(score.before, score.perspective)}. Candidate-child forecast: ${leadLabel(score.after, score.perspective)}. Search difference ${signedPoints(score.delta)} from the ${colorName(score.perspective)} perspective; this is not points earned by one stone.`
  if (!mover || !finite(score.mover_delta)) return fixedPerspective
  return `${fixedPerspective} For ${colorName(mover)} as the mover, the signed forecast change is ${signedPoints(score.mover_delta)}.`
}

export function scoreVolatilitySummary(score: CandidateScoreImpact): string {
  const before = score.outcome_spread_before
  const after = score.outcome_spread_after
  if (finite(before) && finite(after)) {
    return `Predicted final-score spread ${before.toFixed(1)} before, ${after.toFixed(1)} after. KataGo notes this value is biased high; use it only as relative search volatility, not a score error bar.`
  }
  if (finite(after)) return `Predicted final-score spread ${after.toFixed(1)} after. KataGo notes this value is biased high; use it only as relative search volatility, not a score error bar.`
  return 'Final-score spread was not supplied.'
}

function percent(value: number): string {
  const percentage = Math.abs(value) <= 1 ? value * 100 : value
  return `${percentage.toFixed(1)}%`
}

export function evaluationSummary(evaluation: CandidateEvaluation): string | null {
  if (finite(evaluation.winrate_before) && finite(evaluation.winrate_after)) {
    return `${colorName(evaluation.perspective)} win-rate estimate ${percent(evaluation.winrate_before)} → ${percent(evaluation.winrate_after)}${finite(evaluation.visits) ? `; this child received ${evaluation.visits.toLocaleString()} visits` : ''}.`
  }
  if (finite(evaluation.winrate_after)) {
    return `${colorName(evaluation.perspective)} win-rate estimate ${percent(evaluation.winrate_after)}${finite(evaluation.visits) ? `; this child received ${evaluation.visits.toLocaleString()} visits` : ''}.`
  }
  return finite(evaluation.visits) ? `This candidate child received ${evaluation.visits.toLocaleString()} engine visits.` : null
}

export function candidateQualityComparison(
  candidate: CandidateMove,
  topCandidate: CandidateMove | undefined,
  mover: StoneColor,
): string | null {
  if (!topCandidate || topCandidate.id === candidate.id) return null
  const moverName = colorName(mover)
  const difference = candidate.score?.difference_from_top
  if (finite(difference)) {
    if (difference < -0.05) {
      return `For ${moverName}, the score forecast is about ${Math.abs(difference).toFixed(1)} points below ${topCandidate.coordinate} in the same search.`
    }
    if (difference > 0.05) {
      return `For ${moverName}, the score forecast is about ${difference.toFixed(1)} points above ${topCandidate.coordinate}, although KataGo ranks this move lower by its overall selection value.`
    }
    return `For ${moverName}, the score forecast is roughly equal to ${topCandidate.coordinate}; KataGo’s overall selection value still orders the moves.`
  }
  const loss = candidate.score?.loss_vs_top
  if (finite(loss) && loss > 0.05) {
    return `For ${moverName}, the score forecast is about ${loss.toFixed(1)} points below ${topCandidate.coordinate} in the same search.`
  }
  return null
}

export function tacticsSummary(tactics: CandidateTactics, isPass = false): string {
  if (isPass) {
    return tactics.ends_play
      ? 'This is the second consecutive pass: it places no stone, captures nothing, and ends play.'
      : 'Pass places no stone or captures; the opponent moves next, and another consecutive pass would end play.'
  }
  const facts: string[] = []
  if (tactics.captures.length) facts.push(`captures ${tactics.captures.length}`)
  if (tactics.resulting_liberties != null) {
    facts.push(`${tactics.resulting_liberties} resulting libert${tactics.resulting_liberties === 1 ? 'y' : 'ies'}`)
  }
  if (tactics.friendly_groups_joined) facts.push(`joins ${tactics.friendly_groups_joined} friendly groups`)
  if (tactics.opponent_groups_newly_in_atari) facts.push(`puts ${tactics.opponent_groups_newly_in_atari} opposing group${tactics.opponent_groups_newly_in_atari === 1 ? '' : 's'} in atari`)
  if (tactics.friendly_groups_escaped_atari) facts.push(`releases ${tactics.friendly_groups_escaped_atari} friendly group${tactics.friendly_groups_escaped_atari === 1 ? '' : 's'} from atari`)
  if (tactics.cuts.length) facts.push(`blocks ${tactics.cuts.length} nearby opponent connection anchor${tactics.cuts.length === 1 ? '' : 's'}`)
  if (tactics.self_atari) facts.push('self-atari warning')
  return `${facts.join('; ')}.`
}

export function variationSummary(candidate: CandidateMove, size: BoardSize): string | null {
  if (!candidate.variation?.length) return null
  return candidate.variation
    .map((move, index) => `${index + 1}. ${colorName(move.color)} ${move.point ? pointToCoordinate(move.point, size) : 'pass'}`)
    .join(' · ')
}

export function candidateReasoning(candidate: CandidateMove): {
  why: string
  changes: string
  next: string
} {
  return {
    why: candidate.why_here?.trim() || `${candidate.title}. ${candidate.summary}`,
    changes: candidate.what_changes?.trim() || (candidate.tactics ? tacticsSummary(candidate.tactics, candidate.kind === 'pass' || candidate.point == null) : candidate.summary),
    next: candidate.next_calculation?.trim() || candidate.risk?.trim() || candidate.main_line_reply?.trim() || 'Compare the opponent’s most forcing reply before choosing.',
  }
}
