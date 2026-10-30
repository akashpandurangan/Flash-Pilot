import { describeConflict, findEmployeeConflicts, findEquipmentConflicts, findUnstaffedEvents, isActiveEvent, type Conflict, type ConflictEvent } from './conflicts'
import { formatMoney } from './money'
import { fmtDate, fmtDateOnly, todayKey } from './time'
import type { Equipment, ProjectFinancials, ProjectOverview } from '@/types/entities'

export type ActionKind =
  | 'unstaffed' | 'unpaid' | 'overdue_editing' | 'overdue_delivery' | 'missing_details' | 'equipment_conflict' | 'team_conflict' | 'no_equipment'
export type Severity = 'high' | 'medium' | 'low'

export interface ActionItem {
  id: string
  kind: ActionKind
  severity: Severity
  /** One-line summary, e.g. "No photographer for Sharma–Rao Wedding". */
  title: string
  detail: string
  href: string
  /** Event the problem belongs to - used by the "Needs attention" table. */
  projectId: string
  projectName: string
  clientName: string | null
  /** The event's next (or first) session, ISO. */
  date: string | null
  /** Short label for the Issue column, e.g. "Team not assigned". */
  issue: string
  /** Label of the button that opens the fix, e.g. "Assign team". */
  actionLabel: string
}

type ProjectLike = Pick<ProjectOverview, 'id' | 'name' | 'project_code' | 'booking_status' | 'production_stage' | 'archived_at' | 'editing_due_date' | 'delivery_due_date' | 'editing_completed_at'>
  & Partial<Pick<ProjectOverview, 'client_name' | 'next_event_at' | 'first_event_at'>>

export interface ActionInput {
  events: ConflictEvent[]
  projects: ProjectLike[]
  /** null when the viewer has no financial access - unpaid items are then omitted. */
  financials: Pick<ProjectFinancials, 'project_id' | 'balance' | 'payment_due_date'>[] | null
  inventory: Pick<Equipment, 'id' | 'name' | 'quantity_owned' | 'is_active' | 'condition'>[]
  tz: string
  currency: string
  now?: Date
}

const severityOrder: Record<Severity, number> = { high: 0, medium: 1, low: 2 }
export const SEVERITY_LABELS: Record<Severity, string> = { high: 'High', medium: 'Medium', low: 'Low' }

/** Issue + button wording per kind, kept in one place so the table, insights and tests agree. */
const KIND_COPY: Record<ActionKind, { issue: string; action: string }> = {
  unstaffed: { issue: 'Team not assigned', action: 'Assign team' },
  unpaid: { issue: 'Balance payment pending', action: 'Record payment' },
  overdue_editing: { issue: 'Editing overdue', action: 'Update editing' },
  overdue_delivery: { issue: 'Delivery overdue', action: 'Deliver' },
  missing_details: { issue: 'Venue details missing', action: 'Add details' },
  equipment_conflict: { issue: 'Equipment conflict', action: 'Resolve' },
  team_conflict: { issue: 'Photographer double-booked', action: 'Resolve' },
  no_equipment: { issue: 'Equipment not reserved', action: 'Reserve gear' },
}

