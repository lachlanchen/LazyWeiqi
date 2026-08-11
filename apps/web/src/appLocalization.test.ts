import { describe, expect, it } from 'vitest'
import {
  canonicalLessonForStart,
  createGameRequestForLesson,
  localGameForLesson,
  localPreviewForPoint,
  preferencesFromStoredValue,
  selectableBoardSizes,
} from './App'
import { DEFAULT_PREFERENCES, FALLBACK_CURRICULUM, FALLBACK_STATUS } from './fallbackData'
import { localizeGame, localizeLesson, SUPPORTED_LOCALES } from './i18n'
import type { BoardSize } from './types'

describe('offline lesson localization', () => {
  it('builds the fallback from canonical lesson data and restores English after a locale switch', () => {
    const englishLesson = FALLBACK_CURRICULUM.lessons.find((lesson) => lesson.id === 'opening-compass')
    expect(englishLesson).toBeDefined()

    const arabicLesson = localizeLesson(englishLesson!, 'ar')
    const canonicalLesson = canonicalLessonForStart(FALLBACK_CURRICULUM, arabicLesson)
    const fallbackGame = localGameForLesson(canonicalLesson, 'human_companion')
    const arabicGame = localizeGame(fallbackGame, 'ar')
    const englishGame = localizeGame(fallbackGame, 'en')

    expect(canonicalLesson).toBe(englishLesson)
    expect(arabicGame.title).not.toBe(englishLesson!.title)
    expect(arabicGame.objective).not.toBe('Choose any legal opening and name the intention behind it.')
    expect(arabicGame.coach_messages[0].text).not.toBe(englishLesson!.story)
    expect(arabicGame.coach_messages[0].prompt).not.toBe(englishLesson!.memory_line)
    expect(englishGame.title).toBe('Opening Compass')
    expect(englishGame.objective).toBe('Choose any legal opening and name the intention behind it.')
    expect(englishGame.coach_messages[0].text).toBe(englishLesson!.story)
    expect(englishGame.coach_messages[0].prompt).toBe(englishLesson!.memory_line)
  })

  it('keeps the offline 19x19 route empty, ordinary, and mechanically honest', () => {
    const lesson = FALLBACK_CURRICULUM.lessons.find((item) => item.id === 'full-landscape-19')
    expect(lesson).toBeDefined()

    const game = localGameForLesson(lesson!, 'human_companion')
    expect(game.board_size).toBe(19)
    expect(game.stones).toEqual([])
    expect(game.rules).toMatchObject({
      scoring: 'chinese_area',
      ko_rule: 'positional_superko',
      training_variant: undefined,
    })
    expect(game.objective).toContain('normal 19×19 game')
    expect(game.area_snapshot).toMatchObject({
      black_stones: 0,
      white_stones: 0,
      neutral_points: 361,
      adjudicated: false,
    })

    const before = JSON.stringify(game)
    const preview = localPreviewForPoint(game, { x: 3, y: 3 }, 'claim', 'en')
    expect(preview).toMatchObject({
      game_id: game.id,
      revision: game.revision,
      coordinate: 'D16',
      legal: false,
    })
    expect(JSON.stringify(game)).toBe(before)
  })

  it('creates the full-board request from the selected canonical lesson', () => {
    const lesson = FALLBACK_CURRICULUM.lessons.find((item) => item.id === 'full-landscape-19')!
    expect(createGameRequestForLesson(lesson, DEFAULT_PREFERENCES)).toMatchObject({
      lesson_id: 'full-landscape-19',
      board_size: 19,
      mode: 'human_companion',
      human_color: 'black',
      companion: DEFAULT_PREFERENCES.companion,
    })
  })

  it('restores 19x19 preferences while rejecting hidden or malformed sizes', () => {
    const stored = preferencesFromStoredValue(JSON.stringify({
      ...DEFAULT_PREFERENCES,
      board_size: 19,
    }))
    expect(stored.board_size).toBe(19)
    expect(preferencesFromStoredValue(JSON.stringify({ board_size: 13 })).board_size).toBe(9)
    expect(preferencesFromStoredValue('{not-json').board_size).toBe(9)
  })

  it('localizes every canonical 19x19 lesson and game field in all 11 languages', () => {
    const englishLesson = FALLBACK_CURRICULUM.lessons.find(
      (item) => item.id === 'full-landscape-19',
    )!
    const englishGame = localGameForLesson(englishLesson, 'human_companion')

    for (const locale of SUPPORTED_LOCALES) {
      const lesson = localizeLesson(englishLesson, locale)
      const game = localizeGame(englishGame, locale)
      if (locale === 'en') {
        expect(lesson.title).toBe(englishLesson.title)
        expect(game.objective).toBe(englishGame.objective)
        continue
      }
      expect(lesson.title, `${locale}:title`).not.toBe(englishLesson.title)
      expect(lesson.subtitle, `${locale}:subtitle`).not.toBe(englishLesson.subtitle)
      expect(lesson.story, `${locale}:story`).not.toBe(englishLesson.story)
      expect(lesson.memory_line, `${locale}:memory`).not.toBe(englishLesson.memory_line)
      expect(lesson.concepts, `${locale}:concepts`).not.toEqual(englishLesson.concepts)
      expect(game.objective, `${locale}:objective`).not.toBe(englishGame.objective)
      expect(game.coach_messages[0].text, `${locale}:coach story`).not.toBe(englishLesson.story)
      expect(game.coach_messages[0].prompt, `${locale}:coach memory`).not.toBe(englishLesson.memory_line)
    }
  })

  it('uses only advertised public board sizes and keeps 19 in offline fallback', () => {
    expect(selectableBoardSizes(FALLBACK_STATUS)).toEqual([5, 7, 9, 19])
    expect(selectableBoardSizes({
      ...FALLBACK_STATUS,
      supported_board_sizes: [5, 9, 19],
    })).toEqual([5, 9, 19])
    expect(selectableBoardSizes({
      ...FALLBACK_STATUS,
      supported_board_sizes: [5, 13, 19] as unknown as BoardSize[],
    })).toEqual([5, 19])
  })
})
