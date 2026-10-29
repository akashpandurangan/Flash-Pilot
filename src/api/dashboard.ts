import { supabase } from '@/lib/supabase'
import { escapeLike } from '@/lib/utils'
import type { Client, DashboardKpis, Employee, ProjectOverview } from '@/types/entities'
import { unwrap } from './core'

export async function getDashboardKpis(studioId: string): Promise<DashboardKpis> {
  const k = unwrap(await supabase.rpc('dashboard_kpis', { p_studio: studioId })) as DashboardKpis
  return {
    ...k,
    active_projects: Number(k.active_projects), inquiries: Number(k.inquiries), upcoming_events: Number(k.upcoming_events),
    today_events: Number(k.today_events), in_production: Number(k.in_production), pending_delivery: Number(k.pending_delivery),
    outstanding_amount: k.outstanding_amount === null ? null : Number(k.outstanding_amount),
  }
}

export interface SearchResults {
  projects: Pick<ProjectOverview, 'id' | 'name' | 'project_code' | 'client_name' | 'booking_status'>[]
  clients: Pick<Client, 'id' | 'full_name' | 'phone' | 'email'>[]
  employees: Pick<Employee, 'id' | 'full_name' | 'team_role' | 'is_active'>[]
}

/** Global search. Each source is trimmed by row level security (crew find only their own projects). */
export async function globalSearch(studioId: string, rawTerm: string, canSeeClients: boolean, canSeeTeam: boolean): Promise<SearchResults> {
  const term = escapeLike(rawTerm)
  if (term.length < 2) return { projects: [], clients: [], employees: [] }
  const [projects, clients, employees] = await Promise.all([
    supabase.from('project_overview').select('id, name, project_code, client_name, booking_status').eq('studio_id', studioId)
      .or(`name.ilike.%${term}%,client_name.ilike.%${term}%,project_code.ilike.%${term}%`).limit(6),
    canSeeClients
      ? supabase.from('clients').select('id, full_name, phone, email').eq('studio_id', studioId)
          .or(`full_name.ilike.%${term}%,phone.ilike.%${term}%,email.ilike.%${term}%`).is('archived_at', null).limit(6)
      : Promise.resolve({ data: [], error: null }),
    canSeeTeam
      ? supabase.from('employees').select('id, full_name, team_role, is_active').eq('studio_id', studioId).ilike('full_name', `%${term}%`).limit(6)
      : Promise.resolve({ data: [], error: null }),
  ])
  return {
    projects: unwrap(projects) as SearchResults['projects'],
    clients: unwrap(clients) as SearchResults['clients'],
    employees: unwrap(employees) as SearchResults['employees'],
  }
}