/** Operational to-do list for the dashboard, derived from live data. */
export function buildActionItems(input: ActionInput): ActionItem[] {
  const now = input.now ?? new Date()
  const today = todayKey(input.tz, now)
  const byProject = new Map(input.projects.map((p) => [p.id, p]))
  const confirmedProjects = input.projects.filter((p) => p.booking_status === 'confirmed' && !p.archived_at)
  const upcoming = input.events.filter((e) => isActiveEvent(e) && new Date(e.endsAt) >= now)
  const items: ActionItem[] = []

  const add = (
    kind: ActionKind, severity: Severity, projectId: string, fallbackName: string, title: string, detail: string, fallbackDate: string | null = null,
  ) => {
    const p = byProject.get(projectId)
    items.push({
      id: `${kind}:${projectId}:${items.length}`, kind, severity, title, detail, href: `/events/${projectId}`,
      projectId, projectName: p?.name ?? fallbackName, clientName: p?.client_name ?? null,
      date: p?.next_event_at ?? p?.first_event_at ?? fallbackDate,
      issue: KIND_COPY[kind].issue, actionLabel: KIND_COPY[kind].action,
    })
  }

  for (const c of findUnstaffedEvents(upcoming, now)) {
    if (c.kind !== 'unstaffed') continue
    const soon = new Date(c.event.startsAt).getTime() - now.getTime() < 7 * 86_400_000
    add('unstaffed', soon ? 'high' : 'medium', c.event.projectId, c.event.projectName, `No photographer for ${c.event.projectName}`,
      `${c.event.title} · ${fmtDate(c.event.startsAt, input.tz)}`, c.event.startsAt)
  }

  if (input.financials) {
    const finance = new Map(input.financials.map((f) => [f.project_id, f]))
    for (const p of confirmedProjects) {
      const f = finance.get(p.id)
      if (!f || f.balance <= 0) continue
      const overdue = f.payment_due_date !== null && f.payment_due_date < today
      add('unpaid', overdue ? 'high' : 'low', p.id, p.name, `${formatMoney(f.balance, input.currency)} outstanding · ${p.name}`,
        overdue ? `Payment was due ${fmtDateOnly(f.payment_due_date)}` : 'Partially paid or unpaid')
    }
  }

  for (const p of confirmedProjects) {
    if (p.production_stage === 'delivered') continue
    if (p.editing_due_date && p.editing_due_date < today && !p.editing_completed_at) {
      add('overdue_editing', 'high', p.id, p.name, `Editing overdue · ${p.name}`, `Was due ${fmtDateOnly(p.editing_due_date)}`)
    }
    if (p.delivery_due_date && p.delivery_due_date < today) {
      add('overdue_delivery', 'high', p.id, p.name, `Delivery overdue · ${p.name}`, `Was due ${fmtDateOnly(p.delivery_due_date)}`)
    }
  }

  for (const e of upcoming) {
    if (e.bookingStatus !== 'confirmed') continue
    const missing = [!e.venueName?.trim() && 'venue name', !e.venueAddress?.trim() && 'address'].filter(Boolean)
    if (missing.length) {
      add('missing_details', 'low', e.projectId, e.projectName, `Missing ${missing.join(' and ')} · ${e.projectName}`, `${e.title} · ${fmtDate(e.startsAt, input.tz)}`, e.startsAt)
    }
    // Only meaningful for studios that actually track equipment, and only when the shoot is close.
    const closeBy = new Date(e.startsAt).getTime() - now.getTime() < 7 * 86_400_000
    if (input.inventory.length > 0 && closeBy && e.equipment.length === 0) {
      add('no_equipment', 'low', e.projectId, e.projectName, `No equipment reserved · ${e.projectName}`, `${e.title} · ${fmtDate(e.startsAt, input.tz)}`, e.startsAt)
    }
  }

  const conflicts: Conflict[] = [...findEmployeeConflicts(upcoming), ...findEquipmentConflicts(upcoming, input.inventory)]
  for (const c of conflicts) {
    const first = c.kind === 'equipment_unavailable' || c.kind === 'unstaffed' ? c.event : c.events[0]
    add(
      c.kind === 'employee' ? 'team_conflict' : 'equipment_conflict', 'medium', first.projectId, first.projectName,
      c.kind === 'employee' ? `${c.employeeName} is double-booked` : c.kind === 'equipment' ? `${c.equipmentName} is over-committed` : 'Equipment problem',
      describeConflict(c), first.startsAt,
    )
  }

  // One row per (problem type, event): an event with three unstaffed sessions is still one thing to fix.
  const seen = new Set<string>()
  return items
    .sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity])
    .filter((i) => {
      if (i.kind === 'team_conflict' || i.kind === 'equipment_conflict') return true
      const key = `${i.kind}:${i.projectId}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

/** Number of distinct events that have at least one open issue. */
export function countAttentionEvents(items: ActionItem[]): number {
  return new Set(items.map((i) => i.projectId)).size
}
