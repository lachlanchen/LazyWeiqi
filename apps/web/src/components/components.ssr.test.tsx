import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES, DEMO_FACETS } from '../fallbackData'
import { Chronicle } from './Chronicle'
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
    expect(html).toContain('Teaching metaphor')
    expect(html).toContain('not physics, territory, or a score')
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
          likely_reply: 'White can take another open corner.',
          risk: 'Do not call the corner secure yet.',
          verified: true,
        }]}
        lastMove={null}
        ownershipAvailable
      />,
    )

    expect(html).toContain('aria-labelledby="power-teacher-title"')
    expect(html).toContain('KataGo candidate + rules facts')
    expect(html).toContain('it leaves the new string 4 liberties')
    expect(html).toContain('White can take another open corner.')
    expect(html).toContain('Before committing, check: Do not call the corner secure yet.')
    expect(html.indexOf('Place here')).toBeLessThan(html.indexOf('What changes'))
    expect(html.indexOf('What changes')).toBeLessThan(html.indexOf('Likely reply'))
    expect(html.indexOf('Likely reply')).toBeLessThan(html.indexOf('Do next'))
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
    expect(html).toContain('Try a corner first')
    expect(html).toContain('Response to watch')
    expect(html).toContain('watch whether the opponent takes another open corner')
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

    expect(html).toContain('Likely reply')
    expect(html).toContain('No reply line was supplied.')
    expect(html).toContain('nearest opposing stone at B3')
    expect(html).toContain('check any reply that removes a liberty or cuts a connection')
    expect(html).toContain('Authored 5×5 view · no KataGo claim')
  })

  it('renders persisted learner questions and companion answers as an accessible chat', () => {
    const html = renderToStaticMarkup(
      <CoachRail
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
