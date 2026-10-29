import { PHOTOGRAPHER_ROLES } from './constants'
import type { AssignmentRole, BookingStatus, Equipment } from '@/types/entities'

/**
 * Scheduling conflict detection. Pure functions over a list of events so the same
 * logic serves the project form (draft vs. saved), the calendar, the equipment
 * page and the dashboard. Conflicts are warnings - never blockers.
 *
 * Cancelled events, cancelled bookings and archived projects release their
 * people and equipment automatically (they are filtered out here), while the
 * rows themselves stay in the database as history.
 */

export interface ConflictEvent {
  id: string
  projectId: string
  projectName: string
  title: string
  startsAt: string
  endsAt: string
  bookingStatus: BookingStatus
  cancelled: boolean
  archived: boolean
  venueName?: string | null
  venueAddress?: string | null
  assignments: { employeeId: string; employeeName: string; role: AssignmentRole }[]
  equipment: { equipmentId: string | null; customName: string | null; quantity: number }[]
}

export type Conflict =
  | { kind: 'employee'; employeeId: string; employeeName: string; events: [ConflictEvent, ConflictEvent] }
  | { kind: 'equipment'; equipmentId: string; equipmentName: string; owned: number; needed: number; events: ConflictEvent[] }
  | { kind: 'equipment_unavailable'; equipmentId: string; equipmentName: string; reason: string; event: ConflictEvent }
  | { kind: 'overlap'; events: [ConflictEvent, ConflictEvent] }
  | { kind: 'unstaffed'; event: ConflictEvent }

export const overlaps = (aStart: string, aEnd: string, bStart: string, bEnd: string) =>
  new Date(aStart).getTime() < new Date(bEnd).getTime() && new Date(bStart).getTime() < new Date(aEnd).getTime()

export const isActiveEvent = (e: ConflictEvent) => !e.cancelled && !e.archived && e.bookingStatus !== 'cancelled'

const pairs = <T,>(items: T[]): [T, T][] => {
  const out: [T, T][] = []
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) out.push([items[i]!, items[j]!])
  return out
}

/** The same person booked on two overlapping events. */
export function findEmployeeConflicts(events: ConflictEvent[]): Conflict[] {
  const active = events.filter(isActiveEvent)
  const byEmployee = new Map<string, { name: string; events: ConflictEvent[] }>()
  for (const e of active) {
    for (const a of e.assignments) {
      const entry = byEmployee.get(a.employeeId) ?? { name: a.employeeName, events: [] }
      entry.events.push(e)
      byEmployee.set(a.employeeId, entry)
    }
  }
  const out: Conflict[] = []
  for (const [employeeId, { name, events: list }] of byEmployee) {
    for (const [a, b] of pairs(list)) {
      if (overlaps(a.startsAt, a.endsAt, b.startsAt, b.endsAt)) out.push({ kind: 'employee', employeeId, employeeName: name, events: [a, b] })
    }
  }
  return out
}

/**
 * Equipment is over-committed when, at any moment, overlapping events together
 * need more units than the studio owns. A uniquely tagged asset owns one unit,
 * so two overlapping events can never both hold it.
 */
