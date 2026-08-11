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
  PanelsTopLeft,
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
import {
  LanguageSelect,
  localizeCurriculum,
  localizeEnergyFacet,
  localizeGame,
  localizeGameSummary,
  localizeMovePreview,
  translate,
  useI18n,
  type Locale,
  type MessageKey,
} from './i18n'
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
type InterfaceLayout = 'classic' | 'simple'
type NoticeState = {
  key?: MessageKey
  values?: Record<string, string | number>
  translatedValues?: Record<string, MessageKey>
  text?: string
  suffixKey?: MessageKey
}

const PREFERENCES_KEY = 'weiqi.path.preferences.v1'
const HISTORY_PAGE_SIZE = 20
const COACH_HISTORY_PAGE_SIZE = 80

export function interfaceLayoutForPath(pathname: string): InterfaceLayout {
  const normalized = pathname.replace(/\/+$/, '') || '/'
  return normalized === '/' || normalized === '/simple' ? 'simple' : 'classic'
}

export function shouldUseClientRouteSwitch(event: {
  button: number
  defaultPrevented: boolean
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
}): boolean {
  return event.button === 0 &&
    !event.defaultPrevented &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
}

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

function safeMessage(error: unknown, fallback = 'Something interrupted the teaching flow.'): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return fallback
}

class CatalogNoticeError extends Error {
  constructor(readonly key: MessageKey) {
    super(key)
  }
}

function noticeFromError(error: unknown, fallbackKey: MessageKey = 'notice.flowInterrupted'): NoticeState {
  if (error instanceof CatalogNoticeError) return { key: error.key }
  if (error instanceof ApiError || error instanceof Error) return { text: error.message }
  return { key: fallbackKey }
}

function noticeWithDetail(key: MessageKey, error: unknown): NoticeState {
  if (error instanceof ApiError || error instanceof Error) {
    return { key, values: { detail: error.message } }
  }
  return { key, translatedValues: { detail: 'notice.flowInterrupted' } }
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

function authored(locale: Locale, english: string, chinese: string, japanese: string): string {
  return locale === 'zh-Hans' ? chinese : locale === 'ja' ? japanese : english
}

function makeLocalPreview(game: GameState, point: Point, intent: MoveIntent, locale: Locale): MovePreview {
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
      ? authored(locale, 'This is an authored question, not a legal reading. Reconnect the rules service to verify and commit it.', '这是人工编写的提问，不是合法性读取。重新连接规则服务后再验证并落子。', 'これは教材の問いであり、合法手の判定ではありません。ルールサービスに再接続し、検証後に着手してください。')
      : authored(locale, 'That intersection is occupied.', '该交叉点已有棋子。', 'その交点には石があります。'),
    captures: [],
    resulting_liberties: null,
    facets: empty
      ? [{
          id: 'breath',
          label: authored(locale, 'Breath question', '气的问题', 'ダメの問い'),
          canonical_term: authored(locale, 'Liberties to verify', '待验证的气', '検証するダメ'),
          value: authored(locale, 'Not yet read', '尚未读取', 'まだ読みなし'),
          evidence: 'metaphor',
          explanation: authored(locale, 'Use this prompt to form a hypothesis; only the live rules service supplies exact consequences.', '用这个提示形成假设；只有实时规则服务才会给出确定后果。', 'この問いから仮説を作ります。正確な結果を出すのは実行中のルールサービスだけです。'),
        }]
      : [],
    candidates: empty
      ? [{
          id: `authored-${coordinate}`,
          point,
          coordinate,
          intent,
          title: intent === 'unsure' ? authored(locale, 'Explore this point', '探索此点', 'この点を探る') : `${authored(locale, 'Explore', '探索', '探る')} · ${translate(locale, `intent.${intent}` as MessageKey)}`,
          summary: authored(locale, 'Authored prompt only. No legality, reply, or outcome is claimed while the service is offline.', '这只是人工编写的提示。服务离线时，不声称合法性、应手或结果。', '教材用の問いだけです。サービスがオフラインの間は、着手の可否、応手、結果を主張しません。'),
          risk: authored(locale, 'Reconnect before treating this as a playable candidate.', '将它当作可下的候选前，请先重新连接。', '打てる候補として扱う前に再接続してください。'),
          verified: false,
        }]
      : [],
    coach_prompt: authored(locale, 'Name what you expect to change, then reconnect the service to test the hypothesis.', '先说出你预期什么会改变，再重连服务验证假设。', '何が変わると予想するかを言葉にし、サービスへ再接続して仮説を試します。'),
  }
}

