import { describe, expect, it } from 'vitest'
import { venueByEvent } from './schedule'

const NOW = new Date('2030-06-01T08:00:00Z')
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString()
const session = (project: string, startDay: number, venue: string | null, over: Record<string, unknown> = {}) => ({
  project_id: project, starts_at: day(startDay), ends_at: day(startDay + 0.25), venue_name: venue, venue_address: null, cancelled_at: null, ...over,
})

describe('venueByEvent', () => {
  it('uses the venue of the next upcoming session', () => {
    const m = venueByEvent([session('a', -10, 'Old Hall'), session('a', 5, 'Grand Palace'), session('a', 9, 'Beach Resort')], NOW)
    expect(m.get('a')).toBe('Grand Palace')
  })

  it('falls back to the earliest session when all are in the past', () => {
    expect(venueByEvent([session('a', -9, 'First'), session('a', -3, 'Second')], NOW).get('a')).toBe('First')
  })

  it('skips cancelled sessions and sessions without a venue, and uses the address when there is no name', () => {
    const m = venueByEvent([
      session('a', 2, null),
      session('a', 3, 'Cancelled Hall', { cancelled_at: day(-1) }),
      session('a', 4, null, { venue_address: ' 12 MG Road, Pune ' }),
      session('b', 2, null),
    ], NOW)
    expect(m.get('a')).toBe('12 MG Road, Pune')
    expect(m.has('b')).toBe(false)
  })

  it('keeps events separate', () => {
    const m = venueByEvent([session('a', 2, 'A Hall'), session('b', 1, 'B Hall')], NOW)
    expect([m.get('a'), m.get('b')]).toEqual(['A Hall', 'B Hall'])
  })
})
