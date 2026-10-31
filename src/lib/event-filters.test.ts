import { describe, expect, it } from 'vitest'
import { activeFilterCount, chipCounts, chipFromParams, EVENT_CHIPS, eventsLink, matchesChip, paramsFromChip, sortSoonest } from './event-filters'

describe('which events a chip shows', () => {
  const NOW = new Date('2030-06-01T08:00:00Z')
  const at = (days: number) => new Date(NOW.getTime() + days * 86_400_000).toISOString()
  const e = (id: string, over: Record<string, unknown> = {}) => ({
    id, booking_status: 'confirmed' as const, production_stage: 'upcoming' as const, archived_at: null,
    first_event_at: at(5), last_event_at: at(6), production_start_applied_at: null, production_end_applied_at: null, ...over,
  })
  const events = [
    e('upcoming'), e('inquiry', { booking_status: 'inquiry' }),
    e('production', { production_stage: 'production', first_event_at: at(-1), last_event_at: at(1) }),
    e('waiting', { production_stage: 'awaiting_approval' }), e('editing', { production_stage: 'editing' }),
    e('out', { production_stage: 'out_for_delivery' }), e('delivered', { production_stage: 'delivered' }),
    e('cancelled', { booking_status: 'cancelled' }), e('cancelledEditing', { booking_status: 'cancelled', production_stage: 'editing' }),
    e('archived', { archived_at: at(-1) }),
  ]
  const ids = (chip: Parameters<typeof matchesChip>[1]) => events.filter((x) => matchesChip(x, chip, NOW)).map((x) => x.id)

  it('maps every stage tab to its lifecycle stage and keeps cancelled events out of them', () => {
    expect(ids('upcoming')).toEqual(['upcoming', 'inquiry'])
    expect(ids('production')).toEqual(['production'])
    expect(ids('awaiting_approval')).toEqual(['waiting'])
    expect(ids('editing')).toEqual(['editing'])
    expect(ids('out_for_delivery')).toEqual(['out'])
    expect(ids('delivered')).toEqual(['delivered'])
  })

  it('Cancelled is the booking status, All Events is everything that is not archived', () => {
    expect(ids('cancelled')).toEqual(['cancelled', 'cancelledEditing'])
    expect(ids('all')).toHaveLength(events.length - 1)
    expect(ids('all')).not.toContain('archived')
  })

  it('counts each tab from the same rule, so counts and lists agree and no event is listed twice', () => {
    const counts = chipCounts(events, NOW)
    for (const { value } of EVENT_CHIPS) expect(counts[value], value).toBe(ids(value).length)
    const stageIds = EVENT_CHIPS.filter((c) => !['all', 'cancelled'].includes(c.value)).flatMap((c) => ids(c.value))
    expect(new Set(stageIds).size).toBe(stageIds.length)
  })

  it('orders by the next session, with finished events last (most recent first)', () => {
    const rows = [
      { id: 'late', next_event_at: at(9), first_event_at: at(9), last_event_at: at(10) },
      { id: 'done-old', next_event_at: null, first_event_at: at(-30), last_event_at: at(-29) },
      { id: 'soon', next_event_at: at(1), first_event_at: at(1), last_event_at: at(2) },
      { id: 'done-new', next_event_at: null, first_event_at: at(-3), last_event_at: at(-2) },
    ]
    expect(sortSoonest(rows).map((r) => r.id)).toEqual(['soon', 'late', 'done-new', 'done-old'])
  })

  it('links to the full Events page with the matching filter', () => {
    expect(eventsLink('all')).toBe('/events')
    expect(eventsLink('editing')).toBe('/events?stage=editing')
    expect(eventsLink('awaiting_approval')).toBe('/events?stage=awaiting_approval')
    expect(eventsLink('cancelled')).toBe('/events?booking=cancelled')
  })
})

describe('events status chips', () => {
  it('offers one filter per lifecycle stage, plus all and cancelled, in order', () => {
    expect(EVENT_CHIPS.map((c) => c.label)).toEqual(['All Events', 'Upcoming', 'In Production', 'Waiting for Approval', 'Editing', 'Out for Delivery', 'Delivered', 'Cancelled'])
  })

  it('round-trips every chip through the URL parameters', () => {
    for (const { value } of EVENT_CHIPS) expect(chipFromParams(paramsFromChip(value))).toBe(value)
  })

  it('understands the links the dashboard and sidebar already produce', () => {
    expect(chipFromParams({ booking: '', stage: 'production' })).toBe('production')
    expect(chipFromParams({ booking: 'confirmed', stage: 'editing' })).toBe('editing')
    expect(chipFromParams({ booking: 'cancelled', stage: '' })).toBe('cancelled')
    expect(chipFromParams({ booking: '', stage: '' })).toBe('all')
    expect(chipFromParams({ booking: '', stage: 'nonsense' })).toBe('all')
  })

  it('maps chips to the filters the API understands', () => {
    expect(paramsFromChip('all')).toEqual({ booking: '', stage: '' })
    expect(paramsFromChip('cancelled')).toEqual({ booking: 'cancelled', stage: '' })
    expect(paramsFromChip('out_for_delivery')).toEqual({ booking: '', stage: 'out_for_delivery' })
    expect(paramsFromChip('awaiting_approval')).toEqual({ booking: '', stage: 'awaiting_approval' })
  })

  it('counts only the extra filters, not the status chip', () => {
    const base = { type: '', emp: '', from: '', to: '', archived: '0', booking: '', stage: '' }
    expect(activeFilterCount(base)).toBe(0)
    expect(activeFilterCount({ ...base, stage: 'production' })).toBe(0)
    expect(activeFilterCount({ ...base, booking: 'cancelled' })).toBe(0)
    expect(activeFilterCount({ ...base, type: 'wedding', emp: 'e1', archived: '1' })).toBe(3)
    expect(activeFilterCount({ ...base, booking: 'confirmed', stage: 'editing' })).toBe(1)
  })
})
