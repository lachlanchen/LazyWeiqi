import { describe, expect, it } from 'vitest'
import { canonicalLessonForStart, localGameForLesson } from './App'
import { FALLBACK_CURRICULUM } from './fallbackData'
import { localizeGame, localizeLesson } from './i18n'

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
})
