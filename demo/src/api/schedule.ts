import type { Equipment, ScheduleEvent } from '@/types/entities'
import { read } from '../store/access'
import { hydrateEvent } from '../store/views'

export interface ScheduleQuery {
  studioId: string
  /** ISO instants; an event is included when it overlaps [from, to]. */
  from: string
  to: string
  includeCancelled?: boolean
}

/** Events (with project, team and equipment) overlapping a window - one query serves calendar, dashboard, conflicts and reports. */
export async function listScheduleEvents(q: ScheduleQuery): Promise<ScheduleEvent[]> {
  return read((db) => {
    const from = new Date(q.from).toISOString()
    const to = new Date(q.to).toISOString()
    const out: ScheduleEvent[] = []
    for (const ev of db.events) {
      if (ev.studio_id !== q.studioId || ev.starts_at > to || ev.ends_at < from) continue
      if (!q.includeCancelled && ev.cancelled_at) continue
      const project = db.projects.find((p) => p.id === ev.project_id)
      if (!project) continue
      const client = db.clients.find((c) => c.id === project.client_id)
      out.push({
        ...hydrateEvent(db, ev),
        project: {
          id: project.id, name: project.name, project_code: project.project_code, booking_status: project.booking_status,
          production_stage: project.production_stage, archived_at: project.archived_at, client_name: client?.full_name ?? null,
        },
      })
    }
    return out.sort((a, b) => a.starts_at.localeCompare(b.starts_at)).slice(0, 1000)
  })
}

export async function listInventory(_studioId: string): Promise<Equipment[]> {
  return read((db) => [...db.equipment].sort((a, b) => a.name.localeCompare(b.name)))
}
