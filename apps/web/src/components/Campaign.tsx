import { ArrowRight, Check, Clock3, Compass, LockKeyhole, Sparkles } from 'lucide-react'
import type { BoardSize, LessonSummary } from '../types'

interface CampaignProps {
  lessons: LessonSummary[]
  selectedBoard: BoardSize
  onBoardChange: (size: BoardSize) => void
  onStartLesson: (lesson: LessonSummary) => void
  busy?: boolean
}

export function Campaign({ lessons, selectedBoard, onBoardChange, onStartLesson, busy = false }: CampaignProps) {
  const visible = lessons.filter((lesson) => lesson.board_size === selectedBoard)
  return (
    <section className="campaign" data-testid="campaign" data-board-filter={selectedBoard}>
      <div className="section-heading campaign-heading">
        <div>
          <span className="eyebrow"><Compass size={14} /> Your learning path</span>
          <h2>Begin small. Reach the full valley.</h2>
        </div>
        <p>Short lessons teach one relationship at a time. Nine by nine is the default home for complete games.</p>
      </div>

      <div className="board-size-switch" role="radiogroup" aria-label="Lesson board size">
        {([5, 7, 9] as BoardSize[]).map((size) => (
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
            <small>{size === 9 ? 'Full journey' : size === 5 ? 'First breaths' : 'Growing shape'}</small>
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
                  <span><Clock3 size={13} /> {lesson.duration_minutes} min</span>
                  {lesson.training_variant && <span className="training-label">Training rules</span>}
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
                aria-label={`${complete ? 'Revisit' : 'Begin'} ${lesson.title}`}
              >
                {complete ? 'Revisit' : lesson.status === 'current' ? 'Continue' : 'Begin'}
                <ArrowRight size={16} aria-hidden="true" />
              </button>
            </article>
          )
        })}
        {!visible.length && <p className="empty-note">More lessons are being prepared for this board.</p>}
      </div>
    </section>
  )
}
