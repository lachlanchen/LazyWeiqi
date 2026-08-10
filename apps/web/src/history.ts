import type { GameSummary } from './types'

export function appendOlderGames(current: GameSummary[], older: GameSummary[]): GameSummary[] {
  const knownIds = new Set(current.map((game) => game.id))
  return [
    ...current,
    ...older.filter((game) => {
      if (knownIds.has(game.id)) return false
      knownIds.add(game.id)
      return true
    }),
  ]
}
