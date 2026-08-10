import { describe, expect, it } from 'vitest'
import { prependOlderCoachMessages } from './coachHistory'
import type { CoachMessage } from './types'

function message(id: string, text = id): CoachMessage {
  return { id, speaker: 'Lantern', role: 'companion', text }
}

describe('coach history paging', () => {
  it('prepends chronological older pages without losing or duplicating the live tail', () => {
    const current = [message('m3', 'live m3'), message('m4', 'live m4')]
    const older = [message('m1'), message('m2'), message('m3', 'stale overlap')]

    const merged = prependOlderCoachMessages(current, older)

    expect(merged.map((item) => item.id)).toEqual(['m1', 'm2', 'm3', 'm4'])
    expect(merged.find((item) => item.id === 'm3')?.text).toBe('live m3')
  })

  it('deduplicates malformed repeats inside an older page by stable message id', () => {
    const merged = prependOlderCoachMessages(
      [message('m3')],
      [message('m1'), message('m1', 'repeat'), message('m2')],
    )

    expect(merged.map((item) => item.id)).toEqual(['m1', 'm2', 'm3'])
  })
})
