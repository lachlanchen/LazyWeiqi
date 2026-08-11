import { ArrowRight, Check, Clock3, Compass, LockKeyhole, Sparkles } from 'lucide-react'
import { useI18n } from '../i18n'
import type { BoardSize, LessonSummary } from '../types'

interface CampaignProps {
  lessons: LessonSummary[]
  boardSizes: readonly BoardSize[]
  selectedBoard: BoardSize
  onBoardChange: (size: BoardSize) => void
  onStartLesson: (lesson: LessonSummary) => void
  busy?: boolean
}

export function Campaign({ lessons, boardSizes, selectedBoard, onBoardChange, onStartLesson, busy = false }: CampaignProps) {
  const { t } = useI18n()
  const visible = lessons.filter((lesson) => lesson.board_size === selectedBoard)
  return (
    <section className="campaign" data-testid="campaign" data-board-filter={selectedBoard}>
      <div className="section-heading campaign-heading">
        <div>
          <span className="eyebrow"><Compass size={14} /> {t('campaign.eyebrow')}</span>
          <h2>{t('campaign.title')}</h2>
        </div>
        <p>{t('campaign.description')}</p>
      </div>

      <div className="board-size-switch" role="radiogroup" aria-label={t('campaign.boardSize')}>
        {boardSizes.map((size) => (
          <button
            key={size}
            type="button"
            role="radio"
            aria-checked={selectedBoard === size}
            className={selectedBoard === size ? 'selected' : ''}
            onClick={() => onBoardChange(size)}
            data-testid={`board-size-${size}`}
          >
            <span>{size}×{size}</span>
            <small>{size === 19 ? t('campaign.fullJourney') : size === 9 ? t('simple.fullGame') : size === 5 ? t('campaign.firstBreaths') : t('campaign.growingShape')}</small>
          </button>
        ))}
      </div>

      <div className="lesson-path">
        {visible.map((lesson, index) => {
          const locked = lesson.status === 'locked'
          const complete = lesson.status === 'complete'
          return (
            <article
              key={lesson.id}
              className={`lesson-card ${lesson.status ?? 'available'}`}
              data-testid={`lesson-${lesson.id}`}
            >
              <div className="lesson-number" aria-hidden="true">
                {complete ? <Check size={17} /> : locked ? <LockKeyhole size={16} /> : String(index + 1).padStart(2, '0')}
              </div>
              <div className="lesson-content">
                <div className="lesson-meta">
                  <span>{lesson.board_size}×{lesson.board_size}</span>
                  <span><Clock3 size={13} /> {t('simple.minutes', { count: lesson.duration_minutes })}</span>
                  {lesson.training_variant && <span className="training-label">{t('campaign.trainingRules')}</span>}
                  {lesson.board_size === 19 && (
                    <span data-testid="classic-full-board-rules">
                      {t('simple.chineseRules')} · {t('rules.positionalSuperko')}
                    </span>
                  )}
                </div>
                <h3>{lesson.title}</h3>
                <p className="lesson-subtitle">{lesson.subtitle}</p>
                <p className="lesson-story">{lesson.story}</p>
                <div className="concept-tags">
                  {lesson.concepts.map((concept) => <span key={concept}>{concept}</span>)}
                </div>
                <blockquote><Sparkles size={14} /> {lesson.memory_line}</blockquote>
              </div>
              <button
                type="button"
                className="lesson-action"
                onClick={() => onStartLesson(lesson)}
                disabled={locked || busy}
                aria-label={`${complete ? t('campaign.revisit') : t('campaign.begin')} ${lesson.title}`}
              >
                {complete ? t('campaign.revisit') : lesson.status === 'current' ? t('campaign.continue') : t('campaign.begin')}
                <ArrowRight size={16} aria-hidden="true" />
              </button>
            </article>
          )
        })}
        {!visible.length && <p className="empty-note">{t('campaign.moreSoon')}</p>}
      </div>
    </section>
  )
}
