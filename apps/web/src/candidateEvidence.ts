import { pointToCoordinate } from './board'
import type { Locale } from './i18n'
import type {
  BoardSize,
  CandidateEvaluation,
  CandidateMove,
  CandidateScoreImpact,
  CandidateTactics,
  StoneColor,
} from './types'

function colorName(color: StoneColor, locale: Locale = 'en'): string {
  if (locale === 'zh-Hans') return color === 'black' ? '黑棋' : '白棋'
  if (locale === 'ja') return color === 'black' ? '黒' : '白'
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

export function leadLabel(value: number, perspective: StoneColor, locale: Locale = 'en'): string {
  if (Math.abs(value) < 0.05) return locale === 'zh-Hans' ? '平衡' : locale === 'ja' ? '互角' : 'Even'
  const leader = value > 0 ? perspective : opponent(perspective)
  return `${colorName(leader, locale)} +${Math.abs(value).toFixed(1)}`
}

export function scoreImpactSummary(score: CandidateScoreImpact, mover?: StoneColor, locale: Locale = 'en'): string {
  const fixedPerspective = locale === 'zh-Hans'
    ? `当前局面的平滑最终目数预测：${leadLabel(score.before, score.perspective, locale)}。候选子局面预测：${leadLabel(score.after, score.perspective, locale)}。以${colorName(score.perspective, locale)}为视角，搜索差值为 ${signedPoints(score.delta)}；这不是一枚棋子直接赚得的目数。`
    : locale === 'ja'
      ? `現在局面の平滑化された最終得点予測：${leadLabel(score.before, score.perspective, locale)}。候補の子局面予測：${leadLabel(score.after, score.perspective, locale)}。${colorName(score.perspective, locale)}視点の探索差は ${signedPoints(score.delta)}。これは 1 手が直接稼いだ得点ではありません。`
      : `Current-position smoothed final-score forecast: ${leadLabel(score.before, score.perspective)}. Candidate-child forecast: ${leadLabel(score.after, score.perspective)}. Search difference ${signedPoints(score.delta)} from the ${colorName(score.perspective)} perspective; this is not points earned by one stone.`
  if (!mover || !finite(score.mover_delta)) return fixedPerspective
  if (locale === 'zh-Hans') return `${fixedPerspective} 对落子方${colorName(mover, locale)}而言，带符号的预测变化为 ${signedPoints(score.mover_delta)}。`
  if (locale === 'ja') return `${fixedPerspective} 着手側の${colorName(mover, locale)}にとって、符号付き予測変化は ${signedPoints(score.mover_delta)} です。`
  return `${fixedPerspective} For ${colorName(mover)} as the mover, the signed forecast change is ${signedPoints(score.mover_delta)}.`
}

export function scoreVolatilitySummary(score: CandidateScoreImpact, locale: Locale = 'en'): string {
  const before = score.outcome_spread_before
  const after = score.outcome_spread_after
  if (finite(before) && finite(after)) {
    if (locale === 'zh-Hans') return `预测最终目数分散度：着前 ${before.toFixed(1)}，着后 ${after.toFixed(1)}。KataGo 说明此值偏高；只把它用作相对搜索波动，不要当作比分误差条。`
    if (locale === 'ja') return `最終得点の予測幅：着手前 ${before.toFixed(1)}、着手後 ${after.toFixed(1)}。KataGo はこの値が高めに偏ると注記しています。得点の誤差帯ではなく、相対的な探索変動として使います。`
    return `Predicted final-score spread ${before.toFixed(1)} before, ${after.toFixed(1)} after. KataGo notes this value is biased high; use it only as relative search volatility, not a score error bar.`
  }
  if (finite(after)) {
    if (locale === 'zh-Hans') return `着后预测最终目数分散度为 ${after.toFixed(1)}。KataGo 说明此值偏高；只用作相对搜索波动。`
    if (locale === 'ja') return `着手後の最終得点予測幅は ${after.toFixed(1)}。KataGo はこの値が高めに偏ると注記しています。`
    return `Predicted final-score spread ${after.toFixed(1)} after. KataGo notes this value is biased high; use it only as relative search volatility, not a score error bar.`
  }
  return locale === 'zh-Hans' ? '未提供最终目数分散度。' : locale === 'ja' ? '最終得点の幅は提供されていません。' : 'Final-score spread was not supplied.'
}

function percent(value: number): string {
  const percentage = Math.abs(value) <= 1 ? value * 100 : value
  return `${percentage.toFixed(1)}%`
}

export function evaluationSummary(evaluation: CandidateEvaluation, locale: Locale = 'en'): string | null {
  if (finite(evaluation.winrate_before) && finite(evaluation.winrate_after)) {
    const visits = finite(evaluation.visits) ? evaluation.visits.toLocaleString(locale) : null
    if (locale === 'zh-Hans') return `${colorName(evaluation.perspective, locale)}胜率估计 ${percent(evaluation.winrate_before)} → ${percent(evaluation.winrate_after)}${visits ? `；该子局面获得 ${visits} 次访问` : ''}。`
    if (locale === 'ja') return `${colorName(evaluation.perspective, locale)}の勝率推定 ${percent(evaluation.winrate_before)} → ${percent(evaluation.winrate_after)}${visits ? `。この分岐の訪問回数は ${visits} 回` : ''}。`
    return `${colorName(evaluation.perspective)} win-rate estimate ${percent(evaluation.winrate_before)} → ${percent(evaluation.winrate_after)}${visits ? `; this child received ${visits} visits` : ''}.`
  }
  if (finite(evaluation.winrate_after)) {
    const visits = finite(evaluation.visits) ? evaluation.visits.toLocaleString(locale) : null
    if (locale === 'zh-Hans') return `${colorName(evaluation.perspective, locale)}胜率估计 ${percent(evaluation.winrate_after)}${visits ? `；该子局面获得 ${visits} 次访问` : ''}。`
    if (locale === 'ja') return `${colorName(evaluation.perspective, locale)}の勝率推定 ${percent(evaluation.winrate_after)}${visits ? `。この分岐の訪問回数は ${visits} 回` : ''}。`
    return `${colorName(evaluation.perspective)} win-rate estimate ${percent(evaluation.winrate_after)}${visits ? `; this child received ${visits} visits` : ''}.`
  }
  if (!finite(evaluation.visits)) return null
  const visits = evaluation.visits.toLocaleString(locale)
  return locale === 'zh-Hans' ? `该候选子局面获得 ${visits} 次引擎访问。` : locale === 'ja' ? `この候補の子局面は ${visits} 回エンジンに読まれました。` : `This candidate child received ${visits} engine visits.`
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
      return locale === 'zh-Hans' ? `对${moverName}而言，同一次搜索中的目数预测约比 ${topCandidate.coordinate} 低 ${Math.abs(difference).toFixed(1)} 目。` : locale === 'ja' ? `${moverName}にとって、同じ探索の得点予測は ${topCandidate.coordinate} より約 ${Math.abs(difference).toFixed(1)} 目低い。` : `For ${moverName}, the score forecast is about ${Math.abs(difference).toFixed(1)} points below ${topCandidate.coordinate} in the same search.`
    }
    if (difference > 0.05) {
      return locale === 'zh-Hans' ? `对${moverName}而言，目数预测约比 ${topCandidate.coordinate} 高 ${difference.toFixed(1)} 目，但 KataGo 仍按整体选择价值把这手排在后面。` : locale === 'ja' ? `${moverName}にとって得点予測は ${topCandidate.coordinate} より約 ${difference.toFixed(1)} 目高いものの、KataGo の総合選択価値では順位が下です。` : `For ${moverName}, the score forecast is about ${difference.toFixed(1)} points above ${topCandidate.coordinate}, although KataGo ranks this move lower by its overall selection value.`
    }
    return locale === 'zh-Hans' ? `对${moverName}而言，目数预测与 ${topCandidate.coordinate} 大致相当；KataGo 仍使用整体选择价值排序。` : locale === 'ja' ? `${moverName}にとって得点予測は ${topCandidate.coordinate} とほぼ同じですが、KataGo の総合選択価値で順序が決まります。` : `For ${moverName}, the score forecast is roughly equal to ${topCandidate.coordinate}; KataGo’s overall selection value still orders the moves.`
  }
  const loss = candidate.score?.loss_vs_top
  if (finite(loss) && loss > 0.05) {
    return locale === 'zh-Hans' ? `对${moverName}而言，同一次搜索中的目数预测约比 ${topCandidate.coordinate} 低 ${loss.toFixed(1)} 目。` : locale === 'ja' ? `${moverName}にとって、同じ探索の得点予測は ${topCandidate.coordinate} より約 ${loss.toFixed(1)} 目低い。` : `For ${moverName}, the score forecast is about ${loss.toFixed(1)} points below ${topCandidate.coordinate} in the same search.`
  }
  return null
}

