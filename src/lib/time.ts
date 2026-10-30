import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'

/**
 * Event times are stored as UTC instants (timestamptz). Everything the user
 * sees or types is interpreted in the *studio's* time zone, so a 9:00 AM
 * reporting time means 9:00 AM in Asia/Kolkata regardless of the viewer's device.
 */

export const DEFAULT_TIMEZONE = 'Asia/Kolkata'

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** "2026-11-14" + "09:30" in `tz` → UTC ISO string. */
export function zonedToUtcIso(date: string, time: string, tz: string): string {
  return fromZonedTime(`${date}T${time.length === 5 ? `${time}:00` : time}`, tz).toISOString()
}

/** Add whole days to a yyyy-MM-dd string without touching time zones. */
export function addDaysToDateString(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

/**
 * Builds the stored start/end instants from a form's date + times. An end time
 * at or before the start time is read as "after midnight" (next day), so a
 * 7 PM–1 AM reception works without a second date field.
 */
export function buildEventRange(date: string, startTime: string, endTime: string, tz: string) {
  const startsAt = zonedToUtcIso(date, startTime, tz)
  const endDate = endTime <= startTime ? addDaysToDateString(date, 1) : date
  const endsAt = zonedToUtcIso(endDate, endTime, tz)
  return { startsAt, endsAt, endsNextDay: endDate !== date }
}

export function isoToDateInput(iso: string, tz: string): string {
  return formatInTimeZone(iso, tz, 'yyyy-MM-dd')
}

export function isoToTimeInput(iso: string, tz: string): string {
  return formatInTimeZone(iso, tz, 'HH:mm')
}

export const fmtDate = (iso: string, tz: string) => formatInTimeZone(iso, tz, 'EEE, d MMM yyyy')
export const fmtDateShort = (iso: string, tz: string) => formatInTimeZone(iso, tz, 'd MMM')
export const fmtTime = (iso: string, tz: string) => formatInTimeZone(iso, tz, 'h:mm a')
export const fmtDateTime = (iso: string, tz: string) => formatInTimeZone(iso, tz, 'd MMM yyyy, h:mm a')
export const fmtTimeRange = (startIso: string, endIso: string, tz: string) => `${fmtTime(startIso, tz)} – ${fmtTime(endIso, tz)}`

/** Calendar day (yyyy-MM-dd) of an instant in the studio zone. */
export const zonedDayKey = (iso: string | Date, tz: string) => formatInTimeZone(iso, tz, 'yyyy-MM-dd')

export function todayKey(tz: string, now: Date = new Date()): string {
  return zonedDayKey(now, tz)
}

/** [start, end) instants of a studio-zone calendar day. */
export function zonedDayBounds(dayKey: string, tz: string): { start: string; end: string } {
  return { start: zonedToUtcIso(dayKey, '00:00', tz), end: zonedToUtcIso(addDaysToDateString(dayKey, 1), '00:00', tz) }
}

/** Minutes since local midnight (studio zone) of an instant. */
export function minutesIntoDay(iso: string, tz: string): number {
  const [h, m] = isoToTimeInput(iso, tz).split(':').map(Number) as [number, number]
  return h * 60 + m
}

/** Relative day label used in lists: Today, Tomorrow, or the date. */
export function relativeDayLabel(iso: string, tz: string, now: Date = new Date()): string {
  const day = zonedDayKey(iso, tz)
  const today = todayKey(tz, now)
  if (day === today) return 'Today'
  if (day === addDaysToDateString(today, 1)) return 'Tomorrow'
  return fmtDate(iso, tz)
}

/** Whole studio-zone calendar days from today to the day of an instant: 0 = today, 1 = tomorrow, -1 = yesterday. */
export function daysFromToday(iso: string, tz: string, now: Date = new Date()): number {
  const toUtcDay = (key: string) => {
    const [y, m, d] = key.split('-').map(Number) as [number, number, number]
    return Date.UTC(y, m - 1, d)
  }
  return Math.round((toUtcDay(zonedDayKey(iso, tz)) - toUtcDay(todayKey(tz, now))) / 86_400_000)
}

/** "Today", "Tomorrow", "In 5 days", "Yesterday", "5 days ago". */
export function countdownLabel(days: number): string {
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days === -1) return 'Yesterday'
  return days > 0 ? `In ${days} days` : `${-days} days ago`
}

/** yyyy-MM-dd (a date-only value such as a due date) formatted without zone shifts. */
export function fmtDateOnly(date: string | null | undefined): string {
  if (!date) return '—'
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)))
}
