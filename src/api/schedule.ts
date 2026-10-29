import { supabase } from '@/lib/supabase'
import type { Equipment, ScheduleEvent } from '@/types/entities'
import { unwrap } from './core'
import { EVENT_SELECT } from './projects'

export interface ScheduleQuery {
  studioId: string
  /** ISO instants; an event is included when it overlaps [from, to]. */
  from: string
  to: string
  includeCancelled?: boolean
}

/**
 * Events (with project, team and equipment) overlapping a window. One query
 * serves the calendar, dashboard, conflict checks, team workload and reports;
 * row level security trims it to what the viewer may see.
 */
export async function listScheduleEvents(q: ScheduleQuery): Promise<ScheduleEvent[]> {
  let query = supabase
    .from('project_events')
    .select(`${EVENT_SELECT}, project:projects!inner(id, name, project_code, booking_status, production_stage, archived_at)`)
    .eq('studio_id', q.studioId)
    .lte('starts_at', q.to)
    .gte('ends_at', q.from)
    .order('starts_at', { ascending: true })
    .limit(1000)
  if (!q.includeCancelled) query = query.is('cancelled_at', null)
  return unwrap(await query) as unknown as ScheduleEvent[]
}

export async function listInventory(studioId: string): Promise<Equipment[]> {
  return unwrap(await supabase.from('equipment').select('*').eq('studio_id', studioId).order('name')) as Equipment[]
}
