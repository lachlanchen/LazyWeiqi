import { ArrowRight, BookOpen, CalendarDays, CircleDot, LoaderCircle, RotateCcw, Trophy } from 'lucide-react'
import type { GameState, GameSummary } from '../types'

interface ChronicleProps {
  games: GameSummary[]
  selected?: GameState | null
  loading?: boolean
  unavailable?: boolean
  hasOlder?: boolean
  loadingOlder?: boolean
  olderError?: string | null
  onOpen: (id: string) => void
  onResume: (game: GameSummary) => void
  onLoadOlder?: () => void
}

export function Chronicle({
  games,
  selected,
  loading = false,
  unavailable = false,
  hasOlder = false,
  loadingOlder = false,
  olderError,
  onOpen,
  onResume,
  onLoadOlder,
}: ChronicleProps) {
  return (
    <section className="chronicle" data-testid="chronicle" data-status={loading ? 'loading' : 'ready'}>
      <div className="section-heading">
        <div>
          <span className="eyebrow"><BookOpen size={14} /> Your chronicle</span>
          <h2>Games become stories you can revisit</h2>
        </div>
        <p>History keeps the main line, rewinds, intentions, explanations, and engine provenance together.</p>
      </div>

      <div className="chronicle-layout">
        <div className="game-history-list">
          {games.map((game) => (
            <article key={game.id} className={`history-card ${selected?.id === game.id ? 'selected' : ''}`}>
              <button type="button" className="history-main" onClick={() => onOpen(game.id)} disabled={loading}>
                <span className={`history-board board-${game.board_size}`} aria-hidden="true">
                  <i /><i /><i /><i />
                </span>
                <span className="history-copy">
                  <span className="history-meta">
                    <span>{game.board_size}×{game.board_size}</span>
                    <span><CalendarDays size={12} /> {formatDate(game.updated_at)}</span>
                  </span>
                  <strong>{game.title}</strong>
                  <small>{game.result ?? `${game.move_count} moves · ${game.phase}`}</small>
                  <span className="concept-tags compact">
                    {(game.concepts ?? []).slice(0, 3).map((concept) => <span key={concept}>{concept}</span>)}
                  </span>
                </span>
                <ArrowRight size={17} aria-hidden="true" />
              </button>
              <button type="button" className="history-resume" onClick={() => onResume(game)} disabled={loading}>
                <RotateCcw size={14} /> Revisit
              </button>
            </article>
          ))}
          {!games.length && !loading && unavailable && (
            <div className="chronicle-empty" role="status"><BookOpen size={22} /><h3>History is unavailable right now.</h3><p>Your games were not replaced with sample data. Reconnect the local service and try again.</p></div>
          )}
          {!games.length && !loading && !unavailable && (
            <div className="chronicle-empty"><CircleDot size={22} /><h3>Your first game will appear here.</h3><p>Every finished lesson keeps one moment to remember.</p></div>
          )}
          {games.length > 0 && hasOlder && onLoadOlder && (
            <div className="history-pagination">
              <button
                type="button"
                onClick={onLoadOlder}
                disabled={loading || loadingOlder}
                aria-describedby={olderError ? 'history-pagination-error' : undefined}
                data-testid="load-older-games"
              >
                {loadingOlder && <LoaderCircle size={15} className="spin" aria-hidden="true" />}
                {loadingOlder ? 'Loading older games…' : olderError ? 'Try loading older games again' : 'Load older games'}
              </button>
              {olderError && <p id="history-pagination-error" role="alert">{olderError} Your current chronicle is still here.</p>}
            </div>
          )}
        </div>

        <aside className="review-panel" data-testid="review-panel">
          {selected ? (
            <>
              <span className="eyebrow">Review hall</span>
              <h3>{selected.title}</h3>
              <div className="review-result"><Trophy size={17} /> {selected.result ?? 'Journey in progress'}</div>
              {selected.story_summary && (
                <div className="story-acts">
                  {selected.story_summary.promise && <StoryAct number="I" title="Promise" text={selected.story_summary.promise} />}
                  {selected.story_summary.crisis && <StoryAct number="II" title="Crisis" text={selected.story_summary.crisis} />}
                  {selected.story_summary.resolution && <StoryAct number="III" title="Resolution" text={selected.story_summary.resolution} />}
                </div>
              )}
              {selected.review_moments?.length ? (
                <div className="review-moments">
                  {selected.review_moments.slice(0, 3).map((moment) => (
                    <article key={moment.id}>
                      <span>Move {moment.move_number} · {moment.concept}</span>
                      <strong>{moment.title}</strong>
                      <p>{moment.explanation}</p>
                    </article>
                  ))}
                </div>
              ) : selected.story_summary?.memory ? (
                <blockquote>{selected.story_summary.memory}</blockquote>
              ) : (
                <div className="review-grounding"><BookOpen size={17} /><p>No game-specific story summary has been recorded yet. The move history remains available without an invented interpretation.</p></div>
              )}
            </>
          ) : (
            <div className="review-placeholder">
              <BookOpen size={26} />
              <h3>Select a game</h3>
              <p>See its promise, crisis, resolution, and one principle worth carrying forward.</p>
            </div>
          )}
        </aside>
      </div>
    </section>
  )
}

function StoryAct({ number, title, text }: { number: string; title: string; text: string }) {
  return (
    <article>
      <span>{number}</span>
      <div><strong>{title}</strong><p>{text}</p></div>
    </article>
  )
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Recently'
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(date)
}
