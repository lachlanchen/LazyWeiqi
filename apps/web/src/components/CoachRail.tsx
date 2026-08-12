import { useEffect, useState } from 'react'
import { Bot, BrainCircuit, ChevronDown, Hand, History, Lightbulb, MessageCircleQuestion, Send, ShieldCheck, Sparkles, X } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import 'katex/dist/katex.min.css'
import { localizeRulesReason, useI18n, type MessageKey } from '../i18n'
import type { BoardSize, CandidateMove, CoachMessage, GameMode, MoveIntent, MovePreview, StoneColor } from '../types'
import { CandidateCards } from './CandidateCards'
import { EvidenceBadge } from './EnergyLenses'

const INTENTS: Array<{ id: MoveIntent; label: MessageKey }> = [
  { id: 'unsure', label: 'intent.unsure' },
  { id: 'claim', label: 'intent.claim' },
  { id: 'connect', label: 'intent.connect' },
  { id: 'pressure', label: 'intent.pressure' },
  { id: 'escape', label: 'intent.escape' },
  { id: 'settle', label: 'intent.settle' },
  { id: 'sacrifice', label: 'intent.sacrifice' },
]

interface CoachRailProps {
  compact?: boolean
  boardSize: BoardSize
  toPlay: StoneColor
  mode: GameMode
  messages: CoachMessage[]
  preview: MovePreview | null
  candidates: CandidateMove[]
  selectedCandidateId?: string | null
  inspectedCandidateId?: string | null
  suggestedCandidateId?: string | null
  intent: MoveIntent
  onIntentChange: (intent: MoveIntent) => void
  onCandidateSelect: (candidate: CandidateMove) => void
  onCandidateInspect: (candidate: CandidateMove | null) => void
  onAsk: (question: string, kind?: 'hint' | 'explain' | 'reflection') => void
  hasOlderHistory: boolean
  historyLoading: boolean
  historyError: string | null
  onLoadOlderHistory: () => void
  historyKey: string
  onDelegate: () => void
  canDelegate: boolean
  busy: boolean
  fallback: boolean
  statusLabel: string
  delegationKey: string
}

