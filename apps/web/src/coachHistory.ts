import type { CoachMessage } from './types'

/** Prepend an older chronological page while preserving the live tail as authoritative. */
export function prependOlderCoachMessages(
  current: CoachMessage[],
  older: CoachMessage[],
): CoachMessage[] {
  const seen = new Set(current.map((message) => message.id))
  const uniqueOlder: CoachMessage[] = []
  for (const message of older) {
    if (seen.has(message.id)) continue
    seen.add(message.id)
    uniqueOlder.push(message)
  }
  return [...uniqueOlder, ...current]
}
