import { describe, expect, it } from 'vitest'
import type { ProjectDetail } from '@/api/projects'
import { defaultProjectValues, emptyEvent, formToPayload, projectSchema, projectToForm, type ProjectFormValues } from './projectForm'

const ctx = { studioId: 's1', tz: 'Asia/Kolkata', canFinance: true, isNew: true, removedEventIds: [], today: '2030-01-01' }

function valid(over: Partial<ProjectFormValues> = {}): ProjectFormValues {
  return {
    ...defaultProjectValues('c1'),
    name: 'Sharma Wedding',
    agreed_amount: '1,00,000',
    advance_amount: '25000',
    events: [{ ...emptyEvent('wedding'), date: '2030-11-14', start_time: '09:30', end_time: '19:00', venue_name: ' Grand Hall ', assignments: [{ employee_id: 'e1', role: 'lead_photographer' }] }],
    ...over,
  }
}

describe('project form validation', () => {
  it('accepts a complete form', () => {
    expect(projectSchema.safeParse(valid()).success).toBe(true)
  })

  it('requires a client, a name, and an event date', () => {
    const r = projectSchema.safeParse(valid({ client_id: '', name: '', events: [emptyEvent()] }))
    expect(r.success).toBe(false)
    const paths = (r.error?.issues ?? []).map((i) => i.path.join('.'))
    expect(paths).toEqual(expect.arrayContaining(['client_id', 'name', 'events.0.date']))
  })

  it('needs at least one event', () => {
    expect(projectSchema.safeParse(valid({ events: [] })).success).toBe(false)
  })

  it('rejects identical start and end times, bad map links and duplicate people', () => {
    const e = valid().events[0]!
    const bad = projectSchema.safeParse(valid({
      events: [{ ...e, end_time: e.start_time, map_url: 'not a url', assignments: [{ employee_id: 'e1', role: 'lead_photographer' }, { employee_id: 'e1', role: 'assistant' }] }],
    }))
    const msgs = (bad.error?.issues ?? []).map((i) => i.message)
    expect(msgs).toEqual(expect.arrayContaining(['End time must differ from the start time', 'Enter a full link starting with https://', 'Already assigned to this session']))
  })

  it('blocks an advance larger than the project amount unless explicitly confirmed', () => {
    const over = valid({ agreed_amount: '10000', advance_amount: '12000' })
    expect(projectSchema.safeParse(over).success).toBe(false)
    expect(projectSchema.safeParse({ ...over, allow_overpayment: true }).success).toBe(true)
  })

  it('validates amounts and equipment rows', () => {
    expect(projectSchema.safeParse(valid({ agreed_amount: '12.345' })).success).toBe(false)
    const e = valid().events[0]!
    expect(projectSchema.safeParse(valid({ events: [{ ...e, equipment: [{ equipment_id: '', custom_name: '', quantity: '1', notes: '' }] }] })).success).toBe(false)
    expect(projectSchema.safeParse(valid({ events: [{ ...e, equipment: [{ equipment_id: '', custom_name: 'Smoke machine', quantity: '0', notes: '' }] }] })).success).toBe(false)
    expect(projectSchema.safeParse(valid({ events: [{ ...e, equipment: [{ equipment_id: '', custom_name: 'Smoke machine', quantity: '2', notes: '' }] }] })).success).toBe(true)
  })

  it('rejects delivery due before editing due', () => {
    expect(projectSchema.safeParse(valid({ editing_due_date: '2030-12-10', delivery_due_date: '2030-12-01' })).success).toBe(false)
  })
})

