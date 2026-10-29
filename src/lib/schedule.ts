import type { ConflictEvent } from './conflicts'
import type { ScheduleEvent } from '@/types/entities'

/** Adapts a database event (with its project, team and equipment) to the shape the conflict checks use. */
export function toConflictEvent(e: ScheduleEvent): ConflictEvent {
  return {
    id: e.id,
    projectId: e.project_id,
    projectName: e.project.name,
    title: e.title,
    startsAt: e.starts_at,
    endsAt: e.ends_at,
    bookingStatus: e.project.booking_status,
    cancelled: e.cancelled_at !== null,
    archived: e.project.archived_at !== null,
    venueName: e.venue_name,
    venueAddress: e.venue_address,
    assignments: (e.event_assignments ?? []).map((a) => ({
      employeeId: a.employee_id,
      employeeName: a.employee?.full_name ?? 'Team member',
      role: a.role,
    })),
    equipment: (e.event_equipment ?? []).map((r) => ({ equipmentId: r.equipment_id, customName: r.custom_name, quantity: r.quantity })),
  }
}

/** Events that still matter for scheduling (not cancelled / archived). */
export const isLive = (e: ScheduleEvent) =>
  e.cancelled_at === null && e.project.archived_at === null && e.project.booking_status !== 'cancelled'
