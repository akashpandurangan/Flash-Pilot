import { PAGE_SIZE, PRODUCTION_STAGE_LABELS } from '@/lib/constants'
import { todayKey } from '@/lib/time'
import { allowedBookingTransition, checkWorkflowAction, WORKFLOW_LABELS, type WorkflowAction } from '@/lib/workflow'
import type {
  ActivityLog, AssignmentRole, BookingStatus, EventReminder, Page, ProductionTask, Project, ProjectDelivery, ProjectEvent, ProjectOverview, TaskPhase,
} from '@/types/entities'
import type {
  AssignmentPayload, DeliveryInput, EquipmentPayload, EventPayload, ProjectDetail, ProjectFilters, ProjectPayload,
} from '@/api/projects'
import { read, write } from '../store/access'
import { cmpNullsLast, includesText, newId, notFound, raise } from '../store/core'
import type { Db } from '../store/db'
import { logActivity } from '../store/log'
import { activeEventsOf, briefOf, hydrateEvent, newestFirst, overviewOf, type ActivityWithProject } from '../store/views'
import { nullable } from './core'

const iso = (s: string): string => new Date(s).toISOString()
const descNullsLast = (a: string | null, b: string | null): number => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? 1 : -1)

function projectOf(db: Db, id: string): Project {
  const p = db.projects.find((x) => x.id === id)
  if (!p) throw notFound('event')
  return p
}

function openProjectOf(db: Db, id: string): Project {
  const p = projectOf(db, id)
  if (p.archived_at) throw raise('project_archived: this event is archived')
  return p
}

// ------------------------------------------------------------------ list
export async function listProjects(f: ProjectFilters): Promise<Page<ProjectOverview>> {
  return read((db, at) => {
    let rows = db.projects.filter((p) => p.studio_id === f.studioId && (f.archived ? p.archived_at !== null : p.archived_at === null)).map((p) => overviewOf(db, p, at))
    if (f.booking) rows = rows.filter((p) => p.booking_status === f.booking)
    if (f.stage) rows = rows.filter((p) => p.production_stage === f.stage)
    if (f.stage && !f.booking) rows = rows.filter((p) => p.booking_status !== 'cancelled')
    if (f.eventType) rows = rows.filter((p) => p.event_type === f.eventType)
    if (f.employeeId) rows = rows.filter((p) => p.assigned_employee_ids.includes(f.employeeId!))
    if (f.from) rows = rows.filter((p) => p.last_event_at !== null && p.last_event_at >= iso(f.from!))
    if (f.to) rows = rows.filter((p) => p.first_event_at !== null && p.first_event_at <= iso(f.to!))
    if (f.search?.trim()) rows = rows.filter((p) => includesText([p.name, p.client_name, p.project_code], f.search!))

    switch (f.sort) {
      case 'soonest': rows.sort((a, b) => cmpNullsLast(a.next_event_at, b.next_event_at) || descNullsLast(a.last_event_at, b.last_event_at)); break
      case 'latest': rows.sort((a, b) => descNullsLast(a.first_event_at, b.first_event_at)); break
      case 'name': rows.sort((a, b) => a.name.localeCompare(b.name)); break
      default: rows.sort((a, b) => descNullsLast(a.created_at, b.created_at))
    }
    const from = (f.page - 1) * PAGE_SIZE
    return { rows: rows.slice(from, from + PAGE_SIZE), total: rows.length }
  })
}

/** Lightweight list for pickers, alerts and reports (not archived). */
export async function listActiveProjects(studioId: string, limit = 500): Promise<ProjectOverview[]> {
  return read((db, at) =>
    db.projects
      .filter((p) => p.studio_id === studioId && !p.archived_at)
      .map((p) => overviewOf(db, p, at))
      .sort((a, b) => descNullsLast(a.created_at, b.created_at))
      .slice(0, limit),
  )
}

// ---------------------------------------------------------------- detail
/** Kept for parity with the real module (the SQL select used to load an event with its team and equipment). */
export const EVENT_SELECT = `*,
  event_assignments(id, event_id, employee_id, role, notes, employee:employees(id, full_name, team_role, is_active, phone)),
  event_equipment(id, event_id, equipment_id, custom_name, quantity, notes, equipment:equipment(id, name, category, asset_tag, quantity_owned, is_active, condition))`

