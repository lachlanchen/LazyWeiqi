import { Bot, Drama, GraduationCap, Sparkles, UserRound } from 'lucide-react'
import { useI18n, type MessageKey } from '../i18n'
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
  title: MessageKey
  eyebrow: MessageKey
  description: MessageKey
  icon: typeof UserRound
}> = [
  {
    id: 'human_companion',
    title: 'mode.companionTitle',
    eyebrow: 'mode.recommended',
    description: 'mode.companionDescription',
    icon: GraduationCap,
  },
  {
    id: 'human_vs_agent',
    title: 'mode.humanTitle',
    eyebrow: 'mode.humanEyebrow',
    description: 'mode.humanDescription',
    icon: UserRound,
  },
  {
    id: 'agent_vs_agent',
    title: 'mode.theatreTitle',
    eyebrow: 'mode.theatreEyebrow',
    description: 'mode.theatreDescription',
    icon: Drama,
  },
]

const doctrines: Array<{ id: AgentDoctrine; label: MessageKey }> = [
  { id: 'balanced', label: 'doctrine.balanced' },
  { id: 'territory', label: 'doctrine.territory' },
  { id: 'influence', label: 'doctrine.influence' },
  { id: 'fighting', label: 'doctrine.fighting' },
  { id: 'light', label: 'doctrine.light' },
]

const companionStyles: Array<{ id: CompanionStyle; label: MessageKey }> = [
  { id: 'socratic', label: 'style.socratic' },
  { id: 'encouraging', label: 'style.encouraging' },
  { id: 'concise', label: 'style.concise' },
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
  const { t } = useI18n()
  return (
    <section className={`mode-picker ${compact ? 'compact' : ''}`} data-testid="mode-picker" data-mode={mode}>
      {!compact && (
        <div className="section-heading">
          <div>
            <span className="eyebrow">{t('mode.eyebrow')}</span>
            <h2>{t('mode.title')}</h2>
          </div>
          <p>{t('mode.description')}</p>
        </div>
      )}

      <div className="mode-grid" role="radiogroup" aria-label={t('mode.group')}>
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
                <span className="mode-eyebrow">{t(option.eyebrow)}</span>
                <strong>{t(option.title)}</strong>
                {!compact && <small>{t(option.description)}</small>}
              </span>
              <span className="radio-mark" aria-hidden="true" />
            </button>
          )
        })}
      </div>

      <div className="cast-config" data-testid="agent-cast">
        <div className="cast-title">
          <Sparkles size={17} aria-hidden="true" />
          <span>{t('mode.cast')}</span>
        </div>
        {mode === 'agent_vs_agent' && (
          <AgentSelect
            id="black-agent"
            label={t('mode.blackMountain')}
            value={blackAgent.doctrine}
            onChange={(doctrine) => onBlackAgentChange({ ...blackAgent, doctrine })}
          />
        )}
        <AgentSelect
          id="white-agent"
          label={mode === 'agent_vs_agent' ? t('mode.whiteRiver') : t('mode.opponentRiver')}
          value={whiteAgent.doctrine}
          onChange={(doctrine) => onWhiteAgentChange({ ...whiteAgent, doctrine })}
        />
        {mode === 'human_companion' && (
          <label className="field-select" htmlFor="companion-style">
            <span><GraduationCap size={15} aria-hidden="true" /> {t('mode.lanternCompanion')}</span>
            <select
              id="companion-style"
              value={companion.style}
              onChange={(event) =>
                onCompanionChange({ ...companion, style: event.target.value as CompanionStyle })
              }
              data-testid="companion-style"
            >
              {companionStyles.map((style) => <option key={style.id} value={style.id}>{t(style.label)}</option>)}
            </select>
          </label>
        )}
        {mode === 'agent_vs_agent' && (
          <div className="narrator-note">
            <Bot size={16} aria-hidden="true" />
            <span>{t('mode.narratorAuthority')}</span>
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
  const { t } = useI18n()
  return (
    <label className="field-select" htmlFor={id}>
      <span><Bot size={15} aria-hidden="true" /> {label}</span>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value as AgentDoctrine)}
        data-testid={`${id}-doctrine`}
      >
        {doctrines.map((doctrine) => <option key={doctrine.id} value={doctrine.id}>{t(doctrine.label)}</option>)}
      </select>
    </label>
  )
}
