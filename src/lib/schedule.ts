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

/**
 * Venue to show for each event in a list: the venue of its next upcoming session, otherwise its
 * earliest one. Sessions without a venue are skipped so a blank one never hides a real one.
 */
export function venueByEvent(sessions: Pick<ScheduleEvent, 'project_id' | 'starts_at' | 'ends_at' | 'venue_name' | 'venue_address' | 'cancelled_at'>[], now: Date = new Date()): Map<string, string> {
  const ordered = sessions
    .filter((s) => !s.cancelled_at && (s.venue_name?.trim() || s.venue_address?.trim()))
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
  const out = new Map<string, string>()
  const fromUpcoming = new Set<string>()
  for (const s of ordered) {
    const label = (s.venue_name?.trim() || s.venue_address!.trim())
    const upcoming = new Date(s.ends_at).getTime() >= now.getTime()
    if (upcoming && !fromUpcoming.has(s.project_id)) {
      out.set(s.project_id, label) // the first upcoming session wins
      fromUpcoming.add(s.project_id)
    } else if (!out.has(s.project_id)) {
      out.set(s.project_id, label) // otherwise the earliest session
    }
  }
  return out
}

/** Events that still matter for scheduling (not cancelled / archived). */
export const isLive = (e: ScheduleEvent) =>
  e.cancelled_at === null && e.project.archived_at === null && e.project.booking_status !== 'cancelled'