export async function getProject(id: string): Promise<ProjectDetail | null> {
  return read((db) => {
    const p = db.projects.find((x) => x.id === id)
    if (!p) return null
    const events = db.events.filter((e) => e.project_id === id).sort((a, b) => a.starts_at.localeCompare(b.starts_at)).map((e) => hydrateEvent(db, e))
    return { ...p, project_events: events, editor: briefOf(db, p.editor_id) }
  })
}

export async function getProjectOverview(id: string): Promise<ProjectOverview | null> {
  return read((db, at) => {
    const p = db.projects.find((x) => x.id === id)
    return p ? overviewOf(db, p, at) : null
  })
}

// ----------------------------------------------------------- team / gear
/** Reminders follow the team: unsent ones are rebuilt whenever people are added or removed (a database trigger does this for real). */
function syncReminders(db: Db, eventId: string, at: Date): void {
  const ev = db.events.find((e) => e.id === eventId)
  if (!ev) return
  if (ev.cancelled_at) {
    for (const r of db.reminders) if (r.event_id === eventId && r.status === 'scheduled') r.status = 'cancelled'
    return
  }
  db.reminders = db.reminders.filter((r) => !(r.event_id === eventId && r.status === 'scheduled'))
  if (ev.starts_at <= at.toISOString()) return
  const lead = db.studio.reminder_lead_hours * 3_600_000
  for (const a of db.assignments.filter((x) => x.event_id === eventId)) {
    if (db.reminders.some((r) => r.event_id === eventId && r.employee_id === a.employee_id && r.status === 'sent')) continue
    const remindAt = new Date(new Date(ev.starts_at).getTime() - lead).toISOString()
    const reminder: EventReminder = {
      id: newId(), event_id: eventId, employee_id: a.employee_id, role: a.role, event_starts_at: ev.starts_at, remind_at: remindAt,
      status: remindAt <= at.toISOString() ? 'sent' : 'scheduled', last_error: null,
    }
    db.reminders.push(reminder)
  }
}

/** Replaces a session's team. Only people newly added must be active; existing (maybe since deactivated) people may stay. */
function replaceTeam(db: Db, ev: ProjectEvent, team: { employee_id: string; role: AssignmentRole; notes?: string | null }[], at: Date, projectId: string): void {
  const next = new Map(team.map((t) => [t.employee_id, t]))
  const before = db.assignments.filter((a) => a.event_id === ev.id)
  const beforeIds = new Set(before.map((a) => a.employee_id))
  for (const t of next.values()) {
    const person = db.employees.find((e) => e.id === t.employee_id)
    if (!person) throw notFound('team member')
    if (!beforeIds.has(t.employee_id) && !person.is_active) throw raise('employee_inactive: that team member is deactivated')
  }
  db.assignments = db.assignments.filter((a) => a.event_id !== ev.id)
  for (const t of next.values()) {
    const kept = before.find((a) => a.employee_id === t.employee_id && a.role === t.role)
    db.assignments.push({ id: kept?.id ?? newId(), event_id: ev.id, employee_id: t.employee_id, role: t.role, notes: t.notes ?? kept?.notes ?? null })
  }
  for (const t of next.values()) {
    if (!beforeIds.has(t.employee_id)) logActivity(db, { projectId, entityType: 'assignment', entityId: ev.id, action: 'assignment_added', summary: `${db.employees.find((e) => e.id === t.employee_id)!.full_name} assigned to ${ev.title}`, at })
  }
  for (const a of before) {
    if (!next.has(a.employee_id)) logActivity(db, { projectId, entityType: 'assignment', entityId: ev.id, action: 'assignment_removed', summary: `${db.employees.find((e) => e.id === a.employee_id)?.full_name ?? 'Team member'} removed from ${ev.title}`, at })
  }
}

function syncEquipment(db: Db, eventId: string, items: EquipmentPayload[]): void {
  const keepIds = new Set<string>()
  for (const item of items) {
    const existing = item.id ? db.eventEquipment.find((q) => q.id === item.id && q.event_id === eventId) : undefined
    if (existing) {
      existing.equipment_id = item.equipment_id
      existing.custom_name = item.custom_name
      existing.quantity = item.quantity
      existing.notes = item.notes ?? null
      keepIds.add(existing.id)
    } else {
      const id = newId()
      db.eventEquipment.push({ id, event_id: eventId, equipment_id: item.equipment_id, custom_name: item.custom_name, quantity: item.quantity, notes: item.notes ?? null })
      keepIds.add(id)
    }
  }
  db.eventEquipment = db.eventEquipment.filter((q) => q.event_id !== eventId || keepIds.has(q.id))
}

