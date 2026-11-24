import { todayKey, zonedDayBounds } from '@/lib/time'
import type {
  ActivityLog, DashboardKpis, EmployeeBrief, EventAssignment, EventEquipment, Project, ProjectEvent, ProjectFinancials, ProjectOverview,
} from '@/types/entities'
import { round2 } from './core'
import type { Db } from './db'
import { logActivity } from './log'

/**
 * Everything the real database computes for the screens - the project_overview and project_financials views, the event
 * joins and the dashboard_kpis function - rebuilt over the in-memory rows with the same rules.
 */

export const activeEventsOf = (db: Db, projectId: string): ProjectEvent[] => db.events.filter((e) => e.project_id === projectId && !e.cancelled_at)

const minOf = (xs: string[]): string | null => (xs.length ? xs.reduce((a, b) => (a < b ? a : b)) : null)
const maxOf = (xs: string[]): string | null => (xs.length ? xs.reduce((a, b) => (a > b ? a : b)) : null)

export function overviewOf(db: Db, p: Project, at: Date): ProjectOverview {
  const client = db.clients.find((c) => c.id === p.client_id)
  const events = activeEventsOf(db, p.id)
  const eventIds = new Set(events.map((e) => e.id))
  const stamp = at.toISOString()
  return {
    ...p,
    client_name: client?.full_name ?? 'Unknown client',
    client_phone: client?.phone ?? null,
    client_email: client?.email ?? null,
    first_event_at: minOf(events.map((e) => e.starts_at)),
    next_event_at: minOf(events.filter((e) => e.ends_at >= stamp).map((e) => e.starts_at)),
    last_event_at: maxOf(events.map((e) => e.ends_at)),
    event_count: events.length,
    assigned_employee_ids: [...new Set(db.assignments.filter((a) => eventIds.has(a.event_id)).map((a) => a.employee_id))],
  }
}

export function financialsOf(db: Db, projectId: string): ProjectFinancials | null {
  const project = db.projects.find((p) => p.id === projectId)
  if (!project) return null
  const fin = db.finances.find((f) => f.project_id === projectId)
  const agreed = fin?.agreed_amount ?? 0
  const paid = round2(db.payments.filter((p) => p.project_id === projectId && p.status === 'valid').reduce((sum, p) => sum + p.amount, 0))
  return {
    project_id: projectId,
    studio_id: project.studio_id,
    agreed_amount: agreed,
    payment_due_date: fin?.payment_due_date ?? null,
    paid_amount: paid,
    balance: round2(agreed - paid),
  }
}

export function briefOf(db: Db, employeeId: string | null | undefined): EmployeeBrief | null {
  const e = employeeId ? db.employees.find((x) => x.id === employeeId) : undefined
  return e ? { id: e.id, full_name: e.full_name, team_role: e.team_role, is_active: e.is_active, phone: e.phone } : null
}

/** An event with its team and equipment joined in, as the screens' select statement returns it. */
export function hydrateEvent(db: Db, ev: ProjectEvent): ProjectEvent {
  const event_assignments: EventAssignment[] = db.assignments
    .filter((a) => a.event_id === ev.id)
    .map((a) => ({ ...a, employee: briefOf(db, a.employee_id) }))
  const event_equipment: EventEquipment[] = db.eventEquipment
    .filter((q) => q.event_id === ev.id)
    .map((q) => {
      const item = q.equipment_id ? db.equipment.find((e) => e.id === q.equipment_id) : undefined
      return {
        ...q,
        equipment: item
          ? { id: item.id, name: item.name, category: item.category, asset_tag: item.asset_tag, quantity_owned: item.quantity_owned, is_active: item.is_active, condition: item.condition }
          : null,
      }
    })
  return { ...ev, event_assignments, event_equipment }
}

/**
 * What the per-minute scheduler (advance_event_lifecycle) does in the real system: a confirmed event starts production
 * at its first session and moves to "waiting for approval" after its last one. Applied each time the data is read, so the
 * sample events keep moving as real time passes.
 */