export function App() {
  const { locale, t } = useI18n()
  const translateRef = useRef(t)
  const [interfaceLayout, setInterfaceLayout] = useState<InterfaceLayout>(
    () => interfaceLayoutForPath(typeof window === 'undefined' ? '/' : window.location.pathname),
  )
  const simpleInterface = interfaceLayout === 'simple'
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
  const [notice, setNotice] = useState<NoticeState | null>(null)
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
  const displayCurriculum = useMemo(() => localizeCurriculum(curriculum, locale), [curriculum, locale])
  const displayHistory = useMemo(
    () => history.map((game) => localizeGameSummary(game, locale)),
    [history, locale],
  )
  const displayGame = useMemo(
    () => activeGame ? localizeGame(activeGame, locale) : null,
    [activeGame, locale],
  )
  const displayReviewGame = useMemo(
    () => reviewGame ? localizeGame(reviewGame, locale) : null,
    [reviewGame, locale],
  )
  const noticeText = useMemo(() => {
    if (!notice) return null
    const translatedValues = Object.fromEntries(
      Object.entries(notice.translatedValues ?? {}).map(([name, key]) => [name, t(key)]),
    )
    const main = notice.key
      ? t(notice.key, { ...notice.values, ...translatedValues })
      : notice.text ?? ''
    const suffix = notice.suffixKey ? t(notice.suffixKey) : ''
    return [main, suffix].filter(Boolean).join(' ')
  }, [notice, t])
  const displayPreview = useMemo(
    () => preview ? localizeMovePreview(preview, locale) : null,
    [preview, locale],
  )

  useEffect(() => {
    translateRef.current = t
  }, [t])

  useEffect(() => {
    if (!activeGame?.id.startsWith('local-') || !selected) return
    setPreview(makeLocalPreview(activeGame, selected, intent, locale))
  }, [activeGame, intent, locale, selected])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences))
    } catch {
      // Preferences remain active for this tab if browser storage is unavailable.
    }
  }, [preferences])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const syncLayoutFromHistory = () => setInterfaceLayout(interfaceLayoutForPath(window.location.pathname))
    window.addEventListener('popstate', syncLayoutFromHistory)
    return () => window.removeEventListener('popstate', syncLayoutFromHistory)
  }, [])

  const switchInterface = useCallback((next: InterfaceLayout) => {
    if (typeof window === 'undefined' || next === interfaceLayout) return
    window.history.pushState(null, '', next === 'simple' ? '/' : '/full')
    setInterfaceLayout(next)
  }, [interfaceLayout])

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
    if (!ready) setNotice({ key: 'notice.authoredPreview' })
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
        setNotice(noticeWithDetail('notice.analysisUnavailable', error))
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
        throw new Error(translateRef.current('notice.historyPageRepeated'))
      }
      setHistory((current) => appendOlderGames(current, page.games))
      setHistoryCursor(page.next_cursor)
      setHistoryStatus('ready')
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      if (controller.signal.aborted || requestEpoch !== historyPageEpoch.current) return
      setHistoryPageError(t('notice.olderGamesFailed', { detail: safeMessage(error, t('notice.flowInterrupted')) }))
    } finally {
      if (historyPageAbort.current === controller && requestEpoch === historyPageEpoch.current) {
        historyPageAbort.current = null
        setHistoryPageLoading(false)
      }
    }
  }, [historyCursor, historyPageLoading, t])

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
        throw new Error(translateRef.current('notice.conversationPageRepeated'))
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
      setCoachHistoryError(t('notice.earlierConversationFailed', { detail: safeMessage(error, t('notice.flowInterrupted')) }))
    } finally {
      if (
        coachHistoryAbort.current === controller &&
        requestEpoch === coachHistoryEpoch.current
      ) {
        coachHistoryAbort.current = null
        setCoachHistoryLoading(false)
      }
    }
  }, [activeGame, coachHistoryLoading, t])

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
      setNotice({ ...noticeFromError(error), suffixKey: 'notice.previewFallbackSuffix' })
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
        setPreview(makeLocalPreview(activeGame, point, requestedIntent, locale))
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
          throw new CatalogNoticeError('notice.previewMismatch')
        }
        if (controller.signal.aborted || requestEpoch !== previewEpoch.current) return
        setPreview(result)
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      if (controller.signal.aborted || requestEpoch !== previewEpoch.current) return
      setPreview(makeLocalPreview(activeGame, point, requestedIntent, locale))
      setNotice(noticeFromError(error))
    } finally {
      if (previewAbort.current === controller && requestEpoch === previewEpoch.current) {
        previewAbort.current = null
        setOperation('idle')
      }
    }
  }, [activeGame, intent, locale])

  const runAgentTurn = useCallback(async (game: GameState, delegated = false) => {
    if (game.id.startsWith('local-')) {
      setNotice({ key: 'notice.localRulesRequired' })
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
      setNotice({ key: 'notice.delegationUnavailable' })
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
      setNotice(noticeFromError(error))
      setTheatreAutoPlay(false)
    } finally {
      setOperation('idle')
    }
  }, [invalidatePreview, rememberGame, t])

  const submitMove = useCallback(async (kind: 'play' | 'pass') => {
    if (!activeGame || activeGame.id.startsWith('local-')) {
      setNotice({ key: 'notice.commitOffline' })
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
      setNotice(noticeFromError(error))
    } finally {
      setOperation('idle')
    }
  }, [activeGame, intent, invalidatePreview, operation, preview, rememberGame, runAgentTurn, selected, t])

  const rewind = useCallback(async () => {
    if (!activeGame || activeGame.id.startsWith('local-') || activeGame.move_count === 0) {
      setNotice({ key: 'notice.noMoveToRewind' })
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
      setNotice(noticeFromError(error))
    } finally {
      setOperation('idle')
    }
  }, [activeGame, invalidatePreview, rememberGame, t])

  const askCoach = useCallback(async (question: string, kind: 'hint' | 'explain' = 'explain') => {
    if (!activeGame || coachLaneRef.current) return
    coachLaneRef.current = true
    if (activeGame.id.startsWith('local-')) {
      const localMessage: CoachMessage = {
        id: `local-coach-${Date.now()}`,
        speaker: activeGame.mode === 'agent_vs_agent'
          ? authored(locale, 'Lantern · Narrator', '灯笼 · 解说者', 'ランタン · 解説者')
          : authored(locale, 'Lantern', '灯笼', 'ランタン'),
        role: activeGame.mode === 'agent_vs_agent' ? 'narrator' : 'companion',
        text: kind === 'hint'
          ? authored(locale, 'First ask which nearby string has the fewest liberties. Then look for a move that changes more than one relationship.', '先问附近哪块棋的气最少，再寻找一手能同时改变一种以上关系的棋。', 'まず近くのどの一団が最もダメが少ないかを問います。次に、複数の関係を変える手を探します。')
          : authored(locale, 'The strongest contrast is usually not “good versus bad.” It is ground now versus options later. Select a point to make that trade visible.', '最关键的对比通常不是“好对坏”，而是“现在的实地”与“以后的选择”。选一个点，让这个取舍可见。', '最も重要な対比は、たいてい「良い対悪い」ではなく、「今の地」と「後の選択肢」です。点を選び、その取引を見えるようにします。'),
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
      setNotice(noticeFromError(error))
    } finally {
      coachLaneRef.current = false
      setOperation('idle')
    }
  }, [activeGame, intent, locale, selected])

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
      setNotice(noticeWithDetail('notice.openFailed', error))
    } finally {
      if (requestEpoch === gameLoadEpoch.current) {
        gameLoadAbort.current = null
        setOperation('idle')
      }
    }
  }, [t])

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
      setNotice(noticeWithDetail('notice.resumeFailed', error))
    } finally {
      if (requestEpoch === gameLoadEpoch.current) {
        gameLoadAbort.current = null
        setOperation('idle')
      }
    }
  }, [invalidatePreview, rememberGame, t])

  useEffect(() => {
    if (!theatreAutoPlay || !activeGame || activeGame.mode !== 'agent_vs_agent' || activeGame.phase !== 'playing' || operation !== 'idle') return
    const timeout = window.setTimeout(() => void runAgentTurn(activeGame), 1100)
    return () => window.clearTimeout(timeout)
  }, [activeGame, operation, runAgentTurn, theatreAutoPlay])

  const currentLesson = useMemo(
    () =>
      displayCurriculum.lessons.find(
        (lesson) => lesson.status === 'current' && lesson.board_size === preferences.board_size,
      ) ?? displayCurriculum.lessons.find((lesson) => lesson.board_size === preferences.board_size) ?? displayCurriculum.lessons[0],
    [displayCurriculum.lessons, preferences.board_size],
  )

  const setCurrentView = (next: AppView) => {
    if (next !== 'play') invalidatePreview()
    setView(next)
    setNavOpen(false)
    if (next !== 'play') setTheatreAutoPlay(false)
  }

  return (
    <div
      className={simpleInterface ? 'app is-simple' : 'app'}
      data-testid="app-root"
      data-status={bootstrap}
      data-view={view}
      data-layout={interfaceLayout}
      data-engine={serviceStatus.engine.status}
      data-operation={operation}
    >
      {simpleInterface && (
        <header className="simple-header" data-testid="simple-header">
          <button type="button" className="simple-brand" onClick={() => setCurrentView('journey')} aria-label={t('nav.simpleHome')}>
            <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
            <span><strong>{t('app.name')}</strong><small>{t('app.simpleBoard')}</small></span>
          </button>
          <nav aria-label={t('nav.simple')}>
            <button type="button" className={view === 'journey' ? 'active' : ''} aria-current={view === 'journey' ? 'page' : undefined} onClick={() => setCurrentView('journey')} data-testid="simple-nav-journey" aria-label={t('nav.newLesson')}><Compass size={16} /><span>{t('nav.start')}</span></button>
            <button type="button" className={view === 'play' ? 'active' : ''} aria-current={view === 'play' ? 'page' : undefined} onClick={() => activeGame && setCurrentView('play')} disabled={!activeGame} data-testid="simple-nav-play" aria-label={t('nav.currentBoard')}><CircleDot size={16} /><span>{t('nav.board')}</span></button>
            <button type="button" className={view === 'chronicle' ? 'active' : ''} aria-current={view === 'chronicle' ? 'page' : undefined} onClick={() => setCurrentView('chronicle')} data-testid="simple-nav-chronicle" aria-label={t('nav.gameHistory')}><History size={16} /><span>{t('nav.history')}</span></button>
          </nav>
          <div className="simple-header-actions">
            <span
              className={`simple-engine ${engineAvailable ? 'ready' : 'fallback'}`}
              role="status"
              aria-label={bootstrap === 'loading' ? t('status.analysisStarting') : engineAvailable ? t('status.analysisReady') : t('status.authoredFallback')}
              data-testid="simple-engine-status"
            >
              {bootstrap === 'loading' ? <LoaderCircle size={14} className="spin" /> : engineAvailable ? <Gauge size={14} /> : <WifiOff size={14} />}
              <span>{bootstrap === 'loading' ? t('status.starting') : engineAvailable ? t('status.engineReady') : t('status.fallback')}</span>
            </span>
            <LanguageSelect compact />
            <button type="button" className="simple-icon-button" aria-label={t('action.coordinates')} aria-pressed={preferences.coordinates} title={t('action.coordinates')} onClick={() => updatePreferences({ coordinates: !preferences.coordinates })}>
              <Settings2 size={17} />
            </button>
            <a href="/full" className="interface-route-link" data-testid="ui-classic" title={t('nav.openFull')} onClick={(event) => {
              if (!shouldUseClientRouteSwitch(event)) return
              event.preventDefault()
              switchInterface('classic')
            }}>
              <PanelsTopLeft size={16} /><span>{t('nav.fullGuide')}</span>
            </a>
          </div>
        </header>
      )}

      {!simpleInterface && <header className="app-header">
        <button type="button" className="brand" onClick={() => setCurrentView('journey')} aria-label={t('nav.home')}>
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <span><strong>{t('app.name')}</strong><small>{t('app.tagline')}</small></span>
        </button>

        <nav className={navOpen ? 'open' : ''} aria-label={t('nav.primary')}>
          <button type="button" className={view === 'journey' ? 'active' : ''} onClick={() => setCurrentView('journey')} data-testid="nav-journey">
            <Compass size={17} /> {t('nav.journey')}
          </button>
          <button type="button" className={view === 'play' ? 'active' : ''} onClick={() => activeGame && setCurrentView('play')} disabled={!activeGame} data-testid="nav-play">
            <CircleDot size={17} /> {t('nav.board')}
          </button>
          <button type="button" className={view === 'chronicle' ? 'active' : ''} onClick={() => setCurrentView('chronicle')} data-testid="nav-chronicle">
            <History size={17} /> {t('nav.chronicle')}
          </button>
        </nav>

        <div className="header-actions">
          <div
            className={`engine-pill ${engineAvailable ? 'ready' : 'fallback'}`}
            data-testid="engine-status"
            role="status"
            aria-label={bootstrap === 'loading' ? t('status.analysisStarting') : engineAvailable ? t('status.analysisReady') : t('status.authoredFallback')}
          >
            {bootstrap === 'loading' ? <LoaderCircle size={14} className="spin" /> : engineAvailable ? <Gauge size={14} /> : <WifiOff size={14} />}
            <span>{bootstrap === 'loading' ? t('status.starting') : engineAvailable ? t('status.katagoReady') : t('status.lessonFallback')}</span>
          </div>
          <LanguageSelect />
          <button type="button" className="settings-button" aria-label={t('action.coordinates')} aria-pressed={preferences.coordinates} title={t('action.coordinates')} onClick={() => updatePreferences({ coordinates: !preferences.coordinates })}>
            <Settings2 size={18} />
          </button>
          <a href="/" className="interface-route-link" data-testid="ui-simple" title={t('nav.openSimple')} onClick={(event) => {
            if (!shouldUseClientRouteSwitch(event)) return
            event.preventDefault()
            switchInterface('simple')
          }}>
            <PanelsTopLeft size={16} /><span>{t('nav.simpleView')}</span>
          </a>
          <button type="button" className="nav-menu" aria-label={t('nav.toggle')} aria-expanded={navOpen} onClick={() => setNavOpen((open) => !open)}>
            {navOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </header>}

      {noticeText && (
        <div className="notice-bar" role="status" data-testid="app-notice" data-notice-key={notice?.key ?? 'raw'}>
          <WifiOff size={15} aria-hidden="true" />
          <span>{noticeText}</span>
          {bootstrap === 'fallback' && <button type="button" onClick={() => void loadFoundation()}>{t('action.tryAgain')}</button>}
          <button type="button" aria-label={t('action.dismiss')} onClick={() => setNotice(null)}><X size={15} /></button>
        </div>
      )}

      <main>
        {view === 'journey' && (
          simpleInterface ? (
            <SimpleStart
              lesson={currentLesson}
              preferences={preferences}
              loading={operation === 'creating'}
              fallback={bootstrap === 'fallback'}
              onBegin={() => currentLesson && void startLesson(currentLesson)}
              onBoardChange={(board_size) => updatePreferences({ board_size })}
              onModeChange={(mode) => updatePreferences({ mode })}
              onBlackAgentChange={(black_agent) => updatePreferences({ black_agent })}
              onWhiteAgentChange={(white_agent) => updatePreferences({ white_agent })}
              onCompanionChange={(companion) => updatePreferences({ companion })}
            />
          ) : <div className="journey-view">
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
                lessons={displayCurriculum.lessons}
                selectedBoard={preferences.board_size}
                onBoardChange={(board_size) => updatePreferences({ board_size })}
                onStartLesson={(lesson) => void startLesson(lesson)}
                busy={operation === 'creating'}
              />
              <LearningDoctrine />
            </div>
          </div>
        )}

        {view === 'play' && activeGame && displayGame && (
          <PlayWorkspace
            layout={interfaceLayout}
            game={displayGame}
            preferences={preferences}
            operation={operation}
            analysisLoading={analysisLoading}
            selected={selected}
            preview={displayPreview}
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
              games={displayHistory}
              selected={displayReviewGame}
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
  layout?: InterfaceLayout
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
  layout = 'classic',
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
  const { locale, t } = useI18n()
  const [inspectedCandidateId, setInspectedCandidateId] = useState<string | null>(null)
  const boardBusy = operation !== 'idle' && operation !== 'previewing'
  const busy = analysisLoading || boardBusy
  const currentActor = game.actors.find((actor) => actor.color === game.to_play && (actor.role === 'human' || actor.role === 'player_agent'))
  const humanTurn = currentActor?.role === 'human'
  const unsettledAreaLabel = game.area_snapshot
    ? t('play.areaStones', { black: game.area_snapshot.black_stones, white: game.area_snapshot.white_stones })
    : t('play.areaUnsettled')
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
      : selectedCandidate
        ? 'pinned-candidate'
        : openingSuggestion && visualCandidate?.id === openingSuggestion.id
          ? 'suggested-first-stone'
          : passiveTheatreCandidate && visualCandidate?.id === passiveTheatreCandidate.id
            ? 'candidate-comparison'
            : null
  const currentFacets = (preview?.position_facets ?? game.analysis?.facets ?? [])
    .map((facet) => localizeEnergyFacet(facet, locale))
  const hypotheticalFacets = (preview?.candidate_facets ?? preview?.facets ?? [])
    .map((facet) => localizeEnergyFacet(facet, locale))
  const ifPlayedPositionFacets = (preview?.if_played_facets ?? [])
    .map((facet) => localizeEnergyFacet(facet, locale))
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
  const selectionClearable = Boolean(selected || selectedCandidateId)

  useEffect(() => {
    setInspectedCandidateId(null)
  }, [game.id, game.revision])

  const handleCandidateInspect = useCallback((candidate: CandidateMove | null) => {
    setInspectedCandidateId(candidate?.id ?? null)
  }, [])

  const clearBoardSelection = useCallback(() => {
    if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
      if (document.activeElement.closest('.candidate-card')) document.activeElement.blur()
    }
    setInspectedCandidateId(null)
    onCancelSelection()
  }, [onCancelSelection])

  useEffect(() => {
    if (!selectionClearable || typeof window === 'undefined') return
    const handleEscape = (event: KeyboardEvent) => {
      const target = event.target
      const editing = target instanceof Element && (
        target.matches('input, textarea, select, [contenteditable="true"]') ||
        target.closest('[role="dialog"]') !== null
      )
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || editing) return
      event.preventDefault()
      clearBoardSelection()
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [clearBoardSelection, selectionClearable])

  return (
    <div
      className={layout === 'simple' ? 'play-view simple-play' : 'play-view'}
      data-testid="play-workspace"
      data-layout={layout}
      data-mode={game.mode}
      data-turn={game.to_play}
      data-phase={game.phase}
      data-analysis-state={selected ? (operation === 'previewing' && !preview ? 'analyzing' : preview?.legal ? 'if-played-ready' : preview ? 'illegal' : 'analyzing') : openingSuggestion ? 'suggested-first-stone' : analysisLoading ? 'finding-suggestion' : 'current-position'}
      data-selection-state={selected ? 'move-preview' : selectedCandidateId ? 'pinned-candidate' : 'agent-suggestions'}
      data-selected-coordinate={selected ? pointToCoordinate(selected, game.board_size) : undefined}
    >
      {game.rules.training_variant && (
        <div className="training-banner" data-testid="training-rules-banner">
          <GraduationCap size={16} />
          <strong>{t('play.trainingFocus')}</strong>
          <span>{game.rules.training_variant === 'first_capture'
            ? t('play.training.firstCapture')
            : game.rules.training_variant === 'guided_position'
              ? t('play.training.guided')
              : t('play.training.wall')}</span>
        </div>
      )}

      {game.phase === 'finished' && (
        <div className="completion-banner" data-testid={game.result ? 'game-complete' : 'play-ended-unsettled'} data-scored={Boolean(game.result)} role="status">
          {game.result ? <Trophy size={18} aria-hidden="true" /> : <CircleDot size={18} aria-hidden="true" />}
          <div>
            <small>{game.result ? t('play.sceneComplete') : t('play.endedPasses')}</small>
            <strong>{game.result ?? unsettledAreaLabel}</strong>
          </div>
          <button type="button" onClick={onOpenReview}>{t('play.openReflection')} <ArrowRight size={15} /></button>
        </div>
      )}

      <header className="play-titlebar">
        <button type="button" className="back-button" onClick={onBack}><ArrowLeft size={17} /> {t('nav.journey')}</button>
        <div className="play-title">
          <span className="eyebrow">{game.lesson_title ?? t('play.teachingGame')} · {game.board_size}×{game.board_size}</span>
          <h1>{game.title}</h1>
          <p>{game.act}</p>
        </div>
        <div className="turn-card">
          <span className={`turn-stone ${game.to_play}`} aria-hidden="true" />
          <div>
            <small>{game.phase === 'finished' ? t('play.moves', { count: game.move_count }) : t('play.move', { count: game.move_count + 1 })}</small>
            <strong>{game.phase === 'finished' ? (game.result ? t('play.gameComplete') : t('play.scoreNotSettled')) : t('play.toPlay', { name: currentActor?.name ?? localizedColor(game.to_play, t) })}</strong>
          </div>
        </div>
      </header>

      <section className="objective-strip">
        <Target size={17} aria-hidden="true" />
        <div><span>{t('play.currentPurpose')}</span><strong>{game.objective}</strong></div>
        <div className="rules-compact"><span>{game.rules.name}</span><span>{t('play.komi', { value: game.rules.komi })}</span><span>{formatKoRule(game.rules.ko_rule, t)}</span></div>
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
              selectionClearable={selectionClearable}
              onClearSelection={clearBoardSelection}
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
                  ? t('play.analyzingAt', { color: localizedColor(game.to_play, t), coordinate: selected ? pointToCoordinate(selected, game.board_size) : '·' })
                  : analysisLoading && game.move_count === 0
                    ? t('play.findingFirst')
                    : analysisLoading
                      ? t('play.comparing')
                      : operationLabel(operation, t)}</span>
              </div>
            )}
          </div>

          <div className="move-controls" data-testid="move-controls">
            {game.mode === 'agent_vs_agent' ? (
              <>
                <button
                  type="button"
                  className="secondary-control"
                  onClick={selectedCandidateId ? clearBoardSelection : onRewind}
                  disabled={selectedCandidateId ? busy : busy || game.move_count === 0}
                  data-testid={selectedCandidateId ? 'back-to-suggestions' : undefined}
                >
                  {selectedCandidateId ? <><ArrowLeft size={16} /> {t('play.backSuggestions')}</> : <><RotateCcw size={16} /> {t('play.rewind')}</>}
                </button>
                <button type="button" className={`secondary-control ${theatreAutoPlay ? 'active' : ''}`} onClick={() => onTheatreAutoPlay(!theatreAutoPlay)} disabled={game.phase !== 'playing' || (busy && !theatreAutoPlay)} data-testid="theatre-autoplay">
                  {theatreAutoPlay ? <Pause size={16} /> : <Play size={16} />}{theatreAutoPlay ? t('play.pauseTheatre') : t('play.watch')}
                </button>
                <button type="button" className="primary-control" onClick={onAgentTurn} disabled={game.phase !== 'playing' || busy || theatreAutoPlay || localPreview} data-testid="agent-next-turn">
                  <Bot size={17} /> {t('play.oneTurn')}
                </button>
              </>
            ) : selected ? (
              <>
                <button type="button" className="secondary-control" onClick={clearBoardSelection} disabled={busy}>{t('play.cancel')}</button>
                <div className="selection-summary">
                  <span className={`selection-dot ${game.to_play}`} />
                  <div><small>{t('play.previewHint')}</small><strong>{pointToCoordinate(selected, game.board_size)} · {localizedIntent(intent, t)}</strong></div>
                  <span className={`legality ${preview ? (preview.legal ? 'legal' : 'blocked') : 'checking'}`}>
                    {preview ? (preview.legal ? <><Check size={13} /> {t('play.verified')}</> : t('play.notLegal')) : t('play.checking')}
                  </span>
                </div>
                {previewBound ? (
                  <button type="button" className="primary-control" onClick={onCommit} disabled={operation !== 'idle'} data-testid="commit-move">
                    {t('play.placeStone')} <ArrowRight size={17} />
                  </button>
                ) : (
                  <span className="analysis-before-confirmation" data-testid="analysis-before-confirmation">
                    {preview && !preview.legal ? t('play.chooseAnother') : t('play.analysisFirst')}
                  </span>
                )}
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="secondary-control"
                  onClick={selectedCandidateId ? clearBoardSelection : onRewind}
                  disabled={selectedCandidateId ? busy : busy || game.move_count === 0}
                  data-testid={selectedCandidateId ? 'back-to-suggestions' : undefined}
                >
                  {selectedCandidateId ? <><ArrowLeft size={16} /> {t('play.backSuggestions')}</> : <><RotateCcw size={16} /> {t('play.rewind')}</>}
                </button>
                <p className="move-instruction" data-testid={selectedCandidateId ? 'selection-dismiss-hint' : undefined}>
                  <Eye size={16} /> {selectedCandidateId
                    ? t('play.candidatePinned')
                    : t('play.selectEmpty')}
                </p>
                <button type="button" className="secondary-control" onClick={onPass} disabled={game.phase !== 'playing' || busy || !humanTurn}>{t('play.pass')}</button>
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

          <div className="move-timeline" aria-label={t('play.timeline')}>
            <div className="timeline-heading"><BookOpen size={15} /><span>{t('play.storySoFar')}</span><small>{t('play.moves', { count: game.move_count })}</small></div>
            <div className="timeline-track">
              {game.moves.slice(-12).map((move) => (
                <span key={`${move.move_number}-${move.color}`} title={t('play.move', { count: move.move_number })}>
                  <i className={move.color} />
                  <small>{move.point
                    ? pointToCoordinate(move.point, game.board_size)
                    : move.kind === 'pass'
                      ? t('play.pass')
                      : move.kind === 'resign'
                        ? t('play.resign')
                        : move.kind}</small>
                </span>
              ))}
              {!game.move_count && <p>{t('play.firstChronicle')}</p>}
            </div>
          </div>
        </section>

        <CoachRail
          compact={layout === 'simple'}
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
            ? t('status.authoredGuidance')
            : coachStatus.status === 'ready'
              ? t('status.providerReady', { provider: coachStatus.provider })
              : coachStatus.status === 'fallback'
                ? t('status.providerFallback', { provider: coachStatus.provider })
                : t('status.providerState', { provider: coachStatus.provider, state: coachStatus.status === 'starting' ? t('status.starting') : t('status.unavailable') })}
          delegationKey={`${game.id}:${game.revision}:${game.to_play}`}
        />
      </div>
    </div>
  )
}

function SimpleStart({
  lesson,
  preferences,
  loading,
  fallback,
  onBegin,
  onBoardChange,
  onModeChange,
  onBlackAgentChange,
  onWhiteAgentChange,
  onCompanionChange,
}: {
  lesson?: LessonSummary
  preferences: AppPreferences
  loading: boolean
  fallback: boolean
  onBegin: () => void
  onBoardChange: (size: BoardSize) => void
  onModeChange: (mode: GameMode) => void
  onBlackAgentChange: (agent: AppPreferences['black_agent']) => void
  onWhiteAgentChange: (agent: AppPreferences['white_agent']) => void
  onCompanionChange: (companion: AppPreferences['companion']) => void
}) {
  const { t } = useI18n()
  return (
    <section className="simple-start" data-testid="simple-launcher">
      <div className="simple-start-copy">
        <span className="simple-kicker"><Sparkles size={14} /> {t('simple.kicker')}</span>
        <h1>{lesson?.title ?? t('simple.chooseLesson')}</h1>
        <p>{lesson?.subtitle ?? t('simple.beginSmall')}</p>

        <div className="simple-size-choice" role="radiogroup" aria-label={t('simple.boardSize')}>
          {([5, 7, 9] as BoardSize[]).map((size) => (
            <button
              key={size}
              type="button"
              role="radio"
              aria-checked={preferences.board_size === size}
              className={preferences.board_size === size ? 'selected' : ''}
              onClick={() => onBoardChange(size)}
              data-testid={`simple-board-size-${size}`}
            >
              <strong>{size}×{size}</strong>
              <small>{size === 5 ? t('simple.firstBreath') : size === 7 ? t('simple.shape') : t('simple.fullGame')}</small>
            </button>
          ))}
        </div>

        <button type="button" className="simple-begin" onClick={onBegin} disabled={!lesson || loading} data-testid="simple-begin">
          {loading ? <LoaderCircle size={18} className="spin" /> : <Play size={17} />}
          <span>{loading ? t('simple.opening') : t('simple.openBoard')}</span>
          <ArrowRight size={17} />
        </button>

        <div className="simple-lesson-facts" aria-label={t('simple.lessonFacts')}>
          <span><Target size={14} /> {t('simple.minutes', { count: lesson?.duration_minutes ?? '—' })}</span>
          <span><CircleDot size={14} /> {lesson?.training_variant ? t('simple.trainingPosition') : t('simple.chineseRules')}</span>
          <span className={fallback ? 'fallback' : ''}>{fallback ? <WifiOff size={14} /> : <Check size={14} />}{fallback ? t('simple.safePreview') : t('simple.connected')}</span>
        </div>

        {lesson?.memory_line && (
          <blockquote><Sparkles size={14} aria-hidden="true" /> <span>{lesson.memory_line}</span></blockquote>
        )}
      </div>

      <div className="simple-start-setup">
        <header>
          <span className="eyebrow">{t('simple.howMoves')}</span>
          <h2>{t('simple.chooseStyle')}</h2>
          <p>{t('simple.remembered')}</p>
        </header>
        <ModePicker
          compact
          mode={preferences.mode}
          onModeChange={onModeChange}
          blackAgent={preferences.black_agent}
          whiteAgent={preferences.white_agent}
          companion={preferences.companion}
          onBlackAgentChange={onBlackAgentChange}
          onWhiteAgentChange={onWhiteAgentChange}
          onCompanionChange={onCompanionChange}
        />
        <p className="simple-safety"><GraduationCap size={15} /> {t('simple.safety')}</p>
      </div>
    </section>
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
  const { t } = useI18n()
  return (
    <section className="hero" data-testid="onboarding-hero">
      <div className="hero-glow one" /><div className="hero-glow two" />
      <div className="hero-inner">
        <div className="hero-copy">
          <span className="hero-kicker"><Sparkles size={15} /> {t('hero.kicker')}</span>
          <h1>{t('hero.title')}<br /><em>{t('hero.titleEm')}</em></h1>
          <p>{t('hero.description')}</p>
          <div className="hero-actions">
            <button type="button" className="hero-primary" onClick={onBegin} disabled={!lesson || loading} data-testid="begin-journey">
              {loading ? <LoaderCircle size={18} className="spin" /> : <Play size={17} />}
              {lesson ? `${lesson.status === 'current' ? t('hero.continue') : t('hero.begin')} · ${lesson.title}` : t('hero.beginJourney')}
              <ArrowRight size={17} />
            </button>
            <a href="#learning-modes" className="hero-secondary">{t('hero.seeTeaching')} <ChevronRight size={16} /></a>
          </div>
          <div className="hero-trust">
            <span><Check size={13} /> {t('hero.youPlace')}</span>
            <span><Check size={13} /> {t('hero.defaultBoard')}</span>
            <span><Check size={13} /> {t('hero.localFirst')}</span>
            {fallback && <span className="fallback"><WifiOff size={13} /> {t('hero.previewReady')}</span>}
          </div>
        </div>

        <div className="hero-scene" aria-label={t('hero.illustration')}>
          <div className="hero-story-card top">
            <span className="story-icon"><GraduationCap size={17} /></span>
            <div><small>{t('hero.lanternAsks')}</small><strong>{t('hero.breathQuestion')}</strong></div>
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
            <div><small>{t('hero.exactLiberties')}</small><strong>{t('hero.threeRoads')}</strong></div>
            <span className="mini-change">+2</span>
          </div>
          <div className="hero-mode-pill">{mode === 'human_companion' ? <><UserRound size={14} /> {t('hero.youLantern')}</> : mode === 'agent_vs_agent' ? <><Bot size={14} /> {t('hero.narratedTheatre')}</> : <><UserRound size={14} /> {t('hero.quietGame')}</>}</div>
        </div>
      </div>
      <div id="learning-modes" />
    </section>
  )
}

function LearningDoctrine() {
  const { t } = useI18n()
  const items = [
    { icon: CircleDot, title: t('doctrine.exactTitle'), text: t('doctrine.exactText') },
    { icon: Gauge, title: t('doctrine.engineTitle'), text: t('doctrine.engineText') },
    { icon: GraduationCap, title: t('doctrine.companionTitle'), text: t('doctrine.companionText') },
    { icon: BookOpen, title: t('doctrine.storyTitle'), text: t('doctrine.storyText') },
  ]
  return (
    <section className="doctrine-section">
      <div className="section-heading"><div><span className="eyebrow">{t('doctrine.eyebrow')}</span><h2>{t('doctrine.title')}</h2></div><p>{t('doctrine.description')}</p></div>
      <div className="doctrine-grid">{items.map(({ icon: Icon, title, text }) => <article key={title}><span><Icon size={19} /></span><h3>{title}</h3><p>{text}</p></article>)}</div>
    </section>
  )
}

type Translator = (key: MessageKey, values?: Record<string, string | number>) => string

function operationLabel(operation: Operation, t: Translator): string {
  const labels: Record<Operation, MessageKey> = {
    idle: 'operation.ready',
    creating: 'operation.creating',
    previewing: 'operation.previewing',
    moving: 'operation.moving',
    agent: 'operation.agent',
    coach: 'operation.coach',
    rewinding: 'operation.rewinding',
    'loading-game': 'operation.loadingGame',
  }
  return t(labels[operation])
}

function formatKoRule(rule: GameState['rules']['ko_rule'], t: Translator): string {
  const labels: Record<GameState['rules']['ko_rule'], MessageKey> = {
    positional_superko: 'rules.positionalSuperko',
    situational_superko: 'rules.situationalSuperko',
    simple: 'rules.simpleKo',
  }
  return t(labels[rule])
}

function localizedColor(color: Stone['color'], t: Translator): string {
  return t(color === 'black' ? 'board.black' : 'board.white')
}

function localizedIntent(intent: MoveIntent, t: Translator): string {
  return t(`intent.${intent}` as MessageKey)
}

export default App
