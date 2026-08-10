import { describe, expect, it } from 'vitest'
import { ApiError, createApi } from './api'

describe('strict synchronous API client', () => {
  it('uses the documented preview and move routes with JSON bodies', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), init })
      if (String(input).endsWith('/preview')) {
        return new Response(JSON.stringify({
          game_id: 'g1', revision: 3, point: { x: 2, y: 2 }, coordinate: 'C3',
          legal: true, captures: [], facets: [], candidates: [],
        }), { status: 200 })
      }
      return new Response(JSON.stringify({ id: 'g1' }), { status: 200 })
    }) as typeof fetch
    const client = createApi(fetcher, 'http://local.test')

    await client.previewMove('g1', {
      x: 2,
      y: 2,
      actor_id: 'human',
      expected_revision: 3,
      intent: 'connect',
    })
    await client.submitMove('g1', {
      actor_id: 'human',
      expected_revision: 3,
      kind: 'play',
      point: { x: 2, y: 2 },
      intent: 'connect',
    })

    expect(calls.map((call) => call.url)).toEqual([
      'http://local.test/api/games/g1/preview',
      'http://local.test/api/games/g1/moves',
    ])
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({
      x: 2,
      y: 2,
      actor_id: 'human',
      expected_revision: 3,
    })
  })

  it('turns structured service failures into safe ApiError instances', async () => {
    const fetcher = (async () =>
      new Response(JSON.stringify({ detail: 'revision conflict', code: 'stale_revision' }), {
        status: 409,
      })) as typeof fetch
    const client = createApi(fetcher)

    await expect(client.game('g1')).rejects.toEqual(
      expect.objectContaining<ApiError>({
        name: 'ApiError',
        message: 'revision conflict',
        status: 409,
        code: 'stale_revision',
      }),
    )
  })

  it('requests bounded game pages with an encoded opaque cursor', async () => {
    let requestedUrl = ''
    const fetcher = (async (input: string | URL | Request) => {
      requestedUrl = String(input)
      return new Response(JSON.stringify({ games: [], next_cursor: null }), { status: 200 })
    }) as typeof fetch
    const client = createApi(fetcher, 'http://local.test')

    const response = await client.games({ limit: 20, cursor: '2026-08-10T12:00:00Z|game/1+2' })
    const parsedUrl = new URL(requestedUrl)

    expect(parsedUrl.pathname).toBe('/api/games')
    expect(parsedUrl.searchParams.get('limit')).toBe('20')
    expect(parsedUrl.searchParams.get('cursor')).toBe('2026-08-10T12:00:00Z|game/1+2')
    expect(response).toEqual({ games: [], next_cursor: null })
  })

  it('carries a stable coach submission key in the JSON contract', async () => {
    let body: unknown
    const fetcher = (async (_input: string | URL | Request, init?: RequestInit) => {
      body = JSON.parse(String(init?.body))
      return new Response(
        JSON.stringify({
          message: {
            id: 'coach_1', speaker: 'Lantern', role: 'companion', text: 'Notice breath.',
            evidence: ['exact'], question: 'What changed?', created_at: '2026-08-10T00:00:00Z',
          },
        }),
        { status: 200 },
      )
    }) as typeof fetch
    const client = createApi(fetcher)

    await client.coach('g1', {
      expected_revision: 2,
      question: 'What changed?',
      client_request_id: 'coach_12345678',
    })

    expect(body).toMatchObject({
      expected_revision: 2,
      question: 'What changed?',
      client_request_id: 'coach_12345678',
    })
  })

  it('requests a bounded coach-history page with an encoded opaque cursor', async () => {
    let requestedUrl = ''
    const fetcher = (async (input: string | URL | Request) => {
      requestedUrl = String(input)
      return new Response(JSON.stringify({ messages: [], next_cursor: null }), { status: 200 })
    }) as typeof fetch
    const client = createApi(fetcher, 'http://local.test')

    const response = await client.coachHistory(
      'game/with spaces',
      { limit: 80, cursor: 'opaque+/cursor==' },
    )
    const parsedUrl = new URL(requestedUrl)

    expect(parsedUrl.pathname).toBe('/api/games/game%2Fwith%20spaces/coach-history')
    expect(parsedUrl.searchParams.get('limit')).toBe('80')
    expect(parsedUrl.searchParams.get('cursor')).toBe('opaque+/cursor==')
    expect(response).toEqual({ messages: [], next_cursor: null })
  })
})
