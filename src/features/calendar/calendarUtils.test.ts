import { describe, expect, it } from 'vitest'
import { addMonthsKey, layoutLanes, monthGrid, rangeLabel, shiftAnchor, startOfWeekKey, weekKeys } from './calendarUtils'

describe('calendar grid', () => {
  it('builds whole Sunday-first weeks around the month', () => {
    const grid = monthGrid('2026-11-14') // Nov 2026 starts on a Sunday
    expect(grid[0]).toBe('2026-11-01')
    expect(grid.at(-1)).toBe('2026-12-05')
    expect(grid.length % 7).toBe(0)
    expect(grid).toHaveLength(35)
  })

  it('pads with the previous and next month when needed', () => {
    const grid = monthGrid('2026-10-10') // Oct 1 2026 is a Thursday
    expect(grid[0]).toBe('2026-09-27')
    expect(grid.at(-1)).toBe('2026-10-31')
  })

  it('handles 6-row months and year boundaries', () => {
    expect(monthGrid('2027-01-15')[0]).toBe('2026-12-27')
    expect(monthGrid('2026-08-01')).toHaveLength(42)
  })

  it('computes week ranges and navigation', () => {
    expect(startOfWeekKey('2026-11-14')).toBe('2026-11-08')
    expect(weekKeys('2026-11-14')).toEqual(['2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14'])
    expect(addMonthsKey('2026-12-15', 1)).toBe('2027-01-01')
    expect(shiftAnchor('month', '2026-01-31', 1)).toBe('2026-02-01')
    expect(shiftAnchor('week', '2026-11-14', -1)).toBe('2026-11-07')
    expect(shiftAnchor('day', '2026-12-31', 1)).toBe('2027-01-01')
  })

  it('labels the visible range', () => {
    expect(rangeLabel('month', '2026-11-14')).toBe('November 2026')
    expect(rangeLabel('week', '2026-11-14')).toBe('8 Nov – 14 Nov 2026')
  })
})

describe('overlap lanes', () => {
  it('gives non-overlapping blocks the full width', () => {
    const r = layoutLanes([{ start: 0, end: 60 }, { start: 60, end: 120 }])
    expect(r.map((x) => [x.lane, x.lanes])).toEqual([[0, 1], [0, 1]])
  })

  it('places overlapping blocks side by side and clusters independently', () => {
    const r = layoutLanes([
      { start: 0, end: 120, id: 'a' }, { start: 30, end: 90, id: 'b' }, { start: 100, end: 150, id: 'c' },
      { start: 300, end: 360, id: 'd' },
    ])
    const by = Object.fromEntries(r.map((x) => [x.id, x]))
    expect(by.a).toMatchObject({ lane: 0, lanes: 2 })
    expect(by.b).toMatchObject({ lane: 1, lanes: 2 })
    expect(by.c).toMatchObject({ lane: 1, lanes: 2 }) // lane 1 is free again after b ends
    expect(by.d).toMatchObject({ lane: 0, lanes: 1 })
  })
})