/** If sessions move before production starts (or while it runs), the scheduler must look at the new times again. */
function rearmLifecycle(p: Project): void {
  if (p.production_stage === 'upcoming') p.production_start_applied_at = null
  if (p.production_stage === 'production') p.production_end_applied_at = null
}

// ------------------------------------------------------------------ save
/** Creates or updates a project and everything under it as one all-or-nothing step. */
export async function saveProject(projectId: string | null, payload: ProjectPayload): Promise<string> {
  return write((db, at) => {
    const { project: input, finance, initial_payment: initial, events } = payload
    const stamp = at.toISOString()
    if (!db.clients.some((c) => c.id === input.client_id && c.studio_id === input.studio_id)) throw raise('invalid_client: choose a client from this studio')
    if (!events || events.length === 0) throw raise('events_required: add at least one session')

    let project: Project
    if (projectId === null) {
      const status: BookingStatus = input.booking_status ?? 'inquiry'
      if (status === 'cancelled') throw raise('invalid_transition: a new event cannot start cancelled')
      db.projectSeq += 1
      project = {
        id: newId(), studio_id: input.studio_id, project_code: `FP-${String(db.projectSeq).padStart(4, '0')}`, client_id: input.client_id,
        name: input.name.trim(), event_type: input.event_type, description: nullable(input.description), internal_notes: nullable(input.internal_notes),
        booking_status: status, production_stage: 'upcoming', editor_id: input.editor_id, editing_due_date: input.editing_due_date,
        delivery_due_date: input.delivery_due_date, confirmed_at: status === 'confirmed' ? stamp : null, cancelled_at: null, cancel_reason: null,
        production_started_at: null, shoot_completed_at: null, editing_started_at: null, editing_completed_at: null, ready_for_delivery_at: null,
        delivered_at: null, client_approved_at: null, client_approved_by_name: null, client_approval_note: null, production_start_applied_at: null,
        production_end_applied_at: null, archived_at: null, created_at: stamp, updated_at: stamp,
      }
      db.projects.push(project)
      db.finances.push({ project_id: project.id, agreed_amount: finance?.agreed_amount ?? 0, payment_due_date: finance?.payment_due_date ?? null, payment_notes: nullable(finance?.payment_notes) })
      db.studio.default_checklist.forEach((item, i) => {
        db.tasks.push({ id: newId(), project_id: project.id, title: item.title, phase: item.phase, sort_order: i * 10, assignee_id: null, is_done: false, done_at: null, done_by_name: null })
      })
      logActivity(db, { projectId: project.id, entityType: 'project', entityId: project.id, action: 'project_created', summary: `Event created: ${project.name}`, at })
    } else {
      project = openProjectOf(db, projectId)
      project.client_id = input.client_id
      project.name = input.name.trim()
      project.event_type = input.event_type
      project.description = nullable(input.description)
      project.internal_notes = nullable(input.internal_notes)
      if (project.editor_id !== input.editor_id && input.editor_id) {
        logActivity(db, { projectId: project.id, entityType: 'project', entityId: project.id, action: 'editor_assigned', summary: `Editor assigned: ${db.employees.find((e) => e.id === input.editor_id)?.full_name ?? 'Editor'}`, at })
      }
      project.editor_id = input.editor_id
      project.editing_due_date = input.editing_due_date
      project.delivery_due_date = input.delivery_due_date
      project.updated_at = stamp
      if (finance) {
        const row = db.finances.find((f) => f.project_id === project.id)
        if (row) {
          row.agreed_amount = finance.agreed_amount
          row.payment_due_date = finance.payment_due_date
          row.payment_notes = nullable(finance.payment_notes)
        } else {
          db.finances.push({ project_id: project.id, agreed_amount: finance.agreed_amount, payment_due_date: finance.payment_due_date, payment_notes: nullable(finance.payment_notes) })
        }
      }
    }

    // sessions: update the ones that carry an id, add the rest
    let scheduleChanged = projectId === null
    events.forEach((e: EventPayload) => {
      const existing = e.id ? db.events.find((x) => x.id === e.id && x.project_id === project.id) : undefined
      let ev: ProjectEvent
      if (existing) {
        const moved = existing.starts_at !== iso(e.starts_at) || existing.ends_at !== iso(e.ends_at)
        Object.assign(existing, {
          title: e.title.trim(), event_type: e.event_type, starts_at: iso(e.starts_at), ends_at: iso(e.ends_at), venue_name: nullable(e.venue_name),
          venue_address: nullable(e.venue_address), map_url: nullable(e.map_url), notes: nullable(e.notes), sort_order: e.sort_order, cancelled_at: null,
        })
        ev = existing
        if (moved) {
          scheduleChanged = true
          logActivity(db, { projectId: project.id, entityType: 'event', entityId: ev.id, action: 'event_rescheduled', summary: `Session rescheduled: ${ev.title}`, at })
        }
      } else {
        ev = {
          id: newId(), studio_id: project.studio_id, project_id: project.id, title: e.title.trim(), event_type: e.event_type, starts_at: iso(e.starts_at), ends_at: iso(e.ends_at),
          venue_name: nullable(e.venue_name), venue_address: nullable(e.venue_address), map_url: nullable(e.map_url), notes: nullable(e.notes), sort_order: e.sort_order, cancelled_at: null,
        }
        db.events.push(ev)
        scheduleChanged = true
        if (projectId !== null) logActivity(db, { projectId: project.id, entityType: 'event', entityId: ev.id, action: 'event_added', summary: `Session added: ${ev.title}`, at })
      }
      replaceTeam(db, ev, e.assignments as AssignmentPayload[], at, project.id)
      syncEquipment(db, ev.id, e.equipment)
      syncReminders(db, ev.id, at)
    })

    // removed sessions are cancelled, never deleted
    for (const id of payload.removed_event_ids ?? []) {
      const ev = db.events.find((x) => x.id === id && x.project_id === project.id)
      if (!ev || ev.cancelled_at) continue
      ev.cancelled_at = stamp
      scheduleChanged = true
      logActivity(db, { projectId: project.id, entityType: 'event', entityId: ev.id, action: 'event_cancelled', summary: `Session cancelled: ${ev.title}`, at })
      syncReminders(db, ev.id, at)
    }
    if (scheduleChanged) rearmLifecycle(project)

    if (projectId === null && initial && initial.amount > 0) {
      const payment = {
        id: newId(), project_id: project.id, amount: initial.amount, paid_on: initial.paid_on, method: initial.method as 'cash' | 'upi' | 'bank_transfer' | 'other',
        reference: nullable(initial.reference), notes: nullable(initial.notes), is_advance: true, status: 'valid' as const, voided_at: null, void_reason: null,
        recorded_by_name: db.profile.full_name, created_at: stamp,
      }
      db.payments.push(payment)
      logActivity(db, { projectId: project.id, entityType: 'payment', entityId: payment.id, action: 'payment_recorded', category: 'financial', summary: 'Advance payment recorded', at, metadata: { amount: payment.amount, method: payment.method } })
    }
    return project.id
  })
}

