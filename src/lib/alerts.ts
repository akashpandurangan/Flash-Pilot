import { describeConflict, findEmployeeConflicts, findEquipmentConflicts, findUnstaffedEvents, isActiveEvent, type Conflict, type ConflictEvent } from './conflicts'
import { formatMoney } from './money'
import { fmtDate, fmtDateOnly, todayKey } from './time'
import type { Equipment, ProjectFinancials, ProjectOverview } from '@/types/entities'

export type ActionKind = 'unstaffed' | 'unpaid' | 'overdue_editing' | 'overdue_delivery' | 'missing_details' | 'equipment_conflict' | 'team_conflict'
export type Severity = 'high' | 'medium' | 'low'

export interface ActionItem {
  id: string
  kind: ActionKind
  severity: Severity
  title: string
  detail: string
  href: string
}

export interface ActionInput {
  events: ConflictEvent[]
  projects: Pick<ProjectOverview, 'id' | 'name' | 'project_code' | 'booking_status' | 'production_stage' | 'archived_at' | 'editing_due_date' | 'delivery_due_date' | 'editing_completed_at'>[]
  /** null when the viewer has no financial access - unpaid items are then omitted. */
  financials: Pick<ProjectFinancials, 'project_id' | 'balance' | 'payment_due_date'>[] | null
  inventory: Pick<Equipment, 'id' | 'name' | 'quantity_owned' | 'is_active' | 'condition'>[]
  tz: string
  currency: string
  now?: Date
}

const severityOrder: Record<Severity, number> = { high: 0, medium: 1, low: 2 }

/** Operational to-do list for the dashboard, derived from live data. */
export function buildActionItems(input: ActionInput): ActionItem[] {
  const now = input.now ?? new Date()
  const today = todayKey(input.tz, now)
  const items: ActionItem[] = []
  const confirmedProjects = input.projects.filter((p) => p.booking_status === 'confirmed' && !p.archived_at)
  const upcoming = input.events.filter((e) => isActiveEvent(e) && new Date(e.endsAt) >= now)

  for (const c of findUnstaffedEvents(upcoming, now)) {
    if (c.kind !== 'unstaffed') continue
    const soon = new Date(c.event.startsAt).getTime() - now.getTime() < 7 * 86_400_000
    items.push({
      id: `unstaffed:${c.event.id}`, kind: 'unstaffed', severity: soon ? 'high' : 'medium',
      title: `No photographer for ${c.event.projectName}`,
      detail: `${c.event.title} · ${fmtDate(c.event.startsAt, input.tz)}`, href: `/events/${c.event.projectId}`,
    })
  }

  if (input.financials) {
    const byProject = new Map(input.financials.map((f) => [f.project_id, f]))
    for (const p of confirmedProjects) {
      const f = byProject.get(p.id)
      if (!f || f.balance <= 0) continue
      const overdue = f.payment_due_date !== null && f.payment_due_date < today
      items.push({
        id: `unpaid:${p.id}`, kind: 'unpaid', severity: overdue ? 'high' : 'low',
        title: `${formatMoney(f.balance, input.currency)} outstanding · ${p.name}`,
        detail: overdue ? `Payment was due ${fmtDateOnly(f.payment_due_date)}` : 'Partially paid or unpaid', href: `/events/${p.id}`,
      })
    }
  }

  for (const p of confirmedProjects) {
    if (p.production_stage === 'delivered') continue
    if (p.editing_due_date && p.editing_due_date < today && !p.editing_completed_at) {
      items.push({ id: `edit:${p.id}`, kind: 'overdue_editing', severity: 'high', title: `Editing overdue · ${p.name}`, detail: `Was due ${fmtDateOnly(p.editing_due_date)}`, href: `/events/${p.id}` })
    }
    if (p.delivery_due_date && p.delivery_due_date < today) {
      items.push({ id: `deliv:${p.id}`, kind: 'overdue_delivery', severity: 'high', title: `Delivery overdue · ${p.name}`, detail: `Was due ${fmtDateOnly(p.delivery_due_date)}`, href: `/events/${p.id}` })
    }
  }

  for (const e of upcoming) {
    if (e.bookingStatus !== 'confirmed') continue
    const missing = [!e.venueName?.trim() && 'venue name', !e.venueAddress?.trim() && 'address'].filter(Boolean)
    if (missing.length) {
      items.push({ id: `details:${e.id}`, kind: 'missing_details', severity: 'low', title: `Missing ${missing.join(' and ')} · ${e.projectName}`, detail: `${e.title} · ${fmtDate(e.startsAt, input.tz)}`, href: `/events/${e.projectId}` })
    }
  }

  const conflicts: Conflict[] = [...findEmployeeConflicts(upcoming), ...findEquipmentConflicts(upcoming, input.inventory)]
  conflicts.forEach((c, i) => {
    const first = c.kind === 'equipment_unavailable' ? c.event : c.kind === 'unstaffed' ? c.event : c.events[0]
    items.push({
      id: `conflict:${i}:${c.kind}`, kind: c.kind === 'employee' ? 'team_conflict' : 'equipment_conflict', severity: 'medium',
      title: c.kind === 'employee' ? `${c.employeeName} is double-booked` : c.kind === 'equipment' ? `${c.equipmentName} is over-committed` : 'Equipment problem',
      detail: describeConflict(c), href: `/events/${first.projectId}`,
    })
  })

  return items.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity])
}
