import { addDaysToDateString } from '@/lib/time'

/**
 * Calendar maths on plain yyyy-MM-dd strings (UTC date arithmetic), so the grid is
 * identical on every device. Which *day* an event falls on is decided separately,
 * in the studio's time zone (see zonedDayKey).
 */

export const WEEK_START = 0 // Sunday

export const dowOf = (key: string): number => new Date(`${key}T00:00:00Z`).getUTCDay()
export const startOfWeekKey = (key: string): string => addDaysToDateString(key, -((dowOf(key) - WEEK_START + 7) % 7))
export const monthStartKey = (key: string): string => `${key.slice(0, 7)}-01`

export function addMonthsKey(key: string, n: number): string {
  const [y, m] = key.split('-').map(Number) as [number, number]
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 10)
}

export function weekKeys(anchor: string): string[] {
  const start = startOfWeekKey(anchor)
  return Array.from({ length: 7 }, (_, i) => addDaysToDateString(start, i))
}

/** Whole weeks covering the month containing `anchor` (5 or 6 rows). */
export function monthGrid(anchor: string): string[] {
  const first = monthStartKey(anchor)
  const start = startOfWeekKey(first)
  const lastOfMonth = addDaysToDateString(addMonthsKey(first, 1), -1)
  const end = addDaysToDateString(startOfWeekKey(lastOfMonth), 6)
  const out: string[] = []
  for (let d = start; d <= end; d = addDaysToDateString(d, 1)) out.push(d)
  return out
}

export type CalendarView = 'month' | 'week' | 'day' | 'list'

export function shiftAnchor(view: CalendarView, anchor: string, dir: -1 | 1): string {
  if (view === 'month') return addMonthsKey(anchor, dir)
  if (view === 'week') return addDaysToDateString(anchor, 7 * dir)
  if (view === 'day') return addDaysToDateString(anchor, dir)
  return addDaysToDateString(anchor, 30 * dir)
}

const fmt = (opts: Intl.DateTimeFormatOptions, key: string) => new Intl.DateTimeFormat('en-IN', { ...opts, timeZone: 'UTC' }).format(new Date(`${key}T00:00:00Z`))

export function rangeLabel(view: CalendarView, anchor: string): string {
  if (view === 'month') return fmt({ month: 'long', year: 'numeric' }, anchor)
  if (view === 'day') return fmt({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }, anchor)
  if (view === 'week') {
    const days = weekKeys(anchor)
    const a = fmt({ day: 'numeric', month: 'short' }, days[0]!)
    const b = fmt({ day: 'numeric', month: 'short', year: 'numeric' }, days[6]!)
    return `${a} – ${b}`
  }
  return `Next 60 days from ${fmt({ day: 'numeric', month: 'short' }, anchor)}`
}

export const dayLabel = (key: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric' }) => fmt(opts, key)

/**
 * Side-by-side layout for overlapping blocks in a day column. Items that overlap
 * (transitively) form a cluster and share the width equally.
 */
export function layoutLanes<T extends { start: number; end: number }>(items: T[]): (T & { lane: number; lanes: number })[] {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end)
  const out: (T & { lane: number; lanes: number })[] = []
  let cluster: (T & { lane: number; lanes: number })[] = []
  let clusterEnd = -Infinity
  let laneEnds: number[] = []

  const flush = () => {
    for (const c of cluster) c.lanes = laneEnds.length
    out.push(...cluster)
    cluster = []
    laneEnds = []
    clusterEnd = -Infinity
  }

  for (const item of sorted) {
    if (cluster.length > 0 && item.start >= clusterEnd) flush()
    let lane = laneEnds.findIndex((end) => end <= item.start)
    if (lane === -1) lane = laneEnds.length
    laneEnds[lane] = item.end
    clusterEnd = Math.max(clusterEnd, item.end)
    cluster.push({ ...item, lane, lanes: 1 })
  }
  flush()
  return out
}
