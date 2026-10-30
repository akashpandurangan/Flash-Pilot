import { zonedDayKey } from '@/lib/time'
import type { Project } from '@/types/entities'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** More bars than this stop being readable; a longer range shows its most recent months. */
export const MAX_MONTHS = 18
const DAY_MS = 86_400_000

export interface MonthBucket {
  /** yyyy-MM */
  key: string
  /** "Aug", or "Aug 26" when the range spans more than one year. */
  label: string
  value: number
}

/** Every month from the one containing `from` to the one containing `to`, oldest first, capped at MAX_MONTHS. */
export function monthKeys(from: string, to: string): string[] {
  const keys: string[] = []
  let [y, m] = from.split('-').map(Number) as [number, number]
  const [endY, endM] = to.split('-').map(Number) as [number, number]
  while ((y < endY || (y === endY && m <= endM)) && keys.length < 240) {
    keys.push(`${y}-${String(m).padStart(2, '0')}`)
    if (++m > 12) { m = 1; y += 1 }
  }
  return keys.slice(-MAX_MONTHS)
}

/** The month a value falls in. Date-only strings (yyyy-MM-dd) are taken as written; instants are read in the studio zone. */
export function monthOf(value: string, tz: string): string {
  return (value.length === 10 ? value : zonedDayKey(value, tz)).slice(0, 7)
}

/**
 * Sums `weight` per month over a date range, including empty months so gaps show as gaps.
 * `when` yields an instant or a yyyy-MM-dd date; rows it returns nothing for are skipped.
 */
export function bucketByMonth<T>(
  rows: T[],
  when: (row: T) => string | null | undefined,
  range: { from: string; to: string },
  tz: string,
  weight: (row: T) => number = () => 1,
): MonthBucket[] {
  const keys = monthKeys(range.from, range.to)
  const totals = new Map(keys.map((k) => [k, 0]))
  for (const row of rows) {
    const at = when(row)
    if (!at) continue
    const key = monthOf(at, tz)
    if (totals.has(key)) totals.set(key, totals.get(key)! + weight(row))
  }
  const multiYear = keys.length > 0 && keys[0]!.slice(0, 4) !== keys.at(-1)!.slice(0, 4)
  return keys.map((key) => ({
    key,
    label: `${MONTHS[Number(key.slice(5)) - 1]}${multiYear ? ` ${key.slice(2, 4)}` : ''}`,
    value: totals.get(key) ?? 0,
  }))
}

/** True when an instant falls inside [from, to). Compares moments, not strings, so offsets in the data don't matter. */
export function withinRange(iso: string | null | undefined, range: { from: string; to: string }): boolean {
  if (!iso) return false
  const t = new Date(iso).getTime()
  return t >= new Date(range.from).getTime() && t < new Date(range.to).getTime()
}

export interface DeliveryStats {
  delivered: number
  onTime: number
  late: number
  /** Delivered, but no delivery date had been promised. */
  noDeadline: number
  /** Mean days from the end of the shoot to delivery; null when no delivered event recorded both. */
  avgDaysToDeliver: number | null
  /** Mean days spent editing; null when no event recorded both ends. */
  avgEditingDays: number | null
}

type Timeline = Pick<Project, 'delivered_at' | 'delivery_due_date' | 'shoot_completed_at' | 'editing_started_at' | 'editing_completed_at'>

const daysBetween = (a: string, b: string) => Math.max(0, (new Date(b).getTime() - new Date(a).getTime()) / DAY_MS)
const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10 : null)

/** How promptly delivered events went out, from the timestamps the production workflow records. */
export function deliveryPerformance(rows: Timeline[], tz: string): DeliveryStats {
  const delivered = rows.filter((r) => r.delivered_at)
  let onTime = 0
  let late = 0
  let noDeadline = 0
  for (const r of delivered) {
    if (!r.delivery_due_date) noDeadline += 1
    else if (zonedDayKey(r.delivered_at!, tz) <= r.delivery_due_date) onTime += 1
    else late += 1
  }
  return {
    delivered: delivered.length,
    onTime,
    late,
    noDeadline,
    avgDaysToDeliver: mean(delivered.filter((r) => r.shoot_completed_at).map((r) => daysBetween(r.shoot_completed_at!, r.delivered_at!))),
    avgEditingDays: mean(rows.filter((r) => r.editing_started_at && r.editing_completed_at).map((r) => daysBetween(r.editing_started_at!, r.editing_completed_at!))),
  }
}

/** Share of delivered events that met their promised date, as a whole percent; null when none had a deadline. */
export function onTimeRate(s: Pick<DeliveryStats, 'onTime' | 'late'>): number | null {
  const judged = s.onTime + s.late
  return judged === 0 ? null : Math.round((s.onTime / judged) * 100)
}
