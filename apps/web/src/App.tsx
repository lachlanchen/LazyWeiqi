import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Bot,
  Check,
  ChevronRight,
  CircleDot,
  Compass,
  Eye,
  Gauge,
  GraduationCap,
  History,
  LoaderCircle,
  Menu,
  Pause,
  Play,
  RotateCcw,
  Settings2,
  Sparkles,
  Target,
  Trophy,
  UserRound,
  WifiOff,
  X,
} from 'lucide-react'
import { ApiError, api } from './api'
import { pointKey, pointToCoordinate, samePoint, stoneMap } from './board'
import { prependOlderCoachMessages } from './coachHistory'
import { Campaign } from './components/Campaign'
import { Chronicle } from './components/Chronicle'
import { CoachRail } from './components/CoachRail'
import { EnergyLenses } from './components/EnergyLenses'
import { ModePicker } from './components/ModePicker'
import { PowerTeacher } from './components/PowerTeacher'
import { WeiqiBoard, type CandidatePreviewMode, type EnergyLensId } from './components/WeiqiBoard'
import {
  DEFAULT_PREFERENCES,
  DEMO_GAME,
  FALLBACK_CURRICULUM,
  FALLBACK_STATUS,
} from './fallbackData'
import { appendOlderGames } from './history'
import type {
  AppPreferences,
  BoardSize,
  CandidateMove,
  CoachMessage,
  CurriculumResponse,
  GameMode,
  GameState,
  GameSummary,
  LessonSummary,
  MoveIntent,
  MovePreview,
  Point,
  ServiceStatus,
  Stone,
} from './types'

type AppView = 'journey' | 'play' | 'chronicle'
type Operation = 'idle' | 'creating' | 'previewing' | 'moving' | 'agent' | 'coach' | 'rewinding' | 'loading-game'

const PREFERENCES_KEY = 'weiqi.path.preferences.v1'
const HISTORY_PAGE_SIZE = 20
const COACH_HISTORY_PAGE_SIZE = 80

function readPreferences(): AppPreferences {
  if (typeof window === 'undefined') return DEFAULT_PREFERENCES
  try {
    const stored = window.localStorage.getItem(PREFERENCES_KEY)
    if (!stored) return DEFAULT_PREFERENCES
    const parsed = JSON.parse(stored) as Partial<AppPreferences>
    return {
      ...DEFAULT_PREFERENCES,
      ...parsed,
      black_agent: { ...DEFAULT_PREFERENCES.black_agent, ...parsed.black_agent },
      white_agent: { ...DEFAULT_PREFERENCES.white_agent, ...parsed.white_agent },
      companion: { ...DEFAULT_PREFERENCES.companion, ...parsed.companion },
    }
  } catch {
    return DEFAULT_PREFERENCES
  }
}

function safeMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return 'Something interrupted the teaching flow.'
}

function newClientRequestId(prefix: string): string {
  const randomPart =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
  return `${prefix}_${randomPart}`
}

function gameSummaryOf(game: GameState): GameSummary {
  return {
    id: game.id,
    title: game.title,
    mode: game.mode,
    board_size: game.board_size,
    phase: game.phase,
    move_count: game.move_count,
    result: game.result,
    updated_at: game.updated_at,
    lesson_id: game.lesson_id,
    lesson_title: game.lesson_title,
    concepts: game.concepts,
  }
}

function localGameForLesson(lesson: LessonSummary, mode: GameMode): GameState {
  const size = lesson.board_size
  let stones: Stone[] = []
  if (size === 5) {
    stones = [
      { x: 2, y: 2, color: 'black', move_number: 1 },
      { x: 1, y: 2, color: 'white', move_number: 2 },
      { x: 2, y: 3, color: 'white', move_number: 3 },
      { x: 3, y: 2, color: 'white', move_number: 4 },
    ]
  } else if (size === 7) {
    stones = [
      { x: 2, y: 3, color: 'black', move_number: 1 },
      { x: 4, y: 3, color: 'black', move_number: 3 },
      { x: 3, y: 2, color: 'white', move_number: 2 },
      { x: 3, y: 4, color: 'white', move_number: 4 },
    ]
  } else {
    stones = DEMO_GAME.stones
  }

  const actors =
    mode === 'agent_vs_agent'
      ? [
          { id: 'black-agent', name: 'Mountain', role: 'player_agent' as const, color: 'black' as const, doctrine: 'territory' as const },
          { id: 'white-agent', name: 'River', role: 'player_agent' as const, color: 'white' as const, doctrine: 'balanced' as const },
          { id: 'narrator', name: 'Lantern', role: 'narrator_agent' as const },
        ]
      : [
          { id: 'human', name: 'You', role: 'human' as const, color: 'black' as const },
          { id: 'sparring-agent', name: 'River', role: 'player_agent' as const, color: 'white' as const, doctrine: 'balanced' as const },
          ...(mode === 'human_companion'
            ? [{ id: 'companion', name: 'Lantern', role: 'companion_agent' as const, aligned_with: 'black' as const }]
            : []),
        ]

  return {
    ...DEMO_GAME,
    id: `local-${lesson.id}`,
    title: lesson.title,
    lesson_id: lesson.id,
    lesson_title: lesson.title,
    board_size: size,
    mode,
    stones: stones.map(({ x, y, color }) => ({ x, y, color })),
    moves: [],
    move_count: 0,
    revision: 1,
    actors,
    objective: lesson.subtitle,
    concepts: lesson.concepts,
    rules: {
      ...DEMO_GAME.rules,
      komi: lesson.training_variant ? 0 : 7.5,
      training_variant: lesson.training_variant,
    },
    analysis: {
      status: 'fallback',
      engine: 'Authored setup; no live position analysis',
      facets: [],
      candidates: [],
    },
    coach_messages: [
      {
        id: `authored-${lesson.id}`,
        speaker: mode === 'agent_vs_agent' ? 'Lantern · Narrator' : 'Lantern',
        role: mode === 'agent_vs_agent' ? 'narrator' : 'companion',
        text: lesson.story,
        prompt: lesson.memory_line,
        evidence: ['metaphor'],
      },
    ],
    coach_history_next_cursor: null,
  }
}

function makeLocalPreview(game: GameState, point: Point, intent: MoveIntent): MovePreview {
  const occupied = stoneMap(game.stones)
  const empty = !occupied.has(pointKey(point))
  const coordinate = pointToCoordinate(point, game.board_size)
  return {
    game_id: game.id,
    revision: game.revision,
    point,
    coordinate,
    legal: false,
    reason: empty
      ? 'This is an authored question, not a legal reading. Reconnect the rules service to verify and commit it.'
      : 'That intersection is occupied.',
    captures: [],
    resulting_liberties: null,
    facets: empty
      ? [{
          id: 'breath',
          label: 'Breath question',
          canonical_term: 'Liberties to verify',
          value: 'Not yet read',
          evidence: 'metaphor',
          explanation: 'Use this prompt to form a hypothesis; only the live rules service supplies exact consequences.',
        }]
      : [],
    candidates: empty
      ? [{
          id: `authored-${coordinate}`,
          point,
          coordinate,
          intent,
          title: intent === 'unsure' ? 'Explore this point' : `Explore · ${intent}`,
          summary: 'Authored prompt only. No legality, reply, or outcome is claimed while the service is offline.',
          risk: 'Reconnect before treating this as a playable candidate.',
          verified: false,
        }]
      : [],
    coach_prompt: 'Name what you expect to change, then reconnect the service to test the hypothesis.',
  }
}