export async function setBookingStatus(projectId: string, status: BookingStatus, reason?: string) {
  return write((db, at) => {
    const p = openProjectOf(db, projectId)
    if (!allowedBookingTransition(p.booking_status, status)) throw raise(`invalid_transition: a ${p.booking_status} booking cannot become ${status}`)
    if (status === 'confirmed' && activeEventsOf(db, projectId).length === 0) throw raise('events_required: add at least one session before confirming')
    if (p.booking_status === 'confirmed' && status === 'inquiry' && p.production_stage !== 'upcoming') throw raise('invalid_transition: production has already started')
    const stamp = at.toISOString()
    let summary: string
    if (status === 'confirmed') {
      p.confirmed_at = stamp
      p.cancelled_at = null
      p.cancel_reason = null
      summary = 'Booking confirmed'
    } else if (status === 'cancelled') {
      p.cancelled_at = stamp
      p.cancel_reason = nullable(reason)
      summary = 'Booking cancelled'
    } else {
      p.confirmed_at = null
      p.cancelled_at = null
      p.cancel_reason = null
      summary = 'Booking moved back to inquiry'
    }
    p.booking_status = status
    p.updated_at = stamp
    logActivity(db, { projectId, entityType: 'project', entityId: projectId, action: `booking_${status}`, summary, at, metadata: { status, ...(reason ? { reason } : {}) } })
    return p
  })
}

export async function setProjectArchived(projectId: string, archived: boolean) {
  await write((db, at) => {
    const p = projectOf(db, projectId)
    p.archived_at = archived ? at.toISOString() : null
    p.updated_at = at.toISOString()
    logActivity(db, { projectId, entityType: 'project', entityId: projectId, action: archived ? 'project_archived' : 'project_restored', summary: archived ? 'Event archived' : 'Event restored from archive', at })
  })
}

