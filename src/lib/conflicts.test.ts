import { describe, expect, it } from 'vitest'
import { buildActionItems } from './alerts'
import { conflictsInvolving, describeConflict, findEmployeeConflicts, findEquipmentConflicts, findOverlappingEvents, findUnstaffedEvents, overlaps, type ConflictEvent } from './conflicts'

const at = (h: number) => new Date(Date.UTC(2030, 0, 1, h)).toISOString()

function ev(id: string, startH: number, endH: number, over: Partial<ConflictEvent> = {}): ConflictEvent {
  return {
    id, projectId: `p-${id}`, projectName: `Project ${id}`, title: `Event ${id}`, startsAt: at(startH), endsAt: at(endH),
    bookingStatus: 'confirmed', cancelled: false, archived: false, venueName: 'Hall', venueAddress: 'Road 1',
    assignments: [{ employeeId: 'e1', employeeName: 'Pia', role: 'lead_photographer' }], equipment: [], ...over,
  }
}
const camera = { id: 'cam', name: 'Sony A7IV', quantity_owned: 1, is_active: true, condition: 'good' as const }

describe('overlap maths', () => {
  it('treats touching ranges as non-overlapping', () => {
    expect(overlaps(at(9), at(12), at(12), at(15))).toBe(false)
    expect(overlaps(at(9), at(12), at(11), at(15))).toBe(true)
    expect(overlaps(at(9), at(18), at(11), at(12))).toBe(true)
  })
})

describe('employee double-booking', () => {
  it('flags the same person on overlapping events only', () => {
    const c = findEmployeeConflicts([ev('a', 9, 13), ev('b', 12, 16), ev('c', 16, 20)])
    expect(c).toHaveLength(1)
    expect(c[0]).toMatchObject({ kind: 'employee', employeeName: 'Pia' })
    expect(describeConflict(c[0]!)).toContain('Pia')
  })

  it('ignores different people, cancelled events, cancelled bookings and archived projects', () => {
    const other = [{ employeeId: 'e2', employeeName: 'Paul', role: 'lead_photographer' as const }]
    expect(findEmployeeConflicts([ev('a', 9, 13), ev('b', 10, 14, { assignments: other })])).toHaveLength(0)
    expect(findEmployeeConflicts([ev('a', 9, 13), ev('b', 10, 14, { cancelled: true })])).toHaveLength(0)
    expect(findEmployeeConflicts([ev('a', 9, 13), ev('b', 10, 14, { bookingStatus: 'cancelled' })])).toHaveLength(0)
    expect(findEmployeeConflicts([ev('a', 9, 13), ev('b', 10, 14, { archived: true })])).toHaveLength(0)
  })
})

describe('equipment conflicts', () => {
  const use = (qty = 1) => [{ equipmentId: 'cam', customName: null, quantity: qty }]

  it('flags a uniquely tagged asset reserved twice at once', () => {
    const c = findEquipmentConflicts([ev('a', 9, 13, { equipment: use() }), ev('b', 11, 15, { equipment: use() })], [camera])
    expect(c).toHaveLength(1)
    expect(c[0]).toMatchObject({ kind: 'equipment', owned: 1, needed: 2 })
  })

  it('counts quantities for generic items', () => {
    const lights = { id: 'cam', name: 'LED panel', quantity_owned: 3, is_active: true, condition: 'good' as const }
    const ok = findEquipmentConflicts([ev('a', 9, 13, { equipment: use(2) }), ev('b', 11, 15, { equipment: use(1) })], [lights])
    expect(ok).toHaveLength(0)
    const over = findEquipmentConflicts([ev('a', 9, 13, { equipment: use(2) }), ev('b', 11, 15, { equipment: use(2) })], [lights])
    expect(over).toHaveLength(1)
    expect(over[0]).toMatchObject({ needed: 4, owned: 3 })
  })

  it('releases equipment when an event is cancelled or rescheduled apart', () => {
    expect(findEquipmentConflicts([ev('a', 9, 13, { equipment: use() }), ev('b', 11, 15, { equipment: use(), cancelled: true })], [camera])).toHaveLength(0)
    expect(findEquipmentConflicts([ev('a', 9, 13, { equipment: use() }), ev('b', 13, 15, { equipment: use() })], [camera])).toHaveLength(0)
  })

  it('warns when reserved equipment is out of service or retired', () => {
    const events = [ev('a', 9, 13, { equipment: use() })]
    expect(findEquipmentConflicts(events, [{ ...camera, condition: 'out_of_service' }])[0]).toMatchObject({ kind: 'equipment_unavailable' })
    expect(findEquipmentConflicts(events, [{ ...camera, is_active: false }])[0]).toMatchObject({ kind: 'equipment_unavailable' })
    expect(findEquipmentConflicts(events, [camera])).toHaveLength(0)
  })

  it('ignores free-text requirements that are not in inventory', () => {
    const e = ev('a', 9, 13, { equipment: [{ equipmentId: null, customName: 'Smoke machine', quantity: 1 }] })
    expect(findEquipmentConflicts([e, { ...e, id: 'b' }], [camera])).toHaveLength(0)
  })
})

