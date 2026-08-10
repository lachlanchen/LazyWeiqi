export type BoardSize = 5 | 7 | 9

export type StoneColor = 'black' | 'white'
export type GamePhase = 'playing' | 'finished'
export type GameMode = 'human_vs_agent' | 'human_companion' | 'agent_vs_agent' | 'two_player'
export type ActorRole = 'human' | 'player_agent' | 'companion_agent' | 'narrator_agent'
export type AgentDoctrine = 'balanced' | 'territory' | 'influence' | 'fighting' | 'light'
export type CompanionStyle = 'socratic' | 'encouraging' | 'concise'
export type MoveIntent =
  | 'claim'
  | 'connect'
  | 'cut'
  | 'pressure'
  | 'escape'
  | 'settle'
  | 'invade'
  | 'reduce'
  | 'sacrifice'
  | 'endgame'
  | 'unsure'

export interface Point {
  x: number
  y: number
}

export interface Stone extends Point {
  color: StoneColor
  move_number?: number
}

export interface RulesSummary {
  name: string
  scoring: 'chinese_area' | 'aga'
  ko_rule: 'positional_superko' | 'situational_superko' | 'simple'
  komi: number
  training_variant?: 'first_capture' | 'guided_position' | 'wall_training' | null
}

export interface ActorSummary {
  id: string
  name: string
  role: ActorRole
  color?: StoneColor | null
  aligned_with?: StoneColor | null
  doctrine?: AgentDoctrine | null
  personality?: string | null
}

export interface LessonSummary {
  id: string
  order: number
  title: string
  subtitle: string
  story: string
  board_size: BoardSize
  duration_minutes: number
  concepts: string[]
  difficulty: 'first_steps' | 'beginner' | 'growing'
  status?: 'available' | 'current' | 'complete' | 'locked'
  training_variant?: 'first_capture' | 'guided_position' | 'wall_training' | null
  memory_line: string
}

export interface CurriculumResponse {
  version: string
  title: string
  lessons: LessonSummary[]
}

export interface ServiceStatus {
  status: 'ready' | 'degraded' | 'starting'
  service?: string
  version?: string
  engine: {
    status: 'ready' | 'fallback' | 'starting' | 'unavailable'
    provider: string
    model?: string | null
    detail?: string | null
  }
  coach: {
    status: 'ready' | 'fallback' | 'starting' | 'unavailable'
    provider: string
    model?: string | null
    detail?: string | null
  }
  supported_board_sizes?: BoardSize[]
}

export interface MoveRecord {
  id?: string
  move_number: number
  color: StoneColor
  kind: 'play' | 'pass' | 'resign'
  point?: Point | null
  actor_id: string
  intent?: MoveIntent | null
  captured?: Point[]
  comment?: string | null
}

export type EvidenceKind = 'exact' | 'tactical' | 'engine' | 'model' | 'metaphor'

export interface EnergyFacet {
  id: 'breath' | 'bonds' | 'shelter' | 'roads' | 'reach' | 'ground' | 'beat' | 'aji'
  label: string
  canonical_term: string
  value: string
  change?: string | null
  evidence: EvidenceKind
  explanation: string
  confidence?: number | null
}

export interface CandidateMove {
  id: string
  point: Point
  coordinate: string
  intent: MoveIntent
  title: string
  summary: string
  likely_reply?: string | null
  risk?: string | null
  variation?: Array<{ color: StoneColor; point: Point }>
  facets?: EnergyFacet[]
  verified: boolean
}

export interface CoachMessage {
  id: string
  speaker: string
  role: 'coach' | 'companion' | 'narrator' | 'system'
  text: string
  evidence?: EvidenceKind[]
  prompt?: string | null
  /** Present only when the learner actually submitted this question. */
  question?: string | null
  created_at?: string
}

export interface OwnershipCell extends Point {
  value: number
  uncertainty?: number
}

export interface GameAnalysis {
  status: 'ready' | 'fallback' | 'pending' | 'unavailable'
  engine?: string
  network?: string | null
  visits?: number | null
  score_lead?: number | null
  ownership?: OwnershipCell[]
  facets?: EnergyFacet[]
  candidates?: CandidateMove[]
}

export interface ReviewMoment {
  id: string
  move_number: number
  kind: 'proud' | 'turning_point' | 'missed_read' | 'concept_success'
  title: string
  explanation: string
  concept: string
}

export interface GameSummary {
  id: string
  title: string
  mode: GameMode
  board_size: BoardSize
  phase: GamePhase
  move_count: number
  result?: string | null
  updated_at: string
  lesson_id?: string | null
  lesson_title?: string | null
  concepts?: string[]
}

export interface GameState extends GameSummary {
  revision: number
  to_play: StoneColor
  rules: RulesSummary
  stones: Stone[]
  moves: MoveRecord[]
  actors: ActorSummary[]
  objective: string
  act: string
  coach_messages: CoachMessage[]
  coach_history_next_cursor: string | null
  analysis?: GameAnalysis | null
  review_moments?: ReviewMoment[]
  story_summary?: {
    promise?: string
    crisis?: string
    resolution?: string
    memory?: string
  } | null
}

export interface GamesResponse {
  games: GameSummary[]
  next_cursor: string | null
}

export interface GamesPageRequest {
  limit?: number
  cursor?: string
}

export interface CoachHistoryResponse {
  messages: CoachMessage[]
  next_cursor: string | null
}

export interface CoachHistoryPageRequest {
  limit?: number
  cursor?: string
}

export interface CreateGameRequest {
  lesson_id?: string
  board_size: BoardSize
  mode: GameMode
  human_color?: StoneColor
  black_agent?: AgentConfiguration
  white_agent?: AgentConfiguration
  companion?: CompanionConfiguration
}

export interface AgentConfiguration {
  persona: string
  doctrine: AgentDoctrine
}

export interface CompanionConfiguration {
  persona: string
  style: CompanionStyle
}

export interface PreviewMoveRequest extends Point {
  actor_id: string
  expected_revision: number
  intent?: MoveIntent
}

export interface MovePreview {
  game_id: string
  revision: number
  point: Point
  coordinate: string
  legal: boolean
  reason?: string | null
  captures: Point[]
  resulting_liberties?: number | null
  facets: EnergyFacet[]
  candidates: CandidateMove[]
  coach_prompt?: string | null
}

export interface SubmitMoveRequest {
  actor_id: string
  expected_revision: number
  kind: 'play' | 'pass' | 'resign'
  point?: Point
  intent?: MoveIntent
}

export interface AgentTurnRequest {
  actor_id?: string
  expected_revision: number
  doctrine?: AgentDoctrine
  delegated_by?: string
  candidate_id?: string
}

export interface RewindRequest {
  expected_revision: number
  to_move_number: number
}

export interface CoachRequest {
  expected_revision: number
  question: string
  selected_point?: Point
  intent?: MoveIntent
  kind?: 'hint' | 'explain' | 'narrate' | 'reflection'
  client_request_id?: string
}

export interface CoachResponse {
  message: CoachMessage
  candidates?: CandidateMove[]
  facets?: EnergyFacet[]
}

export interface ApiErrorShape {
  detail?: string
  message?: string
  code?: string
}

export interface AppPreferences {
  board_size: BoardSize
  mode: GameMode
  black_agent: AgentConfiguration
  white_agent: AgentConfiguration
  companion: CompanionConfiguration
  reduced_motion: boolean
  coordinates: boolean
}