// -------------------------------------------------------------- workflow
const workflowError = (reason: string): string => {
  if (reason === 'This event is archived.') return 'project_archived: this event is archived'
  if (reason.startsWith('Confirm the booking')) return 'booking_not_confirmed: confirm the booking before changing production'
  return `invalid_transition: ${reason}`
}

export async function runWorkflowAction(projectId: string, action: WorkflowAction, note?: string) {
  return write((db, at) => {
    const p = projectOf(db, projectId)
    const check = checkWorkflowAction(p, 'owner', action)
    if (!check.ok) throw raise(workflowError(check.reason))
    const stamp = at.toISOString()
    let summary: string = WORKFLOW_LABELS[action].done

    switch (action) {
      case 'start_production':
        p.production_stage = 'production'
        p.production_started_at = stamp
        p.production_start_applied_at = stamp
        break
      case 'complete_shoot':
        p.production_stage = 'awaiting_approval'
        p.shoot_completed_at = stamp
        p.production_start_applied_at ??= stamp
        p.production_end_applied_at = stamp
        break
      case 'approve_client':
        p.production_stage = 'editing'
        p.client_approved_at = stamp
        p.client_approved_by_name = db.profile.full_name
        p.client_approval_note = nullable(note)
        p.editing_started_at = stamp
        break
      case 'complete_editing':
        p.editing_completed_at = stamp
        break
      case 'mark_out_for_delivery':
        p.production_stage = 'out_for_delivery'
        p.ready_for_delivery_at = stamp
        break
      case 'mark_delivered': {
        p.production_stage = 'delivered'
        p.delivered_at = stamp
        const day = todayKey(db.studio.timezone, at)
        const delivery = db.deliveries.find((d) => d.project_id === projectId)
        if (delivery) {
          delivery.delivered_on ??= day
          delivery.confirmed_at = stamp
        } else {
          db.deliveries.push({ project_id: projectId, method: 'other', delivered_on: day, link_url: null, notes: null, confirmed_at: stamp })
        }
        break
      }
      case 'revert': {
        // A manual step back is honoured by the scheduler: the "already applied" markers stay set.
        const back = p.production_stage
        if (back === 'production') {
          p.production_stage = 'upcoming'
          p.production_started_at = null
          p.production_start_applied_at ??= stamp
        } else if (back === 'awaiting_approval') {
          p.production_stage = 'production'
          p.shoot_completed_at = null
          p.production_end_applied_at ??= stamp
        } else if (back === 'editing') {
          p.production_stage = 'awaiting_approval'
          p.editing_started_at = null
          p.editing_completed_at = null
          p.client_approved_at = null
          p.client_approved_by_name = null
          p.client_approval_note = null
        } else if (back === 'out_for_delivery') {
          p.production_stage = 'editing'
          p.ready_for_delivery_at = null
        } else if (back === 'delivered') {
          p.production_stage = 'out_for_delivery'
          p.delivered_at = null
          const delivery = db.deliveries.find((d) => d.project_id === projectId)
          if (delivery) delivery.confirmed_at = null
        }
        summary = `Stage stepped back to ${PRODUCTION_STAGE_LABELS[p.production_stage]}`
        break
      }
    }
    p.updated_at = stamp
    logActivity(db, { projectId, entityType: 'project', entityId: projectId, action: `workflow_${action}`, summary, at, metadata: { stage: p.production_stage, ...(note ? { note } : {}) } })
    return p
  })
}

export async function updateProjectFields(
  projectId: string,
  patch: Partial<Pick<Project, 'editor_id' | 'editing_due_date' | 'delivery_due_date' | 'internal_notes'>>,
) {
  return write((db, at) => {
    const p = projectOf(db, projectId)
    if (patch.editor_id !== undefined && patch.editor_id !== p.editor_id && patch.editor_id) {
      logActivity(db, { projectId, entityType: 'project', entityId: projectId, action: 'editor_assigned', summary: `Editor assigned: ${db.employees.find((e) => e.id === patch.editor_id)?.full_name ?? 'Editor'}`, at })
    }
    Object.assign(p, patch)
    p.updated_at = at.toISOString()
    return p
  })
}