describe('staffing and overlap notices', () => {
  const now = new Date(Date.UTC(2029, 11, 31))

  it('flags upcoming events with no photographer (editors alone do not count)', () => {
    const editorOnly = ev('a', 9, 13, { assignments: [{ employeeId: 'e9', employeeName: 'Ed', role: 'editor' }] })
    const none = ev('b', 9, 13, { assignments: [] })
    const ok = ev('c', 9, 13)
    expect(findUnstaffedEvents([editorOnly, none, ok], now).map((c) => (c.kind === 'unstaffed' ? c.event.id : ''))).toEqual(['a', 'b'])
  })

  it('does not flag past events', () => {
    expect(findUnstaffedEvents([ev('a', 9, 13, { assignments: [] })], new Date(Date.UTC(2031, 0, 1)))).toHaveLength(0)
  })

  it('reports overlapping confirmed events from different projects', () => {
    expect(findOverlappingEvents([ev('a', 9, 13), ev('b', 12, 15)])).toHaveLength(1)
    expect(findOverlappingEvents([ev('a', 9, 13), ev('b', 12, 15, { bookingStatus: 'inquiry' })])).toHaveLength(0)
    expect(findOverlappingEvents([ev('a', 9, 13), ev('b', 12, 15, { projectId: 'p-a' })])).toHaveLength(0)
  })

  it('narrows conflicts to the events being edited', () => {
    const all = findEmployeeConflicts([ev('a', 9, 13), ev('b', 10, 14), ev('c', 20, 22), ev('d', 21, 23)])
    expect(all).toHaveLength(2)
    expect(conflictsInvolving(all, new Set(['a']))).toHaveLength(1)
  })
})

describe('action required', () => {
  const now = new Date(Date.UTC(2029, 11, 31))
  const project = (id: string, over: Record<string, unknown> = {}) => ({
    id, name: `Project ${id}`, project_code: 'FP-1', booking_status: 'confirmed' as const, production_stage: 'editing' as const,
    archived_at: null, editing_due_date: null, delivery_due_date: null, editing_completed_at: null, ...over,
  })

  it('collects unstaffed, unpaid, overdue and conflict items, most urgent first', () => {
    const items = buildActionItems({
      events: [ev('a', 9, 13, { assignments: [] }), ev('b', 9, 13, { venueName: '' })],
      projects: [project('p-a'), project('p-b', { editing_due_date: '2029-12-01' }), project('p-c', { delivery_due_date: '2029-12-01', production_stage: 'out_for_delivery' })],
      financials: [{ project_id: 'p-a', balance: 5000, payment_due_date: '2029-12-10' }, { project_id: 'p-b', balance: 0, payment_due_date: null }],
      inventory: [camera], tz: 'Asia/Kolkata', currency: 'INR', now,
    })
    const kinds = items.map((i) => i.kind)
    expect(kinds).toEqual(expect.arrayContaining(['unstaffed', 'unpaid', 'overdue_editing', 'overdue_delivery', 'missing_details']))
    expect(items.find((i) => i.kind === 'unpaid')?.severity).toBe('high') // past its due date
    expect(items.find((i) => i.kind === 'unpaid')?.title).toContain('₹5,000')
    expect(items.find((i) => i.kind === 'overdue_editing')?.href).toBe('/events/p-b')
    const order = items.map((i) => i.severity)
    expect(order).toEqual([...order].sort((x, y) => ({ high: 0, medium: 1, low: 2 }[x] - { high: 0, medium: 1, low: 2 }[y])))
  })

  it('omits money items when the viewer has no financial access', () => {
    const items = buildActionItems({ events: [], projects: [project('p-a')], financials: null, inventory: [], tz: 'Asia/Kolkata', currency: 'INR', now })
    expect(items.some((i) => i.kind === 'unpaid')).toBe(false)
  })

  it('returns nothing for a healthy studio', () => {
    expect(buildActionItems({ events: [ev('a', 9, 13)], projects: [project('p-a')], financials: [{ project_id: 'p-a', balance: 0, payment_due_date: null }], inventory: [], tz: 'Asia/Kolkata', currency: 'INR', now })).toEqual([])
  })
})
