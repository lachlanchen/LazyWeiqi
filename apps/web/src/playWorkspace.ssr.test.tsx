import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { interfaceLayoutForPath, PlayWorkspace, shouldUseClientRouteSwitch } from './App'
import { DEFAULT_PREFERENCES, DEMO_GAME } from './fallbackData'
import type { AreaSnapshot, CandidateMove, GameState, MovePreview, Point } from './types'

const ownershipAfter = Array.from({ length: 81 }, (_, index) => ({
  x: index % 9,
  y: Math.floor(index / 9),
  value: index % 2 ? -0.42 : 0.54,
  variation: 0.16,
}))

const ownershipDelta = ownershipAfter.map((cell, index) => ({
  ...cell,
  value: index < 10 ? 0.18 : index > 70 ? -0.14 : 0.01,
}))

const currentArea: AreaSnapshot = {
  status: 'mechanical_all_stones_alive',
  black_stones: 0,
  black_enclosed_empty: 0,
  black_total: 0,
  white_stones: 0,
  white_enclosed_empty: 0,
  komi: 7.5,
  white_total: 7.5,
  neutral_points: 81,
  adjudicated: false,
}

const ifPlayedArea: AreaSnapshot = {
  ...currentArea,
  black_stones: 1,
  black_total: 1,
  neutral_points: 80,
}

const suggestion: CandidateMove = {
  id: 'm_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  kind: 'play',
  point: { x: 2, y: 2 },
  coordinate: 'C7',
  intent: 'claim',
  intent_evidence: 'teacher',
  title: 'Start from an efficient corner shape',
  summary: 'Use the two nearby edges while keeping room toward the center.',
  main_line_reply: 'One engine line continues with White at G7; it is not forced.',
  risk: 'An open corner is a beginning, not settled territory.',
  tactics: {
    captures: [],
    resulting_liberties: 4,
    resulting_group_size: 1,
    connects: [],
    cuts: [],
    friendly_groups_joined: 0,
    opponent_groups_newly_in_atari: 0,
    friendly_groups_escaped_atari: 0,
    self_atari: false,
    evidence: 'exact',
  },
  score: {
    before: -7.5,
    after: -7.1,
    delta: 0.4,
    mover_delta: 0.4,
    difference_from_top: 0,
    perspective: 'black',
    evidence: 'engine',
  },
  evaluation: {
    perspective: 'black',
    evidence: 'engine',
    order: 0,
    visits: 800,
  },
  ownership_after: ownershipAfter,
  ownership_delta: ownershipDelta,
  ownership_perspective: 'black',
  why_here: 'This move uses the corner edges without pretending the corner is already yours.',
  what_changes: 'It creates one stone with four liberties and changes the ownership forecast nearby.',
  next_calculation: 'Read White’s best approach and Black’s direction of reply.',
  legal_verified: true,
  engine_analyzed: true,
  verified: true,
}

const freshGame: GameState = {
  ...DEMO_GAME,
  id: 'game_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  title: 'Fresh 9×9 game',
  move_count: 0,
  stones: [],
  moves: [],
  act: 'Arrival · Make the first promise',
  analysis: {
    status: 'ready',
    engine: 'KataGo',
    ownership_perspective: 'black',
    facets: [],
    candidates: [suggestion],
  },
}

function renderWorkspace({
  game = freshGame,
  operation = 'idle' as const,
  analysisLoading = false,
  selected = null as Point | null,
  preview = null as MovePreview | null,
  selectedCandidateId = null as string | null,
  layout = 'classic' as const,
}: {
  game?: GameState
  operation?: 'idle' | 'previewing'
  analysisLoading?: boolean
  selected?: Point | null
  preview?: MovePreview | null
  selectedCandidateId?: string | null
  layout?: 'classic' | 'simple'
} = {}) {
  return renderToStaticMarkup(
    <PlayWorkspace
      layout={layout}
      game={game}
      preferences={DEFAULT_PREFERENCES}
      operation={operation}
      analysisLoading={analysisLoading}
      selected={selected}
      preview={preview}
      intent="unsure"
      activeLenses={new Set(['cloud', 'area'])}
      selectedCandidateId={selectedCandidateId}
      engineAvailable
      coachStatus={{ status: 'ready', provider: 'Local teacher' }}
      coachHistoryLoading={false}
      coachHistoryError={null}
      theatreAutoPlay={false}
      onBack={() => undefined}
      onSelect={() => undefined}
      onCancelSelection={() => undefined}
      onCommit={() => undefined}
      onPass={() => undefined}
      onRewind={() => undefined}
      onIntentChange={() => undefined}
      onLensToggle={() => undefined}
      onCandidateSelect={() => undefined}
      onAsk={() => undefined}
      onLoadOlderCoachHistory={() => undefined}
      onDelegate={() => undefined}
      onAgentTurn={() => undefined}
      onTheatreAutoPlay={() => undefined}
      onOpenReview={() => undefined}
    />,
  )
}

