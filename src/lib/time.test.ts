import { describe, expect, it } from 'vitest'
import { addDaysToDateString, buildEventRange, countdownLabel, daysFromToday, fmtTime, isoToDateInput, isoToTimeInput, minutesIntoDay, relativeDayLabel, zonedDayBounds, zonedDayKey, zonedToUtcIso } from './time'

const IST = 'Asia/Kolkata'

describe('time zones', () => {
  it('interprets typed times in the studio zone (IST = UTC+5:30)', () => {
    expect(zonedToUtcIso('2026-11-14', '09:00', IST)).toBe('2026-11-14T03:30:00.000Z')
    expect(zonedToUtcIso('2026-11-14', '09:00', 'UTC')).toBe('2026-11-14T09:00:00.000Z')
  })

  it('round-trips to form fields', () => {
    const iso = zonedToUtcIso('2026-11-14', '19:45', IST)
    expect(isoToDateInput(iso, IST)).toBe('2026-11-14')
    expect(isoToTimeInput(iso, IST)).toBe('19:45')
    expect(fmtTime(iso, IST)).toBe('7:45 PM')
  })

  it('shows the same instant on a different local date in another zone', () => {
    const iso = zonedToUtcIso('2026-11-14', '01:00', IST) // 2026-11-13T19:30Z
    expect(zonedDayKey(iso, IST)).toBe('2026-11-14')
    expect(zonedDayKey(iso, 'UTC')).toBe('2026-11-13')
  })

  it('treats an end time at/before the start as after midnight', () => {
    const r = buildEventRange('2026-11-14', '19:00', '01:00', IST)
    expect(r.endsNextDay).toBe(true)
    expect(new Date(r.endsAt).getTime() - new Date(r.startsAt).getTime()).toBe(6 * 3_600_000)
    const same = buildEventRange('2026-11-14', '09:00', '17:30', IST)
    expect(same.endsNextDay).toBe(false)
  })

  it('does arithmetic on date strings across month ends', () => {
    expect(addDaysToDateString('2026-02-28', 1)).toBe('2026-03-01')
    expect(addDaysToDateString('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('computes day bounds and minutes into the day in the studio zone', () => {
    const { start, end } = zonedDayBounds('2026-11-14', IST)
    expect(start).toBe('2026-11-13T18:30:00.000Z')
    expect(end).toBe('2026-11-14T18:30:00.000Z')
    expect(minutesIntoDay(zonedToUtcIso('2026-11-14', '10:30', IST), IST)).toBe(630)
  })

  it('labels relative days', () => {
    const now = new Date('2026-11-14T04:00:00Z')
    expect(relativeDayLabel('2026-11-14T10:00:00Z', IST, now)).toBe('Today')
    expect(relativeDayLabel('2026-11-15T10:00:00Z', IST, now)).toBe('Tomorrow')
  })
})

describe('countdown to a session', () => {
  // 04:00 UTC on the 14th is 09:30 in Kolkata
  const now = new Date('2026-11-14T04:00:00Z')

  it('counts studio-zone calendar days, not 24-hour blocks', () => {
    expect(daysFromToday('2026-11-14T18:00:00Z', IST, now)).toBe(0)
    // 19:00 UTC on the 14th is already 00:30 on the 15th in Kolkata
    expect(daysFromToday('2026-11-14T19:00:00Z', IST, now)).toBe(1)
    expect(daysFromToday('2026-11-20T04:00:00Z', IST, now)).toBe(6)
    expect(daysFromToday('2026-11-13T04:00:00Z', IST, now)).toBe(-1)
  })

  it('words the distance plainly', () => {
    expect(countdownLabel(0)).toBe('Today')
    expect(countdownLabel(1)).toBe('Tomorrow')
    expect(countdownLabel(6)).toBe('In 6 days')
    expect(countdownLabel(-1)).toBe('Yesterday')
    expect(countdownLabel(-5)).toBe('5 days ago')
  })
})
