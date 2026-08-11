import { describe, expect, it } from 'vitest'
import { DEMO_GAME, FALLBACK_CURRICULUM } from './fallbackData'
import type { GameState } from './types'
import {
  localizeCurriculum,
  localizeEnergyFacet,
  localizeGame,
  localizeRulesReason,
  normalizeLocale,
  translate,
} from './i18n'

describe('reviewed locale contract', () => {
  it('allowlists persisted locale values and preserves English as the default', () => {
    expect(normalizeLocale('zh-Hans')).toBe('zh-Hans')
    expect(normalizeLocale('ja')).toBe('ja')
    expect(normalizeLocale('zh-Hant')).toBe('en')
    expect(normalizeLocale({ locale: 'ja' })).toBe('en')
  })

  it('interpolates only reviewed catalog messages', () => {
    expect(translate('zh-Hans', 'play.move', { count: 8 })).toBe('第 8 手')
    expect(translate('ja', 'simple.minutes', { count: 6 })).toBe('6 分')
  })

  it('localizes only known deterministic rule failures', () => {
    expect(localizeRulesReason('that intersection is occupied', 'zh-Hans')).toBe('该交叉点已有棋子')
    expect(localizeRulesReason('that intersection is outside the 9×9 board', 'ja')).toBe('その交点は 9×9 の盤外にある')
    expect(localizeRulesReason('provider-specific diagnostic', 'zh-Hans')).toBe('provider-specific diagnostic')
  })

  it('localizes known exact facet facts but preserves unknown engine prose', () => {
    const exact = localizeEnergyFacet({
      id: 'breath',
      label: 'Breath',
      canonical_term: 'Liberties',
      value: '2 group(s) in atari',
      evidence: 'exact',
      explanation: 'A group in atari has exactly one distinct liberty.',
    }, 'zh-Hans')
    const engine = localizeEnergyFacet({
      id: 'reach',
      label: 'Reach',
      canonical_term: 'Influence tendency',
      value: 'Network-specific value',
      evidence: 'engine',
      explanation: 'Unconstrained network explanation.',
    }, 'ja')

    expect(exact.value).toBe('2 块棋被叫吃')
    expect(exact.explanation).toContain('只有一口')
    expect(engine.label).toBe('予測')
    expect(engine.value).toBe('Network-specific value')
    expect(engine.explanation).toBe('Unconstrained network explanation.')
  })

  it('keeps metaphor reach distinct from engine ownership forecast', () => {
    const metaphor = localizeEnergyFacet({
      id: 'reach',
      label: 'Reach',
      canonical_term: 'Influence tendency',
      value: 'Distance-based presence',
      evidence: 'metaphor',
      explanation: 'Presence and tension are deterministic teaching metaphors derived from stone distance and liberties; they are not territory, score, or physical energy.',
    }, 'zh-Hans')
    const mismatched = localizeEnergyFacet({
      id: 'reach',
      label: 'Reach',
      canonical_term: 'Influence tendency',
      value: 'Engine ownership field',
      evidence: 'metaphor',
      explanation: 'KataGo estimates future ownership; it is not territory already owned.',
    }, 'ja')

    expect(metaphor.evidence).toBe('metaphor')
    expect(metaphor.label).toBe('存在感示意')
    expect(metaphor.canonical_term).toBe('距离比喻')
    expect(metaphor.value).toBe('基于距离的存在感')
    expect(mismatched.label).toBe('存在感の図')
    expect(mismatched.value).toBe('Engine ownership field')
    expect(mismatched.explanation).toBe('KataGo estimates future ownership; it is not territory already owned.')
  })

  it('localizes curriculum by stable lesson ID without mutating the source', () => {
    const localized = localizeCurriculum(FALLBACK_CURRICULUM, 'zh-Hans')
    const original = FALLBACK_CURRICULUM.lessons.find((lesson) => lesson.id === 'first-breath')
    const translated = localized.lessons.find((lesson) => lesson.id === 'first-breath')

    expect(original?.title).toBe('First Breath')
    expect(translated?.title).toBe('第一口气')
    expect(translated?.concepts).toEqual(['气', '叫吃', '提子'])
  })

  it('does not translate unconstrained model or engine prose', () => {
    const modelText = 'A model-specific explanation that is not in the reviewed catalog.'
    const engineExplanation = 'A network-specific ownership explanation.'
    const game: GameState = {
      ...DEMO_GAME,
      coach_messages: [{
        id: 'generated-message',
        speaker: 'Lantern',
        role: 'companion' as const,
        text: modelText,
        evidence: ['model' as const],
      }],
      analysis: {
        ...DEMO_GAME.analysis,
        status: 'ready',
        facets: [{
          id: 'reach' as const,
          label: 'Reach',
          canonical_term: 'Ownership tendency',
          value: 'Network value',
          evidence: 'engine' as const,
          explanation: engineExplanation,
        }],
      },
    }

    const localized = localizeGame(game, 'ja')
    expect(localized.coach_messages[0].text).toBe(modelText)
    expect(localized.coach_messages[0].speaker).toBe('ランタン')
    expect(localized.actors.find((actor) => actor.role === 'human')?.name).toBe('あなた')
    expect(localized.analysis?.facets?.[0].explanation).toBe(engineExplanation)
    expect(localized.analysis?.facets?.[0].label).toBe('予測')
    expect(localized.act).toBe('接触 · 二つの一団が形になり始める')
  })

  it('preserves authored coach prompt roles while translating local fallback lessons', () => {
    const local = localizeGame({
      ...DEMO_GAME,
      lesson_id: 'first-breath',
      coach_messages: [{
        id: 'authored-first-breath',
        speaker: 'Lantern',
        role: 'companion',
        text: 'A fallback story.',
        prompt: 'Count all distinct liberties.',
        evidence: ['metaphor'],
      }],
    }, 'zh-Hans')
    const server = localizeGame({
      ...DEMO_GAME,
      lesson_id: 'first-breath',
      coach_messages: [{
        id: 'authored-opening',
        speaker: 'Lantern',
        role: 'companion',
        text: 'A server story.',
        prompt: 'See how a stone stays alive.',
        evidence: ['metaphor'],
      }],
    }, 'zh-Hans')

    expect(local.coach_messages[0].prompt).toBe('数整块棋不重复的气。')
    expect(server.coach_messages[0].prompt).toBe('看见棋子如何存活。')
  })

  it('localizes deterministic coach fallback structure without rewriting model prose', () => {
    const deterministic = localizeGame({
      ...DEMO_GAME,
      lesson_id: 'first-breath',
      coach_messages: [{
        id: 'coach-deterministic',
        speaker: 'Lantern',
        role: 'companion',
        evidence: ['teacher'],
        text: [
          'Exact board check — fewest current liberties: Black at C3 has 2 liberties; White at B3 has 1 liberty',
          'Rules-verified legal candidate: D4.',
          "Teacher hypothesis (not KataGo's reason): A teacher hypothesis is to keep several future directions open.",
          'Teacher risk hypothesis: A flexible move may be too quiet if a nearby group currently has very few liberties.',
          'Remember: Count every liberty.',
          'The model companion was unavailable. This fallback separates exact board facts from authored teacher guidance.',
        ].join('\n\n'),
      }],
    }, 'ja')
    const modelBody = 'Keep this model sentence exactly as supplied.'
    const model = localizeGame({
      ...DEMO_GAME,
      coach_messages: [{
        id: 'coach-model',
        speaker: 'Lantern',
        role: 'companion',
        evidence: ['model'],
        text: `Now: ${modelBody}\n\nModel uncertainty: ${modelBody}`,
      }],
    }, 'zh-Hans')
    const localModelFallback = localizeGame({
      ...DEMO_GAME,
      coach_messages: [{
        id: 'coach-local-model',
        speaker: 'Lantern',
        role: 'companion',
        evidence: ['model'],
        text: [
          'Local-model explanation — not an exact board fact. Verify factual claims against the labeled Energy facets below.',
          'Candidate coordinate: pass.',
          'Teacher hypothesis: A teacher hypothesis is to keep several future directions open.',
          'Then watch: A flexible move may be too quiet if a nearby group currently has very few liberties.',
          'GPT-5.6 Sol was unavailable; opt-in local prose was used and is labeled as model-generated.',
        ].join('\n\n'),
      }],
    }, 'ja')

    expect(deterministic.coach_messages[0].text).toContain('正確な盤面確認')
    expect(deterministic.coach_messages[0].text).toContain('黒 C3 は 2 ダメ')
    expect(deterministic.coach_messages[0].text).toContain('教師の仮説')
    expect(deterministic.coach_messages[0].text).toContain('一団全体の異なるダメを数える。')
    expect(deterministic.coach_messages[0].text).not.toContain('Exact board check')
    expect(model.coach_messages[0].text).toBe(`现在：${modelBody}\n\n模型不确定性：${modelBody}`)
    expect(localModelFallback.coach_messages[0].text).toContain('ローカルモデルの説明です。')
    expect(localModelFallback.coach_messages[0].text).toContain('候補の座標：パス。')
    expect(localModelFallback.coach_messages[0].text).toContain('次に見ること：近くの一団のダメが少ないなら')
    expect(localModelFallback.coach_messages[0].text).toContain('GPT-5.6 Sol を利用できなかったため')
  })

  it('localizes the deterministic agent-choice prefix before move teaching copy', () => {
    const localized = localizeGame({
      ...DEMO_GAME,
      coach_messages: [{
        id: 'move-agent-choice',
        speaker: 'Lantern',
        role: 'companion',
        text: 'Mountain chose this move through gpt-5.6-sol. The pressured group found another road. Recount its current liberties after the extension.',
        evidence: ['teacher'],
      }],
    }, 'zh-Hans')

    expect(localized.coach_messages[0].text).toBe('山通过GPT-5.6 Sol走了这手。受压的棋块找到了新出路。长出后，请重新数它现在的气。')
  })
})
