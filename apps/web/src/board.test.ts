import { describe, expect, it } from 'vitest'
import {
  coordinateToPoint,
  groupAt,
  ownershipClass,
  pointToCoordinate,
  strongOwnershipForecast,
  teachingPresenceField,
} from './board'
import { DEFAULT_PREFERENCES } from './fallbackData'
import type { Stone } from './types'

describe('board teaching facts', () => {
  it('starts a new learner on the real-game 9x9 route', () => {
    expect(DEFAULT_PREFERENCES.board_size).toBe(9)
  })

  it('counts distinct liberties for a connected string', () => {
    const stones: Stone[] = [
      { x: 1, y: 2, color: 'black' },
      { x: 2, y: 2, color: 'black' },
      { x: 0, y: 2, color: 'white' },
      { x: 1, y: 1, color: 'white' },
      { x: 1, y: 3, color: 'white' },
      { x: 2, y: 1, color: 'white' },
    ]

    const reading = groupAt(stones, { x: 1, y: 2 }, 5)
    expect(reading?.stones).toHaveLength(2)
    expect(reading?.liberties).toEqual(
      expect.arrayContaining([{ x: 3, y: 2 }, { x: 2, y: 3 }]),
    )
    expect(reading?.liberties).toHaveLength(2)
  })

  it('uses Go coordinates that skip I and count rows from the bottom', () => {
    expect(pointToCoordinate({ x: 8, y: 0 }, 9)).toBe('J9')
    expect(pointToCoordinate({ x: 3, y: 5 }, 9)).toBe('D4')
    expect(coordinateToPoint('D4', 9)).toEqual({ x: 3, y: 5 })
    expect(coordinateToPoint('I4', 9)).toBeNull()
  })

  it('uses searched-line variation in the strong-forecast display heuristic', () => {
    expect(strongOwnershipForecast({ x: 0, y: 0, value: 0.9, variation: 0.1 })).toBe(true)
    expect(strongOwnershipForecast({ x: 0, y: 0, value: 0.9 })).toBe(false)
    expect(strongOwnershipForecast({ x: 0, y: 0, value: 0.9, variation: 0.5 })).toBe(false)
    expect(strongOwnershipForecast({ x: 0, y: 0, value: 0.9, uncertainty: 0.5 })).toBe(false)
    expect(ownershipClass({ x: 0, y: 0, value: 0.9, variation: 0.5 })).toBe('mist')
    expect(ownershipClass({ x: 0, y: 0, value: 0.9 })).toBe('mist')
    expect(ownershipClass({ x: 0, y: 0, value: 0.05, uncertainty: 0.1 })).toBe('mist')
  })

  it('keeps an empty teaching-presence field quiet', () => {
    const field = teachingPresenceField([], 5)

    expect(field).toHaveLength(25)
    expect(field.every((cell) => cell.kind === 'quiet')).toBe(true)
    expect(field.every((cell) => cell.black === 0 && cell.white === 0 && cell.contested === 0)).toBe(true)
  })

  it('shows each color fading away from its own stones', () => {
    const field = teachingPresenceField([
      { x: 0, y: 0, color: 'black' },
      { x: 4, y: 4, color: 'white' },
    ], 5)
    const at = (x: number, y: number) => field.find((cell) => cell.x === x && cell.y === y)

    expect(at(0, 0)?.black).toBeGreaterThan(at(2, 2)?.black ?? 1)
    expect(at(4, 4)?.white).toBeGreaterThan(at(2, 2)?.white ?? 1)
    expect(at(0, 0)?.kind).toBe('black')
    expect(at(4, 4)?.kind).toBe('white')
  })

  it('marks a balanced overlap as contested without calling it ownership', () => {
    const field = teachingPresenceField([
      { x: 1, y: 2, color: 'black' },
      { x: 3, y: 2, color: 'white' },
    ], 5)
    const meetingPoint = field.find((cell) => cell.x === 2 && cell.y === 2)

    expect(meetingPoint?.kind).toBe('contested')
    expect(meetingPoint?.contested).toBeGreaterThan(0.3)
    expect(meetingPoint?.black).toBeCloseTo(meetingPoint?.white ?? 0)
  })
})
