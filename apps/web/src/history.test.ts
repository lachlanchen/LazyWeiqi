import { describe, expect, it } from 'vitest'
import { appendOlderGames } from './history'
import type { GameSummary } from './types'

function summary(id: string, updatedAt: string): GameSummary {
  return {
    id,
    title: `Game ${id}`,
    mode: 'human_companion',
    board_size: 9,
    phase: 'playing',
    move_count: 4,
    updated_at: updatedAt,
  }
}

describe('chronicle pagination', () => {
  it('appends older pages without dropping current games or duplicating cursor overlaps', () => {
    const current = [
      summary('new', '2026-08-10T12:00:00Z'),
      summary('boundary', '2026-08-10T11:00:00Z'),
    ]
    const older = [
      summary('boundary', '2026-08-10T11:00:00Z'),
      summary('old', '2026-08-09T09:00:00Z'),
      summary('old', '2026-08-09T09:00:00Z'),
    ]

    expect(appendOlderGames(current, older).map((game) => game.id)).toEqual([
      'new',
      'boundary',
      'old',
    ])
    expect(current.map((game) => game.id)).toEqual(['new', 'boundary'])
  })
})
