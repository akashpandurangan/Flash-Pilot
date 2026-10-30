import { PRODUCTION_STAGES } from './constants'
import type { BookingStatus, ProductionStage } from '@/types/entities'

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
