import type {
  AgentTurnRequest,
  CoachRequest,
  CoachResponse,
  CoachHistoryPageRequest,
  CoachHistoryResponse,
  CreateGameRequest,
  CurriculumResponse,
  GamesPageRequest,
  GameState,
  GamesResponse,
  MovePreview,
  PreviewMoveRequest,
  RewindRequest,
  ServiceStatus,
  SubmitMoveRequest,
} from './types'

export class ApiError extends Error {
  readonly status: number
  readonly code?: string

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

type FetchLike = typeof fetch

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorMessage(value: unknown, fallback: string): { message: string; code?: string } {
  if (!isRecord(value)) return { message: fallback }
  const message =
    typeof value.detail === 'string'
      ? value.detail
      : typeof value.message === 'string'
        ? value.message
        : fallback
  return { message, code: typeof value.code === 'string' ? value.code : undefined }
}

async function parseJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new ApiError('The teaching service returned an unreadable response.', response.status)
  }
}

export interface WeiqiApi {
  status(signal?: AbortSignal): Promise<ServiceStatus>
  curriculum(signal?: AbortSignal): Promise<CurriculumResponse>
  games(page?: GamesPageRequest, signal?: AbortSignal): Promise<GamesResponse>
  game(id: string, signal?: AbortSignal): Promise<GameState>
  createGame(request: CreateGameRequest, signal?: AbortSignal): Promise<GameState>
  previewMove(id: string, request: PreviewMoveRequest, signal?: AbortSignal): Promise<MovePreview>
  submitMove(id: string, request: SubmitMoveRequest, signal?: AbortSignal): Promise<GameState>
  agentTurn(id: string, request: AgentTurnRequest, signal?: AbortSignal): Promise<GameState>
  rewind(id: string, request: RewindRequest, signal?: AbortSignal): Promise<GameState>
  coach(id: string, request: CoachRequest, signal?: AbortSignal): Promise<CoachResponse>
  coachHistory(
    id: string,
    page?: CoachHistoryPageRequest,
    signal?: AbortSignal,
  ): Promise<CoachHistoryResponse>
}

export function createApi(fetcher: FetchLike = fetch, baseUrl = ''): WeiqiApi {
  const request = async <T>(
    path: string,
    init: RequestInit = {},
    signal?: AbortSignal,
  ): Promise<T> => {
    let response: Response
    try {
      response = await fetcher(`${baseUrl}${path}`, {
        ...init,
        signal,
        headers: {
          Accept: 'application/json',
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...init.headers,
        },
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      throw new ApiError('The local teaching service is not reachable.', 0, 'offline')
    }

    const payload = await parseJson(response)
    if (!response.ok) {
      const fallback = `The teaching service could not complete this request (${response.status}).`
      const parsed = errorMessage(payload, fallback)
      throw new ApiError(parsed.message, response.status, parsed.code)
    }
    return payload as T
  }

  const post = <TResponse, TRequest>(path: string, body: TRequest, signal?: AbortSignal) =>
    request<TResponse>(path, { method: 'POST', body: JSON.stringify(body) }, signal)

  return {
    status: (signal) => request<ServiceStatus>('/api/status', {}, signal),
    curriculum: (signal) => request<CurriculumResponse>('/api/curriculum', {}, signal),
    games: (page = {}, signal) => {
      const query = new URLSearchParams()
      if (page.limit !== undefined) query.set('limit', String(page.limit))
      if (page.cursor !== undefined) query.set('cursor', page.cursor)
      const suffix = query.size ? `?${query.toString()}` : ''
      return request<GamesResponse>(`/api/games${suffix}`, {}, signal)
    },
    game: (id, signal) => request<GameState>(`/api/games/${encodeURIComponent(id)}`, {}, signal),
    createGame: (body, signal) => post<GameState, CreateGameRequest>('/api/games', body, signal),
    previewMove: (id, body, signal) =>
      post<MovePreview, PreviewMoveRequest>(
        `/api/games/${encodeURIComponent(id)}/preview`,
        body,
        signal,
      ),
    submitMove: (id, body, signal) =>
      post<GameState, SubmitMoveRequest>(`/api/games/${encodeURIComponent(id)}/moves`, body, signal),
    agentTurn: (id, body, signal) =>
      post<GameState, AgentTurnRequest>(
        `/api/games/${encodeURIComponent(id)}/agent-turn`,
        body,
        signal,
      ),
    rewind: (id, body, signal) =>
      post<GameState, RewindRequest>(`/api/games/${encodeURIComponent(id)}/rewind`, body, signal),
    coach: (id, body, signal) =>
      post<CoachResponse, CoachRequest>(`/api/games/${encodeURIComponent(id)}/coach`, body, signal),
    coachHistory: (id, page = {}, signal) => {
      const query = new URLSearchParams()
      if (page.limit !== undefined) query.set('limit', String(page.limit))
      if (page.cursor !== undefined) query.set('cursor', page.cursor)
      const suffix = query.size ? `?${query.toString()}` : ''
      return request<CoachHistoryResponse>(
        `/api/games/${encodeURIComponent(id)}/coach-history${suffix}`,
        {},
        signal,
      )
    },
  }
}

export const api = createApi()
