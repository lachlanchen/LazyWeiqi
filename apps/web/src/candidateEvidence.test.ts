import { describe, expect, it } from 'vitest'
import {
  candidateQualityComparison,
  scoreImpactSummary,
  scoreVolatilitySummary,
} from './candidateEvidence'
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
})
