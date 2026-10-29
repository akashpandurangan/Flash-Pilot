import { z } from 'zod'
import type { EventPayload, ProjectDetail, ProjectPayload } from '@/api/projects'
import { DEFAULT_ASSIGNMENT_FOR_TEAM_ROLE } from '@/lib/constants'
import { parseMoneyInput } from '@/lib/money'
import { buildEventRange, isoToDateInput, isoToTimeInput } from '@/lib/time'
import { isValidUrl } from '@/lib/utils'
import type { AssignmentRole, EventType, PaymentMethod, TeamRole } from '@/types/entities'

const EVENT_TYPES = ['wedding', 'engagement', 'reception', 'birthday', 'maternity', 'pre_wedding', 'corporate', 'other'] as const
const ASSIGNMENT_ROLES = ['lead_photographer', 'second_photographer', 'videographer', 'assistant', 'editor', 'other'] as const

const moneyField = z.string().trim().refine((v) => v === '' || parseMoneyInput(v) !== null, 'Enter a valid amount (up to 2 decimals)')

export const assignmentSchema = z.object({
  employee_id: z.string().min(1, 'Choose a person'),
  role: z.enum(ASSIGNMENT_ROLES),
})

export const equipmentRowSchema = z
  .object({
    dbId: z.string().optional(),
    equipment_id: z.string(),
    custom_name: z.string().trim().max(120),
    quantity: z.string().trim().refine((v) => /^[1-9]\d{0,3}$/.test(v), 'Whole number, at least 1'),
    notes: z.string().trim().max(300),
  })
  .refine((r) => r.equipment_id !== '' || r.custom_name !== '', { message: 'Pick an item or describe it', path: ['equipment_id'] })

export const eventSchema = z
  .object({
    dbId: z.string().optional(),
    title: z.string().trim().min(1, 'Name this event').max(160),
    event_type: z.enum(EVENT_TYPES),
    date: z.string().min(1, 'Choose the event date'),
    start_time: z.string().min(1, 'Set the reporting time'),
    end_time: z.string().min(1, 'Set the end time'),
    venue_name: z.string().trim().max(160),
    venue_address: z.string().trim().max(400),
    map_url: z.string().trim().refine((v) => v === '' || isValidUrl(v), 'Enter a full link starting with https://'),
    notes: z.string().trim().max(2000),
    assignments: z.array(assignmentSchema),
    equipment: z.array(equipmentRowSchema),
  })
  .superRefine((ev, ctx) => {
    if (ev.start_time && ev.end_time && ev.start_time === ev.end_time) {
      ctx.addIssue({ code: 'custom', path: ['end_time'], message: 'End time must differ from the start time' })
    }
    const seen = new Set<string>()
    ev.assignments.forEach((a, i) => {
      if (!a.employee_id) return
      if (seen.has(a.employee_id)) ctx.addIssue({ code: 'custom', path: ['assignments', i, 'employee_id'], message: 'Already assigned to this event' })
      seen.add(a.employee_id)
    })
    const items = new Set<string>()
    ev.equipment.forEach((r, i) => {
      if (!r.equipment_id) return
      if (items.has(r.equipment_id)) ctx.addIssue({ code: 'custom', path: ['equipment', i, 'equipment_id'], message: 'Already listed - raise the quantity instead' })
      items.add(r.equipment_id)
    })
  })

export const projectSchema = z
  .object({
    client_id: z.string().min(1, 'Choose a client'),
    name: z.string().trim().min(2, 'Give the project a name').max(160),
    event_type: z.enum(EVENT_TYPES),
    booking_status: z.enum(['inquiry', 'confirmed']),
    description: z.string().trim().max(4000),
    internal_notes: z.string().trim().max(4000),
    editor_id: z.string(),
    editing_due_date: z.string(),
    delivery_due_date: z.string(),
    agreed_amount: moneyField,
    payment_due_date: z.string(),
    payment_notes: z.string().trim().max(1000),
    advance_amount: moneyField,
    advance_paid_on: z.string(),
    advance_method: z.enum(['cash', 'upi', 'bank_transfer', 'other']),
    advance_reference: z.string().trim().max(120),
    allow_overpayment: z.boolean(),
    events: z.array(eventSchema).min(1, 'Add at least one event'),
  })
  .superRefine((v, ctx) => {
    const agreed = parseMoneyInput(v.agreed_amount) ?? 0
    const advance = parseMoneyInput(v.advance_amount) ?? 0
    if (advance > 0 && advance > agreed && !v.allow_overpayment) {
      ctx.addIssue({ code: 'custom', path: ['advance_amount'], message: agreed === 0 ? 'Enter the project amount first, or confirm below' : 'The advance is more than the project amount - confirm below to record it as credit' })
    }
    if (v.editing_due_date && v.delivery_due_date && v.delivery_due_date < v.editing_due_date) {
      ctx.addIssue({ code: 'custom', path: ['delivery_due_date'], message: 'Delivery should not be before editing is due' })
    }
  })

export type ProjectFormValues = z.infer<typeof projectSchema>
export type EventFormValues = z.infer<typeof eventSchema>

export function emptyEvent(type: EventType = 'wedding', title?: string): EventFormValues {
  return {
    title: title ?? defaultEventTitle(type), event_type: type, date: '', start_time: '09:00', end_time: '17:00',
    venue_name: '', venue_address: '', map_url: '', notes: '', assignments: [], equipment: [],
  }
}

export function defaultEventTitle(type: EventType): string {
  return type === 'pre_wedding' ? 'Pre-wedding shoot' : type.charAt(0).toUpperCase() + type.slice(1)
}

