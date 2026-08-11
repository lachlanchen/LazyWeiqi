import { describe, expect, it } from 'vitest'
import {
  candidateReasoning,
  candidateQualityComparison,
  evaluationSummary,
  scoreImpactSummary,
  scoreVolatilitySummary,
  tacticsSummary,
  variationSummary,
} from './candidateEvidence'
import { ADDITIONAL_TEACHING_LOCALES } from './lessonTranslations.additional'
import { translate } from './i18n'
import type { CandidateMove, CandidateScoreImpact } from './types'

const TOP: CandidateMove = {
  id: 'm_top',
  point: { x: 4, y: 4 },
  coordinate: 'E5',
  intent: 'claim',
  title: 'Build ground',
  summary: 'Compare this move.',
  verified: true,
}

it('states both the fixed Black perspective and the White mover sign', () => {
  const score: CandidateScoreImpact = {
    before: 2,
    after: 3,
    delta: 1,
    mover_delta: -1,
    perspective: 'black',
    evidence: 'engine',
  }

  expect(scoreImpactSummary(score, 'white')).toContain(
    'For White as the mover, the signed forecast change is −1.0',
  )
})

describe('candidate comparison language', () => {
  it('keeps rank and score forecast separate when they disagree', () => {
    const candidate: CandidateMove = {
      ...TOP,
      id: 'm_second',
      coordinate: 'C3',
      score: {
        before: 0,
        after: 0.3,
        delta: 0.3,
        difference_from_top: 0.3,
        perspective: 'black',
        evidence: 'engine',
      },
    }

    expect(candidateQualityComparison(candidate, TOP, 'black')).toBe(
      'For Black, the score forecast is about 0.3 points above E5, although KataGo ranks this move lower by its overall selection value.',
    )
  })

  it('describes score spread as biased-high relative volatility, not confidence', () => {
    const summary = scoreVolatilitySummary({
      before: 0,
      after: 0,
      delta: 0,
      perspective: 'black',
      evidence: 'engine',
      outcome_spread_after: 7.2,
    })
    expect(summary).toContain('biased high')
    expect(summary).toContain('relative search volatility')
    expect(summary).not.toContain('confidence')
  })

  it('keeps Japanese engine visit evidence fully localized', () => {
    const summary = evaluationSummary({
      perspective: 'black',
      evidence: 'engine',
      winrate_after: 0.54,
      visits: 900,
    }, 'ja')

    expect(summary).toContain('この分岐の訪問回数は 900 回')
    expect(summary).not.toContain('visits')
  })

  it('localizes exact tactics, score wrappers, colors, and pass for every added locale', () => {
    const tacticAnchors = {
      ar: 'يلتقط',
      es: 'captura',
      fr: 'capture',
      ko: '잡음',
      vi: 'bắt',
      'zh-Hant': '提',
      de: 'schlägt',
      ru: 'снимает',
    } as const
    const candidate: CandidateMove = {
      ...TOP,
      variation: [
        { color: 'black', kind: 'play', point: { x: 2, y: 2 } },
        { color: 'white', kind: 'pass', point: null },
      ],
    }
    const tactics = {
      captures: [{ x: 1, y: 1 }],
      resulting_liberties: 3,
      connects: [],
      cuts: [{ x: 3, y: 3 }],
      friendly_groups_joined: 2,
      opponent_groups_newly_in_atari: 1,
      friendly_groups_escaped_atari: 1,
      self_atari: true,
      evidence: 'exact' as const,
    }
    const score: CandidateScoreImpact = {
      before: 1,
      after: 2,
      delta: 1,
      mover_delta: 1,
      perspective: 'black',
      evidence: 'engine',
    }

    for (const locale of ADDITIONAL_TEACHING_LOCALES) {
      const tacticText = tacticsSummary(tactics, false, locale)
      const scoreText = scoreImpactSummary(score, 'black', locale)
      const line = variationSummary(candidate, 9, locale)

      expect(tacticText, locale).toContain(tacticAnchors[locale])
      expect(tacticText, locale).not.toMatch(/captures|resulting liberties|friendly groups|opposing group|self-atari warning/)
      expect(scoreText, locale).not.toContain('Current-position smoothed final-score forecast')
      expect(line, locale).toContain(translate(locale, 'board.black'))
      expect(line, locale).toContain(translate(locale, 'board.white'))
      expect(line, locale).toContain(translate(locale, 'play.pass'))
      expect(line, locale).not.toMatch(/\b(?:Black|White|pass)\b/)
      if (locale !== 'zh-Hant') {
        expect(`${tacticText} ${scoreText} ${line}`, locale).not.toMatch(/子を取る|結果は .*ダメ|パスは|相手の一団/)
      }
    }
  })

  it('keeps unknown provider reasoning byte-identical while localizing only deterministic fallbacks', () => {
    const providerWhy = 'Provider prose :: leave punctuation & casing EXACT.'
    const providerChanges = 'MODEL_OUTPUT[Δ=raw]'
    const providerNext = 'Engine says: maybe Q16?'
    const candidate: CandidateMove = {
      ...TOP,
      why_here: providerWhy,
      what_changes: providerChanges,
      next_calculation: providerNext,
    }

    for (const locale of ADDITIONAL_TEACHING_LOCALES) {
      expect(candidateReasoning(candidate, locale)).toEqual({
        why: providerWhy,
        changes: providerChanges,
        next: providerNext,
      })
    }
  })
})
