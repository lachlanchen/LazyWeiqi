import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { CandidateMove, OpeningTeaching, OpeningTeachingDiagram, Stone } from '../types'
import {
  LocalShapeDiagram,
  OpeningEvidenceCards,
  OpeningEngineProvenanceCard,
  requestOpeningDeepStudy,
  TeachingLineDiagram,
  verifiedAfterStones,
  WholeBoardDiagram,
} from './OpeningReading'

const capturedPoint = { x: 3, y: 2 }
const candidatePoint = { x: 3, y: 3 }
const currentStones: Stone[] = [
  { ...capturedPoint, color: 'white' },
  { x: 4, y: 4, color: 'black' },
]
const localDiagram: OpeningTeachingDiagram = {
  diagram_type: 'local_shape',
  crop: { min_x: 0, min_y: 0, max_x: 8, max_y: 8 },
  verified_current_stones: currentStones.map(({ x, y, color }) => ({ point: { x, y }, color })),
  candidate: { point: candidatePoint, color: 'black' },
  steps: [],
  line_kind: 'authored_context',
  not_forced: true,
}
const wholeDiagram: OpeningTeachingDiagram = {
  ...localDiagram,
  diagram_type: 'whole_board_direction',
  crop: { min_x: 0, min_y: 0, max_x: 18, max_y: 18 },
}
const contextDiagram: OpeningTeachingDiagram = {
  ...localDiagram,
  diagram_type: 'corner_sequence',
  steps: [{
    order: 1,
    kind: 'extension',
    point: { x: 8, y: 3 },
    coordinate: 'J16',
    label_id: 'extend_top',
    why_id: 'extend_along_open_side',
    gain_id: 'top_side_option',
    loss_id: 'corner_not_secured',
    evidence: 'authored',
  }],
}

const teaching = {
  teaching_diagrams: [localDiagram, wholeDiagram, contextDiagram],
  territory: { zones: [] },
  influence: { vectors: [] },
  follow_ups: [],
  reply_anchors: [],
} as unknown as OpeningTeaching

const captureCandidate = {
  id: 'm_capture_preview',
  kind: 'play',
  point: candidatePoint,
  coordinate: 'D16',
  intent: 'pressure',
  title: 'unused localized copy id',
  summary: 'unused localized copy id',
  legal_verified: true,
  verified: true,
  tactics: {
    captures: [capturedPoint],
    resulting_liberties: 3,
    resulting_group_size: 1,
    connects: [],
    cuts: [],
    friendly_groups_joined: 0,
    opponent_groups_newly_in_atari: 0,
    friendly_groups_escaped_atari: 0,
    self_atari: false,
    evidence: 'exact',
  },
  opening_teaching: teaching,
} as CandidateMove

describe('opening deep study', () => {
  it('requests reflection and closes without exposing a move commit', () => {
    const events: string[] = []
    const request = vi.fn(() => events.push('request'))
    const close = vi.fn(() => events.push('close'))

    requestOpeningDeepStudy(request, close)

    expect(events).toEqual(['request', 'close'])
    expect(request).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
  })

  it('still restores the board view if a synchronous request fails', () => {
    const close = vi.fn()

    expect(() => requestOpeningDeepStudy(() => {
      throw new Error('request failed')
    }, close)).toThrow('request failed')
    expect(close).toHaveBeenCalledOnce()
  })
})

