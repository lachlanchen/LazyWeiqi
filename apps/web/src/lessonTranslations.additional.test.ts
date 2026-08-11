import { describe, expect, it } from 'vitest'
import {
  ADDITIONAL_LESSON_IDS,
  ADDITIONAL_TEACHING_LOCALES,
  DETERMINISTIC_ACTS,
  KNOWN_NAMES,
  deterministicActsAdditional,
  knownNamesAdditional,
  lessonTranslationsAdditional,
} from './lessonTranslations.additional'

describe('additional authored lesson translations', () => {
  it('has exact lesson and field parity in every locale', () => {
    for (const locale of ADDITIONAL_TEACHING_LOCALES) {
      const lessons = lessonTranslationsAdditional[locale]
      expect(Object.keys(lessons).sort(), locale).toEqual([...ADDITIONAL_LESSON_IDS].sort())

      for (const lessonId of ADDITIONAL_LESSON_IDS) {
        const lesson = lessons[lessonId]
        expect(Object.keys(lesson).sort(), `${locale}:${lessonId}`).toEqual([
          'concepts',
          'memory',
          'objective',
          'story',
          'subtitle',
          'title',
        ])
        expect(lesson.title.trim(), `${locale}:${lessonId}:title`).not.toBe('')
        expect(lesson.subtitle.trim(), `${locale}:${lessonId}:subtitle`).not.toBe('')
        expect(lesson.story.trim(), `${locale}:${lessonId}:story`).not.toBe('')
        expect(lesson.objective.trim(), `${locale}:${lessonId}:objective`).not.toBe('')
        expect(lesson.memory.trim(), `${locale}:${lessonId}:memory`).not.toBe('')
        expect(lesson.concepts.length, `${locale}:${lessonId}:concepts`).toBeGreaterThan(0)
      }
    }
  })

  it('localizes every opening-compass teaching field and preserves its rule meaning', () => {
    const english = {
      title: 'Choose a Promise',
      subtitle: 'Your first real 9×9 opening',
      story: 'The valley is empty. Your first stone does not own it—it makes a promise.',
      objective: 'Choose any legal opening and name the intention behind it.',
      memory: 'A first move is a promise, not territory already owned.',
    }

    for (const locale of ADDITIONAL_TEACHING_LOCALES) {
      const opening = lessonTranslationsAdditional[locale]['opening-compass']
      for (const field of Object.keys(english) as (keyof typeof english)[]) {
        expect(opening[field], `${locale}:opening-compass:${field}`).not.toBe(english[field])
      }
      expect(opening.subtitle, locale).toContain('9×9')
    }
  })

  it('preserves the authored tactical coordinates', () => {
    for (const locale of ADDITIONAL_TEACHING_LOCALES) {
      expect(lessonTranslationsAdditional[locale]['breath-5'].objective, locale).toContain('C3')
      const bridgeObjective = lessonTranslationsAdditional[locale]['bridge-5'].objective
      expect(bridgeObjective, locale).toContain('B3')
      expect(bridgeObjective, locale).toContain('D3')
    }
  })

  it('has exact deterministic-act and known-name locale parity', () => {
    expect(Object.keys(deterministicActsAdditional).sort()).toEqual([...DETERMINISTIC_ACTS].sort())
    expect(Object.keys(knownNamesAdditional).sort()).toEqual([...KNOWN_NAMES].sort())

    for (const act of DETERMINISTIC_ACTS) {
      expect(Object.keys(deterministicActsAdditional[act]).sort(), act).toEqual(
        [...ADDITIONAL_TEACHING_LOCALES].sort(),
      )
    }
    for (const name of KNOWN_NAMES) {
      expect(Object.keys(knownNamesAdditional[name]).sort(), name).toEqual(
        [...ADDITIONAL_TEACHING_LOCALES].sort(),
      )
    }
  })

  it('uses formal French and German address across lessons and related labels', () => {
    expect(lessonTranslationsAdditional.fr['roads-7'].subtitle).toBe(
      'Fuyez, stabilisez-vous ou retournez combattre',
    )
    expect(lessonTranslationsAdditional.fr['opening-compass'].objective).toBe(
      'Choisissez n’importe quel premier coup légal et nommez son intention.',
    )
    expect(lessonTranslationsAdditional.de['first-expedition'].objective).toBe(
      'Spielen Sie, bis beide Seiten passen, prüfen Sie die mechanische Flächenübersicht und erkennen Sie ungeklärte Gruppen, bevor Sie ein Endergebnis nennen.',
    )
    expect(lessonTranslationsAdditional.de['hunt-run-settle'].story).toBe(
      'Die Jagd beginnt. Entscheiden Sie, ob Sie vorrücken, ausweichen, fliehen oder einen sicheren Ort bauen.',
    )
    expect(deterministicActsAdditional['Resolution · Read the finished landscape'].fr).toBe(
      'Dénouement · Lisez le paysage final',
    )
    expect(deterministicActsAdditional['Settlement · Turn potential into readable ground'].de).toBe(
      'Stabilisierung · Verwandeln Sie Potenzial in beurteilbaren Raum',
    )
    expect(knownNamesAdditional.You.fr).toBe('Vous')
    expect(knownNamesAdditional.You.de).toBe('Sie')

    const reviewedText = (locale: 'fr' | 'de') => [
      ...Object.values(lessonTranslationsAdditional[locale]).flatMap((lesson) => [
        lesson.title,
        lesson.subtitle,
        lesson.story,
        lesson.objective,
        lesson.memory,
        ...lesson.concepts,
      ]),
      ...Object.values(deterministicActsAdditional).map((act) => act[locale]),
      ...Object.values(knownNamesAdditional).map((name) => name[locale]),
    ].join('\n')

    const french = reviewedText('fr')
    expect(french).not.toMatch(
      /(?:^|[\s,.;:!?«»(])(?:tu|te|toi|ton|ta|tes)(?=$|[\s,.;:!?«»)])/iu,
    )
    expect(french).not.toMatch(/demande-toi|stabilise-toi/u)
    expect(french).not.toMatch(
      /(?:^|[\s.;:!?·])(?:Lis|Fais|Vois|Trouve|Donne|Connecte|Fuis|Retourne|Décide|Crée|Choisis|Nomme|Termine|Mène|Joue|Examine|Repère|Utilise|Raconte|Observe|Compte|Construis|Combats|Dresse|Garde|Forme|Ressens|Apprends|Distingue|Poursuis|Attaque|Tire|Transforme)(?=$|[\s,.;:!?])/u,
    )
    expect(french).not.toMatch(/; règle\b/u)

    const german = reviewedText('de')
    expect(german).not.toMatch(
      /(?:^|[\s,.;:!?„“(])(?:du|dich|dir|dein|deine|deinen|deinem|deiner|deines)(?=$|[\s,.;:!?„“)])\b/iu,
    )
    expect(german).not.toMatch(
      /(?:^|[\s.;:!?·])(?:Lies|Sieh|Finde|Gib|Verbinde|Entscheide|Schaffe|Wähle|Benenne|Beende|Führe|Spiele|Prüfe|Erkenne|Nutze|Erzähle|Besprich|Zähle|Baue|Errichte|Halte|Bilde|Spüre|Lerne|Unterscheide|Gewinne|Greife|Verwandle)(?=$|[\s,.;:!?])/u,
    )
    expect(german).not.toMatch(/(?:^|[\s.;:!?])frage(?=$|[\s,.;:!?])/u)
    expect(german).not.toMatch(/; kläre\b/u)
  })
})
