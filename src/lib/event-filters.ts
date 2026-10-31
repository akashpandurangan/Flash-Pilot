import { PRODUCTION_STAGES } from './constants'
import { effectiveStage, isLive, type LifecycleSubject } from './lifecycle'
import type { BookingStatus, ProductionStage, ProjectOverview } from '@/types/entities'

/**
 * The status chips on the Events page. They are a friendlier face on the two existing URL filters
 * (`booking`, `stage`), so old links and the dashboard / sidebar links keep working unchanged.
 */
export type EventChip = 'all' | ProductionStage | 'cancelled'

export const EVENT_CHIPS: { value: EventChip; label: string }[] = [
  { value: 'all', label: 'All Events' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'production', label: 'In Production' },
  { value: 'awaiting_approval', label: 'Waiting for Approval' },
  { value: 'editing', label: 'Editing' },
  { value: 'out_for_delivery', label: 'Out for Delivery' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'cancelled', label: 'Cancelled' },
]

const STAGE_CHIPS: ProductionStage[] = PRODUCTION_STAGES

export function chipFromParams(p: { booking: string; stage: string }): EventChip {
  if (p.booking === 'cancelled') return 'cancelled'
  if ((STAGE_CHIPS as string[]).includes(p.stage)) return p.stage as EventChip
  return 'all'
}

export function paramsFromChip(chip: EventChip): { booking: BookingStatus | ''; stage: ProductionStage | '' } {
  if (chip === 'all') return { booking: '', stage: '' }
  if (chip === 'cancelled') return { booking: 'cancelled', stage: '' }
  return { booking: '', stage: chip }
}

/** Number of filters (beyond the status chip and search) that are narrowing the list. */
export function activeFilterCount(f: { type: string; emp: string; from: string; to: string; archived: string; booking: string; stage: string }): number {
  const chip = chipFromParams(f)
  const extraBooking = !!f.booking && !(chip === 'cancelled')
  return [f.type, f.emp, f.from, f.to, f.archived === '1' ? '1' : '', extraBooking ? f.booking : ''].filter(Boolean).length
}

/**
 * Which events belong under a status chip - the one rule behind the dashboard's Events panel tabs, their counts and
 * the pipeline, so they always agree. Stage chips use the lifecycle stage the event is really in (see lifecycle.ts) and
 * leave out cancelled events; "Cancelled" is a booking status, not a stage; "All Events" is everything not archived.
 */
export function matchesChip(e: LifecycleSubject, chip: EventChip, now: Date = new Date()): boolean {
  if (e.archived_at) return false
  if (chip === 'all') return true
  if (chip === 'cancelled') return e.booking_status === 'cancelled'
  return isLive(e) && effectiveStage(e, now) === chip
}

export function chipCounts(events: LifecycleSubject[], now: Date = new Date()): Record<EventChip, number> {
  const counts = Object.fromEntries(EVENT_CHIPS.map((c) => [c.value, 0])) as Record<EventChip, number>
  for (const e of events) for (const { value } of EVENT_CHIPS) if (matchesChip(e, value, now)) counts[value] += 1
  return counts
}

type Sortable = Pick<ProjectOverview, 'next_event_at' | 'first_event_at' | 'last_event_at'>
const at = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : null)

/** The Events page's default order: the next session first, events with nothing ahead last (most recently finished first). */
export function sortSoonest<T extends Sortable>(events: T[]): T[] {
  return [...events].sort((a, b) => {
    const an = at(a.next_event_at)
    const bn = at(b.next_event_at)
    if (an !== null && bn !== null) return an - bn
    if (an !== null) return -1
    if (bn !== null) return 1
    return (at(b.last_event_at) ?? 0) - (at(a.last_event_at) ?? 0)
  })
}

/** The Events page link that shows the same set as a chip (same URL parameters the page already understands). */
export function eventsLink(chip: EventChip): string {
  const { booking, stage } = paramsFromChip(chip)
  const q = new URLSearchParams()
  if (booking) q.set('booking', booking)
  if (stage) q.set('stage', stage)
  const qs = q.toString()
  return qs ? `/events?${qs}` : '/events'
}
