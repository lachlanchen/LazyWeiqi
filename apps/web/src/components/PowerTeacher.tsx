import { ArrowRight, Lightbulb } from 'lucide-react'
import { groupAt, orthogonalNeighbors, pointToCoordinate, samePoint } from '../board'
import {
  candidateReasoning,
  candidateQualityComparison,
  scoreImpactSummary,
  tacticsSummary,
  variationSummary,
} from '../candidateEvidence'
import { localizeAuthoredTemplate, localizeAuthoredText } from '../authoredCopy'
import { localizeRulesReason, translate, useI18n, type Locale, type MessageKey } from '../i18n'
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

function authored(locale: Locale, english: string, chinese: string, japanese: string): string {
  const localized = localizeAuthoredText(locale, english)
  if (localized !== english) return localized
  return locale === 'zh-Hans' ? chinese : locale === 'ja' ? japanese : english
}

function authoredTemplate(
  locale: Locale,
  englishTemplate: string,
  values: Record<string, string | number>,
  chinese: string,
  japanese: string,
): string {
  const english = englishTemplate.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : match,
  )
  const localized = localizeAuthoredTemplate(locale, englishTemplate, values)
  if (localized !== english) return localized
  return locale === 'zh-Hans' ? chinese : locale === 'ja' ? japanese : english
}

function colorName(color: StoneColor, locale: Locale): string {
  return translate(locale, color === 'black' ? 'board.black' : 'board.white')
}

function candidateForPoint(candidates: CandidateMove[], point: Point | null): CandidateMove | undefined {
  if (!point) return undefined
  return candidates.find((candidate) => candidate.point != null && samePoint(candidate.point, point))
}

function sourceClass(source: TeachingSource): string {
  return source.toLowerCase().replace(/\s+/g, '-')
}

function sourceKey(source: TeachingSource): MessageKey {
  return {
    'Exact rules': 'source.exactRules',
    'Engine estimate': 'source.engine',
    'Lesson guidance': 'source.lesson',
    'Teacher interpretation': 'source.teacher',
  }[source] as MessageKey
}

function stepLabelKey(label: TeachingStep['label']): MessageKey {
  return {
    Play: 'power.play',
    Because: 'power.because',
    Changes: 'power.changes',
    Opponent: 'power.opponent',
    'Then check': 'power.thenCheck',
    Principle: 'power.principle',
  }[label] as MessageKey
}

function principleFor(candidate: CandidateMove, size: BoardSize, locale: Locale): string {
  if (candidate.kind === 'pass' || candidate.point == null) {
    return authored(locale, 'Pass only when continuing looks smaller than stopping or giving priority away; it does not prove every group is settled.', '只有继续的价值看起来小于停下或交出先手时才停一手；停一手不证明每块棋都已安定。', '続ける価値が止まることや先手を渡すことより小さいときだけパスします。パスはすべての一団が確定した証明ではありません。')
  }
  if (candidate.tactics?.self_atari || (candidate.tactics?.resulting_liberties != null && candidate.tactics.resulting_liberties <= 2)) {
    return authored(locale, 'A low liberty count is a warning; read the opponent’s forcing reply before taking broad profit.', '气少是警告；获取全局利益前，先读对手的强制应手。', 'ダメが少ないのは警告です。広い利益を取る前に相手の強制手を読みます。')
  }
  if (candidate.intent === 'escape' || candidate.tactics?.friendly_groups_escaped_atari) {
    return authored(locale, 'A group with few options narrows your plan. Add options, connect, or sacrifice it when that trade is better.', '选择少的棋块会限制计划。增加出路、连接，或在交换更好时舍弃它。', '選択肢の少ない一団は計画を狭めます。選択肢を増やす、つなぐ、または取引が良いときに捨てます。')
  }
  if (candidate.intent === 'claim' || candidate.intent === 'settle') {
    const nearCorner = candidate.point.x <= 1 || candidate.point.y <= 1 || candidate.point.x >= size - 2 || candidate.point.y >= size - 2
    return nearCorner
      ? authored(locale, 'A corner can be efficient because two edges help, but first compare every concrete local danger.', '角部有两条边帮助，因此可以高效；但要先比较每个具体局部危险。', '隅は二辺を使えるので効率的ですが、まず具体的な局所の危険を比較します。')
      : authored(locale, 'A settling move should create useful options now; location alone does not make a group safe.', '安定的着法应立即创造有用选择；仅凭位置不会让棋块安全。', '安定させる手は、今役立つ選択肢を作るべきです。場所だけで一団は安全になりません。')
  }
  if (candidate.intent === 'pressure' || candidate.intent === 'reduce') {
    return authored(locale, 'Influence is useful only when it has a target or a realistic way to convert into safety, attack, or points.', '外势只有面向目标，或能切实转化为安全、攻击或目数时才有用。', '外勢は目標があり、安全、攻め、または得点へ現実的に変換できるときだけ役立ちます。')
  }
  if (candidate.intent === 'connect') {
    return authored(locale, 'Connection is valuable when shared liberties and coordination outweigh the loss of speed.', '当共享气与协调的价值大于速度损失时，连接才值得。', '共有するダメと連携の価値が速度の損失を上回るとき、連絡に価値があります。')
  }
  return authored(locale, 'Choose by comparing a forcing reply and your follow-up, not by how impressive one stone looks alone.', '选择时要比较对手的强制应手与你的后续，不要只看一枚棋子多么显眼。', '相手の強制的な応手と自分の続きを比較して選びます。1 子の見栄えだけで選びません。')
}