export function App() {
  const [view, setView] = useState<AppView>('journey')
  const [preferences, setPreferences] = useState<AppPreferences>(readPreferences)
  const [curriculum, setCurriculum] = useState<CurriculumResponse>(FALLBACK_CURRICULUM)
  const [serviceStatus, setServiceStatus] = useState<ServiceStatus>(FALLBACK_STATUS)
  const [history, setHistory] = useState<GameSummary[]>([])
  const [historyStatus, setHistoryStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading')
  const [historyCursor, setHistoryCursor] = useState<string | null>(null)
  const [historyPageLoading, setHistoryPageLoading] = useState(false)
  const [historyPageError, setHistoryPageError] = useState<string | null>(null)
  const [activeGame, setActiveGame] = useState<GameState | null>(null)
  const [reviewGame, setReviewGame] = useState<GameState | null>(null)
  const [bootstrap, setBootstrap] = useState<'loading' | 'ready' | 'fallback'>('loading')
  const [operation, setOperation] = useState<Operation>('idle')
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const coachLaneRef = useRef(false)
  const [coachHistoryLoading, setCoachHistoryLoading] = useState(false)
  const [coachHistoryError, setCoachHistoryError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Point | null>(null)
  const [preview, setPreview] = useState<MovePreview | null>(null)
  const [intent, setIntent] = useState<MoveIntent>('unsure')
  const [activeLenses, setActiveLenses] = useState<Set<EnergyLensId>>(() => new Set(['cloud', 'breath', 'bonds', 'area']))
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [navOpen, setNavOpen] = useState(false)
  const [theatreAutoPlay, setTheatreAutoPlay] = useState(false)
  const previewAbort = useRef<AbortController | null>(null)
  const previewEpoch = useRef(0)
  const foundationAbort = useRef<AbortController | null>(null)
  const foundationEpoch = useRef(0)
  const gameLoadAbort = useRef<AbortController | null>(null)
  const gameLoadEpoch = useRef(0)
  const historyPageAbort = useRef<AbortController | null>(null)
  const historyPageEpoch = useRef(0)
  const coachHistoryAbort = useRef<AbortController | null>(null)
  const coachHistoryEpoch = useRef(0)
  const analysisAbort = useRef<AbortController | null>(null)
  const analysisEpoch = useRef(0)
  const requestedAnalysisKey = useRef<string | null>(null)

  const serviceLive = bootstrap === 'ready'
  const engineAvailable = serviceStatus.engine.status === 'ready'
  const isBusy = operation !== 'idle' && operation !== 'previewing'

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences))
    } catch {
      // Preferences remain active for this tab if browser storage is unavailable.
    }
  }, [preferences])

  const invalidatePreview = useCallback(() => {
    previewAbort.current?.abort()
    previewAbort.current = null
    previewEpoch.current += 1
    setSelected(null)
    setPreview(null)
    setSelectedCandidateId(null)
    setOperation((current) => current === 'previewing' ? 'idle' : current)
  }, [])

  const loadFoundation = useCallback(async () => {
    foundationAbort.current?.abort()
    historyPageAbort.current?.abort()
    historyPageAbort.current = null
    historyPageEpoch.current += 1
    const controller = new AbortController()
    foundationAbort.current = controller
    const requestEpoch = ++foundationEpoch.current
    setBootstrap('loading')
    setHistoryStatus('loading')
    setHistoryPageLoading(false)
    setHistoryPageError(null)
    setNotice(null)
    const [statusResult, curriculumResult, gamesResult] = await Promise.allSettled([
      api.status(controller.signal),
      api.curriculum(controller.signal),
      api.games({ limit: HISTORY_PAGE_SIZE }, controller.signal),
    ])

    if (controller.signal.aborted || requestEpoch !== foundationEpoch.current) return

    const ready = statusResult.status === 'fulfilled' && curriculumResult.status === 'fulfilled'
    if (statusResult.status === 'fulfilled') setServiceStatus(statusResult.value)
    else setServiceStatus(FALLBACK_STATUS)
    if (curriculumResult.status === 'fulfilled') setCurriculum(curriculumResult.value)
    else setCurriculum(FALLBACK_CURRICULUM)
    if (gamesResult.status === 'fulfilled') {
      setHistory(gamesResult.value.games)
      setHistoryCursor(gamesResult.value.next_cursor)
      setHistoryStatus('ready')
    } else {
      setHistory([])
      setHistoryCursor(null)
      setHistoryStatus('unavailable')
    }
    setBootstrap(ready ? 'ready' : 'fallback')
    if (!ready) setNotice('The app is showing its authored lesson preview while the local teaching service starts.')
  }, [])

  useEffect(() => {
    void loadFoundation()
    return () => {
      foundationAbort.current?.abort()
      foundationEpoch.current += 1
      previewAbort.current?.abort()
      previewEpoch.current += 1
      gameLoadAbort.current?.abort()
      gameLoadEpoch.current += 1
      historyPageAbort.current?.abort()
      historyPageEpoch.current += 1
      coachHistoryAbort.current?.abort()
      coachHistoryEpoch.current += 1
      analysisAbort.current?.abort()
      analysisEpoch.current += 1
    }
  }, [loadFoundation])

  useEffect(() => {
    const game = activeGame
    const alreadyAnalyzed = Boolean(game?.analysis?.candidates?.length)
    const turnActor = game?.actors.find(
      (actor) => actor.color === game.to_play &&
        (actor.role === 'human' || actor.role === 'player_agent'),
    )
    const learnerTurn = turnActor?.role === 'human'
    const pausedTheatre = Boolean(
      game?.mode === 'agent_vs_agent' && !theatreAutoPlay && operation === 'idle',
    )
    if (
      !serviceLive ||
      !game ||
      game.id.startsWith('local-') ||
      game.phase !== 'playing' ||
      operation !== 'idle' ||
      (!learnerTurn && !pausedTheatre) ||
      alreadyAnalyzed
    ) {
      analysisAbort.current?.abort()
      analysisAbort.current = null
      setAnalysisLoading(false)
      return
    }

    const key = `${game.id}:${game.revision}`
    if (requestedAnalysisKey.current === key) return
    requestedAnalysisKey.current = key
    analysisAbort.current?.abort()
    const controller = new AbortController()
    analysisAbort.current = controller
    const requestEpoch = ++analysisEpoch.current
    setAnalysisLoading(true)

    void api.analyzeGame(game.id, game.revision, controller.signal)
      .then((response) => {
        if (controller.signal.aborted || requestEpoch !== analysisEpoch.current) return
        setActiveGame((current) => {
          if (!current || current.id !== response.game_id || current.revision !== response.revision) {
            return current
          }
          return { ...current, analysis: response.analysis }
        })
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        if (controller.signal.aborted || requestEpoch !== analysisEpoch.current) return
        setNotice(`Next-move comparison is unavailable. ${safeMessage(error)}`)
      })
      .finally(() => {
        if (analysisAbort.current === controller && requestEpoch === analysisEpoch.current) {
          analysisAbort.current = null
          setAnalysisLoading(false)
        }
      })

    return () => {
      controller.abort()
      // A board preview may intentionally supersede this request. Leave the
      // revision eligible for a fresh comparison when previewing ends; the
      // aborted response was never attached to activeGame.
      if (requestedAnalysisKey.current === key) requestedAnalysisKey.current = null
    }
  }, [
    activeGame?.analysis?.candidates?.length,
    activeGame?.id,
    activeGame?.phase,
    activeGame?.revision,
    operation,
    serviceLive,
    theatreAutoPlay,
  ])

  useEffect(() => {
    coachHistoryAbort.current?.abort()
    coachHistoryAbort.current = null
    coachHistoryEpoch.current += 1
    setCoachHistoryLoading(false)
    setCoachHistoryError(null)
  }, [activeGame?.id, activeGame?.revision])

  const updatePreferences = (patch: Partial<AppPreferences>) =>
    setPreferences((current) => ({ ...current, ...patch }))

  const rememberGame = useCallback((game: GameState) => {
    if (game.id.startsWith('local-')) return
    const summary = gameSummaryOf(game)
    setHistory((current) => [summary, ...current.filter((item) => item.id !== game.id)])
    setHistoryStatus('ready')
  }, [])

  const loadOlderGames = useCallback(async () => {
    if (!historyCursor || historyPageLoading) return
    historyPageAbort.current?.abort()
    const controller = new AbortController()
    historyPageAbort.current = controller
    const requestEpoch = ++historyPageEpoch.current
    const requestedCursor = historyCursor
    setHistoryPageLoading(true)
    setHistoryPageError(null)
    try {
      const page = await api.games(
        { limit: HISTORY_PAGE_SIZE, cursor: requestedCursor },
        controller.signal,
      )
      if (controller.signal.aborted || requestEpoch !== historyPageEpoch.current) return
      if (page.next_cursor === requestedCursor) {
        throw new Error('The teaching service repeated the same history page.')
      }
      setHistory((current) => appendOlderGames(current, page.games))
      setHistoryCursor(page.next_cursor)
      setHistoryStatus('ready')
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      if (controller.signal.aborted || requestEpoch !== historyPageEpoch.current) return
      setHistoryPageError(`Older games could not be loaded. ${safeMessage(error)}`)
    } finally {
      if (historyPageAbort.current === controller && requestEpoch === historyPageEpoch.current) {
        historyPageAbort.current = null
        setHistoryPageLoading(false)
      }
    }
  }, [historyCursor, historyPageLoading])

  const loadOlderCoachHistory = useCallback(async () => {
    const requestedCursor = activeGame?.coach_history_next_cursor
    if (!activeGame || !requestedCursor || coachHistoryLoading) return
    coachHistoryAbort.current?.abort()
    const controller = new AbortController()
    coachHistoryAbort.current = controller
    const requestEpoch = ++coachHistoryEpoch.current
    const gameId = activeGame.id
    const gameRevision = activeGame.revision
    setCoachHistoryLoading(true)
    setCoachHistoryError(null)
    try {
      const page = await api.coachHistory(
        gameId,
        { limit: COACH_HISTORY_PAGE_SIZE, cursor: requestedCursor },
        controller.signal,
      )
      if (controller.signal.aborted || requestEpoch !== coachHistoryEpoch.current) return
      if (page.next_cursor === requestedCursor) {
        throw new Error('The teaching service repeated the same conversation page.')
      }
      setActiveGame((current) => {
        if (!current || current.id !== gameId || current.revision !== gameRevision) return current
        return {
          ...current,
          coach_messages: prependOlderCoachMessages(current.coach_messages, page.messages),
          coach_history_next_cursor: page.next_cursor,
        }
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      if (controller.signal.aborted || requestEpoch !== coachHistoryEpoch.current) return
      setCoachHistoryError(`Earlier conversation could not be loaded. ${safeMessage(error)}`)
    } finally {
      if (
        coachHistoryAbort.current === controller &&
        requestEpoch === coachHistoryEpoch.current
      ) {
        coachHistoryAbort.current = null
        setCoachHistoryLoading(false)
      }
    }
  }, [activeGame, coachHistoryLoading])

  const startLesson = useCallback(async (lesson: LessonSummary) => {
    invalidatePreview()
    setOperation('creating')
    setNotice(null)
    try {
      const game = await api.createGame({
        lesson_id: lesson.id,
        board_size: lesson.board_size,
        mode: preferences.mode,
        human_color: preferences.mode === 'agent_vs_agent' ? undefined : 'black',
        black_agent: preferences.black_agent,
        white_agent: preferences.white_agent,
        companion: preferences.mode === 'human_companion' ? preferences.companion : undefined,
      })
      setActiveGame(game)
      rememberGame(game)
    } catch (error) {
      setActiveGame(localGameForLesson(lesson, preferences.mode))
      setNotice(`${safeMessage(error)} Showing a non-committing authored preview.`)
    } finally {
      setView('play')
      setOperation('idle')
      window.scrollTo({ top: 0, behavior: preferences.reduced_motion ? 'auto' : 'smooth' })
    }
  }, [invalidatePreview, preferences, rememberGame])

  const requestPreview = useCallback(async (
    point: Point,
    requestedIntent = intent,
    candidateId: string | null = null,
  ) => {
    if (!activeGame) return
    previewAbort.current?.abort()
    const controller = new AbortController()
    previewAbort.current = controller
    const requestEpoch = ++previewEpoch.current
    const gameId = activeGame.id
    const gameRevision = activeGame.revision
    setSelected(point)
    setPreview(null)
    setSelectedCandidateId(candidateId)
    setOperation('previewing')
    try {
      if (activeGame.id.startsWith('local-')) {
        setPreview(makeLocalPreview(activeGame, point, requestedIntent))
      } else {
        const result = await api.previewMove(
          activeGame.id,
          {
            ...point,
            actor_id: activeGame.actors.find((actor) => actor.role === 'human' && actor.color === activeGame.to_play)?.id ?? 'human',
            expected_revision: activeGame.revision,
            intent: requestedIntent,
          },
          controller.signal,
        )
        if (
          result.game_id !== gameId ||
          result.revision !== gameRevision ||
          !samePoint(result.point, point)
        ) {
          throw new Error('The preview no longer matches this board position. Please select the point again.')
        }
        if (controller.signal.aborted || requestEpoch !== previewEpoch.current) return
        setPreview(result)
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      if (controller.signal.aborted || requestEpoch !== previewEpoch.current) return
      setPreview(makeLocalPreview(activeGame, point, requestedIntent))
      setNotice(safeMessage(error))
    } finally {
      if (previewAbort.current === controller && requestEpoch === previewEpoch.current) {
        previewAbort.current = null
        setOperation('idle')
      }
    }
  }, [activeGame, intent])

  const runAgentTurn = useCallback(async (game: GameState, delegated = false) => {
    if (game.id.startsWith('local-')) {
      setNotice('The local rules service must be connected before any agent can place a stone.')
      setTheatreAutoPlay(false)
      return
    }
    if (game.phase !== 'playing') return
    invalidatePreview()
    setOperation('agent')
    setNotice(null)
    const turnActor = game.actors.find(
      (candidate) => candidate.color === game.to_play &&
        (candidate.role === 'human' || candidate.role === 'player_agent'),
    )
    const actor = delegated
      ? game.actors.find((candidate) => candidate.role === 'companion_agent')
      : game.actors.find((candidate) => candidate.role === 'player_agent' && candidate.color === game.to_play)
    if (delegated && (turnActor?.role !== 'human' || !actor)) {
      setNotice('This position does not have a Human turn and Companion available for one-move delegation.')
      setOperation('idle')
      return
    }
    try {
      const updated = await api.agentTurn(game.id, {
        actor_id: actor?.id,
        expected_revision: game.revision,
        doctrine: actor?.doctrine ?? undefined,
        delegated_by: delegated ? turnActor?.id : undefined,
      })
      setActiveGame(updated)
      rememberGame(updated)

      if (delegated && updated.phase === 'playing') {
        const replyActor = updated.actors.find(
          (candidate) => candidate.role === 'player_agent' && candidate.color === updated.to_play,
        )
        if (replyActor) {
          const reply = await api.agentTurn(updated.id, {
            actor_id: replyActor.id,
            expected_revision: updated.revision,
            doctrine: replyActor.doctrine ?? undefined,
          })
          setActiveGame(reply)
          rememberGame(reply)
        }
      }
    } catch (error) {
      setNotice(safeMessage(error))
      setTheatreAutoPlay(false)
    } finally {
      setOperation('idle')
    }
  }, [invalidatePreview, rememberGame])

  const submitMove = useCallback(async (kind: 'play' | 'pass') => {
    if (!activeGame || activeGame.id.startsWith('local-')) {
      setNotice('Reconnect the deterministic rules service to commit a move. The current board is a safe preview.')
      return
    }
    if (operation !== 'idle' || activeGame.phase !== 'playing') return
    if (
      kind === 'play' &&
      (!selected ||
        !preview?.legal ||
        preview.game_id !== activeGame.id ||
        preview.revision !== activeGame.revision ||
        !samePoint(preview.point, selected))
    ) return
    const human = activeGame.actors.find((actor) => actor.role === 'human' && actor.color === activeGame.to_play)
    if (!human) return
    setOperation('moving')
    setNotice(null)
    try {
      const updated = await api.submitMove(activeGame.id, {
        actor_id: human.id,
        expected_revision: activeGame.revision,
        kind,
        point: kind === 'play' ? selected ?? undefined : undefined,
        intent,
      })
      setActiveGame(updated)
      rememberGame(updated)
      invalidatePreview()
      const nextActor = updated.actors.find((actor) => actor.role === 'player_agent' && actor.color === updated.to_play)
      if (updated.phase === 'playing' && nextActor && updated.mode !== 'agent_vs_agent') {
        await runAgentTurn(updated)
      }
    } catch (error) {
      setNotice(safeMessage(error))
    } finally {
      setOperation('idle')
    }
  }, [activeGame, intent, invalidatePreview, operation, preview, rememberGame, runAgentTurn, selected])

  const rewind = useCallback(async () => {
    if (!activeGame || activeGame.id.startsWith('local-') || activeGame.move_count === 0) {
      setNotice('There is no committed server move to rewind yet.')
      return
    }
    setOperation('rewinding')
    try {
      const updated = await api.rewind(activeGame.id, {
        expected_revision: activeGame.revision,
        to_move_number: Math.max(0, activeGame.move_count - 1),
      })
      setActiveGame(updated)
      rememberGame(updated)
      invalidatePreview()
    } catch (error) {
      setNotice(safeMessage(error))
    } finally {
      setOperation('idle')
    }
  }, [activeGame, invalidatePreview, rememberGame])

  const askCoach = useCallback(async (question: string, kind: 'hint' | 'explain' = 'explain') => {
    if (!activeGame || coachLaneRef.current) return
    coachLaneRef.current = true
    if (activeGame.id.startsWith('local-')) {
      const localMessage: CoachMessage = {
        id: `local-coach-${Date.now()}`,
        speaker: activeGame.mode === 'agent_vs_agent' ? 'Lantern · Narrator' : 'Lantern',
        role: activeGame.mode === 'agent_vs_agent' ? 'narrator' : 'companion',
        text: kind === 'hint'
          ? 'First ask which nearby string has the fewest liberties. Then look for a move that changes more than one relationship.'
          : 'The strongest contrast is usually not “good versus bad.” It is ground now versus options later. Select a point to make that trade visible.',
        evidence: ['metaphor'],
        question,
      }
      setActiveGame({ ...activeGame, coach_messages: [...activeGame.coach_messages, localMessage] })
      coachLaneRef.current = false
      return
    }
    setOperation('coach')
    try {
      const response = await api.coach(activeGame.id, {
        expected_revision: activeGame.revision,
        question,
        selected_point: selected ?? undefined,
        intent,
        kind,
        client_request_id: newClientRequestId('coach'),
      })
      setActiveGame((current) => {
        if (!current || current.id !== activeGame.id || current.revision !== activeGame.revision) return current
        return {
          ...current,
          coach_messages: [...current.coach_messages, response.message],
          analysis: {
            status: current.analysis?.status ?? 'fallback',
            ...current.analysis,
            facets: response.facets?.length ? response.facets : current.analysis?.facets,
            candidates: response.candidates?.length ? response.candidates : current.analysis?.candidates,
          },
        }
      })
      if (response.candidates?.length || response.facets?.length) {
        setPreview((current) => current
          ? {
              ...current,
              candidates: response.candidates?.length ? response.candidates : current.candidates,
              facets: response.facets?.length ? response.facets : current.facets,
            }
          : current)
      }
    } catch (error) {
      setNotice(safeMessage(error))
    } finally {
      coachLaneRef.current = false
      setOperation('idle')
    }
  }, [activeGame, intent, selected])

  const loadReview = useCallback(async (id: string) => {
    gameLoadAbort.current?.abort()
    const controller = new AbortController()
    gameLoadAbort.current = controller
    const requestEpoch = ++gameLoadEpoch.current
    setOperation('loading-game')
    setNotice(null)
    try {
      const game = await api.game(id, controller.signal)
      if (controller.signal.aborted || requestEpoch !== gameLoadEpoch.current) return
      setReviewGame(game)
    } catch (error) {
      if (controller.signal.aborted || requestEpoch !== gameLoadEpoch.current) return
      setReviewGame(null)
      setNotice(`That game could not be opened: ${safeMessage(error)}`)
    } finally {
      if (requestEpoch === gameLoadEpoch.current) {
        gameLoadAbort.current = null
        setOperation('idle')
      }
    }
  }, [])

  const resumeGame = useCallback(async (summary: GameSummary) => {
    gameLoadAbort.current?.abort()
    const controller = new AbortController()
    gameLoadAbort.current = controller
    const requestEpoch = ++gameLoadEpoch.current
    invalidatePreview()
    setOperation('loading-game')
    setNotice(null)
    try {
      const game = await api.game(summary.id, controller.signal)
      if (controller.signal.aborted || requestEpoch !== gameLoadEpoch.current) return
      setActiveGame(game)
      rememberGame(game)
      setView('play')
    } catch (error) {
      if (controller.signal.aborted || requestEpoch !== gameLoadEpoch.current) return
      setNotice(`That game could not be resumed: ${safeMessage(error)}`)
    } finally {
      if (requestEpoch === gameLoadEpoch.current) {
        gameLoadAbort.current = null
        setOperation('idle')
      }
    }
  }, [invalidatePreview, rememberGame])

  useEffect(() => {
    if (!theatreAutoPlay || !activeGame || activeGame.mode !== 'agent_vs_agent' || activeGame.phase !== 'playing' || operation !== 'idle') return
    const timeout = window.setTimeout(() => void runAgentTurn(activeGame), 1100)
    return () => window.clearTimeout(timeout)
  }, [activeGame, operation, runAgentTurn, theatreAutoPlay])

  const currentLesson = useMemo(
    () =>
      curriculum.lessons.find(
        (lesson) => lesson.status === 'current' && lesson.board_size === preferences.board_size,
      ) ?? curriculum.lessons.find((lesson) => lesson.board_size === preferences.board_size) ?? curriculum.lessons[0],
    [curriculum.lessons, preferences.board_size],
  )

  const setCurrentView = (next: AppView) => {
    if (next !== 'play') invalidatePreview()
    setView(next)
    setNavOpen(false)
    if (next !== 'play') setTheatreAutoPlay(false)
  }

  return (
    <div
      className="app"
      data-testid="app-root"
      data-status={bootstrap}
      data-view={view}
      data-engine={serviceStatus.engine.status}
      data-operation={operation}
    >
      <header className="app-header">
        <button type="button" className="brand" onClick={() => setCurrentView('journey')} aria-label="Path of Influence home">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <span><strong>Path of Influence</strong><small>Weiqi, taught as a living story</small></span>
        </button>

        <nav className={navOpen ? 'open' : ''} aria-label="Primary navigation">
          <button type="button" className={view === 'journey' ? 'active' : ''} onClick={() => setCurrentView('journey')} data-testid="nav-journey">
            <Compass size={17} /> Journey
          </button>
          <button type="button" className={view === 'play' ? 'active' : ''} onClick={() => activeGame && setCurrentView('play')} disabled={!activeGame} data-testid="nav-play">
            <CircleDot size={17} /> Board
          </button>
          <button type="button" className={view === 'chronicle' ? 'active' : ''} onClick={() => setCurrentView('chronicle')} data-testid="nav-chronicle">
            <History size={17} /> Chronicle
          </button>
        </nav>

        <div className="header-actions">
          <div
            className={`engine-pill ${engineAvailable ? 'ready' : 'fallback'}`}
            data-testid="engine-status"
            role="status"
            aria-label={bootstrap === 'loading' ? 'Local analysis engine starting' : engineAvailable ? 'KataGo analysis engine ready' : 'Using authored lesson fallback'}
          >
            {bootstrap === 'loading' ? <LoaderCircle size={14} className="spin" /> : engineAvailable ? <Gauge size={14} /> : <WifiOff size={14} />}
            <span>{bootstrap === 'loading' ? 'Starting' : engineAvailable ? 'KataGo ready' : 'Lesson fallback'}</span>
          </div>
          <button type="button" className="settings-button" aria-label="Toggle board coordinates" aria-pressed={preferences.coordinates} title="Toggle board coordinates" onClick={() => updatePreferences({ coordinates: !preferences.coordinates })}>
            <Settings2 size={18} />
          </button>
          <button type="button" className="nav-menu" aria-label="Toggle navigation" aria-expanded={navOpen} onClick={() => setNavOpen((open) => !open)}>
            {navOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </header>

      {notice && (
        <div className="notice-bar" role="status" data-testid="app-notice">
          <WifiOff size={15} aria-hidden="true" />
          <span>{notice}</span>
          {bootstrap === 'fallback' && <button type="button" onClick={() => void loadFoundation()}>Try again</button>}
          <button type="button" aria-label="Dismiss notice" onClick={() => setNotice(null)}><X size={15} /></button>
        </div>
      )}

      <main>
        {view === 'journey' && (
          <div className="journey-view">
            <OnboardingHero
              lesson={currentLesson}
              mode={preferences.mode}
              onBegin={() => currentLesson && void startLesson(currentLesson)}
              loading={operation === 'creating'}
              fallback={bootstrap === 'fallback'}
            />
            <div className="content-width">
              <ModePicker
                mode={preferences.mode}
                onModeChange={(mode) => updatePreferences({ mode })}
                blackAgent={preferences.black_agent}
                whiteAgent={preferences.white_agent}
                companion={preferences.companion}
                onBlackAgentChange={(black_agent) => updatePreferences({ black_agent })}
                onWhiteAgentChange={(white_agent) => updatePreferences({ white_agent })}
                onCompanionChange={(companion) => updatePreferences({ companion })}
              />
              <Campaign
                lessons={curriculum.lessons}
                selectedBoard={preferences.board_size}
                onBoardChange={(board_size) => updatePreferences({ board_size })}
                onStartLesson={(lesson) => void startLesson(lesson)}
                busy={operation === 'creating'}
              />
              <LearningDoctrine />
            </div>
          </div>
        )}

        {view === 'play' && activeGame && (
          <PlayWorkspace
            game={activeGame}
            preferences={preferences}
            operation={operation}
            analysisLoading={analysisLoading}
            selected={selected}
            preview={preview}
            intent={intent}
            activeLenses={activeLenses}
            selectedCandidateId={selectedCandidateId}
            engineAvailable={engineAvailable}
            coachStatus={serviceStatus.coach}
            coachHistoryLoading={coachHistoryLoading}
            coachHistoryError={coachHistoryError}
            theatreAutoPlay={theatreAutoPlay}
            onBack={() => setCurrentView('journey')}
            onSelect={(point) => void requestPreview(point)}
            onCancelSelection={invalidatePreview}
            onCommit={() => void submitMove('play')}
            onPass={() => void submitMove('pass')}
            onRewind={() => void rewind()}
            onIntentChange={setIntent}
            onLensToggle={(id) => setActiveLenses((current) => {
              const next = new Set(current)
              if (next.has(id)) next.delete(id)
              else next.add(id)
              return next
            })}
            onCandidateSelect={(candidate) => {
              setIntent(candidate.intent)
              if (activeGame.mode === 'agent_vs_agent' || candidate.kind === 'pass' || candidate.point == null) {
                // Theatre cards are read-only study controls. Pin the supplied
                // candidate locally; a separate explicit button authorizes a
                // Player Agent turn or human pass.
                setSelectedCandidateId(candidate.id)
                setSelected(null)
                setPreview(null)
                return
              }
              void requestPreview(candidate.point, candidate.intent, candidate.id)
            }}
            onAsk={(question, kind) => void askCoach(question, kind)}
            onLoadOlderCoachHistory={() => void loadOlderCoachHistory()}
            onDelegate={() => void runAgentTurn(activeGame, true)}
            onAgentTurn={() => void runAgentTurn(activeGame)}
            onTheatreAutoPlay={setTheatreAutoPlay}
            onOpenReview={() => {
              setReviewGame(activeGame)
              setCurrentView('chronicle')
            }}
          />
        )}

        {view === 'chronicle' && (
          <div className="content-width chronicle-view">
            <Chronicle
              games={history}
              selected={reviewGame}
              loading={operation === 'loading-game'}
              unavailable={historyStatus === 'unavailable'}
              hasOlder={historyCursor !== null}
              loadingOlder={historyPageLoading}
              olderError={historyPageError}
              onOpen={(id) => void loadReview(id)}
              onResume={(game) => void resumeGame(game)}
              onLoadOlder={() => void loadOlderGames()}
            />
          </div>
        )}
      </main>
    </div>
  )
}

interface PlayWorkspaceProps {
  game: GameState
  preferences: AppPreferences
  operation: Operation
  analysisLoading: boolean
  selected: Point | null
  preview: MovePreview | null
  intent: MoveIntent
  activeLenses: Set<EnergyLensId>
  selectedCandidateId: string | null
  engineAvailable: boolean
  coachStatus: ServiceStatus['coach']
  coachHistoryLoading: boolean
  coachHistoryError: string | null
  theatreAutoPlay: boolean
  onBack: () => void
  onSelect: (point: Point) => void
  onCancelSelection: () => void
  onCommit: () => void
  onPass: () => void
  onRewind: () => void
  onIntentChange: (intent: MoveIntent) => void
  onLensToggle: (id: EnergyLensId) => void
  onCandidateSelect: (candidate: CandidateMove) => void
  onAsk: (question: string, kind?: 'hint' | 'explain') => void
  onLoadOlderCoachHistory: () => void
  onDelegate: () => void
  onAgentTurn: () => void
  onTheatreAutoPlay: (value: boolean) => void
  onOpenReview: () => void
}

export function PlayWorkspace({
  game,
  preferences,
  operation,
  analysisLoading,
  selected,
  preview,
  intent,
  activeLenses,
  selectedCandidateId,
  engineAvailable,
  coachStatus,
  coachHistoryLoading,
  coachHistoryError,
  theatreAutoPlay,
  onBack,
  onSelect,
  onCancelSelection,
  onCommit,
  onPass,
  onRewind,
  onIntentChange,
  onLensToggle,
  onCandidateSelect,
  onAsk,
  onLoadOlderCoachHistory,
  onDelegate,
  onAgentTurn,
  onTheatreAutoPlay,
  onOpenReview,
}: PlayWorkspaceProps) {
  const [inspectedCandidateId, setInspectedCandidateId] = useState<string | null>(null)
  const boardBusy = operation !== 'idle' && operation !== 'previewing'
  const busy = analysisLoading || boardBusy
  const currentActor = game.actors.find((actor) => actor.color === game.to_play && (actor.role === 'human' || actor.role === 'player_agent'))
  const humanTurn = currentActor?.role === 'human'
  const unsettledAreaLabel = game.area_snapshot
    ? `Stones: Black ${game.area_snapshot.black_stones} · White ${game.area_snapshot.white_stones}. Territory and dead stones are not settled, so no final score is declared.`
    : 'Territory and dead stones are not settled, so no final score is declared.'
  const candidates = preview?.candidates ?? game.analysis?.candidates ?? []
  const inspectedCandidate = candidates.find((candidate) => candidate.id === inspectedCandidateId) ?? null
  const selectedCandidate = candidates.find((candidate) => candidate.id === selectedCandidateId) ?? null
  const previewTeachingCandidate: CandidateMove | null = preview?.teaching
    ? {
        ...preview.teaching,
        summary: preview.teaching.summary ?? preview.teaching.why_here,
      }
    : null
  const comparisonCandidate = inspectedCandidate && (
    !previewTeachingCandidate || inspectedCandidate.id !== previewTeachingCandidate.id
  ) ? inspectedCandidate : null
  const openingSuggestion = game.board_size === 9 && game.move_count === 0 && game.stones.length === 0 &&
    !selected && !preview && humanTurn && game.mode !== 'agent_vs_agent'
    ? game.analysis?.candidates?.find((candidate) =>
        candidate.kind !== 'pass' && candidate.point != null && candidate.evaluation?.order === 0,
      ) ?? game.analysis?.candidates?.find((candidate) => candidate.kind !== 'pass' && candidate.point != null) ?? null
    : null
  const passiveTheatreCandidate = game.mode === 'agent_vs_agent' ? candidates[0] ?? null : null
  // Hover/focus may temporarily replace the pinned preview. A fresh 9×9 board
  // shows the supplied first-stone suggestion, but never requests or plays it.
  const visualCandidate = comparisonCandidate ?? (
    selected
      ? previewTeachingCandidate ?? selectedCandidate
      : selectedCandidate ?? openingSuggestion ?? passiveTheatreCandidate
  )
  const candidatePreviewMode: CandidatePreviewMode | null = comparisonCandidate
    ? 'candidate-comparison'
    : selected && visualCandidate
      ? 'if-played'
      : openingSuggestion && visualCandidate?.id === openingSuggestion.id
        ? 'suggested-first-stone'
        : passiveTheatreCandidate && visualCandidate?.id === passiveTheatreCandidate.id
          ? 'candidate-comparison'
        : selectedCandidate
          ? 'pinned-candidate'
          : null
  const currentFacets = preview?.position_facets ?? game.analysis?.facets ?? []
  const hypotheticalFacets = preview?.candidate_facets ?? preview?.facets ?? []
  const ifPlayedPositionFacets = preview?.if_played_facets ?? []
  // A preview may replace consequence readings such as liberties, but it must
  // never hide exact current-position facts such as the side to move.
  const facets = preview
    ? [
        ...hypotheticalFacets
          .filter((facet) => facet.id !== 'area' && facet.id !== 'beat')
          .map((facet) => ({ ...facet, scope: 'if_played' as const })),
        ...ifPlayedPositionFacets
          .filter((facet) => facet.id === 'beat' || facet.id === 'reach')
          .map((facet) => ({ ...facet, scope: 'if_played' as const })),
        ...currentFacets
          .filter((facet) => facet.id === 'beat' || facet.id === 'reach')
          .map((facet) => ({ ...facet, scope: 'current' as const })),
      ]
    : currentFacets.map((facet) => ({ ...facet, scope: 'current' as const }))
  const localPreview = game.id.startsWith('local-')
  const ownershipAvailable = Boolean(game.analysis?.ownership?.length)
  const previewBound = Boolean(
    selected &&
      preview?.legal &&
      preview.game_id === game.id &&
      preview.revision === game.revision &&
      samePoint(preview.point, selected),
  )

  useEffect(() => {
    setInspectedCandidateId(null)
  }, [game.id, game.revision])

  const handleCandidateInspect = useCallback((candidate: CandidateMove | null) => {
    setInspectedCandidateId(candidate?.id ?? null)
  }, [])

  return (
    <div
      className="play-view"
      data-testid="play-workspace"
      data-mode={game.mode}
      data-turn={game.to_play}
      data-phase={game.phase}
      data-analysis-state={selected ? (operation === 'previewing' && !preview ? 'analyzing' : preview?.legal ? 'if-played-ready' : preview ? 'illegal' : 'analyzing') : openingSuggestion ? 'suggested-first-stone' : analysisLoading ? 'finding-suggestion' : 'current-position'}
      data-selected-coordinate={selected ? pointToCoordinate(selected, game.board_size) : undefined}
    >
      {game.rules.training_variant && (
        <div className="training-banner" data-testid="training-rules-banner">
          <GraduationCap size={16} />
          <strong>Training focus:</strong>
          <span>{game.rules.training_variant === 'first_capture'
            ? 'look for the first sound capture; completion follows the service-reported game state.'
            : game.rules.training_variant === 'guided_position'
              ? 'this scene begins from an authored teaching position; the live service still owns legality and completion.'
              : 'practice extending from the wall; the live service remains the authority on legal play and completion.'}</span>
        </div>
      )}

      {game.phase === 'finished' && (
        <div className="completion-banner" data-testid={game.result ? 'game-complete' : 'play-ended-unsettled'} data-scored={Boolean(game.result)} role="status">
          {game.result ? <Trophy size={18} aria-hidden="true" /> : <CircleDot size={18} aria-hidden="true" />}
          <div>
            <small>{game.result ? 'Scene complete' : 'Play ended · two consecutive passes'}</small>
            <strong>{game.result ?? unsettledAreaLabel}</strong>
          </div>
          <button type="button" onClick={onOpenReview}>Open reflection <ArrowRight size={15} /></button>
        </div>
      )}

      <header className="play-titlebar">
        <button type="button" className="back-button" onClick={onBack}><ArrowLeft size={17} /> Journey</button>
        <div className="play-title">
          <span className="eyebrow">{game.lesson_title ?? 'Teaching game'} · {game.board_size}×{game.board_size}</span>
          <h1>{game.title}</h1>
          <p>{game.act}</p>
        </div>
        <div className="turn-card">
          <span className={`turn-stone ${game.to_play}`} aria-hidden="true" />
          <div>
            <small>{game.phase === 'finished' ? `${game.move_count} moves` : `Move ${game.move_count + 1}`}</small>
            <strong>{game.phase === 'finished' ? (game.result ? 'Game complete' : 'Play ended · score not settled') : `${currentActor?.name ?? game.to_play} to play`}</strong>
          </div>
        </div>
      </header>

      <section className="objective-strip">
        <Target size={17} aria-hidden="true" />
        <div><span>Current purpose</span><strong>{game.objective}</strong></div>
        <div className="rules-compact"><span>{game.rules.name}</span><span>Komi {game.rules.komi}</span><span>{formatKoRule(game.rules.ko_rule)}</span></div>
      </section>

      <div className="play-layout">
        <section className="board-column">
          <div className="board-stage">
            <WeiqiBoard
              size={game.board_size}
              stones={game.stones}
              toPlay={game.to_play}
              selected={selected}
              onSelect={onSelect}
              preview={preview}
              candidatePreview={visualCandidate}
              candidatePreviewMode={candidatePreviewMode}
              lastMove={game.moves.at(-1) ?? null}
              ownership={game.analysis?.ownership}
              activeLenses={activeLenses}
              showCoordinates={preferences.coordinates}
              disabled={boardBusy || !humanTurn || game.mode === 'agent_vs_agent' || game.phase !== 'playing'}
              reducedMotion={preferences.reduced_motion}
              operationStatus={operation}
            />

            {(operation !== 'idle' || analysisLoading) && (
              <div
                className="board-operation"
                role="status"
                data-testid={operation === 'previewing' ? 'unconfirmed-analysis-loading' : analysisLoading && game.move_count === 0 ? 'suggested-first-stone-loading' : 'board-operation'}
              >
                <LoaderCircle size={18} className="spin" />
                <span>{operation === 'previewing'
                  ? `Analyzing if ${game.to_play} plays ${selected ? pointToCoordinate(selected, game.board_size) : 'here'}…`
                  : analysisLoading && game.move_count === 0
                    ? 'Finding a suggested first stone…'
                    : analysisLoading
                      ? 'Comparing the next choices…'
                      : operationLabel(operation)}</span>
              </div>
            )}
          </div>

          <div className="move-controls" data-testid="move-controls">
            {game.mode === 'agent_vs_agent' ? (
              <>
                <button type="button" className="secondary-control" onClick={onRewind} disabled={busy || game.move_count === 0}><RotateCcw size={16} /> Rewind</button>
                <button type="button" className={`secondary-control ${theatreAutoPlay ? 'active' : ''}`} onClick={() => onTheatreAutoPlay(!theatreAutoPlay)} disabled={game.phase !== 'playing' || (busy && !theatreAutoPlay)} data-testid="theatre-autoplay">
                  {theatreAutoPlay ? <Pause size={16} /> : <Play size={16} />}{theatreAutoPlay ? 'Pause theatre' : 'Watch continuously'}
                </button>
                <button type="button" className="primary-control" onClick={onAgentTurn} disabled={game.phase !== 'playing' || busy || theatreAutoPlay || localPreview} data-testid="agent-next-turn">
                  <Bot size={17} /> Play one narrated turn
                </button>
              </>
            ) : selected ? (
              <>
                <button type="button" className="secondary-control" onClick={onCancelSelection} disabled={busy}>Cancel</button>
                <div className="selection-summary">
                  <span className={`selection-dot ${game.to_play}`} />
                  <div><small>Previewing</small><strong>{pointToCoordinate(selected, game.board_size)} · {intent}</strong></div>
                  <span className={`legality ${preview ? (preview.legal ? 'legal' : 'blocked') : 'checking'}`}>
                    {preview ? (preview.legal ? <><Check size={13} /> Verified</> : 'Not legal') : 'Checking…'}
                  </span>
                </div>
                {previewBound ? (
                  <button type="button" className="primary-control" onClick={onCommit} disabled={operation !== 'idle'} data-testid="commit-move">
                    Place stone <ArrowRight size={17} />
                  </button>
                ) : (
                  <span className="analysis-before-confirmation" data-testid="analysis-before-confirmation">
                    {preview && !preview.legal ? 'Choose another point' : 'Analysis first · placement remains locked'}
                  </span>
                )}
              </>
            ) : (
              <>
                <button type="button" className="secondary-control" onClick={onRewind} disabled={busy || game.move_count === 0}><RotateCcw size={16} /> Rewind</button>
                <p className="move-instruction"><Eye size={16} /> Select an empty intersection to preview its consequences.</p>
                <button type="button" className="secondary-control" onClick={onPass} disabled={game.phase !== 'playing' || busy || !humanTurn}>Pass</button>
              </>
            )}
          </div>

          <PowerTeacher
            size={game.board_size}
            stones={game.stones}
            toPlay={game.to_play}
            selected={selected}
            preview={preview}
            activeCandidate={visualCandidate}
            candidates={candidates}
            lastMove={game.moves.at(-1) ?? null}
            ownershipAvailable={ownershipAvailable}
          />

          <EnergyLenses active={activeLenses} onToggle={onLensToggle} facets={facets} engineAvailable={engineAvailable && !localPreview && ownershipAvailable} />

          <div className="move-timeline" aria-label="Move timeline">
            <div className="timeline-heading"><BookOpen size={15} /><span>The story so far</span><small>{game.move_count} moves</small></div>
            <div className="timeline-track">
              {game.moves.slice(-12).map((move) => (
                <span key={`${move.move_number}-${move.color}`} title={`Move ${move.move_number}`}>
                  <i className={move.color} />
                  <small>{move.point ? pointToCoordinate(move.point, game.board_size) : move.kind}</small>
                </span>
              ))}
              {!game.move_count && <p>The first move will begin the chronicle.</p>}
            </div>
          </div>
        </section>

        <CoachRail
          boardSize={game.board_size}
          toPlay={game.to_play}
          mode={game.mode}
          messages={game.coach_messages}
          preview={preview}
          candidates={candidates}
          selectedCandidateId={selectedCandidateId}
          inspectedCandidateId={inspectedCandidateId}
          suggestedCandidateId={openingSuggestion?.id ?? null}
          intent={intent}
          onIntentChange={onIntentChange}
          onCandidateSelect={onCandidateSelect}
          onCandidateInspect={handleCandidateInspect}
          onAsk={onAsk}
          hasOlderHistory={game.coach_history_next_cursor !== null}
          historyLoading={coachHistoryLoading}
          historyError={coachHistoryError}
          onLoadOlderHistory={onLoadOlderCoachHistory}
          historyKey={game.id}
          onDelegate={onDelegate}
          canDelegate={humanTurn && game.phase === 'playing' && !localPreview && game.actors.some((actor) => actor.role === 'companion_agent')}
          busy={busy}
          fallback={localPreview || coachStatus.status === 'unavailable' || coachStatus.status === 'starting'}
          statusLabel={localPreview
            ? 'Authored guidance'
            : coachStatus.status === 'ready'
              ? `${coachStatus.provider} · ready`
              : coachStatus.status === 'fallback'
                ? `${coachStatus.provider} · local fallback`
                : `${coachStatus.provider} · ${coachStatus.status}`}
          delegationKey={`${game.id}:${game.revision}:${game.to_play}`}
        />
      </div>
    </div>
  )
}

function OnboardingHero({
  lesson,
  mode,
  onBegin,
  loading,
  fallback,
}: {
  lesson?: LessonSummary
  mode: GameMode
  onBegin: () => void
  loading: boolean
  fallback: boolean
}) {
  return (
    <section className="hero" data-testid="onboarding-hero">
      <div className="hero-glow one" /><div className="hero-glow two" />
      <div className="hero-inner">
        <div className="hero-copy">
          <span className="hero-kicker"><Sparkles size={15} /> A patient path into Weiqi</span>
          <h1>Don’t memorize the board.<br /><em>Learn to feel what changes.</em></h1>
          <p>Play a complete game as a story of breath, connection, reach, danger, and choice—grounded in exact rules and bounded local analysis.</p>
          <div className="hero-actions">
            <button type="button" className="hero-primary" onClick={onBegin} disabled={!lesson || loading} data-testid="begin-journey">
              {loading ? <LoaderCircle size={18} className="spin" /> : <Play size={17} />}
              {lesson ? `${lesson.status === 'current' ? 'Continue' : 'Begin'} · ${lesson.title}` : 'Begin the journey'}
              <ArrowRight size={17} />
            </button>
            <a href="#learning-modes" className="hero-secondary">See how teaching works <ChevronRight size={16} /></a>
          </div>
          <div className="hero-trust">
            <span><Check size={13} /> You place your stones</span>
            <span><Check size={13} /> 9×9 default</span>
            <span><Check size={13} /> Local-first</span>
            {fallback && <span className="fallback"><WifiOff size={13} /> Preview ready while engine starts</span>}
          </div>
        </div>

        <div className="hero-scene" aria-label="Illustration of a teaching position">
          <div className="hero-story-card top">
            <span className="story-icon"><GraduationCap size={17} /></span>
            <div><small>Lantern asks</small><strong>Which group needs breath first?</strong></div>
          </div>
          <svg viewBox="0 0 440 440" className="hero-board" aria-hidden="true">
            <defs>
              <linearGradient id="hero-board-wash" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#f6dda8" /><stop offset="1" stopColor="#eac176" /></linearGradient>
              <filter id="hero-shadow"><feDropShadow dx="0" dy="7" stdDeviation="8" floodOpacity=".2" /></filter>
            </defs>
            <rect x="20" y="20" width="400" height="400" rx="30" fill="url(#hero-board-wash)" />
            {Array.from({ length: 9 }, (_, index) => <g key={index}><line x1="58" y1={58 + index * 40.5} x2="382" y2={58 + index * 40.5} stroke="#76572f" strokeOpacity=".66" /><line y1="58" x1={58 + index * 40.5} y2="382" x2={58 + index * 40.5} stroke="#76572f" strokeOpacity=".66" /></g>)}
            {[{x:139,y:301,c:'b'},{x:180,y:301,c:'b'},{x:139,y:260,c:'b'},{x:301,y:139,c:'w'},{x:260,y:139,c:'w'},{x:301,y:180,c:'w'}].map((stone, index) => <circle key={index} cx={stone.x} cy={stone.y} r="18" fill={stone.c === 'b' ? '#152934' : '#fffdf5'} stroke={stone.c === 'b' ? '#07151d' : '#c9c4b8'} filter="url(#hero-shadow)" />)}
            <circle cx="220" cy="220" r="15" fill="#0a8f77" fillOpacity=".2" stroke="#087c69" strokeWidth="3" strokeDasharray="5 5" />
            <path d="M 196 220 C 178 210 171 193 180 179" fill="none" stroke="#0a8f77" strokeWidth="4" strokeLinecap="round" strokeDasharray="4 8" />
          </svg>
          <div className="hero-story-card bottom">
            <span className="energy-mini"><i /><i /><i /></span>
            <div><small>Exact · Liberties</small><strong>Three open roads</strong></div>
            <span className="mini-change">+2</span>
          </div>
          <div className="hero-mode-pill">{mode === 'human_companion' ? <><UserRound size={14} /> You + Lantern</> : mode === 'agent_vs_agent' ? <><Bot size={14} /> Narrated theatre</> : <><UserRound size={14} /> Quiet game</>}</div>
        </div>
      </div>
      <div id="learning-modes" />
    </section>
  )
}

function LearningDoctrine() {
  const items = [
    { icon: CircleDot, title: 'Exact breath', text: 'Rules code owns liberties, legality, capture, ko, scoring, and history.' },
    { icon: Gauge, title: 'Bounded evidence', text: 'KataGo supplies candidate forecasts and variation across searched lines. It never mutates a game.' },
    { icon: GraduationCap, title: 'A companion, not a pilot', text: 'Lantern asks, explains, and reflects. Your turn remains yours.' },
    { icon: BookOpen, title: 'A story you can replay', text: 'Every rewind becomes a branch, so curiosity never erases the original game.' },
  ]
  return (
    <section className="doctrine-section">
      <div className="section-heading"><div><span className="eyebrow">Our teaching promise</span><h2>High-quality analysis, honestly labeled</h2></div><p>“Energy” is a useful language for relationships—not a mystical score and never a replacement for evidence.</p></div>
      <div className="doctrine-grid">{items.map(({ icon: Icon, title, text }) => <article key={title}><span><Icon size={19} /></span><h3>{title}</h3><p>{text}</p></article>)}</div>
    </section>
  )
}

function operationLabel(operation: Operation): string {
  const labels: Record<Operation, string> = {
    idle: 'Ready',
    creating: 'Opening the lesson…',
    previewing: 'Reading the point…',
    moving: 'Verifying and placing…',
    agent: 'Agent is choosing among verified candidates…',
    coach: 'Companion is preparing a grounded explanation…',
    rewinding: 'Opening a new branch…',
    'loading-game': 'Opening the chronicle…',
  }
  return labels[operation]
}

function formatKoRule(rule: GameState['rules']['ko_rule']): string {
  const labels: Record<GameState['rules']['ko_rule'], string> = {
    positional_superko: 'Positional superko',
    situational_superko: 'Situational superko',
    simple: 'Simple ko',
  }
  return labels[rule]
}

export default App