export function advanceLifecycle(db: Db, at: Date): void {
  const stamp = at.toISOString()
  // The real job runs every minute, so a transition due at T was applied within a minute of T, not whenever someone next looked.
  const ranAt = (due: string): Date => new Date(Math.min(at.getTime(), new Date(due).getTime() + 30_000))
  for (const p of db.projects) {
    if (p.booking_status !== 'confirmed' || p.archived_at || p.production_stage !== 'upcoming' || p.production_start_applied_at) continue
    const first = minOf(activeEventsOf(db, p.id).map((e) => e.starts_at))
    if (!first || first > stamp) continue
    const when = ranAt(first)
    p.production_stage = 'production'
    p.production_started_at = first
    p.production_start_applied_at = when.toISOString()
    p.updated_at = when.toISOString()
    logActivity(db, { projectId: p.id, entityType: 'project', entityId: p.id, action: 'workflow_start_production', summary: 'Production started automatically at the scheduled start', actor: null, at: when, metadata: { stage: 'production', automatic: true, scheduled_for: first } })
  }
  for (const p of db.projects) {
    if (p.booking_status !== 'confirmed' || p.archived_at || p.production_stage !== 'production' || p.production_end_applied_at) continue
    const last = maxOf(activeEventsOf(db, p.id).map((e) => e.ends_at))
    if (!last || last > stamp) continue
    const when = ranAt(last)
    p.production_stage = 'awaiting_approval'
    p.shoot_completed_at ??= last
    p.production_start_applied_at ??= when.toISOString()
    p.production_end_applied_at = when.toISOString()
    p.updated_at = when.toISOString()
    logActivity(db, { projectId: p.id, entityType: 'project', entityId: p.id, action: 'workflow_complete_shoot', summary: 'Production completed automatically at the scheduled end - waiting for client approval', actor: null, at: when, metadata: { stage: 'awaiting_approval', automatic: true, scheduled_for: last } })
  }
}

export function dashboardKpis(db: Db, at: Date): DashboardKpis {
  const tz = db.studio.timezone
  const stamp = at.toISOString()
  const horizon = new Date(at.getTime() + 7 * 86_400_000).toISOString()
  const { start, end } = zonedDayBounds(todayKey(tz, at), tz)
  const open = db.projects.filter((p) => !p.archived_at)
  const notCancelled = open.filter((p) => p.booking_status !== 'cancelled')
  const confirmed = open.filter((p) => p.booking_status === 'confirmed')

  const upcoming = notCancelled.filter((p) => p.production_stage === 'upcoming')
  const stageCounts: DashboardKpis['stage_counts'] = {}
  for (const p of notCancelled) stageCounts[p.production_stage] = (stageCounts[p.production_stage] ?? 0) + 1

  const todayProjects = new Set(
    db.events.filter((e) => !e.cancelled_at && e.starts_at >= start && e.starts_at < end).map((e) => e.project_id).filter((id) => notCancelled.some((p) => p.id === id)),
  )

  let outstanding = 0
  for (const p of confirmed) outstanding += Math.max(financialsOf(db, p.id)?.balance ?? 0, 0)

  return {
    active_projects: confirmed.filter((p) => p.production_stage !== 'delivered').length,
    inquiries: open.filter((p) => p.booking_status === 'inquiry').length,
    upcoming_events: upcoming.filter((p) => activeEventsOf(db, p.id).some((e) => e.starts_at > stamp)).length,
    upcoming_next_7_days: upcoming.filter((p) => {
      const first = minOf(activeEventsOf(db, p.id).map((e) => e.starts_at))
      return first !== null && first >= stamp && first <= horizon
    }).length,
    today_events: todayProjects.size,
    in_production: confirmed.filter((p) => p.production_stage === 'production').length,
    ready_for_delivery: confirmed.filter((p) => p.production_stage === 'out_for_delivery').length,
    pending_delivery: confirmed.filter((p) => p.production_stage === 'editing' || p.production_stage === 'out_for_delivery').length,
    outstanding_amount: round2(outstanding),
    stage_counts: stageCounts,
  }
}

/** Newest first; rows created in the same millisecond keep their insertion order reversed (later = newer). */
export function newestFirst<T extends { created_at: string }>(rows: T[]): T[] {
  return rows.map((row, i) => ({ row, i })).sort((a, b) => (a.row.created_at === b.row.created_at ? b.i - a.i : a.row.created_at < b.row.created_at ? 1 : -1)).map((x) => x.row)
}

export type ActivityWithProject = ActivityLog & { project: { name: string } | null }
