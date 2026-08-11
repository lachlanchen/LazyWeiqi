import { pointToCoordinate } from './board'
import { localizeAuthoredTemplate, localizeAuthoredText } from './authoredCopy'
import { translate, type Locale } from './i18n'
import type {
  BoardSize,
  CandidateEvaluation,
  CandidateMove,
  CandidateScoreImpact,
  CandidateTactics,
  StoneColor,
} from './types'

function colorName(color: StoneColor, locale: Locale = 'en'): string {
  return translate(locale, color === 'black' ? 'board.black' : 'board.white')
}

function opponent(color: StoneColor): StoneColor {
  return color === 'black' ? 'white' : 'black'
}

function finite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function sentencePeriod(locale: Locale): string {
  return locale === 'ja' || locale === 'zh-Hans' || locale === 'zh-Hant' ? '。' : '.'
}

function clauseSeparator(locale: Locale): string {
  if (locale === 'ja') return '。'
  if (locale === 'zh-Hans' || locale === 'zh-Hant') return '；'
  if (locale === 'ar') return '؛ '
  return '; '
}

export function signedPoints(value: number): string {
  const normalized = Math.abs(value) < 0.05 ? 0 : value
  return `${normalized >= 0 ? '+' : '−'}${Math.abs(normalized).toFixed(1)}`
}

export function leadLabel(value: number, perspective: StoneColor, locale: Locale = 'en'): string {
  if (Math.abs(value) < 0.05) return localizeAuthoredText(locale, 'Even')
  const leader = value > 0 ? perspective : opponent(perspective)
  return `${colorName(leader, locale)} +${Math.abs(value).toFixed(1)}`
}

export function scoreImpactSummary(score: CandidateScoreImpact, mover?: StoneColor, locale: Locale = 'en'): string {
  const fixedPerspective = localizeAuthoredTemplate(
    locale,
    'Current-position smoothed final-score forecast: {before}. Candidate-child forecast: {after}. Search difference {delta} from the {perspective} perspective; this is not points earned by one stone.',
    {
      before: leadLabel(score.before, score.perspective, locale),
      after: leadLabel(score.after, score.perspective, locale),
      delta: signedPoints(score.delta),
      perspective: colorName(score.perspective, locale),
    },
  )
  if (!mover || !finite(score.mover_delta)) return fixedPerspective
  return `${fixedPerspective} ${localizeAuthoredTemplate(
    locale,
    'For {mover} as the mover, the signed forecast change is {delta}.',
    { mover: colorName(mover, locale), delta: signedPoints(score.mover_delta) },
  )}`
}

export function scoreVolatilitySummary(score: CandidateScoreImpact, locale: Locale = 'en'): string {
  const before = score.outcome_spread_before
  const after = score.outcome_spread_after
  if (finite(before) && finite(after)) {
    return localizeAuthoredTemplate(
      locale,
      'Predicted final-score spread {before} before, {after} after. KataGo notes this value is biased high; use it only as relative search volatility, not a score error bar.',
      { before: before.toFixed(1), after: after.toFixed(1) },
    )
  }
  if (finite(after)) {
    return localizeAuthoredTemplate(
      locale,
      'Predicted final-score spread {after} after. KataGo notes this value is biased high; use it only as relative search volatility, not a score error bar.',
      { after: after.toFixed(1) },
    )
  }
  return localizeAuthoredText(locale, 'Final-score spread was not supplied.')
}

function percent(value: number): string {
  const percentage = Math.abs(value) <= 1 ? value * 100 : value
  return `${percentage.toFixed(1)}%`
}

export function evaluationSummary(evaluation: CandidateEvaluation, locale: Locale = 'en'): string | null {
  if (finite(evaluation.winrate_before) && finite(evaluation.winrate_after)) {
    const visits = finite(evaluation.visits) ? evaluation.visits.toLocaleString(locale) : null
    const estimate = localizeAuthoredTemplate(locale, '{color} win-rate estimate {before} → {after}', {
      color: colorName(evaluation.perspective, locale),
      before: percent(evaluation.winrate_before),
      after: percent(evaluation.winrate_after),
    })
    const visitClause = visits
      ? `${clauseSeparator(locale)}${localizeAuthoredTemplate(locale, 'this child received {visits} visits', { visits })}`
      : ''
    return `${estimate}${visitClause}${sentencePeriod(locale)}`
  }
  if (finite(evaluation.winrate_after)) {
    const visits = finite(evaluation.visits) ? evaluation.visits.toLocaleString(locale) : null
    const estimate = localizeAuthoredTemplate(locale, '{color} win-rate estimate {after}', {
      color: colorName(evaluation.perspective, locale),
      after: percent(evaluation.winrate_after),
    })
    const visitClause = visits
      ? `${clauseSeparator(locale)}${localizeAuthoredTemplate(locale, 'this child received {visits} visits', { visits })}`
      : ''
    return `${estimate}${visitClause}${sentencePeriod(locale)}`
  }
  if (!finite(evaluation.visits)) return null
  const visits = evaluation.visits.toLocaleString(locale)
  return localizeAuthoredTemplate(locale, 'This candidate child received {visits} engine visits.', { visits })
}

