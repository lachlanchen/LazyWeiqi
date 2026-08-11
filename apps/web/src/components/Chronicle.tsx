import { ArrowRight, BookOpen, CalendarDays, CircleDot, LoaderCircle, RotateCcw, Trophy } from 'lucide-react'
import { useI18n, type Locale } from '../i18n'
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
  const { locale, t } = useI18n()
  return (
    <section className="chronicle" data-testid="chronicle" data-status={loading ? 'loading' : 'ready'}>
      <div className="section-heading">
        <div>
          <span className="eyebrow"><BookOpen size={14} /> {t('chronicle.eyebrow')}</span>
          <h2>{t('chronicle.title')}</h2>
        </div>
        <p>{t('chronicle.description')}</p>
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
                    <span><CalendarDays size={12} /> {formatDate(game.updated_at, locale, t('chronicle.recently'))}</span>
                  </span>
                  <strong>{game.title}</strong>
                  <small>{game.result ?? (game.phase === 'finished' ? t('chronicle.ended') : t('chronicle.movesPhase', { count: game.move_count, phase: t('chronicle.phasePlaying') }))}</small>
                  <span className="concept-tags compact">
                    {(game.concepts ?? []).slice(0, 3).map((concept) => <span key={concept}>{concept}</span>)}
                  </span>
                </span>
                <ArrowRight size={17} aria-hidden="true" />
              </button>
              <button type="button" className="history-resume" onClick={() => onResume(game)} disabled={loading}>
                <RotateCcw size={14} /> {t('chronicle.revisit')}
              </button>
            </article>
          ))}
          {!games.length && !loading && unavailable && (
            <div className="chronicle-empty" role="status"><BookOpen size={22} /><h3>{t('chronicle.unavailableTitle')}</h3><p>{t('chronicle.unavailableText')}</p></div>
          )}
          {!games.length && !loading && !unavailable && (
            <div className="chronicle-empty"><CircleDot size={22} /><h3>{t('chronicle.emptyTitle')}</h3><p>{t('chronicle.emptyText')}</p></div>
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
                {loadingOlder ? t('chronicle.loadingOlder') : olderError ? t('chronicle.tryOlder') : t('chronicle.loadOlder')}
              </button>
              {olderError && <p id="history-pagination-error" role="alert">{olderError} {t('chronicle.currentStillHere')}</p>}
            </div>
          )}
        </div>

        <aside className="review-panel" data-testid="review-panel">
          {selected ? (
            <>
              <span className="eyebrow">{t('chronicle.reviewHall')}</span>
              <h3>{selected.title}</h3>
              <div className="review-result"><Trophy size={17} /> {selected.result ?? (selected.phase === 'finished' ? t('chronicle.ended') : t('chronicle.inProgress'))}</div>
              {selected.story_summary && (
                <div className="story-acts">
                  {selected.story_summary.promise && <StoryAct number="I" title={t('chronicle.promise')} text={selected.story_summary.promise} />}
                  {selected.story_summary.crisis && <StoryAct number="II" title={t('chronicle.crisis')} text={selected.story_summary.crisis} />}
                  {selected.story_summary.resolution && <StoryAct number="III" title={t('chronicle.resolution')} text={selected.story_summary.resolution} />}
                </div>
              )}
              {selected.review_moments?.length ? (
                <div className="review-moments">
                  {selected.review_moments.slice(0, 3).map((moment) => (
                    <article key={moment.id}>
                      <span>{t('chronicle.moveConcept', { count: moment.move_number, concept: moment.concept })}</span>
                      <strong>{moment.title}</strong>
                      <p>{moment.explanation}</p>
                    </article>
                  ))}
                </div>
              ) : selected.story_summary?.memory ? (
                <blockquote>{selected.story_summary.memory}</blockquote>
              ) : (
                <div className="review-grounding"><BookOpen size={17} /><p>{t('chronicle.noSummary')}</p></div>
              )}
            </>
          ) : (
            <div className="review-placeholder">
              <BookOpen size={26} />
              <h3>{t('chronicle.selectGame')}</h3>
              <p>{t('chronicle.selectText')}</p>
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

function formatDate(value: string, locale: Locale, fallback: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return fallback
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(date)
}