describe('simple interface route contract', () => {
  it('uses the simple interface at the root and keeps explicit aliases', () => {
    expect(interfaceLayoutForPath('/')).toBe('simple')
    expect(interfaceLayoutForPath('/simple')).toBe('simple')
    expect(interfaceLayoutForPath('/simple/')).toBe('simple')
    expect(interfaceLayoutForPath('/full')).toBe('classic')
    expect(interfaceLayoutForPath('/full/')).toBe('classic')
    expect(interfaceLayoutForPath('/chronicle')).toBe('classic')
  })

  it('keeps modified and non-primary route clicks available to the browser', () => {
    const plainClick = {
      button: 0,
      defaultPrevented: false,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
    }

    expect(shouldUseClientRouteSwitch(plainClick)).toBe(true)
    expect(shouldUseClientRouteSwitch({ ...plainClick, button: 1 })).toBe(false)
    expect(shouldUseClientRouteSwitch({ ...plainClick, ctrlKey: true })).toBe(false)
    expect(shouldUseClientRouteSwitch({ ...plainClick, metaKey: true })).toBe(false)
    expect(shouldUseClientRouteSwitch({ ...plainClick, shiftKey: true })).toBe(false)
    expect(shouldUseClientRouteSwitch({ ...plainClick, altKey: true })).toBe(false)
    expect(shouldUseClientRouteSwitch({ ...plainClick, defaultPrevented: true })).toBe(false)
  })

  it('reuses the exact interactive board and candidate controls in the compact workspace', () => {
    const html = renderWorkspace({ layout: 'simple' })

    expect(html).toContain('class="play-view simple-play"')
    expect(html).toContain('data-testid="play-workspace" data-layout="simple"')
    expect(html).toContain('data-testid="weiqi-board"')
    expect(html).toContain('data-testid="candidate-list"')
    expect(html).toContain('data-density="compact"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('data-testid="power-teacher"')
    expect(html).toContain('data-testid="energy-lenses"')
    expect(html).toContain('data-testid="move-controls"')
    expect(html).toContain('data-testid="coach-input"')
    expect(html).toContain('data-testid="suggested-first-stone"')
    expect(html).not.toContain('data-testid="commit-move"')
  })

  it('keeps the classic workspace class when no compact layout is requested', () => {
    const html = renderWorkspace()

    expect(html).toContain('data-testid="play-workspace" data-layout="classic"')
    expect(html).toContain('data-density="full"')
    expect(html).not.toContain('simple-play')
  })
})

describe('unconfirmed first-move analysis flow', () => {
  it('keeps the strongest passive comparison visible in agent theatre', () => {
    const html = renderWorkspace({
      game: {
        ...freshGame,
        mode: 'agent_vs_agent',
        actors: [
          { id: 'black-agent', name: 'River', role: 'player_agent', color: 'black', doctrine: 'balanced' },
          { id: 'white-agent', name: 'Stone', role: 'player_agent', color: 'white', doctrine: 'balanced' },
        ],
      },
    })

    expect(html).toContain('data-candidate-mode="candidate-comparison"')
    expect(html).toContain('data-testid="candidate-field-key"')
    expect(html).toContain('data-candidate-id="m_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"')
    expect(html).not.toContain('data-testid="suggested-first-stone"')
  })

  it('shows the supplied first-stone suggestion before any click without exposing confirmation', () => {
    const html = renderWorkspace()

    expect(html).toContain('data-analysis-state="suggested-first-stone"')
    expect(html).toContain('data-testid="suggested-first-stone"')
    expect(html).toContain('data-coordinate="C7"')
    expect(html).toContain('Suggested first: C7')
    expect(html).toContain('Suggested first stone: C7. Nothing has been placed.')
    expect(html).toContain('data-testid="suggested-first-stone-card"')
    expect(html).toContain('Suggested first stone · KataGo order 1')
    expect(html).not.toContain('data-testid="commit-move"')
  })

  it('labels the actual engine rank when pass is ranked before the suggested play', () => {
    const passCandidate: CandidateMove = {
      ...suggestion,
      id: 'm_cccccccccccccccccccccccccccccccc',
      kind: 'pass',
      point: null,
      coordinate: 'pass',
      evaluation: { ...suggestion.evaluation!, order: 0 },
    }
    const secondRankedPlay: CandidateMove = {
      ...suggestion,
      evaluation: { ...suggestion.evaluation!, order: 1 },
    }
    const html = renderWorkspace({
      game: {
        ...freshGame,
        analysis: {
          ...freshGame.analysis!,
          candidates: [passCandidate, secondRankedPlay],
        },
      },
    })

    expect(html).toContain('Suggested first stone · KataGo order 2')
    expect(html).not.toContain('Suggested first stone · KataGo order 1')
  })

  it('shows analyzing immediately after one board selection and withholds Place stone', () => {
    const html = renderWorkspace({
      operation: 'previewing',
      selected: { x: 4, y: 5 },
    })

    expect(html).toContain('data-testid="unconfirmed-analysis"')
    expect(html).toContain('data-analysis-state="analyzing"')
    expect(html).toContain('data-selected-coordinate="E4"')
    expect(html).toContain('data-selection-state="move-preview"')
    expect(html).toContain('data-selection-clearable="true"')
    expect(html).toContain('data-context-action="clear-selection"')
    expect(html).toContain('aria-keyshortcuts="Escape"')
    expect(html).toContain('right-click board or Esc to unselect')
    expect(html).toContain('Analyzing if black plays E4')
    expect(html).toContain('No stone has been placed')
    expect(html).toContain('data-testid="analysis-before-confirmation"')
    expect(html).not.toContain('data-testid="commit-move"')
  })

  it('marks a pinned candidate as dismissible back to agent suggestions', () => {
    const html = renderWorkspace({ selectedCandidateId: suggestion.id })

    expect(html).toContain('data-selection-state="pinned-candidate"')
    expect(html).toContain('data-candidate-mode="pinned-candidate"')
    expect(html).toContain('data-selection-clearable="true"')
    expect(html).toContain('data-context-action="clear-selection"')
    expect(html).toContain('data-testid="selection-dismiss-hint"')
    expect(html).toContain('data-testid="back-to-suggestions"')
    expect(html).toContain('right-click board or press Esc to return to agent suggestions')
  })

  it('gives a pinned theatre candidate a touch-accessible return action', () => {
    const html = renderWorkspace({
      game: {
        ...freshGame,
        mode: 'agent_vs_agent',
        actors: [
          { id: 'black-agent', name: 'River', role: 'player_agent', color: 'black', doctrine: 'balanced' },
          { id: 'white-agent', name: 'Stone', role: 'player_agent', color: 'white', doctrine: 'balanced' },
        ],
      },
      selectedCandidateId: suggestion.id,
    })

    expect(html).toContain('data-selection-state="pinned-candidate"')
    expect(html).toContain('data-candidate-mode="pinned-candidate"')
    expect(html).toContain('data-testid="back-to-suggestions"')
    expect(html).toContain('Back to suggestions')
  })

  it('leaves the browser context action alone when showing passive agent suggestions', () => {
    const html = renderWorkspace()

    expect(html).toContain('data-selection-state="agent-suggestions"')
    expect(html).toContain('data-selection-clearable="false"')
    expect(html).toContain('data-context-action="browser-default"')
    expect(html).not.toContain('aria-keyshortcuts="Escape"')
  })

  it('shows the clicked point’s if-played map, score, and teacher before separate confirmation', () => {
    const point = { x: 4, y: 5 }
    const clickedTeaching: CandidateMove = {
      ...suggestion,
      id: 'm_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      point,
      coordinate: 'E4',
      title: 'Test the center-side point',
      evaluation: { ...suggestion.evaluation!, order: 2 },
    }
    const preview: MovePreview = {
      game_id: freshGame.id,
      revision: freshGame.revision,
      point,
      coordinate: 'E4',
      legal: true,
      captures: [],
      resulting_liberties: 4,
      facets: [],
      position_facets: [{
        id: 'area',
        label: 'Board count',
        canonical_term: 'Stones and empty intersections',
        value: 'Black 0 stones · White 0 stones',
        evidence: 'exact',
        explanation: '81 intersections are empty. Territory is not settled.',
      }],
      if_played_facets: [{
        id: 'area',
        label: 'Board count',
        canonical_term: 'Stones and empty intersections',
        value: 'Black 1 stone · White 0 stones',
        evidence: 'exact',
        explanation: '80 intersections are empty. Territory is not settled.',
      }],
      current_area_snapshot: currentArea,
      if_played_area_snapshot: ifPlayedArea,
      if_played_side_to_move: 'white',
      candidates: [suggestion],
      teaching: {
        ...clickedTeaching,
        tactics: clickedTeaching.tactics!,
        why_here: clickedTeaching.why_here!,
        what_changes: clickedTeaching.what_changes!,
        next_calculation: clickedTeaching.next_calculation!,
      },
    }
    const html = renderWorkspace({ selected: point, preview })

    expect(html).toContain('data-analysis-state="if-played-ready"')
    expect(html).toContain('data-testid="unconfirmed-analysis"')
    expect(html).toContain('data-analysis-state="ready"')
    expect(html).toContain('If played · still unconfirmed')
    expect(html).toContain('E4 · board if black played here')
    expect(html).toContain('data-testid="candidate-ownership-after"')
    expect(html).toContain('data-testid="if-played-score-forecast"')
    expect(html).toContain('data-testid="if-played-position-comparison"')
    expect(html).toContain('data-testid="current-position-bookkeeping"')
    expect(html).toContain('Stones · Black 0 · White 0')
    expect(html).toContain('81 empty intersections · black to move')
    expect(html).toContain('data-testid="if-played-position-bookkeeping"')
    expect(html).toContain('Stones · Black 1 · White 0')
    expect(html).toContain('80 empty intersections · white to move')
    expect(html).toContain('No territory is settled during live play')
    expect(html).not.toContain('Black 81')
    expect(html).not.toContain('data-scope="if_played" data-facet-id="area"')
    expect(html).toContain('data-active-candidate="m_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"')
    expect(html).toContain('Other candidate ideas')
    expect(html).toContain('E4 preview shown on board')
    expect(html).toContain('data-testid="commit-move"')
  })
})