export function CoachRail({
  compact = false,
  boardSize,
  toPlay,
  mode,
  messages,
  preview,
  candidates,
  selectedCandidateId,
  inspectedCandidateId,
  suggestedCandidateId,
  intent,
  onIntentChange,
  onCandidateSelect,
  onCandidateInspect,
  onAsk,
  hasOlderHistory,
  historyLoading,
  historyError,
  onLoadOlderHistory,
  historyKey,
  onDelegate,
  canDelegate,
  busy,
  fallback,
  statusLabel,
  delegationKey,
}: CoachRailProps) {
  const { locale, t } = useI18n()
  const [question, setQuestion] = useState('')
  const [delegationOpen, setDelegationOpen] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [historyRevealed, setHistoryRevealed] = useState(false)
  const role = mode === 'agent_vs_agent' ? t('coach.narrator') : mode === 'human_companion' ? t('coach.companion') : t('coach.lessonGuide')
  const name = mode === 'human_vs_agent' ? t('coach.compass') : t('coach.lantern')

  useEffect(() => {
    setDelegationOpen(false)
  }, [delegationKey])

  useEffect(() => {
    setHistoryRevealed(false)
  }, [historyKey])

  const visibleMessages = historyRevealed ? messages : messages.slice(-3)
  const canRevealHistory = messages.length > 3 || hasOlderHistory

  return (
    <aside className="coach-rail" data-testid="coach-rail" data-role={mode === 'agent_vs_agent' ? 'narrator' : mode === 'human_companion' ? 'companion' : 'lesson-guide'} data-mobile-open={mobileOpen}>
      <div className="coach-rail-handle" aria-hidden="true" />
      <button
        type="button"
        className="coach-mobile-toggle"
        aria-expanded={mobileOpen}
        aria-controls="coach-sheet-content"
        onClick={() => setMobileOpen((open) => !open)}
      >
        <span className="coach-avatar"><Sparkles size={17} aria-hidden="true" /></span>
        <span><strong>{name}</strong><small>{statusLabel}</small></span>
        <ChevronDown size={17} aria-hidden="true" />
      </button>
      <div id="coach-sheet-content" className="coach-sheet-content">
      <header className="coach-header">
        <div className="coach-avatar"><Sparkles size={19} aria-hidden="true" /></div>
        <div>
          <span>{role}</span>
          <h2>{name}</h2>
        </div>
        <span className={`coach-state ${fallback ? 'fallback' : 'ready'}`}>
          {statusLabel}
        </span>
      </header>

      <section className="coach-doctrine" aria-label={t('coach.authority')}>
        <ShieldCheck size={16} aria-hidden="true" />
        <p>
          {mode === 'agent_vs_agent'
            ? t('coach.authorityTheatre')
            : mode === 'human_companion'
              ? t('coach.authorityCompanion')
              : t('coach.authorityHuman')}
        </p>
      </section>

      {mode !== 'agent_vs_agent' && (
        <section className="intent-section">
          <div className="rail-section-title">
            <span>{t('coach.intention')}</span>
            <small>{t('coach.optional')}</small>
          </div>
          <div className="intent-row" role="radiogroup" aria-label={t('coach.moveIntention')}>
            {INTENTS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={intent === item.id}
                className={intent === item.id ? 'selected' : ''}
                onClick={() => onIntentChange(item.id)}
                disabled={busy}
              >
                {t(item.label)}
              </button>
            ))}
          </div>
        </section>
      )}

      {canRevealHistory && (
        <div className="coach-history-controls">
          {!historyRevealed ? (
            <button
              type="button"
              data-testid="reveal-coach-history"
              aria-controls="coach-conversation-log"
              onClick={() => setHistoryRevealed(true)}
            >
              <History size={14} aria-hidden="true" /> {t('coach.revealHistory')}
            </button>
          ) : (
            <div className="coach-history-actions">
              {hasOlderHistory && (
                <button
                  type="button"
                  data-testid="load-older-coach-history"
                  aria-controls="coach-conversation-log"
                  aria-describedby={historyError ? 'coach-history-error' : undefined}
                  onClick={onLoadOlderHistory}
                  disabled={historyLoading}
                >
                  <History size={14} aria-hidden="true" />
                  {historyLoading
                    ? t('coach.loadingEarlier')
                    : historyError
                      ? t('coach.tryEarlier')
                      : t('coach.loadEarlier')}
                </button>
              )}
              <button type="button" onClick={() => setHistoryRevealed(false)}>
                {t('coach.recentOnly')}
              </button>
            </div>
          )}
          {historyRevealed && historyError && (
            <p id="coach-history-error" role="alert">
              {historyError} {t('coach.visibleStillHere')}
            </p>
          )}
        </div>
      )}

      <section id="coach-conversation-log" className="coach-conversation" role="log" aria-label={t('coach.conversation', { name })} aria-live="polite" aria-relevant="additions text">
        {visibleMessages.map((message) => {
          const answerLabel = {
            coach: t('coach.answer'),
            companion: t('coach.companionAnswer'),
            narrator: t('coach.narratorResponse'),
            system: t('coach.systemMessage'),
          }[message.role]
          return (
            <div
              key={message.id}
              className="coach-exchange"
              role="group"
              aria-label={message.question ? t('coach.questionAndAnswer', { answer: answerLabel }) : answerLabel}
            >
              {message.question && (
                <article className="coach-message learner" aria-label={t('coach.learnerQuestion')}>
                  <div className="message-meta">
                    <strong>{t('coach.you')}</strong>
                    <span>{t('coach.learnerQuestion')}</span>
                  </div>
                  <p>{message.question}</p>
                </article>
              )}
              <article className={`coach-message answer ${message.role}`} aria-label={`${message.speaker}, ${answerLabel}`}>
                <div className="message-meta">
                  <strong>{message.speaker}</strong>
                  <span>{answerLabel}</span>
                </div>
                <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{message.text}</ReactMarkdown>
                {message.evidence?.length ? (
                  <div className="message-evidence" role="group" aria-label={t('coach.evidence')}>
                    {[...new Set(message.evidence)].map((kind) => <EvidenceBadge key={kind} kind={kind} />)}
                  </div>
                ) : null}
                {message.prompt && (
                  <p className="companion-prompt"><strong>{t('coach.asks', { name: message.speaker })}</strong> {message.prompt}</p>
                )}
              </article>
            </div>
          )
        })}
        {!messages.length && (
          <div className="coach-empty"><Bot size={20} /><p>{t('coach.empty')}</p></div>
        )}
      </section>

      <section className="consequence-section">
        <div className="rail-section-title">
          <span>{preview ? t('coach.otherCandidates') : t('coach.candidateIntentions')}</span>
          {preview && <small>{preview.legal ? t('coach.previewShown', { coordinate: preview.coordinate }) : t('coach.pointIllegal', { coordinate: preview.coordinate })}</small>}
        </div>
        {preview && !preview.legal && (
          <div className="preview-illegal" role="alert"><X size={15} /> {localizeRulesReason(preview.reason, locale) ?? t('coach.notLegalNow')}</div>
        )}
        <CandidateCards
          compact={compact}
          boardSize={boardSize}
          toPlay={toPlay}
          candidates={candidates}
          selectedCandidateId={selectedCandidateId}
          inspectedCandidateId={inspectedCandidateId}
          suggestedCandidateId={suggestedCandidateId}
          onInspect={onCandidateInspect}
          onSelect={onCandidateSelect}
          disabled={busy}
        />
      </section>

      <div className="coach-quick-actions">
        <button type="button" onClick={() => onAsk(t('coach.hintQuestion'), 'hint')} disabled={busy}>
          <Lightbulb size={15} /> {t('coach.hint')}
        </button>
        <button type="button" onClick={() => onAsk(t('coach.compareQuestion'), 'explain')} disabled={busy}>
          <MessageCircleQuestion size={15} /> {t('coach.compare')}
        </button>
        {boardSize === 19 && (
          <button
            type="button"
            onClick={() => onAsk(t('opening.deepStudyHelp'), 'reflection')}
            disabled={busy}
            data-testid="coach-deep-study"
          >
            <BrainCircuit size={15} aria-hidden="true" /> {t('opening.deepStudy')}
          </button>
        )}
      </div>

      <form
        className="coach-form"
        onSubmit={(event) => {
          event.preventDefault()
          const cleaned = question.trim()
          if (!cleaned) return
          onAsk(cleaned, 'explain')
          setQuestion('')
        }}
      >
        <label className="sr-only" htmlFor="coach-question">{t('coach.ask')}</label>
        <input
          id="coach-question"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder={mode === 'agent_vs_agent' ? t('coach.askDoctrine') : t('coach.askChanged')}
          maxLength={500}
          disabled={busy}
          data-testid="coach-input"
        />
        <button type="submit" disabled={busy || !question.trim()} aria-label={t('coach.ask')} data-testid="coach-send">
          <Send size={17} />
        </button>
      </form>

      {mode === 'human_companion' && canDelegate && (
        <div className="delegation-zone" data-testid="delegation-zone" data-confirming={delegationOpen}>
          {!delegationOpen ? (
            <button type="button" className="delegate-button" onClick={() => setDelegationOpen(true)} disabled={busy}>
              <Hand size={16} /> {t('coach.invite')} <ChevronDown size={14} />
            </button>
          ) : (
            <div className="delegate-confirm" role="group" aria-label={t('coach.confirmDelegation')}>
              <p><strong>{t('coach.oneTurnOnly')}</strong> {t('coach.delegationExplanation')}</p>
              <div>
                <button type="button" onClick={() => setDelegationOpen(false)} disabled={busy}>{t('coach.keepTurn')}</button>
                <button
                  type="button"
                  className="primary"
                  onClick={() => { setDelegationOpen(false); onDelegate() }}
                  disabled={busy}
                  data-testid="delegate-confirm"
                >
                  {t('coach.chooseOnce')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      </div>
    </aside>
  )
}