describe('form → payload', () => {
  it('converts studio-local times to UTC instants and trims text', () => {
    const p = formToPayload(valid(), ctx)
    expect(p.events[0]).toMatchObject({ starts_at: '2030-11-14T04:00:00.000Z', ends_at: '2030-11-14T13:30:00.000Z', venue_name: 'Grand Hall', venue_address: null, sort_order: 0 })
    expect(p.project).toMatchObject({ studio_id: 's1', client_id: 'c1', name: 'Sharma Wedding', booking_status: 'inquiry', editor_id: null })
  })

  it('runs past midnight when the end time is earlier than the start', () => {
    const e = { ...valid().events[0]!, start_time: '19:00', end_time: '01:00' }
    const p = formToPayload(valid({ events: [e] }), ctx)
    expect(new Date(p.events[0]!.ends_at).getTime() - new Date(p.events[0]!.starts_at).getTime()).toBe(6 * 3_600_000)
  })

  it('sends the agreed amount and the advance as a first payment on create', () => {
    const p = formToPayload(valid(), ctx)
    expect(p.finance).toEqual({ agreed_amount: 100000, payment_due_date: null, payment_notes: null })
    expect(p.initial_payment).toMatchObject({ amount: 25000, method: 'upi', paid_on: '2030-01-01', allow_overpayment: false })
  })

  it('never sends money for people without financial access, nor an advance when editing', () => {
    const noFin = formToPayload(valid(), { ...ctx, canFinance: false })
    expect(noFin.finance).toBeUndefined()
    expect(noFin.initial_payment).toBeUndefined()
    const edit = formToPayload(valid(), { ...ctx, isNew: false })
    expect(edit.initial_payment).toBeUndefined()
    expect(edit.project).not.toHaveProperty('booking_status')
  })

  it('keeps ids of existing events and rows, and passes removed events along', () => {
    const e = { ...valid().events[0]!, dbId: 'ev1', equipment: [{ dbId: 'eq1', equipment_id: 'item1', custom_name: 'ignored', quantity: '2', notes: '' }, { equipment_id: '', custom_name: ' Fog machine ', quantity: '1', notes: 'rental' }] }
    const p = formToPayload(valid({ events: [e] }), { ...ctx, isNew: false, removedEventIds: ['gone'] })
    expect(p.events[0]!.id).toBe('ev1')
    expect(p.events[0]!.equipment).toEqual([
      { id: 'eq1', equipment_id: 'item1', custom_name: null, quantity: 2, notes: null },
      { equipment_id: null, custom_name: 'Fog machine', quantity: 1, notes: 'rental' },
    ])
    expect(p.removed_event_ids).toEqual(['gone'])
  })
})

describe('project → form', () => {
  it('shows saved times in the studio zone and skips cancelled events', () => {
    const detail = {
      id: 'p1', client_id: 'c1', name: 'Saved', event_type: 'wedding', booking_status: 'confirmed', description: null, internal_notes: null,
      editor_id: null, editing_due_date: null, delivery_due_date: null,
      project_events: [
        { id: 'ev1', title: 'Wedding', event_type: 'wedding', starts_at: '2030-11-14T04:00:00.000Z', ends_at: '2030-11-14T13:30:00.000Z', venue_name: 'Hall', venue_address: null, map_url: null, notes: null, cancelled_at: null, event_assignments: [{ employee_id: 'e1', role: 'lead_photographer' }], event_equipment: [{ id: 'q1', equipment_id: null, custom_name: 'Fog', quantity: 2, notes: null }] },
        { id: 'ev2', title: 'Cancelled', event_type: 'other', starts_at: '2030-11-15T04:00:00.000Z', ends_at: '2030-11-15T06:00:00.000Z', cancelled_at: '2030-01-01T00:00:00Z' },
      ],
    } as unknown as ProjectDetail
    const v = projectToForm(detail, { agreed_amount: 50000, payment_due_date: '2030-11-01', payment_notes: null }, 'Asia/Kolkata')
    expect(v.events).toHaveLength(1)
    expect(v.events[0]).toMatchObject({ dbId: 'ev1', date: '2030-11-14', start_time: '09:30', end_time: '19:00', venue_name: 'Hall' })
    expect(v.events[0]!.equipment[0]).toMatchObject({ dbId: 'q1', custom_name: 'Fog', quantity: '2' })
    expect(v.agreed_amount).toBe('50000')
    expect(v.payment_due_date).toBe('2030-11-01')
  })

  it('round-trips without drifting the schedule', () => {
    const e = valid().events[0]!
    const payload = formToPayload(valid({ events: [e] }), ctx)
    const back = projectToForm({ ...({} as ProjectDetail), client_id: 'c1', name: 'x', event_type: 'wedding', booking_status: 'confirmed', project_events: [{ ...payload.events[0]!, id: 'ev', cancelled_at: null, event_assignments: [], event_equipment: [] }] as never } as ProjectDetail, null, 'Asia/Kolkata')
    expect(back.events[0]).toMatchObject({ date: '2030-11-14', start_time: '09:30', end_time: '19:00' })
  })
})