function candidateSteps(
  size: BoardSize,
  toPlay: StoneColor,
  candidate: CandidateMove,
  topCandidate?: CandidateMove,
  locale: Locale = 'en',
): TeachingStep[] {
  const reasoning = candidateReasoning(candidate, locale)
  const pv = variationSummary(candidate, size, locale)
  const changes: TeachingSentence[] = candidate.tactics
    ? [{ source: 'Exact rules', text: tacticsSummary(candidate.tactics, candidate.kind === 'pass' || candidate.point == null, locale) }]
    : [{ source: 'Teacher interpretation', text: reasoning.changes }]
  if (candidate.score && candidate.engine_analyzed && size === 9) {
    changes.push({ source: 'Engine estimate', text: scoreImpactSummary(candidate.score, toPlay, locale) })
  }
  const because: TeachingSentence[] = [{ source: 'Teacher interpretation', text: reasoning.why }]
  const engineRank = candidate.evaluation?.order != null ? candidate.evaluation.order + 1 : null
  const qualityComparison = candidateQualityComparison(candidate, topCandidate, toPlay, locale)
  if (size === 9 && candidate.engine_analyzed && engineRank != null) {
    because.push({
      source: 'Engine estimate',
      text: translate(locale, 'candidate.rank', {
        coordinate: candidate.coordinate,
        rank: engineRank,
        visits: candidate.evaluation?.visits != null
          ? translate(locale, 'candidate.visits', { count: candidate.evaluation.visits.toLocaleString(locale) })
          : '',
      }),
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
        text: `${candidate.engine_analyzed && size === 9 ? authored(locale, 'One engine main line (not forced)', '一条引擎主变（非强制）', 'エンジン主変化の一例（強制ではない）') : authored(locale, 'One authored line to examine', '一条供检查的编写变化', '検討用に作成された変化の一例')}: ${pv}`,
      }]
    : candidate.main_line_reply
      ? [{
          source: candidate.engine_analyzed && size === 9 ? 'Engine estimate' as const : 'Teacher interpretation' as const,
          text: `${candidate.engine_analyzed && size === 9 ? authored(locale, 'Reply in one engine line (not forced)', '引擎主变中的回应（非强制）', 'エンジン主変化の応手（強制ではない）') : authored(locale, 'Reply to examine', '需检查的回应', '検討する応手')}: ${candidate.main_line_reply}`,
        }]
      : [{ source: 'Teacher interpretation' as const, text: authored(locale, 'No reply line was supplied. Check the opponent’s most forcing capture, cut, or liberty-reducing move.', '未提供回应变化。检查对手最强制的提子、切断或减气着法。', '応手の変化は提供されていません。相手の最も強制的な取り、切り、ダメを詰める手を確認します。') }]

  return [
    { label: 'Play', sentences: [{ source: 'Lesson guidance', text: `${colorName(toPlay, locale)} ${candidate.coordinate}: ${candidate.title}.` }] },
    { label: 'Because', sentences: because },
    { label: 'Changes', sentences: changes },
    { label: 'Opponent', sentences: opponent },
    { label: 'Then check', sentences: [{ source: 'Teacher interpretation', text: reasoning.next }] },
    { label: 'Principle', sentences: [{ source: 'Lesson guidance', text: principleFor(candidate, size, locale) }] },
  ]
}

function selectedSteps(
  size: BoardSize,
  stones: Stone[],
  toPlay: StoneColor,
  selected: Point,
  preview: MovePreview | null,
  locale: Locale,
): TeachingStep[] {
  const coordinate = pointToCoordinate(selected, size)
  if (!preview || !samePoint(preview.point, selected)) {
    return [
      { label: 'Play', sentences: [{ source: 'Lesson guidance', text: authoredTemplate(locale, 'Inspect {color} at {coordinate}; nothing has been placed.', { color: colorName(toPlay, locale), coordinate }, `检查${colorName(toPlay, locale)}下在 ${coordinate} 的情况；尚未落子。`, `${colorName(toPlay, locale)}が ${coordinate} に打つ場合を調べます。まだ着手していません。`) }] },
      { label: 'Because', sentences: [{ source: 'Teacher interpretation', text: authored(locale, 'Hold the question until the rules preview returns.', '等规则预览返回后再下结论。', 'ルールプレビューが戻るまで判断を保留します。') }] },
      { label: 'Changes', sentences: [{ source: 'Exact rules', text: authored(locale, 'The legal result is still pending, so no capture or liberty claim is made.', '合法结果仍在等待，因此不声称会提子或有多少气。', '着手可否の判定がまだないため、取りやダメについて主張しません。') }] },
      { label: 'Opponent', sentences: [{ source: 'Teacher interpretation', text: authored(locale, 'Wait for position-bound evidence before reading a reply.', '先等待与当前局面绑定的依据，再读对手回应。', '局面に紐付いた根拠を待ってから応手を読みます。') }] },
      { label: 'Then check', sentences: [{ source: 'Lesson guidance', text: authored(locale, 'Keep this point selected until the preview finishes.', '预览完成前保持选中此点。', 'プレビューが終わるまでこの点を選択したままにします。') }] },
      { label: 'Principle', sentences: [{ source: 'Lesson guidance', text: authored(locale, 'Verify first; explain second.', '先验证，再解释。', 'まず検証、次に説明。') }] },
    ]
  }

  if (!preview.legal) {
    return [
      { label: 'Play', sentences: [{ source: 'Exact rules', text: authoredTemplate(locale, '{coordinate} is not legal now.', { coordinate }, `${coordinate} 当前不合法。`, `${coordinate} には現在打てません。`) }] },
      { label: 'Because', sentences: [{ source: 'Exact rules', text: localizeRulesReason(preview.reason, locale) ?? authored(locale, 'The rules service rejected this move.', '规则服务拒绝了这手棋。', 'ルールサービスがこの手を拒否しました。') }] },
      { label: 'Changes', sentences: [{ source: 'Exact rules', text: authored(locale, 'No stone is placed and the board does not change.', '不落子，棋盘不变。', '石は置かれず、盤面は変わりません。') }] },
      { label: 'Opponent', sentences: [{ source: 'Exact rules', text: authored(locale, 'There is no reply to an illegal move.', '非法着法不会产生对手应手。', '非合法手に対する応手はありません。') }] },
      { label: 'Then check', sentences: [{ source: 'Lesson guidance', text: authored(locale, 'Choose another empty intersection.', '选择另一个空交叉点。', '別の空いた交点を選びます。') }] },
      { label: 'Principle', sentences: [{ source: 'Lesson guidance', text: authored(locale, 'A strategic idea matters only after legality is settled.', '只有先确定合法性，战略思路才有意义。', '戦略的なアイデアは、その手が打てると確定して初めて意味を持ちます。') }] },
    ]
  }

  const exactChanges: string[] = []
  if (preview.captures.length) exactChanges.push(authoredTemplate(locale, 'captures {count} stone(s)', { count: preview.captures.length }, `提掉 ${preview.captures.length} 枚棋子`, `${preview.captures.length} 子を取り`))
  if (preview.resulting_liberties != null) exactChanges.push(authoredTemplate(locale, 'leaves the new string {count} liberties', { count: preview.resulting_liberties }, `让新棋串有 ${preview.resulting_liberties} 口气`, `新しい一団に ${preview.resulting_liberties} ダメを残す`))
  const adjacentGroups = orthogonalNeighbors(selected, size)
    .map((neighbor) => groupAt(stones, neighbor, size))
    .filter((group): group is NonNullable<typeof group> => group != null)
  const fewestAdjacentLiberties = adjacentGroups.length
    ? Math.min(...adjacentGroups.map((group) => group.liberties.length))
    : null
  const hasAtariEvidence = preview.resulting_liberties === 1 ||
    adjacentGroups.some((group) => group.liberties.length === 1)
  const exactChangeJoiner = locale === 'ar'
    ? '، و'
    : locale === 'zh-Hans' || locale === 'zh-Hant'
      ? '，并'
      : locale === 'ja'
        ? '、'
        : '; '
  return [
    { label: 'Play', sentences: [{ source: 'Exact rules', text: authoredTemplate(locale, '{color} can legally play {coordinate}; the stone is still only a preview.', { color: colorName(toPlay, locale), coordinate }, `${colorName(toPlay, locale)}可以合法下在 ${coordinate}；棋子仍只是预览。`, `${colorName(toPlay, locale)}は ${coordinate} に合法に打てますが、まだプレビューです。`) }] },
    { label: 'Because', sentences: [{ source: 'Teacher interpretation', text: authored(locale, 'Name the job this move should do before judging it.', '判断前，先说出这手棋应该完成的任务。', '判断する前に、この手が担う役割を言葉にします。') }] },
    { label: 'Changes', sentences: [{ source: 'Exact rules', text: exactChanges.length ? authoredTemplate(locale, 'It {changes}.', { changes: exactChanges.join(exactChangeJoiner) }, `这手棋会${exactChanges.join('，并')}。`, `この手は${exactChanges.join('、')}。`) : authored(locale, 'No capture was reported; compare the resulting liberties and connections.', '没有报告提子；请比较着后的气与连接。', '取りは報告されていません。着手後のダメと連絡を比較します。') }] },
    { label: 'Opponent', sentences: [{ source: 'Teacher interpretation', text: authored(locale, 'No engine line is attached. Check the opponent’s most forcing capture, cut, or liberty reduction.', '没有附加引擎变化。请检查对手最强制的提子、切断或减气着法。', 'エンジン変化は付いていません。相手の最も強制的な取り、切り、ダメを詰める手を確認します。') }] },
    { label: 'Then check', sentences: [{ source: 'Teacher interpretation', text: fewestAdjacentLiberties != null ? authoredTemplate(locale, 'The adjacent group with the fewest current liberties has {fewest}; check whether it is actually urgent before comparing the preview’s {preview} liberties.', { fewest: fewestAdjacentLiberties, preview: preview.resulting_liberties ?? translate(locale, 'board.unreported') }, `相邻棋块中最少的当前气数是 ${fewestAdjacentLiberties}；先判断它是否真的紧急，再比较预览结果的${preview.resulting_liberties ?? '未报告'}口气。`, `隣接する一団の現在の最小ダメ数は ${fewestAdjacentLiberties}。本当に急場かを確かめてから、プレビュー結果の ${preview.resulting_liberties ?? '未報告'} ダメと比較します。`) : authored(locale, 'Compare a concrete local reply before a broad follow-up.', '先比较一个具体的局部应手，再考虑宽广的后续。', '広い続きの前に、具体的な局所応手を比較します。') }] },
    hasAtariEvidence
      ? { label: 'Principle', sentences: [{ source: 'Lesson guidance', text: authored(locale, 'Atari demands an immediate decision; compare saving, capturing, connecting, or sacrificing before assuming the group must be rescued.', '被叫吃时要立即作出决定；先比较救、吃、连或弃，再判断是否必须救这块棋。', 'アタリではすぐに方針を決めます。助ける、取る、つなぐ、捨てるを比較してから、救出が必要だと判断します。') }] }
      : { label: 'Principle', sentences: [{ source: 'Exact rules', text: authored(locale, "The resulting connected string's distinct liberties are counted exactly.", '着后连通棋串的不重复气数会被精确计算。', '着手後の連結した一団の異なるダメを正確に数えます。') }] },
  ]
}

function currentSteps(
  size: BoardSize,
  stones: Stone[],
  toPlay: StoneColor,
  candidate: CandidateMove | undefined,
  lastMove: MoveRecord | null,
  locale: Locale,
): TeachingStep[] {
  if (candidate) return candidateSteps(size, toPlay, candidate, candidate, locale)
  const lastPoint = lastMove?.kind === 'play' ? lastMove.point ?? null : null
  const lastGroup = lastPoint ? groupAt(stones, lastPoint, size) : null
  return [
    { label: 'Play', sentences: [{ source: 'Lesson guidance', text: authored(locale, 'Select a candidate or an empty intersection; inspection never places a stone.', '选择候选着或空交叉点；观察永远不会落子。', '候補手または空交点を選びます。調べるだけで石は打たれません。') }] },
    { label: 'Because', sentences: [{ source: 'Lesson guidance', text: authored(locale, 'First find the group with the fewest liberties and ask whether it is urgent.', '先找到气最少的棋块，再问它是否紧急。', 'まずダメが最も少ない一団を見つけ、急場かを問います。') }] },
    { label: 'Changes', sentences: [{ source: 'Exact rules', text: lastGroup ? authoredTemplate(locale, 'The last move’s connected string has {count} distinct liberties.', { count: lastGroup.liberties.length }, `最后一手的连通棋串有 ${lastGroup.liberties.length} 口不重复的气。`, `最終手の連結した一団には ${lastGroup.liberties.length} 個の異なるダメがあります。`) : authored(locale, 'No candidate-specific rules result is available yet.', '尚无针对候选着的规则结果。', '候補手固有のルール結果はまだありません。') }] },
    { label: 'Opponent', sentences: [{ source: 'Teacher interpretation', text: authored(locale, 'Look for capture, cut, atari, or a move that takes away your follow-up.', '寻找提子、切断、叫吃，或夺走你后续手段的着法。', '取り、切り、アタリ、または自分の続きを奪う手を探します。') }] },
    { label: 'Then check', sentences: [{ source: 'Lesson guidance', text: authored(locale, 'Compare at least two candidates against the same forcing reply.', '用同一个强制应手比较至少两个候选。', '同じ強制的な応手に対し、少なくとも 2 つの候補を比較します。') }] },
    { label: 'Principle', sentences: [{ source: 'Lesson guidance', text: authored(locale, 'Corners can be efficient, but urgency and whole-board direction decide when.', '角部可以很高效，但紧急性与全局方向决定何时走。', '隅は効率的ですが、いつ打つかは緊急度と全局の方向が決めます。') }] },
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
  const { locale, t } = useI18n()
  const selectedCandidate = candidateForPoint(candidates, selected)
  const candidate = activeCandidate ?? selectedCandidate ?? (!selected ? candidates[0] : undefined)
  const steps = candidate
    ? candidateSteps(size, toPlay, candidate, candidates.find((item) => item.evaluation?.order === 0), locale)
    : selected
      ? selectedSteps(size, stones, toPlay, selected, preview, locale)
      : currentSteps(size, stones, toPlay, undefined, lastMove, locale)
  const evidenceMode = size < 9
    ? authoredTemplate(locale, 'Authored {size}×{size} view · no KataGo claim', { size }, `人工编写的 ${size}×${size} 视图 · 不声称有 KataGo 依据`, `教材用の ${size}×${size} 表示 · KataGo の主張なし`)
    : candidate
      ? candidate.engine_analyzed
        ? authored(locale, 'Rules + labeled engine forecasts', '规则 + 已标注的引擎预测', 'ルール + 出典付きエンジン予測')
        : authored(locale, 'Rules + teacher interpretation · no candidate engine claim', '规则 + 教师解读 · 不声称候选着有引擎依据', 'ルール + 教師の解釈 · 候補手のエンジン根拠なし')
      : ownershipAvailable
        ? authored(locale, 'Current-position ownership forecast + rules', '当前局面归属预测 + 规则', '現在局面の帰属予測 + ルール')
        : authored(locale, 'Rules + teacher interpretation', '规则 + 教师解读', 'ルール + 教師の解釈')

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
          <span className="eyebrow">{t('power.eyebrow')}</span>
          <h3 id="power-teacher-title">{t('power.title')}</h3>
        </div>
        <span className="power-teacher-source">{evidenceMode}</span>
      </header>
      <ol className="power-teacher-steps">
        {steps.map((step, index) => (
          <li key={step.label}>
            <span className="step-number">{index + 1}</span>
            <div>
              <strong>{t(stepLabelKey(step.label))}</strong>
              {step.sentences.map((sentence, sentenceIndex) => (
                <p key={`${sentence.source}-${sentenceIndex}`}>
                  <span className={`teaching-source ${sourceClass(sentence.source)}`}>{t(sourceKey(sentence.source))}</span>
                  {sentence.text}
                </p>
              ))}
            </div>
            {index < steps.length - 1 && <ArrowRight className="step-arrow" size={14} aria-hidden="true" />}
          </li>
        ))}
      </ol>
      <p className="power-memory"><b>{t('power.remember')}</b> {t('power.memory')}</p>
    </section>
  )
}
