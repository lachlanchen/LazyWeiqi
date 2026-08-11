import { describe, expect, it } from 'vitest'
import { DEMO_GAME, FALLBACK_CURRICULUM } from './fallbackData'
import {
  ADDITIONAL_LESSON_IDS,
  ADDITIONAL_TEACHING_LOCALES,
  DETERMINISTIC_ACTS,
  deterministicActsAdditional,
  knownNamesAdditional,
  lessonTranslationsAdditional,
} from './lessonTranslations.additional'
import type { GameState, LessonSummary } from './types'
import {
  LOCALE_NAMES,
  MESSAGE_KEYS,
  SUPPORTED_LOCALES,
  documentLocale,
  localizeCurriculum,
  localizeEnergyFacet,
  localizeGame,
  localizeGameSummary,
  localizeKnownName,
  localizeLesson,
  localizeRulesReason,
  localeDirection,
  messagesForLocale,
  normalizeLocale,
  translate,
} from './i18n'

function placeholders(message: string): string[] {
  return [...message.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()
}

describe('reviewed locale contract', () => {
  it('allowlists persisted locale values and preserves English as the default', () => {
    expect(SUPPORTED_LOCALES).toEqual([
      'en', 'ar', 'es', 'fr', 'ja', 'ko', 'vi', 'zh-Hans', 'zh-Hant', 'de', 'ru',
    ])
    expect(normalizeLocale('zh-Hans')).toBe('zh-Hans')
    expect(normalizeLocale('zh-Hant')).toBe('zh-Hant')
    expect(normalizeLocale('ar')).toBe('ar')
    expect(normalizeLocale('ja')).toBe('ja')
    expect(normalizeLocale('pt')).toBe('en')
    expect(normalizeLocale({ locale: 'ja' })).toBe('en')
  })

  it('publishes the exact native selector labels and direction for every locale', () => {
    expect(LOCALE_NAMES).toEqual({
      en: 'English',
      ar: 'العربية',
      es: 'Español',
      fr: 'Français',
      ja: '日本語',
      ko: '한국어',
      vi: 'Tiếng Việt',
      'zh-Hans': '简体中文',
      'zh-Hant': '繁體中文',
      de: 'Deutsch',
      ru: 'Русский',
    })
    expect(localeDirection('ar')).toBe('rtl')
    expect(documentLocale('ar')).toMatchObject({ lang: 'ar', dir: 'rtl' })
    expect(documentLocale('zh-Hant')).toMatchObject({ lang: 'zh-Hant', dir: 'ltr' })
    for (const locale of SUPPORTED_LOCALES.filter((item) => item !== 'ar')) {
      expect(localeDirection(locale)).toBe('ltr')
    }
  })

  it('requires exact key and placeholder parity in all eleven explicit catalogs', () => {
    const english = messagesForLocale('en')
    const expectedKeys = [...MESSAGE_KEYS].sort()
    expect(expectedKeys).toHaveLength(409)

    for (const locale of SUPPORTED_LOCALES) {
      const catalog = messagesForLocale(locale)
      expect(Object.keys(catalog).sort(), locale).toEqual(expectedKeys)
      for (const key of MESSAGE_KEYS) {
        expect(placeholders(catalog[key]), `${locale}:${key}`).toEqual(placeholders(english[key]))
      }
    }
  })

  it('keeps Go meanings for terms that generic translation commonly corrupts', () => {
    const contextualTranslations = {
      ar: {
        'app.tagline': 'Weiqi كقصة حيّة نتعلّم منها',
        'hero.kicker': 'درب هادئ إلى Weiqi',
        'board.grid': 'رقعة Weiqi بحجم {size}×{size}. الدور: {color}.',
        'nav.board': 'الرقعة',
        'operation.rewinding': 'افتتاح فرع جديد…',
        'candidate.engineOrder': 'ترتيب KataGo {rank}',
        'candidate.afterOwnership': 'توقع السيطرة بعد النقلة',
        'board.moveLegal': 'النقلة قانونية.',
        'rules.reasonSuperko': 'ستكرر النقلة وضعًا سابقًا للرقعة',
      },
      de: {
        'nav.board': 'Brett',
        'operation.rewinding': 'Ein neuer Variantenast wird geöffnet …',
        'candidate.engineOrder': 'KataGo-Rang {rank}',
        'candidate.afterOwnership': 'Besitzprognose nach dem Zug',
        'board.moveLegal': 'Der Zug ist legal.',
        'rules.reasonSuperko': 'Der Zug würde eine frühere Brettposition wiederholen',
      },
      es: {
        'nav.board': 'Tablero',
        'operation.rewinding': 'Abriendo una nueva rama…',
        'candidate.engineOrder': 'Orden de KataGo {rank}',
        'candidate.afterOwnership': 'Control estimado tras la jugada',
        'board.moveLegal': 'La jugada es legal.',
        'rules.reasonSuperko': 'la jugada repetiría una posición anterior del tablero',
      },
      fr: {
        'nav.board': 'Goban',
        'operation.rewinding': 'Ouverture d\'une nouvelle branche…',
        'candidate.engineOrder': 'Rang KataGo {rank}',
        'candidate.afterOwnership': 'Contrôle estimé après le coup',
        'board.moveLegal': 'Le coup est légal.',
        'rules.reasonSuperko': 'le coup répéterait une position antérieure du goban',
      },
      ko: {
        'nav.board': '바둑판',
        'operation.rewinding': '새 분기 여는 중…',
        'candidate.engineOrder': 'KataGo 순위 {rank}',
        'candidate.afterOwnership': '착수 후 소유 예측',
        'board.moveLegal': '합법적인 수입니다.',
        'rules.reasonSuperko': '그 수는 이전 바둑판 국면을 반복합니다',
      },
      ru: {
        'nav.board': 'Доска',
        'operation.rewinding': 'Открываем новую ветвь…',
        'candidate.engineOrder': 'Порядок KataGo: {rank}',
        'candidate.afterOwnership': 'Прогноз владения после хода',
        'board.moveLegal': 'Ход допустим.',
        'rules.reasonSuperko': 'этот ход повторит предыдущую позицию на доске',
      },
      vi: {
        'nav.board': 'Bàn cờ',
        'operation.rewinding': 'Đang mở một nhánh mới…',
        'candidate.engineOrder': 'Thứ tự KataGo {rank}',
        'candidate.afterOwnership': 'Dự báo kiểm soát sau nước đi',
        'board.moveLegal': 'Nước đi hợp lệ.',
        'rules.reasonSuperko': 'nước đi sẽ lặp lại một thế cờ trước đó',
        'lens.cloudTerm': 'Ẩn dụ khoảng cách',
      },
      'zh-Hans': {
        'candidate.supportsComparison': '这仅用于比较，不是地盘事实。',
        'candidate.afterOwnership': '着后归属预测',
      },
      'zh-Hant': {
        'candidate.supportsComparison': '這僅用於比較，不是地盤事實。',
        'candidate.afterOwnership': '著後歸屬預測',
        'doctrine.companionText': '燈籠會提問、解釋和復盤；你的回合始終屬於你。',
        'intent.connect': '連接',
        'lens.connections': '連接',
        'chronicle.reviewHall': '復盤室',
      },
    } as const

    for (const [locale, expected] of Object.entries(contextualTranslations)) {
      const catalog = messagesForLocale(locale as keyof typeof contextualTranslations)
      for (const [key, value] of Object.entries(expected)) {
        expect(catalog[key as keyof typeof expected], `${locale}:${key}`).toBe(value)
      }
    }
  })

  it('interpolates only reviewed catalog messages', () => {
    expect(translate('zh-Hans', 'play.move', { count: 8 })).toBe('第 8 手')
    expect(translate('ja', 'simple.minutes', { count: 6 })).toBe('6 分')
    expect(translate('es', 'play.pass')).toBe('Pasar')
    expect(translate('ko', 'lens.liberties')).toBe('활로')
    expect(translate('zh-Hant', 'play.placeStone')).toBe('確認落子')
    expect(translate('ar', 'rules.reasonOutside', { size: '9×9' })).toContain('9×9')
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

  it('integrates every authored lesson field for every additional locale', () => {
    const source: LessonSummary = {
      id: 'opening-compass',
      order: 1,
      title: 'Choose a Promise',
      subtitle: 'Your first real 9×9 opening',
      story: 'The valley is empty. Your first stone does not own it—it makes a promise.',
      board_size: 9,
      duration_minutes: 12,
      concepts: ['opening', 'influence', 'territory', 'intention'],
      difficulty: 'beginner',
      memory_line: 'A first move is a promise, not territory already owned.',
    }

    for (const locale of ADDITIONAL_TEACHING_LOCALES) {
      for (const lessonId of ADDITIONAL_LESSON_IDS) {
        const translated = lessonTranslationsAdditional[locale][lessonId]
        const localized = localizeLesson({ ...source, id: lessonId }, locale)
        expect(localized, `${locale}:${lessonId}`).toMatchObject({
          title: translated.title,
          subtitle: translated.subtitle,
          story: translated.story,
          memory_line: translated.memory,
          concepts: translated.concepts,
        })
      }

      const expected = lessonTranslationsAdditional[locale]['opening-compass']
      const game = localizeGame({
        ...DEMO_GAME,
        lesson_id: 'opening-compass',
        title: source.title,
        lesson_title: source.title,
        objective: 'Choose any legal opening and name the intention behind it.',
      }, locale)
      const summary = localizeGameSummary(DEMO_GAME, locale)
      expect(game.title, `${locale}:title`).toBe(expected.title)
      expect(game.objective, `${locale}:objective`).toBe(expected.objective)
      expect(summary.title, `${locale}:summary`).toBe(expected.title)
      expect(game.title).not.toBe(source.title)
      expect(game.objective).not.toBe('Choose any legal opening and name the intention behind it.')
      expect(expected.subtitle).not.toBe(source.subtitle)
      expect(expected.story).not.toBe(source.story)
      expect(expected.memory).not.toBe(source.memory_line)
    }

    expect(localizeLesson(source, 'ar')).toMatchObject({
      title: 'اختر وعدًا',
      subtitle: 'افتتاحك الحقيقي الأول على رقعة 9×9',
      story: 'الوادي خالٍ. حجرك الأول لا يملك الأرض؛ بل يقدّم وعدًا.',
      memory_line: 'النقلة الأولى وعد، وليست أرضًا مملوكة بعد.',
    })
  })

  it('integrates all six deterministic acts and stable learner labels in every locale', () => {
    for (const locale of ADDITIONAL_TEACHING_LOCALES) {
      for (const act of DETERMINISTIC_ACTS) {
        const localized = localizeGame({ ...DEMO_GAME, act }, locale)
        expect(localized.act, `${locale}:${act}`).toBe(deterministicActsAdditional[act][locale])
        expect(localized.act).not.toBe(act)
      }
      expect(localizeKnownName('You', locale)).toBe(knownNamesAdditional.You[locale])
      expect(localizeKnownName('Black', locale)).toBe(knownNamesAdditional.Black[locale])
      expect(localizeKnownName('White', locale)).toBe(knownNamesAdditional.White[locale])
    }
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

  it('preserves unknown model and engine bodies byte-for-byte in every non-English locale', () => {
    const modelBody = 'Provider payload: xYz-42 / 黑 / C3 — preserve every byte.'
    const engineBody = 'Network payload: ownership=0.187500; opaque=true.'
    for (const locale of SUPPORTED_LOCALES.filter((item) => item !== 'en')) {
      const localized = localizeGame({
        ...DEMO_GAME,
        lesson_id: null,
        coach_messages: [{
          id: 'opaque-provider-message',
          speaker: 'Lantern',
          role: 'companion',
          text: modelBody,
          evidence: ['model'],
        }],
        analysis: {
          status: 'ready',
          facets: [{
            id: 'reach',
            label: 'Reach',
            canonical_term: 'Ownership tendency',
            value: 'Opaque network value',
            evidence: 'engine',
            explanation: engineBody,
          }],
        },
      }, locale)
      expect(localized.coach_messages[0].text, locale).toBe(modelBody)
      expect(localized.analysis?.facets?.[0].value, locale).toBe('Opaque network value')
      expect(localized.analysis?.facets?.[0].explanation, locale).toBe(engineBody)
    }
  })

  it('localizes new-locale interface evidence labels without rewriting provider prose', () => {
    const modelText = 'Keep this provider-authored explanation byte-for-byte.'
    const engineText = 'Keep this network-specific ownership explanation byte-for-byte.'
    const localized = localizeGame({
      ...DEMO_GAME,
      coach_messages: [{
        id: 'provider-arabic-locale',
        speaker: 'Lantern',
        role: 'companion',
        text: modelText,
        evidence: ['model'],
      }],
      analysis: {
        ...DEMO_GAME.analysis,
        status: 'ready',
        facets: [{
          id: 'reach',
          label: 'Reach',
          canonical_term: 'Ownership tendency',
          value: 'Network value',
          evidence: 'engine',
          explanation: engineText,
        }],
      },
    }, 'ar')

    expect(localized.coach_messages[0].text).toBe(modelText)
    expect(localized.analysis?.facets?.[0].explanation).toBe(engineText)
    expect(localized.analysis?.facets?.[0].value).toBe('Network value')
    expect(localized.analysis?.facets?.[0].label).toBe(translate('ar', 'lens.forecast'))
    expect(localized.rules.name).toBe(translate('ar', 'simple.chineseRules'))
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

  it('localizes deterministic coach and facet templates in every non-English locale', () => {
    const exactBoard = 'Exact board check — fewest current liberties: Black at C3 has 2 liberties; White at B3 has 1 liberty'
    const teacherSummary = 'A teacher hypothesis is to keep several future directions open.'
    const teacherRisk = 'A flexible move may be too quiet if a nearby group currently has very few liberties.'
    const fallback = [
      exactBoard,
      'Rules-verified legal candidate: D4.',
      `Teacher hypothesis (not KataGo's reason): ${teacherSummary}`,
      'KataGo reply in one main line (not forced): White pass',
      `Teacher risk hypothesis: ${teacherRisk}`,
      'Remember: Count every liberty.',
      'The model companion was unavailable. This fallback separates exact board facts from authored teacher guidance.',
    ].join('\n\n')

    for (const locale of SUPPORTED_LOCALES.filter((item) => item !== 'en')) {
      const localized = localizeGame({
        ...DEMO_GAME,
        lesson_id: 'opening-compass',
        coach_messages: [{
          id: 'coach-deterministic-all-locales',
          speaker: 'Lantern',
          role: 'companion',
          evidence: ['teacher'],
          text: fallback,
        }],
      }, locale)
      const output = localized.coach_messages[0].text
      expect(output, locale).not.toContain('Exact board check')
      expect(output, locale).not.toContain('Rules-verified legal candidate')
      expect(output, locale).not.toContain('Teacher hypothesis (not KataGo')
      expect(output, locale).not.toContain(teacherSummary)
      expect(output, locale).not.toContain(teacherRisk)
      expect(output, locale).not.toContain('The model companion was unavailable')

      const facet = localizeEnergyFacet({
        id: 'breath',
        label: 'Breath',
        canonical_term: 'Liberties',
        value: '2 group(s) in atari',
        evidence: 'exact',
        explanation: 'A group in atari has exactly one distinct liberty.',
      }, locale)
      expect(facet.value, locale).not.toBe('2 group(s) in atari')
      expect(facet.explanation, locale).not.toBe('A group in atari has exactly one distinct liberty.')
    }
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
