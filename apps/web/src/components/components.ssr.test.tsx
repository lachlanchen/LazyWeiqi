import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES, DEMO_FACETS } from '../fallbackData'
import { Chronicle } from './Chronicle'
import { CandidateCards } from './CandidateCards'
import { CoachRail } from './CoachRail'
import { EnergyLenses } from './EnergyLenses'
import { ModePicker } from './ModePicker'
import { PowerTeacher } from './PowerTeacher'
import { WeiqiBoard } from './WeiqiBoard'

describe('accessible teaching surfaces', () => {
  it('renders the SVG board as an accessible grid with stable state markers', () => {
    const html = renderToStaticMarkup(
      <WeiqiBoard
        size={5}
        stones={[{ x: 2, y: 2, color: 'black' }]}
        toPlay="white"
        selected={{ x: 1, y: 1 }}
        onSelect={() => undefined}
        activeLenses={new Set(['breath'])}
        showCoordinates
      />,
    )

    expect(html).toContain('data-testid="weiqi-board"')
    expect(html).toContain('role="grid"')
    expect(html).toContain('C3, black stone')
    expect(html).toContain('B4, empty, selected for preview')
    expect(html).toContain('data-board-size="5"')
  })

  it('renders distinct agent modes and companion authority copy', () => {
    const html = renderToStaticMarkup(
      <ModePicker
        mode="human_companion"
        onModeChange={() => undefined}
        blackAgent={DEFAULT_PREFERENCES.black_agent}
        whiteAgent={DEFAULT_PREFERENCES.white_agent}
        companion={DEFAULT_PREFERENCES.companion}
        onBlackAgentChange={() => undefined}
        onWhiteAgentChange={() => undefined}
        onCompanionChange={() => undefined}
      />,
    )

    expect(html).toContain('data-mode="human_companion"')
    expect(html).toContain('Human vs Agent')
    expect(html).toContain('Narrated Agent vs Agent')
    expect(html).toContain('Player Agents may choose only verified legal candidates')
    expect(html).toContain('Lantern · Companion')
  })

  it('labels energy facets by provenance instead of showing an aggregate score', () => {
    const html = renderToStaticMarkup(
      <EnergyLenses
        active={new Set(['breath', 'bonds', 'reach'])}
        onToggle={() => undefined}
        facets={DEMO_FACETS}
        engineAvailable
      />,
    )

    expect(html).toContain('Turn one clear layer on or off')
    expect(html).toContain('No magic score')
    expect(html).toContain('Exact')
    expect(html).toContain('Engine estimate')
    expect(html).toContain('aria-disabled="true"')
    expect(html).not.toMatch(/energy\s*[:=]\s*\d+/i)
  })

  it('separates current readings from hypothetical move consequences', () => {
    const html = renderToStaticMarkup(
      <EnergyLenses
        active={new Set(['breath', 'area'])}
        onToggle={() => undefined}
        facets={[
          { ...DEMO_FACETS[0], scope: 'if_played' },
          {
            id: 'area',
            label: 'Area snapshot',
            canonical_term: 'Mechanical Chinese area count',
            value: 'Black 2 · White 9.5',
            evidence: 'exact',
            explanation: 'Every stone is treated alive; this is not an adjudicated result.',
            scope: 'current',
          },
        ]}
        engineAvailable={false}
      />,
    )

    expect(html).toContain('data-scope="if_played"')
    expect(html).toContain('>If played<')
    expect(html).toContain('data-scope="current"')
    expect(html).toContain('>Current position<')
  })

  it('shows plain-language opening potential before any stone is played', () => {
    const html = renderToStaticMarkup(
      <WeiqiBoard
        size={9}
        stones={[]}
        toPlay="black"
        selected={null}
        onSelect={() => undefined}
        activeLenses={new Set(['cloud'])}
        showCoordinates
      />,
    )

    expect(html).toContain('data-testid="opening-potential-cloud"')
    expect(html.match(/data-zone-kind="corner"/g)).toHaveLength(4)
    expect(html).toContain('<b>Corner</b> · fewer directions to close')
    expect(html).toContain('<b>Side</b> · links nearby stones')
    expect(html).toContain('<b>Center</b> · reaches far, encloses slowly')
    expect(html).toContain('Beginner analogy · not move quality')
    expect(html).toContain('not physics, territory, ownership, or score')
  })

  it('renders separate black, white, and contested presence fields after play', () => {
    const html = renderToStaticMarkup(
      <WeiqiBoard
        size={5}
        stones={[
          { x: 1, y: 2, color: 'black' },
          { x: 3, y: 2, color: 'white' },
        ]}
        toPlay="black"
        selected={null}
        onSelect={() => undefined}
        activeLenses={new Set(['cloud'])}
        showCoordinates={false}
      />,
    )

    expect(html).toContain('data-testid="stone-presence-cloud"')
    expect(html).toContain('data-field="black"')
    expect(html).toContain('data-field="white"')
    expect(html).toContain('data-field="contested"')
    expect(html).toContain('<b>Black</b> · nearby presence')
    expect(html).toContain('<b>White</b> · nearby presence')
    expect(html).toContain('<b>Violet</b> · both are close')
    expect(html).toContain('authored 5×5 teaching view; the installed KataGo evidence is 9×9 only')
  })

  it('switches from the decorative sketch to an exact candidate forecast field and PV', () => {
    const ownershipAfter = Array.from({ length: 81 }, (_, index) => ({
      x: index % 9,
      y: Math.floor(index / 9),
      value: index % 3 === 0 ? 0.62 : -0.34,
      variation: index % 7 === 0 ? 0.4 : 0.12,
    }))
    const ownershipDelta = ownershipAfter.map((cell, index) => ({
      ...cell,
      value: index < 6 ? 0.24 - index * 0.02 : index > 74 ? -0.18 : 0.01,
    }))
    const html = renderToStaticMarkup(
      <WeiqiBoard
        size={9}
        stones={[{ x: 6, y: 6, color: 'white' }]}
        toPlay="black"
        selected={null}
        onSelect={() => undefined}
        candidatePreview={{
          id: 'm_0123456789abcdef0123456789abcdef',
          point: { x: 2, y: 2 },
          coordinate: 'C7',
          intent: 'claim',
          title: 'Build a corner base',
          summary: 'Use the nearby edges while keeping an exit.',
          tactics: {
            captures: [],
            resulting_liberties: 4,
            connects: [{ x: 2, y: 3 }, { x: 3, y: 2 }],
            cuts: [{ x: 3, y: 3 }],
            friendly_groups_joined: 2,
            opponent_groups_newly_in_atari: 0,
            friendly_groups_escaped_atari: 0,
            self_atari: false,
            evidence: 'exact',
          },
          ownership_after: ownershipAfter,
          ownership_delta: ownershipDelta,
          ownership_perspective: 'black',
          variation: [
            { color: 'black', kind: 'play', point: { x: 2, y: 2 } },
            { color: 'white', kind: 'play', point: { x: 6, y: 2 } },
            { color: 'black', kind: 'pass', point: null },
          ],
          legal_verified: true,
          engine_analyzed: true,
          verified: true,
        }}
        activeLenses={new Set(['cloud'])}
        showCoordinates
      />,
    )

    expect(html).toContain('data-testid="candidate-ghost-stone"')
    expect(html).toContain('data-testid="candidate-ownership-after"')
    expect(html).toContain('data-testid="candidate-ownership-smooth"')
    expect(html).toContain('data-testid="candidate-ownership-delta"')
    expect(html).toContain('data-testid="candidate-tactical-links"')
    expect(html).toContain('data-testid="candidate-pv"')
    expect(html).toContain('data-line-kind="engine-main-line-not-forced"')
    expect(html).toContain('After this move')
    expect(html).toContain('Forecast difference after this move vs current')
    expect(html).toContain('Values are always Black perspective')
    expect(html).toContain('omitted cells are not neutral')
    expect(html).not.toContain('data-testid="stone-presence-cloud"')
  })

  it('labels a small-board candidate as location and exact shape without an engine forecast claim', () => {
    const html = renderToStaticMarkup(
      <WeiqiBoard
        size={5}
        stones={[]}
        toPlay="black"
        selected={null}
        onSelect={() => undefined}
        candidatePreview={{
          id: 'authored-c3',
          point: { x: 2, y: 2 },
          coordinate: 'C3',
          intent: 'connect',
          title: 'Join nearby stones',
          summary: 'Check the connection.',
          legal_verified: true,
          engine_analyzed: false,
          verified: false,
        }}
        activeLenses={new Set(['cloud'])}
        showCoordinates
      />,
    )

    expect(html).toContain('Location and exact-shape preview for candidate C3')
    expect(html).toContain('C3 · location and exact-shape preview')
    expect(html).toContain('no engine ownership map is supplied')
    expect(html).not.toContain('candidate forecast')
    expect(html).not.toContain('engine forecast after')
  })

  it('labels candidate reasoning, exact tactics, engine rank, score perspective, and touch action', () => {
    const candidate = {
      id: 'm_fedcba9876543210fedcba9876543210',
      point: { x: 2, y: 2 },
      coordinate: 'C7',
      intent: 'claim' as const,
      title: 'Build a corner base',
      summary: 'Use two nearby edges conditionally.',
      main_line_reply: 'White approaches at D7.',
      risk: 'Check the outside direction.',
      tactics: {
        captures: [],
        resulting_liberties: 4,
        connects: [],
        cuts: [],
        friendly_groups_joined: 0,
        opponent_groups_newly_in_atari: 0,
        friendly_groups_escaped_atari: 0,
        self_atari: false,
        evidence: 'exact' as const,
      },
      score: {
        before: -1.2,
        after: -0.7,
        delta: 0.5,
        perspective: 'black' as const,
        evidence: 'engine' as const,
        outcome_spread_before: 8.2,
        outcome_spread_after: 7.9,
        loss_vs_top: 0,
      },
      evaluation: {
        perspective: 'black' as const,
        evidence: 'engine' as const,
        order: 0,
        visits: 900,
        winrate_before: 0.48,
        winrate_after: 0.5,
      },
      why_here: 'This balances corner efficiency with an outside road.',
      what_changes: 'It creates a base without claiming the corner as settled.',
      next_calculation: 'Read the outside approach and your answer.',
      legal_verified: true,
      engine_analyzed: true,
      verified: true,
    }
    const html = renderToStaticMarkup(
      <CandidateCards
        boardSize={9}
        toPlay="black"
        candidates={[candidate]}
        selectedCandidateId={null}
        inspectedCandidateId={candidate.id}
        onInspect={() => undefined}
        onSelect={() => undefined}
      />,
    )

    expect(html).toContain('aria-pressed="false"')
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('click or press Enter to select its non-committing move preview')
    expect(html).toContain('Why here <em>Teacher interpretation</em>')
    expect(html).toContain('Rules facts')
    expect(html).toContain('KataGo ranks C7 #1; this child received 900 visits')
    expect(html).toContain('Engine estimate · black perspective')
    expect(html).toContain('Search difference +0.5 from the Black perspective')
    expect(html).toContain('Predicted final-score spread 8.2 before, 7.9 after')
    expect(html).toContain('Reply in one engine line (not forced)')
    expect(html).toContain('Teacher hypothesis · possible job')
    expect(html).toContain('Hover or focus to inspect. Tap, click, or press Enter')
  })

  it('teaches an engine-ranked pass without inventing liberties or dereferencing a point', () => {
    const pass = {
      id: 'm_11111111111111111111111111111111',
      kind: 'pass' as const,
      point: null,
      coordinate: 'pass',
      intent: 'endgame' as const,
      intent_evidence: 'teacher' as const,
      title: 'Possible end-of-game judgment',
      summary: 'Passing places no stone. The two-consecutive-pass ending rule applies.',
      risk: 'Passing does not prove the board is settled.',
      tactics: {
        captures: [],
        resulting_liberties: null,
        resulting_group_size: null,
        connects: [],
        cuts: [],
        friendly_groups_joined: 0,
        opponent_groups_newly_in_atari: 0,
        friendly_groups_escaped_atari: 0,
        self_atari: false,
        evidence: 'exact' as const,
      },
      evaluation: {
        perspective: 'black' as const,
        evidence: 'engine' as const,
        order: 0,
        visits: 120,
      },
      legal_verified: true,
      engine_analyzed: true,
      verified: true,
    }
    const cards = renderToStaticMarkup(
      <CandidateCards
        boardSize={9}
        toPlay="black"
        candidates={[pass]}
        selectedCandidateId={pass.id}
        inspectedCandidateId={null}
        onInspect={() => undefined}
        onSelect={() => undefined}
      />,
    )
    const teacher = renderToStaticMarkup(
      <PowerTeacher
        size={9}
        stones={[]}
        toPlay="black"
        selected={null}
        preview={null}
        activeCandidate={pass}
        candidates={[pass]}
        lastMove={null}
        ownershipAvailable={false}
      />,
    )

    expect(cards).toContain('the opponent moves next, and another consecutive pass would end play')
    expect(cards).not.toContain('null resulting liberties')
    expect(teacher).toContain('Pass only when continuing looks smaller than stopping or giving priority away')
    expect(teacher).not.toContain('low liberty count')
  })

  it('shows a no-map pass without borrowing a stale point or ghost stone', () => {
    const html = renderToStaticMarkup(
      <WeiqiBoard
        size={9}
        stones={[]}
        toPlay="black"
        selected={{ x: 4, y: 4 }}
        onSelect={() => undefined}
        candidatePreview={{
          id: 'm_22222222222222222222222222222222',
          kind: 'pass',
          point: null,
          coordinate: 'pass',
          intent: 'endgame',
          title: 'Possible end-of-game judgment',
          summary: 'Yield the turn and check whether play is complete.',
          legal_verified: true,
          engine_analyzed: true,
          verified: true,
        }}
        activeLenses={new Set(['cloud'])}
        showCoordinates
      />,
    )

    expect(html).toContain('Pass preview with no stone placement and no ownership map')
    expect(html).toContain('Pass · no stone is placed')
    expect(html).toContain('no stone location')
    expect(html).not.toContain('data-testid="candidate-ghost-stone"')
  })

  it('teaches a preview as place, change, reply, and next action using supplied evidence', () => {
    const html = renderToStaticMarkup(
      <PowerTeacher
        size={9}
        stones={[]}
        toPlay="black"
        selected={{ x: 2, y: 2 }}
        preview={{
          game_id: 'game-1',
          revision: 0,
          point: { x: 2, y: 2 },
          coordinate: 'C7',
          legal: true,
          captures: [],
          resulting_liberties: 4,
          facets: [],
          candidates: [],
        }}
        candidates={[{
          id: 'candidate-c7',
          point: { x: 2, y: 2 },
          coordinate: 'C7',
          intent: 'claim',
          title: 'Take a corner base',
          summary: 'Build from the nearby edges.',
          main_line_reply: 'White can take another open corner.',
          risk: 'Do not call the corner secure yet.',
          legal_verified: true,
          engine_analyzed: true,
          tactics: {
            captures: [],
            resulting_liberties: 4,
            connects: [],
            cuts: [],
            friendly_groups_joined: 0,
            opponent_groups_newly_in_atari: 0,
            friendly_groups_escaped_atari: 0,
            self_atari: false,
            evidence: 'exact',
          },
          verified: true,
        }]}
        lastMove={null}
        ownershipAvailable
      />,
    )

    expect(html).toContain('aria-labelledby="power-teacher-title"')
    expect(html).toContain('Rules + labeled engine forecasts')
    expect(html).toContain('4 resulting liberties')
    expect(html).toContain('White can take another open corner.')
    expect(html).toContain('Do not call the corner secure yet.')
    expect(html.indexOf('Play')).toBeLessThan(html.indexOf('Because'))
    expect(html.indexOf('Because')).toBeLessThan(html.indexOf('Changes'))
    expect(html.indexOf('Changes')).toBeLessThan(html.indexOf('Opponent'))
    expect(html.indexOf('Opponent')).toBeLessThan(html.indexOf('Then check'))
    expect(html.indexOf('Then check')).toBeLessThan(html.indexOf('Principle'))
    expect(html).toContain('Exact rules')
    expect(html).toContain('Teacher interpretation')
  })

  it('labels small-board guidance as authored rather than engine evidence', () => {
    const html = renderToStaticMarkup(
      <PowerTeacher
        size={7}
        stones={[]}
        toPlay="black"
        selected={null}
        preview={null}
        candidates={[]}
        lastMove={null}
        ownershipAvailable={false}
      />,
    )

    expect(html).toContain('Authored 7×7 view · no KataGo claim')
    expect(html).toContain('First find the group with the fewest liberties')
    expect(html).toContain('Corners can be efficient, but urgency')
    expect(html).not.toContain('Engine estimate')
  })

  it('turns a missing small-board reply line into an honest concrete watch instruction', () => {
    const html = renderToStaticMarkup(
      <PowerTeacher
        size={5}
        stones={[
          { x: 2, y: 2, color: 'black' },
          { x: 1, y: 2, color: 'white' },
        ]}
        toPlay="black"
        selected={{ x: 2, y: 1 }}
        preview={{
          game_id: 'game-small',
          revision: 0,
          point: { x: 2, y: 1 },
          coordinate: 'C4',
          legal: true,
          captures: [],
          resulting_liberties: 3,
          facets: [],
          candidates: [],
        }}
        candidates={[{
          id: 'authored-c4',
          point: { x: 2, y: 1 },
          coordinate: 'C4',
          intent: 'escape',
          title: 'Extend',
          summary: 'Give the pressured string another road.',
          risk: 'Check the nearby cut.',
          verified: false,
        }]}
        lastMove={null}
        ownershipAvailable={false}
      />,
    )

    expect(html).toContain('Opponent')
    expect(html).toContain('No reply line was supplied.')
    expect(html).toContain('most forcing capture, cut, or liberty-reducing move')
    expect(html).toContain('Authored 5×5 view · no KataGo claim')
  })

  it('renders persisted learner questions and companion answers as an accessible chat', () => {
    const html = renderToStaticMarkup(
      <CoachRail
        boardSize={9}
        toPlay="black"
        mode="human_companion"
        messages={[
          {
            id: 'authored-opening',
            speaker: 'Lantern',
            role: 'companion',
            prompt: 'Choose an opening and name its intention.',
            text: 'The empty board is waiting.',
            evidence: ['metaphor'],
          },
          {
            id: 'coach_1',
            speaker: 'Lantern',
            role: 'companion',
            question: 'What changed?',
            text: String.raw`Two liberties remain. Inline: $L=2$.

$$
B-W=\Delta
$$

<script>window.notAllowed = true</script>`,
            evidence: ['exact', 'model', 'engine', 'exact'],
            created_at: '2026-08-10T00:00:00Z',
          },
        ]}
        preview={null}
        candidates={[]}
        selectedCandidateId={null}
        intent="unsure"
        onIntentChange={() => undefined}
        onCandidateSelect={() => undefined}
        onCandidateInspect={() => undefined}
        onAsk={() => undefined}
        hasOlderHistory
        historyLoading={false}
        historyError={null}
        onLoadOlderHistory={() => undefined}
        historyKey="game-1"
        onDelegate={() => undefined}
        canDelegate={false}
        busy={false}
        fallback={false}
        statusLabel="Local model · ready"
        delegationKey="game-1:1"
      />,
    )

    expect(html).toContain('role="log"')
    expect(html).toContain('aria-label="Lantern conversation"')
    expect(html).toContain('class="coach-message learner"')
    expect(html.match(/class="coach-message learner"/g)).toHaveLength(1)
    expect(html).toContain('aria-label="Learner question"')
    expect(html).toContain('class="coach-message answer companion"')
    expect(html).toContain('aria-label="Lantern, Companion answer"')
    expect(html.indexOf('What changed?')).toBeLessThan(html.indexOf('Two liberties remain.'))
    expect(html).toContain('aria-label="Evidence provenance"')
    expect(html).toContain('Model explanation')
    expect(html).toContain('Engine estimate')
    expect(html.match(/>Exact<\/span>/g)).toHaveLength(1)
    expect(html).toContain('class="katex"')
    expect(html).toContain('class="katex-display"')
    expect(html).not.toContain('<script>')
    expect(html).toContain('Lantern asks:')
    expect(html).toContain('Choose an opening and name its intention.')
    expect(html).not.toContain('<blockquote>What changed?</blockquote>')
    expect(html).toContain('data-testid="reveal-coach-history"')
    expect(html).toContain('Reveal conversation history')
  })

  it('shows an accessible older-history retry without replacing visible games', () => {
    const html = renderToStaticMarkup(
      <Chronicle
        games={[{
          id: 'game-1',
          title: 'Visible game',
          mode: 'human_companion',
          board_size: 9,
          phase: 'playing',
          move_count: 8,
          updated_at: '2026-08-10T00:00:00Z',
        }]}
        hasOlder
        olderError="Older games could not be loaded."
        onOpen={() => undefined}
        onResume={() => undefined}
        onLoadOlder={() => undefined}
      />,
    )

    expect(html).toContain('Visible game')
    expect(html).toContain('data-testid="load-older-games"')
    expect(html).toContain('Try loading older games again')
    expect(html).toContain('role="alert"')
    expect(html).toContain('Your current chronicle is still here.')
  })
})