export function defaultProjectValues(clientId = '', type: EventType = 'wedding'): ProjectFormValues {
  return {
    client_id: clientId, name: '', event_type: type, booking_status: 'inquiry', description: '', internal_notes: '',
    editor_id: '', editing_due_date: '', delivery_due_date: '', agreed_amount: '', payment_due_date: '', payment_notes: '',
    advance_amount: '', advance_paid_on: '', advance_method: 'upi' as PaymentMethod, advance_reference: '', allow_overpayment: false,
    events: [emptyEvent(type)],
  }
}

export function defaultRoleFor(teamRole: TeamRole): AssignmentRole {
  return DEFAULT_ASSIGNMENT_FOR_TEAM_ROLE[teamRole]
}

const orNull = (s: string): string | null => (s.trim() === '' ? null : s.trim())

export interface PayloadContext {
  studioId: string
  tz: string
  /** Caller may enter amounts and payments. Without this, no money fields are sent at all. */
  canFinance: boolean
  isNew: boolean
  removedEventIds: string[]
  today: string
}

/**
 * NOTE: persisted row ids are kept in `dbId`, never `id` - react-hook-form's useFieldArray
 * reserves `id` for its own row keys and would overwrite ours.
 */

/** Browser form → the single payload the save_project() database function receives. */
export function formToPayload(v: ProjectFormValues, ctx: PayloadContext): ProjectPayload {
  const events: EventPayload[] = v.events.map((e, i) => {
    const { startsAt, endsAt } = buildEventRange(e.date, e.start_time, e.end_time, ctx.tz)
    return {
      ...(e.dbId ? { id: e.dbId } : {}),
      title: e.title.trim(),
      event_type: e.event_type,
      starts_at: startsAt,
      ends_at: endsAt,
      venue_name: orNull(e.venue_name),
      venue_address: orNull(e.venue_address),
      map_url: orNull(e.map_url),
      notes: orNull(e.notes),
      sort_order: i,
      assignments: e.assignments.filter((a) => a.employee_id).map((a) => ({ employee_id: a.employee_id, role: a.role })),
      equipment: e.equipment.map((r) => ({
        ...(r.dbId ? { id: r.dbId } : {}),
        equipment_id: r.equipment_id || null,
        custom_name: r.equipment_id ? null : orNull(r.custom_name),
        quantity: Number(r.quantity),
        notes: orNull(r.notes),
      })),
    }
  })

  const payload: ProjectPayload = {
    project: {
      studio_id: ctx.studioId,
      client_id: v.client_id,
      name: v.name.trim(),
      event_type: v.event_type,
      ...(ctx.isNew ? { booking_status: v.booking_status } : {}),
      description: orNull(v.description),
      internal_notes: orNull(v.internal_notes),
      editor_id: orNull(v.editor_id),
      editing_due_date: orNull(v.editing_due_date),
      delivery_due_date: orNull(v.delivery_due_date),
    },
    events,
    removed_event_ids: ctx.removedEventIds,
  }

  if (ctx.canFinance) {
    payload.finance = {
      agreed_amount: parseMoneyInput(v.agreed_amount) ?? 0,
      payment_due_date: orNull(v.payment_due_date),
      payment_notes: orNull(v.payment_notes),
    }
    const advance = parseMoneyInput(v.advance_amount) ?? 0
    if (ctx.isNew && advance > 0) {
      payload.initial_payment = {
        amount: advance,
        paid_on: v.advance_paid_on || ctx.today,
        method: v.advance_method,
        reference: orNull(v.advance_reference),
        notes: null,
        allow_overpayment: v.allow_overpayment,
      }
    }
  }
  return payload
}

/** Saved project → form values, with event times shown in the studio's time zone. */
export function projectToForm(
  p: ProjectDetail,
  finance: { agreed_amount: number; payment_due_date: string | null; payment_notes: string | null } | null,
  tz: string,
): ProjectFormValues {
  const events = p.project_events
    .filter((e) => !e.cancelled_at)
    .map<EventFormValues>((e) => ({
      dbId: e.id,
      title: e.title,
      event_type: e.event_type,
      date: isoToDateInput(e.starts_at, tz),
      start_time: isoToTimeInput(e.starts_at, tz),
      end_time: isoToTimeInput(e.ends_at, tz),
      venue_name: e.venue_name ?? '',
      venue_address: e.venue_address ?? '',
      map_url: e.map_url ?? '',
      notes: e.notes ?? '',
      assignments: (e.event_assignments ?? []).map((a) => ({ employee_id: a.employee_id, role: a.role })),
      equipment: (e.event_equipment ?? []).map((r) => ({
        dbId: r.id, equipment_id: r.equipment_id ?? '', custom_name: r.custom_name ?? '', quantity: String(r.quantity), notes: r.notes ?? '',
      })),
    }))
  return {
    ...defaultProjectValues(p.client_id, p.event_type),
    name: p.name,
    booking_status: p.booking_status === 'confirmed' ? 'confirmed' : 'inquiry',
    description: p.description ?? '',
    internal_notes: p.internal_notes ?? '',
    editor_id: p.editor_id ?? '',
    editing_due_date: p.editing_due_date ?? '',
    delivery_due_date: p.delivery_due_date ?? '',
    agreed_amount: finance && finance.agreed_amount > 0 ? String(finance.agreed_amount) : '',
    payment_due_date: finance?.payment_due_date ?? '',
    payment_notes: finance?.payment_notes ?? '',
    events: events.length > 0 ? events : [emptyEvent(p.event_type)],
  }
}