export function findEquipmentConflicts(events: ConflictEvent[], inventory: Pick<Equipment, 'id' | 'name' | 'quantity_owned' | 'is_active' | 'condition'>[]): Conflict[] {
  const active = events.filter(isActiveEvent)
  const items = new Map(inventory.map((i) => [i.id, i]))
  const out: Conflict[] = []

  const byItem = new Map<string, { event: ConflictEvent; qty: number }[]>()
  for (const e of active) {
    for (const r of e.equipment) {
      if (!r.equipmentId) continue
      const list = byItem.get(r.equipmentId) ?? []
      list.push({ event: e, qty: r.quantity })
      byItem.set(r.equipmentId, list)
    }
  }

  for (const [equipmentId, uses] of byItem) {
    const item = items.get(equipmentId)
    if (!item) continue
    const peak = { needed: 0, group: [] as ConflictEvent[] }
    for (const u of uses) {
      const concurrent = uses.filter((o) => overlaps(u.event.startsAt, u.event.endsAt, o.event.startsAt, o.event.endsAt))
      const needed = concurrent.reduce((s, o) => s + o.qty, 0)
      if (needed > peak.needed) {
        peak.needed = needed
        peak.group = concurrent.map((c) => c.event)
      }
    }
    if (peak.needed > item.quantity_owned && peak.group.length > 0) {
      out.push({ kind: 'equipment', equipmentId, equipmentName: item.name, owned: item.quantity_owned, needed: peak.needed, events: peak.group })
    }
    for (const u of uses) {
      if (!item.is_active) out.push({ kind: 'equipment_unavailable', equipmentId, equipmentName: item.name, reason: 'is retired from the inventory', event: u.event })
      else if (item.condition === 'out_of_service' || item.condition === 'needs_repair')
        out.push({ kind: 'equipment_unavailable', equipmentId, equipmentName: item.name, reason: item.condition === 'out_of_service' ? 'is out of service' : 'needs repair', event: u.event })
    }
  }
  return out
}

/** Informational: two confirmed events happening at the same time. */
export function findOverlappingEvents(events: ConflictEvent[]): Conflict[] {
  const active = events.filter((e) => isActiveEvent(e) && e.bookingStatus === 'confirmed')
  return pairs(active)
    .filter(([a, b]) => a.projectId !== b.projectId && overlaps(a.startsAt, a.endsAt, b.startsAt, b.endsAt))
    .map(([a, b]) => ({ kind: 'overlap' as const, events: [a, b] as [ConflictEvent, ConflictEvent] }))
}

/** Active events with nobody on the photography side. */
export function findUnstaffedEvents(events: ConflictEvent[], now: Date = new Date()): Conflict[] {
  return events
    .filter((e) => isActiveEvent(e) && new Date(e.endsAt).getTime() >= now.getTime())
    .filter((e) => !e.assignments.some((a) => PHOTOGRAPHER_ROLES.includes(a.role)))
    .map((event) => ({ kind: 'unstaffed' as const, event }))
}

export function findAllConflicts(events: ConflictEvent[], inventory: Pick<Equipment, 'id' | 'name' | 'quantity_owned' | 'is_active' | 'condition'>[], now: Date = new Date()): Conflict[] {
  return [
    ...findEmployeeConflicts(events),
    ...findEquipmentConflicts(events, inventory),
    ...findOverlappingEvents(events),
    ...findUnstaffedEvents(events, now),
  ]
}

/** Keep only conflicts that involve at least one of `ids` (e.g. the events being edited). */
export function conflictsInvolving(conflicts: Conflict[], ids: Set<string>): Conflict[] {
  return conflicts.filter((c) => {
    switch (c.kind) {
      case 'employee':
      case 'overlap': return c.events.some((e) => ids.has(e.id))
      case 'equipment': return c.events.some((e) => ids.has(e.id))
      case 'equipment_unavailable':
      case 'unstaffed': return ids.has(c.event.id)
    }
  })
}

export function describeConflict(c: Conflict): string {
  switch (c.kind) {
    case 'employee':
      return `${c.employeeName} is booked on “${c.events[0].title}” (${c.events[0].projectName}) and “${c.events[1].title}” (${c.events[1].projectName}) at overlapping times.`
    case 'equipment':
      return `${c.equipmentName}: ${c.needed} needed at the same time but only ${c.owned} owned (${c.events.map((e) => e.projectName).join(', ')}).`
    case 'equipment_unavailable':
      return `${c.equipmentName} ${c.reason} but is reserved for “${c.event.title}” (${c.event.projectName}).`
    case 'overlap':
      return `“${c.events[0].title}” (${c.events[0].projectName}) overlaps “${c.events[1].title}” (${c.events[1].projectName}).`
    case 'unstaffed':
      return `“${c.event.title}” (${c.event.projectName}) has no photographer assigned.`
  }
}
