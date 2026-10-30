import { describe, expect, it } from 'vitest'
import { activeFilterCount, chipFromParams, EVENT_CHIPS, paramsFromChip } from './event-filters'

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