export function candidateQualityComparison(
  candidate: CandidateMove,
  topCandidate: CandidateMove | undefined,
  mover: StoneColor,
  locale: Locale = 'en',
): string | null {
  if (!topCandidate || topCandidate.id === candidate.id) return null
  const moverName = colorName(mover, locale)
  const difference = candidate.score?.difference_from_top
  if (finite(difference)) {
    if (difference < -0.05) {
      return localizeAuthoredTemplate(locale, 'For {mover}, the score forecast is about {points} points below {coordinate} in the same search.', {
        mover: moverName,
        points: Math.abs(difference).toFixed(1),
        coordinate: topCandidate.coordinate,
      })
    }
    if (difference > 0.05) {
      return localizeAuthoredTemplate(locale, 'For {mover}, the score forecast is about {points} points above {coordinate}, although KataGo ranks this move lower by its overall selection value.', {
        mover: moverName,
        points: difference.toFixed(1),
        coordinate: topCandidate.coordinate,
      })
    }
    return localizeAuthoredTemplate(locale, 'For {mover}, the score forecast is roughly equal to {coordinate}; KataGo’s overall selection value still orders the moves.', {
      mover: moverName,
      coordinate: topCandidate.coordinate,
    })
  }
  const loss = candidate.score?.loss_vs_top
  if (finite(loss) && loss > 0.05) {
    return localizeAuthoredTemplate(locale, 'For {mover}, the score forecast is about {points} points below {coordinate} in the same search.', {
      mover: moverName,
      points: loss.toFixed(1),
      coordinate: topCandidate.coordinate,
    })
  }
  return null
}

export function tacticsSummary(tactics: CandidateTactics, isPass = false, locale: Locale = 'en'): string {
  if (isPass) {
    return tactics.ends_play
      ? localizeAuthoredText(locale, 'This is the second consecutive pass: it places no stone, captures nothing, and ends play.')
      : localizeAuthoredText(locale, 'Pass places no stone or captures; the opponent moves next, and another consecutive pass would end play.')
  }
  const facts: string[] = []
  if (tactics.captures.length) {
    facts.push(localizeAuthoredTemplate(locale, 'captures {count}', { count: tactics.captures.length }))
  }
  if (tactics.resulting_liberties != null) {
    const english = tactics.resulting_liberties === 1 ? '{count} resulting liberty' : '{count} resulting liberties'
    const source = locale === 'en' ? english : '{count} resulting liberties'
    facts.push(localizeAuthoredTemplate(locale, source, { count: tactics.resulting_liberties }))
  }
  if (tactics.friendly_groups_joined) {
    const english = tactics.friendly_groups_joined === 1 ? 'joins {count} friendly group' : 'joins {count} friendly groups'
    const source = locale === 'en' ? english : 'joins {count} friendly groups'
    facts.push(localizeAuthoredTemplate(locale, source, { count: tactics.friendly_groups_joined }))
  }
  if (tactics.opponent_groups_newly_in_atari) {
    const english = tactics.opponent_groups_newly_in_atari === 1
      ? 'puts {count} opposing group in atari'
      : 'puts {count} opposing groups in atari'
    const source = locale === 'en' ? english : 'puts {count} opposing group(s) in atari'
    facts.push(localizeAuthoredTemplate(locale, source, { count: tactics.opponent_groups_newly_in_atari }))
  }
  if (tactics.friendly_groups_escaped_atari) {
    const english = tactics.friendly_groups_escaped_atari === 1
      ? 'releases {count} friendly group from atari'
      : 'releases {count} friendly groups from atari'
    const source = locale === 'en' ? english : 'releases {count} friendly group(s) from atari'
    facts.push(localizeAuthoredTemplate(locale, source, { count: tactics.friendly_groups_escaped_atari }))
  }
  if (tactics.cuts.length) {
    const english = tactics.cuts.length === 1
      ? 'blocks {count} nearby opponent connection anchor'
      : 'blocks {count} nearby opponent connection anchors'
    const source = locale === 'en' ? english : 'blocks {count} nearby opponent connection anchor(s)'
    facts.push(localizeAuthoredTemplate(locale, source, { count: tactics.cuts.length }))
  }
  if (tactics.self_atari) facts.push(localizeAuthoredText(locale, 'self-atari warning'))
  return `${facts.join(clauseSeparator(locale))}${sentencePeriod(locale)}`
}

export function variationSummary(candidate: CandidateMove, size: BoardSize, locale: Locale = 'en'): string | null {
  if (!candidate.variation?.length) return null
  return candidate.variation
    .map((move, index) => `${index + 1}. ${colorName(move.color, locale)} ${move.point ? pointToCoordinate(move.point, size) : translate(locale, 'play.pass')}`)
    .join(' · ')
}

export function candidateReasoning(candidate: CandidateMove, locale: Locale = 'en'): {
  why: string
  changes: string
  next: string
} {
  return {
    why: candidate.why_here?.trim() || `${candidate.title}. ${candidate.summary}`,
    changes: candidate.what_changes?.trim() || (candidate.tactics ? tacticsSummary(candidate.tactics, candidate.kind === 'pass' || candidate.point == null, locale) : candidate.summary),
    next: candidate.next_calculation?.trim() || candidate.risk?.trim() || candidate.main_line_reply?.trim()
      || localizeAuthoredText(locale, 'Compare the opponent’s most forcing reply before choosing.'),
  }
}