export function tacticsSummary(tactics: CandidateTactics, isPass = false, locale: Locale = 'en'): string {
  if (isPass) {
    if (locale === 'zh-Hans') return tactics.ends_play ? '这是连续第二次停一手：不落子、不提子，并结束对局。' : '停一手不落子也不提子；轮到对手，如果再连续停一手就结束对局。'
    if (locale === 'ja') return tactics.ends_play ? '2 回目の連続パスです：石を打たず、取りもなく、終局します。' : 'パスは石を打たず、取りもありません。次は相手で、もう 1 回連続パスで終局します。'
    return tactics.ends_play
      ? 'This is the second consecutive pass: it places no stone, captures nothing, and ends play.'
      : 'Pass places no stone or captures; the opponent moves next, and another consecutive pass would end play.'
  }
  const facts: string[] = []
  if (locale !== 'en') {
    const zh = locale === 'zh-Hans'
    if (tactics.captures.length) facts.push(zh ? `提 ${tactics.captures.length} 子` : `${tactics.captures.length} 子を取る`)
    if (tactics.resulting_liberties != null) facts.push(zh ? `结果有 ${tactics.resulting_liberties} 口气` : `結果は ${tactics.resulting_liberties} ダメ`)
    if (tactics.friendly_groups_joined) facts.push(zh ? `连起 ${tactics.friendly_groups_joined} 块友军` : `${tactics.friendly_groups_joined} つの味方の一団をつなぐ`)
    if (tactics.opponent_groups_newly_in_atari) facts.push(zh ? `使 ${tactics.opponent_groups_newly_in_atari} 块对方棋被叫吃` : `${tactics.opponent_groups_newly_in_atari} つの相手の一団をアタリにする`)
    if (tactics.friendly_groups_escaped_atari) facts.push(zh ? `让 ${tactics.friendly_groups_escaped_atari} 块友军逃出叫吃` : `${tactics.friendly_groups_escaped_atari} つの味方の一団がアタリから逃れる`)
    if (tactics.cuts.length) facts.push(zh ? `阻断 ${tactics.cuts.length} 个附近连接点` : `${tactics.cuts.length} か所の近くの連絡拠点を防ぐ`)
    if (tactics.self_atari) facts.push(zh ? '自己被叫吃的警告' : '自アタリの警告')
    return `${facts.join(zh ? '；' : '、')}。`
  }
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

export function variationSummary(candidate: CandidateMove, size: BoardSize, locale: Locale = 'en'): string | null {
  if (!candidate.variation?.length) return null
  return candidate.variation
    .map((move, index) => `${index + 1}. ${colorName(move.color, locale)} ${move.point ? pointToCoordinate(move.point, size) : locale === 'zh-Hans' ? '停一手' : locale === 'ja' ? 'パス' : 'pass'}`)
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
    next: candidate.next_calculation?.trim() || candidate.risk?.trim() || candidate.main_line_reply?.trim() || (locale === 'zh-Hans'
      ? '选择前，先比较对手最强制的回应。'
      : locale === 'ja'
        ? '選ぶ前に、相手の最も強制的な応手を比較します。'
        : 'Compare the opponent’s most forcing reply before choosing.'),
  }
}
