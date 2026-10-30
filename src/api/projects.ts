import { supabase } from '@/lib/supabase'
import { PAGE_SIZE } from '@/lib/constants'
import type { WorkflowAction } from '@/lib/workflow'
import { escapeLike } from '@/lib/utils'
import type {
  ActivityLog, AssignmentRole, BookingStatus, DeliveryMethod, EmployeeBrief, EventReminder, EventType, Page, ProductionStage,
  ProductionTask, Project, ProjectDelivery, ProjectEvent, ProjectOverview, TaskPhase,
} from '@/types/entities'
import { nullable, unwrap } from './core'

// ------------------------------------------------------------------ list
export type ProjectSort = 'soonest' | 'latest' | 'newest' | 'name'

export interface ProjectFilters {
  studioId: string
  search?: string
  booking?: BookingStatus | ''
  stage?: ProductionStage | ''
  eventType?: EventType | ''
  employeeId?: string
  from?: string // ISO instant
  to?: string
  archived: boolean
  sort: ProjectSort
  page: number
}

export async function listProjects(f: ProjectFilters): Promise<Page<ProjectOverview>> {
  let q = supabase.from('project_overview').select('*', { count: 'exact' }).eq('studio_id', f.studioId)
  q = f.archived ? q.not('archived_at', 'is', null) : q.is('archived_at', null)
  if (f.booking) q = q.eq('booking_status', f.booking)
  if (f.stage) q = q.eq('production_stage', f.stage)
  if (f.stage && !f.booking) q = q.neq('booking_status', 'cancelled')
  if (f.eventType) q = q.eq('event_type', f.eventType)
  if (f.employeeId) q = q.contains('assigned_employee_ids', [f.employeeId])
  if (f.from) q = q.gte('last_event_at', f.from)
  if (f.to) q = q.lte('first_event_at', f.to)
  const term = escapeLike(f.search ?? '')
  if (term) q = q.or(`name.ilike.%${term}%,client_name.ilike.%${term}%,project_code.ilike.%${term}%`)

  switch (f.sort) {
    case 'soonest': q = q.order('next_event_at', { ascending: true, nullsFirst: false }).order('last_event_at', { ascending: false, nullsFirst: false }); break
    case 'latest': q = q.order('first_event_at', { ascending: false, nullsFirst: false }); break
    case 'name': q = q.order('name', { ascending: true }); break
    default: q = q.order('created_at', { ascending: false })
  }
  const from = (f.page - 1) * PAGE_SIZE
  const res = await q.range(from, from + PAGE_SIZE - 1)
  return { rows: unwrap(res) as ProjectOverview[], total: res.count ?? 0 }
}

/** Lightweight list for pickers, alerts and reports (not archived). */
export async function listActiveProjects(studioId: string, limit = 500): Promise<ProjectOverview[]> {
  return unwrap(
    await supabase.from('project_overview').select('*').eq('studio_id', studioId).is('archived_at', null).order('created_at', { ascending: false }).limit(limit),
  ) as ProjectOverview[]
}

// ---------------------------------------------------------------- detail
export const EVENT_SELECT = `*,
  event_assignments(id, event_id, employee_id, role, notes, employee:employees(id, full_name, team_role, is_active, phone)),
  event_equipment(id, event_id, equipment_id, custom_name, quantity, notes, equipment:equipment(id, name, category, asset_tag, quantity_owned, is_active, condition))`

export interface ProjectDetail extends Project {
  project_events: ProjectEvent[]
  editor: EmployeeBrief | null
}

export async function getProject(id: string): Promise<ProjectDetail | null> {
  const res = await supabase
    .from('projects')
    .select(`*, editor:employees(id, full_name, team_role, is_active), project_events(${EVENT_SELECT})`)
    .eq('id', id)
    .maybeSingle()
  const row = unwrap(res) as (ProjectDetail & { editor: EmployeeBrief | EmployeeBrief[] | null }) | null
  if (!row) return null
  const events = [...(row.project_events ?? [])].sort((a, b) => a.starts_at.localeCompare(b.starts_at))
  return { ...row, project_events: events, editor: Array.isArray(row.editor) ? (row.editor[0] ?? null) : row.editor }
}

export async function getProjectOverview(id: string): Promise<ProjectOverview | null> {
  return (unwrap(await supabase.from('project_overview').select('*').eq('id', id).maybeSingle()) as ProjectOverview | null) ?? null
}

// ------------------------------------------------------------------ save
export interface AssignmentPayload {
  employee_id: string
  role: AssignmentRole
  notes?: string | null
}

export interface EquipmentPayload {
  id?: string
  equipment_id: string | null
  custom_name: string | null
  quantity: number
  notes?: string | null
}

export interface EventPayload {
  id?: string
  title: string
  event_type: EventType
  starts_at: string
  ends_at: string
  venue_name: string | null
  venue_address: string | null
  map_url: string | null
  notes: string | null
  sort_order: number
  assignments: AssignmentPayload[]
  equipment: EquipmentPayload[]
}

