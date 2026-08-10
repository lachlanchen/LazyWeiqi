import { useEffect, useState } from 'react'
import { Bot, ChevronDown, Hand, History, Lightbulb, MessageCircleQuestion, Send, ShieldCheck, Sparkles, X } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import 'katex/dist/katex.min.css'
import type { BoardSize, CandidateMove, CoachMessage, GameMode, MoveIntent, MovePreview, StoneColor } from '../types'
import { CandidateCards } from './CandidateCards'
import { EvidenceBadge } from './EnergyLenses'

const INTENTS: Array<{ id: MoveIntent; label: string }> = [
  { id: 'unsure', label: 'Unsure' },
  { id: 'claim', label: 'Claim' },
  { id: 'connect', label: 'Connect' },
  { id: 'pressure', label: 'Pressure' },
  { id: 'escape', label: 'Escape' },
  { id: 'settle', label: 'Settle' },
  { id: 'sacrifice', label: 'Trade' },
]

interface CoachRailProps {
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
  onAsk: (question: string, kind?: 'hint' | 'explain') => void
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
  const [question, setQuestion] = useState('')
  const [delegationOpen, setDelegationOpen] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [historyRevealed, setHistoryRevealed] = useState(false)
  const role = mode === 'agent_vs_agent' ? 'Narrator' : mode === 'human_companion' ? 'Companion' : 'Lesson guide'
  const name = mode === 'human_vs_agent' ? 'Compass' : 'Lantern'

  useEffect(() => {
    setDelegationOpen(false)
  }, [delegationKey])

  useEffect(() => {
    setHistoryRevealed(false)
  }, [historyKey])

  const visibleMessages = historyRevealed ? messages : messages.slice(-3)
  const canRevealHistory = messages.length > 3 || hasOlderHistory

  return (
    <aside className="coach-rail" data-testid="coach-rail" data-role={role.toLowerCase()} data-mobile-open={mobileOpen}>
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

      <section className="coach-doctrine" aria-label="Agent authority">
        <ShieldCheck size={16} aria-hidden="true" />
        <p>
          {mode === 'agent_vs_agent'
            ? 'Narration explains both doctrines. Only the two Player Agents can place stones.'
            : mode === 'human_companion'
              ? 'Lantern is on your side, but does not move your stones unless you explicitly delegate one turn.'
              : 'River chooses only among legal candidates verified by the teaching service.'}
        </p>
      </section>

      {mode !== 'agent_vs_agent' && (
        <section className="intent-section">
          <div className="rail-section-title">
            <span>Your intention</span>
            <small>Optional, but useful</small>
          </div>
          <div className="intent-row" role="radiogroup" aria-label="Move intention">
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
                {item.label}
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
              <History size={14} aria-hidden="true" /> Reveal conversation history
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
                    ? 'Loading earlier messages…'
                    : historyError
                      ? 'Try loading earlier messages again'
                      : 'Load earlier messages'}
                </button>
              )}
              <button type="button" onClick={() => setHistoryRevealed(false)}>
                Show recent only
              </button>
            </div>
          )}
          {historyRevealed && historyError && (
            <p id="coach-history-error" role="alert">
              {historyError} The visible conversation is still here.
            </p>
          )}
        </div>
      )}

      <section id="coach-conversation-log" className="coach-conversation" role="log" aria-label={`${name} conversation`} aria-live="polite" aria-relevant="additions text">
        {visibleMessages.map((message) => {
          const answerLabel = {
            coach: 'Coach answer',
            companion: 'Companion answer',
            narrator: 'Narrator response',
            system: 'System message',
          }[message.role]
          return (
            <div
              key={message.id}
              className="coach-exchange"
              role="group"
              aria-label={message.question ? `Learner question and ${answerLabel.toLowerCase()}` : answerLabel}
            >
              {message.question && (
                <article className="coach-message learner" aria-label="Learner question">
                  <div className="message-meta">
                    <strong>You</strong>
                    <span>Learner question</span>
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
                  <div className="message-evidence" role="group" aria-label="Evidence provenance">
                    {[...new Set(message.evidence)].map((kind) => <EvidenceBadge key={kind} kind={kind} />)}
                  </div>
                ) : null}
                {message.prompt && (
                  <p className="companion-prompt"><strong>{message.speaker} asks:</strong> {message.prompt}</p>
                )}
              </article>
            </div>
          )
        })}
        {!messages.length && (
          <div className="coach-empty"><Bot size={20} /><p>The guide is watching quietly. Select a point or ask a question.</p></div>
        )}
      </section>

      <section className="consequence-section">
        <div className="rail-section-title">
          <span>{preview ? 'Other candidate ideas' : 'Candidate intentions'}</span>
          {preview && <small>{preview.legal ? `${preview.coordinate} preview shown on board` : `${preview.coordinate} is not legal`}</small>}
        </div>
        {preview && !preview.legal && (
          <div className="preview-illegal" role="alert"><X size={15} /> {preview.reason ?? 'That point is not legal now.'}</div>
        )}
        <CandidateCards
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
        <button type="button" onClick={() => onAsk('What should I notice before I move?', 'hint')} disabled={busy}>
          <Lightbulb size={15} /> Hint ladder
        </button>
        <button type="button" onClick={() => onAsk('Explain the strongest contrast between these candidates.', 'explain')} disabled={busy}>
          <MessageCircleQuestion size={15} /> Compare
        </button>
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
        <label className="sr-only" htmlFor="coach-question">Ask the coach</label>
        <input
          id="coach-question"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder={mode === 'agent_vs_agent' ? 'Ask about either doctrine…' : 'Ask what changed…'}
          maxLength={500}
          disabled={busy}
          data-testid="coach-input"
        />
        <button type="submit" disabled={busy || !question.trim()} aria-label="Ask coach" data-testid="coach-send">
          <Send size={17} />
        </button>
      </form>

      {mode === 'human_companion' && canDelegate && (
        <div className="delegation-zone" data-testid="delegation-zone" data-confirming={delegationOpen}>
          {!delegationOpen ? (
            <button type="button" className="delegate-button" onClick={() => setDelegationOpen(true)} disabled={busy}>
              <Hand size={16} /> Invite Lantern to choose this one move <ChevronDown size={14} />
            </button>
          ) : (
            <div className="delegate-confirm" role="group" aria-label="Confirm one-turn delegation">
              <p><strong>One turn only.</strong> Under your explicit authority, Lantern will choose from the server’s position-bound verified candidates. Lantern remains a non-playing Companion, and every later turn stays yours.</p>
              <div>
                <button type="button" onClick={() => setDelegationOpen(false)} disabled={busy}>Keep my turn</button>
                <button
                  type="button"
                  className="primary"
                  onClick={() => { setDelegationOpen(false); onDelegate() }}
                  disabled={busy}
                  data-testid="delegate-confirm"
                >
                  Choose this move once
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