export async function cancelEvent(eventId: string) {
  await write((db, at) => {
    const ev = db.events.find((e) => e.id === eventId)
    if (!ev) throw notFound('session')
    const project = openProjectOf(db, ev.project_id)
    if (ev.cancelled_at) return
    ev.cancelled_at = at.toISOString()
    rearmLifecycle(project)
    logActivity(db, { projectId: ev.project_id, entityType: 'event', entityId: ev.id, action: 'event_cancelled', summary: `Session cancelled: ${ev.title}`, at })
    syncReminders(db, ev.id, at)
  })
}

// ----------------------------------------------------------------- tasks
export async function listTasks(projectId: string): Promise<ProductionTask[]> {
  return read((db) => db.tasks.filter((t) => t.project_id === projectId).sort((a, b) => a.sort_order - b.sort_order))
}

export async function setTaskDone(taskId: string, done: boolean) {
  return write((db, at) => {
    const t = db.tasks.find((x) => x.id === taskId)
    if (!t) throw notFound('task')
    openProjectOf(db, t.project_id)
    t.is_done = done
    t.done_at = done ? at.toISOString() : null
    t.done_by_name = done ? db.profile.full_name : null
    logActivity(db, { projectId: t.project_id, entityType: 'task', entityId: t.id, action: done ? 'task_completed' : 'task_reopened', summary: `${done ? 'Completed' : 'Reopened'}: ${t.title}`, at })
    return t
  })
}

export async function addTask(_studioId: string, projectId: string, title: string, phase: TaskPhase, sortOrder: number) {
  return write((db) => {
    openProjectOf(db, projectId)
    const task: ProductionTask = { id: newId(), project_id: projectId, title: title.trim(), phase, sort_order: sortOrder, assignee_id: null, is_done: false, done_at: null, done_by_name: null }
    db.tasks.push(task)
    return task
  })
}

export async function updateTask(taskId: string, patch: Partial<Pick<ProductionTask, 'title' | 'phase' | 'assignee_id'>>) {
  return write((db) => {
    const t = db.tasks.find((x) => x.id === taskId)
    if (!t) throw notFound('task')
    Object.assign(t, patch)
    return t
  })
}

export async function deleteTask(taskId: string) {
  await write((db) => { db.tasks = db.tasks.filter((t) => t.id !== taskId) })
}

// -------------------------------------------------------------- delivery
export async function getDelivery(projectId: string): Promise<ProjectDelivery | null> {
  return read((db) => db.deliveries.find((d) => d.project_id === projectId) ?? null)
}

export async function saveDelivery(_studioId: string, projectId: string, input: DeliveryInput) {
  return write((db, at) => {
    openProjectOf(db, projectId)
    const existing = db.deliveries.find((d) => d.project_id === projectId)
    const row: ProjectDelivery = {
      project_id: projectId, method: input.method, delivered_on: input.delivered_on || null, link_url: nullable(input.link_url), notes: nullable(input.notes),
      confirmed_at: existing?.confirmed_at ?? null,
    }
    if (existing) Object.assign(existing, row)
    else db.deliveries.push(row)
    logActivity(db, { projectId, entityType: 'delivery', entityId: projectId, action: 'delivery_updated', summary: 'Delivery details updated', at })
    return row
  })
}

// -------------------------------------------------------------- activity
export async function listProjectActivity(projectId: string, limit = 50): Promise<ActivityLog[]> {
  return read((db) => newestFirst(db.activity.filter((a) => a.project_id === projectId)).slice(0, limit))
}

export async function listRecentActivity(_studioId: string, limit = 12): Promise<ActivityWithProject[]> {
  return read((db) =>
    newestFirst(db.activity).slice(0, limit).map((a) => {
      const p = a.project_id ? db.projects.find((x) => x.id === a.project_id) : undefined
      return { ...a, project: p ? { name: p.name } : null }
    }),
  )
}

export async function listEventReminders(eventIds: string[]): Promise<EventReminder[]> {
  if (eventIds.length === 0) return []
  return read((db) => db.reminders.filter((r) => eventIds.includes(r.event_id)).sort((a, b) => a.remind_at.localeCompare(b.remind_at)))
}

// ------------------------------------------------------------------ team
/** Replaces a session's team in one step; reminders follow. */
export async function setEventTeam(eventId: string, team: { employee_id: string; role: AssignmentRole }[]) {
  await write((db, at) => {
    const ev = db.events.find((e) => e.id === eventId)
    if (!ev) throw notFound('session')
    openProjectOf(db, ev.project_id)
    if (ev.cancelled_at) throw raise('invalid_transition: this session is cancelled')
    replaceTeam(db, ev, team, at, ev.project_id)
    syncReminders(db, ev.id, at)
  })
}