describe('opening textbook diagram board states', () => {
  it('derives an immutable verified after-state from exact captures', () => {
    const after = verifiedAfterStones(currentStones, candidatePoint, 'black', [capturedPoint])

    expect(currentStones).toContainEqual({ ...capturedPoint, color: 'white' })
    expect(after).not.toContainEqual({ ...capturedPoint, color: 'white' })
    expect(after).toContainEqual({ ...candidatePoint, color: 'black' })
  })

  it('keeps the captured stone in the local before diagram and removes it from after', () => {
    const before = renderToStaticMarkup(
      createElement(LocalShapeDiagram, { size: 19, stones: currentStones, toPlay: 'black', candidate: captureCandidate, after: false, label: 'before' }),
    )
    const after = renderToStaticMarkup(
      createElement(LocalShapeDiagram, { size: 19, stones: currentStones, toPlay: 'black', candidate: captureCandidate, after: true, label: 'after' }),
    )

    expect(before).toContain('data-point="3:2"')
    expect(before).toContain('data-stone-state="verified-current"')
    expect(after).not.toContain('data-point="3:2"')
    expect(after).toContain('data-point="3:3"')
    expect(after).toContain('data-stone-state="candidate-preview"')
  })

  it('removes exact captures from the whole-board candidate preview', () => {
    const html = renderToStaticMarkup(
      createElement(WholeBoardDiagram, {
        size: 19,
        stones: currentStones,
        toPlay: 'black',
        candidate: captureCandidate,
        teaching,
        label: 'whole board',
        anchorLabel: () => 'anchor',
      }),
    )

    expect(html).not.toContain('data-point="3:2"')
    expect(html).toContain('data-point="3:3"')
    expect(html).toContain('data-stone-state="candidate-preview"')
  })

  it('uses the verified after-state under explicitly authored, non-forced context', () => {
    const html = renderToStaticMarkup(
      createElement(TeachingLineDiagram, {
        diagram: contextDiagram,
        candidateId: captureCandidate.id,
        label: 'Illustrative context · not forced',
        stepLabel: () => 'next step',
        exactCaptures: [capturedPoint],
      }),
    )

    expect(html).not.toContain('data-point="3:2"')
    expect(html).toContain('data-point="3:3"')
    expect(html).toContain('data-board-state="verified-after-candidate-preview"')
    expect(html).toContain('data-overlay-state="authored-context-not-forced"')
    expect(html).toContain('aria-label="Illustrative context · not forced"')
  })
})

describe('opening evidence lanes', () => {
  it('keeps exact shape facts separate from calculated shape assessment', () => {
    const html = renderToStaticMarkup(
      createElement(OpeningEvidenceCards, {
        summaries: {
          shape: '4 liberties · 0 connections',
          territory: 'corner potential',
          influence: 'two directions',
          joseki: 'entry context',
        },
        thickness: 'Single stone — not thick',
        weaknesses: ['Can be approached'],
        territoryNote: 'Potential, not secured territory',
        balanceEffect: 'Adds one option',
        josekiNote: 'Illustrative, not forced',
      }),
    )
    const exactCard = html.match(/<article[^>]*data-testid="opening-shape-exact-card"[\s\S]*?<\/article>/)?.[0] ?? ''
    const assessmentCard = html.match(/<article[^>]*data-testid="opening-shape-assessment"[\s\S]*?<\/article>/)?.[0] ?? ''

    expect(exactCard).toContain('data-evidence="exact"')
    expect(exactCard).toContain('4 liberties · 0 connections')
    expect(exactCard).not.toContain('Single stone — not thick')
    expect(assessmentCard).toContain('data-evidence="calculated_potential"')
    expect(assessmentCard).toContain('Calculated potential')
    expect(assessmentCard).toContain('Single stone — not thick · Can be approached')
  })

  it('exposes candidate-bound engine scope without upgrading root-only evidence', () => {
    const candidateBound = renderToStaticMarkup(
      createElement(OpeningEngineProvenanceCard, {
        engine: {
          available: true,
          evidence: 'engine',
          profile: 'quality',
          model_sha256: 'a'.repeat(64),
          requested_visits: 512,
          actual_visits: 512,
          perspective: 'black',
          candidate_analyzed: true,
          binding: {
            state_token: 'state', position_hash: 'position', history_digest: 'history',
            move_number: 0, side_to_move: 'black', board_size: 19, query_sha256: 'b'.repeat(64),
          },
        },
      }),
    )
    const rootOnly = renderToStaticMarkup(
      createElement(OpeningEngineProvenanceCard, {
        engine: {
          available: true,
          evidence: 'engine',
          profile: 'fast',
          model_sha256: 'c'.repeat(64),
          requested_visits: 96,
          actual_visits: 96,
          perspective: 'black',
          candidate_analyzed: false,
          binding: {
            state_token: 'state', position_hash: 'position', history_digest: 'history',
            move_number: 0, side_to_move: 'black', board_size: 19, query_sha256: 'd'.repeat(64),
          },
        },
      }),
    )

    expect(candidateBound).toContain('data-engine-available="true"')
    expect(candidateBound).toContain('data-candidate-analyzed="true"')
    expect(candidateBound).toContain('data-profile="quality"')
    expect(candidateBound).toContain('This supports comparison; it is not a territory fact')
    expect(candidateBound).not.toContain('KataGo-ranked')
    expect(rootOnly).toContain('data-engine-available="true"')
    expect(rootOnly).toContain('data-candidate-analyzed="false"')
    expect(rootOnly).toContain('No engine support is claimed')
    expect(rootOnly).toContain('Engine evidence is not attached to this reading')
    expect(rootOnly).not.toContain('KataGo-ranked')
  })
})
