import { describe, expect, it } from 'vitest'
import {
  AUTHORED_LOCALES,
  AUTHORED_TRANSLATION_KEYS,
  localizeAuthoredTemplate,
  localizeAuthoredText,
} from './authoredCopy'

const appFallbacks = [
  'This is an authored question, not a legal reading. Reconnect the rules service to verify and commit it.',
  'That intersection is occupied.',
  'Breath question',
  'Liberties to verify',
  'Not yet read',
  'Use this prompt to form a hypothesis; only the live rules service supplies exact consequences.',
  'Explore this point',
  'Explore',
  'Authored prompt only. No legality, reply, or outcome is claimed while the service is offline.',
  'Reconnect before treating this as a playable candidate.',
  'Name what you expect to change, then reconnect the service to test the hypothesis.',
  'First ask which nearby string has the fewest liberties. Then look for a move that changes more than one relationship.',
  'The strongest contrast is usually not “good versus bad.” It is ground now versus options later. Select a point to make that trade visible.',
] as const

describe('authored client fallback copy', () => {
  it('has a non-English value for every deterministic App fallback in every locale', () => {
    for (const locale of AUTHORED_LOCALES) {
      for (const english of appFallbacks) {
        expect(localizeAuthoredText(locale, english), `${locale}:${english}`).not.toBe(english)
      }
    }
  })

  it('keeps unknown provider prose byte-identical', () => {
    const unknown = 'Provider-owned prose / capitalization / spacing:  A9.'
    for (const locale of AUTHORED_LOCALES) {
      expect(localizeAuthoredText(locale, unknown), locale).toBe(unknown)
    }
  })

  it('localizes the compact liberty badge without losing its count', () => {
    for (const locale of AUTHORED_LOCALES) {
      const badge = localizeAuthoredTemplate(locale, 'L{count}', { count: 4 })
      expect(badge, locale).toContain('4')
      expect(badge, locale).not.toBe('L4')
    }
  })

  it('preserves the reviewed 185-key shape and every template placeholder', () => {
    expect(AUTHORED_TRANSLATION_KEYS).toHaveLength(185)

    const placeholders = (value: string) =>
      [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()

    for (const english of AUTHORED_TRANSLATION_KEYS) {
      for (const locale of AUTHORED_LOCALES) {
        expect(placeholders(localizeAuthoredText(locale, english)), `${locale}:${english}`).toEqual(
          placeholders(english),
        )
      }
    }
  })

  it('uses formal French and German address throughout reviewed authored copy', () => {
    expect(
      localizeAuthoredText(
        'fr',
        'Your lower group has room to breathe. Before moving, ask whether you want ground, connection, or reach.',
      ),
    ).toBe(
      'Votre groupe du bas a de quoi respirer. Avant de jouer, demandez-vous si vous voulez du territoire, une connexion ou de la portée.',
    )
    expect(localizeAuthoredText('fr', 'Which promise should your next stone make?')).toBe(
      'Quelle promesse votre prochaine pierre doit-elle faire ?',
    )
    expect(
      localizeAuthoredText(
        'de',
        'Reconnect before treating this as a playable candidate.',
      ),
    ).toBe(
      'Stellen Sie die Verbindung wieder her, bevor Sie dies als spielbaren Kandidaten behandeln.',
    )
    expect(
      localizeAuthoredText(
        'de',
        'The opponent now has a group with one liberty. Check the reply before celebrating the pressure.',
      ),
    ).toBe(
      'Der Gegner hat nun eine Gruppe mit nur einer Freiheit. Prüfen Sie die Antwort, bevor Sie den Druck feiern.',
    )

    const french = AUTHORED_TRANSLATION_KEYS.map((key) => localizeAuthoredText('fr', key)).join('\n')
    expect(french).not.toMatch(
      /(?:^|[\s,.;:!?«»(])(?:tu|te|toi|ton|ta|tes)(?=$|[\s,.;:!?«»)])/iu,
    )
    expect(french).not.toMatch(/demande-toi/u)
    expect(french).not.toMatch(
      /(?:^|[\s.;:!?])(?:Passe|Vois|Trouve|Donne|Connecte|Fuis|Décide|Crée|Choisis|Joue|Utilise|Observe|Compte|Construis|Dresse|Forme|Ressens|Apprends|Distingue|Poursuis|Attaque|Tire)(?=$|[\s,.;:!?])/u,
    )

    const german = AUTHORED_TRANSLATION_KEYS.map((key) => localizeAuthoredText('de', key)).join('\n')
    expect(german).not.toMatch(
      /(?:^|[\s,.;:!?„“(])(?:du|dich|dir|dein|deine|deinen|deinem|deiner|deines)(?=$|[\s,.;:!?„“)])\b/iu,
    )
    expect(german).not.toMatch(
      /(?:^|[\s.;:!?])(?:Verbinde|Nutze|Stelle|Benenne|Wähle|Passe|lies|Schaffe|vergleiche|Prüfe|Lass|Warte|Finde|Gib|Übe|Zähle|Probiere|Schlage|Merke)(?=$|[\s,.;:!?])/u,
    )
    expect(german).not.toMatch(/\bFrage (?:vor|zuerst)\b/u)
    expect(german).not.toMatch(/\bfrage(?:,| ob)\b/u)
    expect(german).not.toMatch(/\bSuche (?:dann|nach)\b/u)
  })

  it('renders the corrected Arabic liberty and turn grammar', () => {
    expect(
      localizeAuthoredText(
        'ar',
        'The opponent now has a group with one liberty. Check the reply before celebrating the pressure.',
      ),
    ).toBe('لدى الخصم الآن مجموعة ذات حرية واحدة. افحص الرد قبل الاحتفال بالضغط.')
    expect(localizeAuthoredTemplate('ar', '{color} to move', { color: 'الأسود' })).toBe(
      'الدور: الأسود',
    )
    expect(
      localizeAuthoredTemplate(
        'ar',
        '{color} can legally play {coordinate}; the stone is still only a preview.',
        { color: 'الأسود', coordinate: 'C3' },
      ),
    ).toBe('يمكن أن يلعب الأسود قانونيًا عند C3؛ وما زال الحجر مجرد معاينة.')

    const arabic = AUTHORED_TRANSLATION_KEYS.map((key) => localizeAuthoredText('ar', key)).join('\n')
    expect(arabic).not.toContain('مجموعة بحرية واحدة')
    expect(arabic).not.toContain('الدور لـ{color}')
    expect(arabic).not.toContain('يمكن لـ{color} اللعب')
  })
})
