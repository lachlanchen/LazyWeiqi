import type { BoardSize, OwnershipCell, Point, Stone, StoneColor } from './types'

const COLUMN_LABELS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J'] as const

export function pointKey(point: Point): string {
  return `${point.x}:${point.y}`
}

export function samePoint(left: Point | null | undefined, right: Point | null | undefined): boolean {
  return Boolean(left && right && left.x === right.x && left.y === right.y)
}

export function pointToCoordinate(point: Point, size: BoardSize): string {
  if (point.x < 0 || point.y < 0 || point.x >= size || point.y >= size) return 'outside board'
  return `${COLUMN_LABELS[point.x]}${size - point.y}`
}

export function coordinateToPoint(coordinate: string, size: BoardSize): Point | null {
  const normalized = coordinate.trim().toUpperCase()
  const match = /^([A-HJ])(\d{1,2})$/.exec(normalized)
  if (!match) return null
  const x = COLUMN_LABELS.indexOf(match[1] as (typeof COLUMN_LABELS)[number])
  const row = Number(match[2])
  const y = size - row
  if (x < 0 || x >= size || y < 0 || y >= size) return null
  return { x, y }
}

export function orthogonalNeighbors(point: Point, size: BoardSize): Point[] {
  return [
    { x: point.x - 1, y: point.y },
    { x: point.x + 1, y: point.y },
    { x: point.x, y: point.y - 1 },
    { x: point.x, y: point.y + 1 },
  ].filter((candidate) =>
    candidate.x >= 0 && candidate.y >= 0 && candidate.x < size && candidate.y < size,
  )
}

export function stoneMap(stones: Stone[]): Map<string, Stone> {
  return new Map(stones.map((stone) => [pointKey(stone), stone]))
}

export interface GroupReading {
  color: StoneColor
  stones: Point[]
  liberties: Point[]
}

export function groupAt(stones: Stone[], anchor: Point, size: BoardSize): GroupReading | null {
  const occupied = stoneMap(stones)
  const root = occupied.get(pointKey(anchor))
  if (!root) return null

  const queued: Point[] = [anchor]
  const seen = new Set<string>()
  const group: Point[] = []
  const liberties = new Map<string, Point>()

  while (queued.length) {
    const current = queued.shift()
    if (!current) break
    const currentKey = pointKey(current)
    if (seen.has(currentKey)) continue
    seen.add(currentKey)
    group.push(current)

    for (const neighbor of orthogonalNeighbors(current, size)) {
      const neighborStone = occupied.get(pointKey(neighbor))
      if (!neighborStone) {
        liberties.set(pointKey(neighbor), neighbor)
      } else if (neighborStone.color === root.color && !seen.has(pointKey(neighbor))) {
        queued.push(neighbor)
      }
    }
  }

  return {
    color: root.color,
    stones: group,
    liberties: [...liberties.values()],
  }
}

export function allGroups(stones: Stone[], size: BoardSize): GroupReading[] {
  const seen = new Set<string>()
  const groups: GroupReading[] = []
  for (const stone of stones) {
    if (seen.has(pointKey(stone))) continue
    const reading = groupAt(stones, stone, size)
    if (!reading) continue
    reading.stones.forEach((point) => seen.add(pointKey(point)))
    groups.push(reading)
  }
  return groups
}

export function ownershipMap(cells: OwnershipCell[] | undefined): Map<string, OwnershipCell> {
  return new Map((cells ?? []).map((cell) => [pointKey(cell), cell]))
}

export function ownershipClass(cell: OwnershipCell | undefined): 'black' | 'white' | 'mist' | 'none' {
  if (!cell) return 'none'
  const spread = cell.variation ?? cell.uncertainty
  if (spread == null || !Number.isFinite(spread)) return 'mist'
  if (spread > 0.35 || Math.abs(cell.value) < 0.18) return 'mist'
  return cell.value > 0 ? 'black' : 'white'
}

export function strongOwnershipForecast(cell: OwnershipCell | undefined): boolean {
  if (!cell) return false
  const spread = cell.variation ?? cell.uncertainty
  if (spread == null || !Number.isFinite(spread)) return false
  return Math.abs(cell.value) >= 0.78 && spread <= 0.22
}

export interface TeachingPresenceCell extends Point {
  black: number
  white: number
  contested: number
  kind: 'black' | 'white' | 'contested' | 'quiet'
}

/**
 * A deliberately simple, deterministic teaching field. It measures only how
 * close each intersection is to the stones already on the board. It is not an
 * ownership estimate, score, tactical reading, or physics simulation.
 */
export function teachingPresenceField(stones: Stone[], size: BoardSize): TeachingPresenceCell[] {
  const spread = size === 5 ? 0.95 : size === 7 ? 1.15 : 1.35
  const spreadSquared = spread * spread

  return Array.from({ length: size * size }, (_, index) => {
    const point = { x: index % size, y: Math.floor(index / size) }
    let blackRaw = 0
    let whiteRaw = 0

    for (const stone of stones) {
      const dx = stone.x - point.x
      const dy = stone.y - point.y
      const closeness = Math.exp(-(dx * dx + dy * dy) / (2 * spreadSquared))
      if (stone.color === 'black') blackRaw += closeness
      else whiteRaw += closeness
    }

    const black = 1 - Math.exp(-blackRaw * 1.2)
    const white = 1 - Math.exp(-whiteRaw * 1.2)
    const total = black + white
    const balance = total > 0 ? (2 * Math.min(black, white)) / total : 0
    const contested = Math.min(black, white) * balance
    const kind =
      contested >= 0.16
        ? 'contested'
        : Math.max(black, white) < 0.06
          ? 'quiet'
          : black >= white
            ? 'black'
            : 'white'

    return { ...point, black, white, contested, kind }
  })
}

export function actorForTurn(stonesToPlay: StoneColor): string {
  return stonesToPlay === 'black' ? 'black-agent' : 'white-agent'
}

export function clampBoardFocus(point: Point, size: BoardSize): Point {
  return {
    x: Math.max(0, Math.min(size - 1, point.x)),
    y: Math.max(0, Math.min(size - 1, point.y)),
  }
}