export interface ProjectPayload {
  project: {
    studio_id: string
    client_id: string
    name: string
    event_type: EventType
    booking_status?: BookingStatus
    description: string | null
    internal_notes: string | null
    editor_id: string | null
    editing_due_date: string | null
    delivery_due_date: string | null
  }
  finance?: { agreed_amount: number; payment_due_date: string | null; payment_notes: string | null }
  initial_payment?: { amount: number; paid_on: string; method: string; reference: string | null; notes: string | null; allow_overpayment: boolean } | null
  events: EventPayload[]
  removed_event_ids?: string[]
}

/** Creates or updates a project and everything under it in one database transaction. */
export async function saveProject(projectId: string | null, payload: ProjectPayload): Promise<string> {
  return unwrap(await supabase.rpc('save_project', { p_project_id: projectId, p_payload: payload })) as string
}

export async function setBookingStatus(projectId: string, status: BookingStatus, reason?: string) {
  return unwrap(await supabase.rpc('set_booking_status', { p_project_id: projectId, p_status: status, p_reason: nullable(reason) })) as Project
}

export async function setProjectArchived(projectId: string, archived: boolean) {
  unwrap(await supabase.rpc('set_project_archived', { p_project_id: projectId, p_archived: archived }))
}

export async function runWorkflowAction(projectId: string, action: WorkflowAction, note?: string) {
  return unwrap(await supabase.rpc('project_workflow_action', { p_project_id: projectId, p_action: action, p_note: nullable(note) })) as Project
}

export async function updateProjectFields(
  projectId: string,
  patch: Partial<Pick<Project, 'editor_id' | 'editing_due_date' | 'delivery_due_date' | 'internal_notes'>>,
) {
  return unwrap(await supabase.from('projects').update(patch).eq('id', projectId).select().single()) as Project
}

export async function cancelEvent(eventId: string) {
  unwrap(await supabase.from('project_events').update({ cancelled_at: new Date().toISOString() }).eq('id', eventId))
}

// ----------------------------------------------------------------- tasks
export async function listTasks(projectId: string): Promise<ProductionTask[]> {
  return unwrap(await supabase.from('production_tasks').select('*').eq('project_id', projectId).order('sort_order').order('created_at')) as ProductionTask[]
}

export async function setTaskDone(taskId: string, done: boolean) {
  return unwrap(await supabase.rpc('set_task_done', { p_task_id: taskId, p_done: done })) as ProductionTask
}

export async function addTask(studioId: string, projectId: string, title: string, phase: TaskPhase, sortOrder: number) {
  return unwrap(
    await supabase.from('production_tasks').insert({ studio_id: studioId, project_id: projectId, title: title.trim(), phase, sort_order: sortOrder }).select().single(),
  ) as ProductionTask
}

export async function updateTask(taskId: string, patch: Partial<Pick<ProductionTask, 'title' | 'phase' | 'assignee_id'>>) {
  return unwrap(await supabase.from('production_tasks').update(patch).eq('id', taskId).select().single()) as ProductionTask
}

export async function deleteTask(taskId: string) {
  unwrap(await supabase.from('production_tasks').delete().eq('id', taskId))
}

// -------------------------------------------------------------- delivery
export async function getDelivery(projectId: string): Promise<ProjectDelivery | null> {
  return (unwrap(await supabase.from('project_deliveries').select('*').eq('project_id', projectId).maybeSingle()) as ProjectDelivery | null) ?? null
}

export interface DeliveryInput {
  method: DeliveryMethod
  delivered_on: string
  link_url?: string
  notes?: string
}

export async function saveDelivery(studioId: string, projectId: string, input: DeliveryInput) {
  return unwrap(
    await supabase
      .from('project_deliveries')
      .upsert(
        { project_id: projectId, studio_id: studioId, method: input.method, delivered_on: input.delivered_on || null, link_url: nullable(input.link_url), notes: nullable(input.notes) },
        { onConflict: 'project_id' },
      )
      .select()
      .single(),
  ) as ProjectDelivery
}

// -------------------------------------------------------------- activity
export async function listProjectActivity(projectId: string, limit = 50): Promise<ActivityLog[]> {
  return unwrap(await supabase.from('activity_logs').select('*').eq('project_id', projectId).order('created_at', { ascending: false }).limit(limit)) as ActivityLog[]
}

export async function listRecentActivity(studioId: string, limit = 12): Promise<(ActivityLog & { project: { name: string } | null })[]> {
  return unwrap(
    await supabase.from('activity_logs').select('*, project:projects(name)').eq('studio_id', studioId).order('created_at', { ascending: false }).limit(limit),
  ) as (ActivityLog & { project: { name: string } | null })[]
}

export async function listEventReminders(eventIds: string[]): Promise<EventReminder[]> {
  if (eventIds.length === 0) return []
  return unwrap(await supabase.from('event_reminders').select('*').in('event_id', eventIds).order('remind_at')) as EventReminder[]
}

// ------------------------------------------------------------------ team
/** Replaces an event's team in one transaction; reminders and notifications follow via triggers. */
export async function setEventTeam(eventId: string, team: { employee_id: string; role: AssignmentRole }[]) {
  unwrap(await supabase.rpc('set_event_team', { p_event_id: eventId, p_team: team }))
}
