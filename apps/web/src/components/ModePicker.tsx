import { Bot, Drama, GraduationCap, Sparkles, UserRound } from 'lucide-react'
import type {
  AgentConfiguration,
  AgentDoctrine,
  CompanionConfiguration,
  CompanionStyle,
  GameMode,
} from '../types'

interface ModePickerProps {
  mode: GameMode
  onModeChange: (mode: GameMode) => void
  blackAgent: AgentConfiguration
  whiteAgent: AgentConfiguration
  companion: CompanionConfiguration
  onBlackAgentChange: (agent: AgentConfiguration) => void
  onWhiteAgentChange: (agent: AgentConfiguration) => void
  onCompanionChange: (companion: CompanionConfiguration) => void
  compact?: boolean
}

const MODE_OPTIONS: Array<{
  id: GameMode
  title: string
  eyebrow: string
  description: string
  icon: typeof UserRound
}> = [
  {
    id: 'human_companion',
    title: 'Journey with a companion',
    eyebrow: 'Recommended',
    description: 'You play every stone. Lantern asks questions and explains verified evidence.',
    icon: GraduationCap,
  },
  {
    id: 'human_vs_agent',
    title: 'Quiet teaching game',
    eyebrow: 'Human vs Agent',
    description: 'You face a calibrated Player Agent with only concise lesson prompts.',
    icon: UserRound,
  },
  {
    id: 'agent_vs_agent',
    title: 'Theatre of stones',
    eyebrow: 'Narrated Agent vs Agent',
    description: 'Watch two doctrines choose among verified candidates while a narrator teaches.',
    icon: Drama,
  },
]

const doctrines: Array<{ id: AgentDoctrine; label: string }> = [
  { id: 'balanced', label: 'Balanced' },
  { id: 'territory', label: 'Territory' },
  { id: 'influence', label: 'Influence' },
  { id: 'fighting', label: 'Fighting' },
  { id: 'light', label: 'Light & flexible' },
]

const companionStyles: Array<{ id: CompanionStyle; label: string }> = [
  { id: 'socratic', label: 'Socratic questions' },
  { id: 'encouraging', label: 'Warm encouragement' },
  { id: 'concise', label: 'Quiet and concise' },
]

export function ModePicker({
  mode,
  onModeChange,
  blackAgent,
  whiteAgent,
  companion,
  onBlackAgentChange,
  onWhiteAgentChange,
  onCompanionChange,
  compact = false,
}: ModePickerProps) {
  return (
    <section className={`mode-picker ${compact ? 'compact' : ''}`} data-testid="mode-picker" data-mode={mode}>
      {!compact && (
        <div className="section-heading">
          <div>
            <span className="eyebrow">Choose how the story moves</span>
            <h2>Three ways to learn</h2>
          </div>
          <p>Player Agents may choose only verified legal candidates. Companion and narrator roles never control a color.</p>
        </div>
      )}

      <div className="mode-grid" role="radiogroup" aria-label="Learning mode">
        {MODE_OPTIONS.map((option) => {
          const Icon = option.icon
          const selected = mode === option.id
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={selected}
              className={`mode-card ${selected ? 'selected' : ''}`}
              onClick={() => onModeChange(option.id)}
              data-testid={`mode-${option.id}`}
            >
              <span className="mode-icon"><Icon size={20} aria-hidden="true" /></span>
              <span className="mode-copy">
                <span className="mode-eyebrow">{option.eyebrow}</span>
                <strong>{option.title}</strong>
                {!compact && <small>{option.description}</small>}
              </span>
              <span className="radio-mark" aria-hidden="true" />
            </button>
          )
        })}
      </div>

      <div className="cast-config" data-testid="agent-cast">
        <div className="cast-title">
          <Sparkles size={17} aria-hidden="true" />
          <span>Cast & doctrine</span>
        </div>
        {mode === 'agent_vs_agent' && (
          <AgentSelect
            id="black-agent"
            label="Black · Mountain"
            value={blackAgent.doctrine}
            onChange={(doctrine) => onBlackAgentChange({ ...blackAgent, doctrine })}
          />
        )}
        <AgentSelect
          id="white-agent"
          label={`${mode === 'agent_vs_agent' ? 'White' : 'Opponent'} · River`}
          value={whiteAgent.doctrine}
          onChange={(doctrine) => onWhiteAgentChange({ ...whiteAgent, doctrine })}
        />
        {mode === 'human_companion' && (
          <label className="field-select" htmlFor="companion-style">
            <span><GraduationCap size={15} aria-hidden="true" /> Lantern · Companion</span>
            <select
              id="companion-style"
              value={companion.style}
              onChange={(event) =>
                onCompanionChange({ ...companion, style: event.target.value as CompanionStyle })
              }
              data-testid="companion-style"
            >
              {companionStyles.map((style) => <option key={style.id} value={style.id}>{style.label}</option>)}
            </select>
          </label>
        )}
        {mode === 'agent_vs_agent' && (
          <div className="narrator-note">
            <Bot size={16} aria-hidden="true" />
            <span>Lantern narrates intentions and consequences; it never chooses either side’s move.</span>
          </div>
        )}
      </div>
    </section>
  )
}

function AgentSelect({
  id,
  label,
  value,
  onChange,
}: {
  id: string
  label: string
  value: AgentDoctrine
  onChange: (value: AgentDoctrine) => void
}) {
  return (
    <label className="field-select" htmlFor={id}>
      <span><Bot size={15} aria-hidden="true" /> {label}</span>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value as AgentDoctrine)}
        data-testid={`${id}-doctrine`}
      >
        {doctrines.map((doctrine) => <option key={doctrine.id} value={doctrine.id}>{doctrine.label}</option>)}
      </select>
    </label>
  )
}
