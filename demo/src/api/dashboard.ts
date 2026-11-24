import type { Client, DashboardKpis, Employee, ProjectOverview } from '@/types/entities'
import { read } from '../store/access'
import { includesText } from '../store/core'
import { dashboardKpis, overviewOf } from '../store/views'

export async function getDashboardKpis(_studioId: string): Promise<DashboardKpis> {
  return read((db, at) => dashboardKpis(db, at))
}

export interface SearchResults {
  projects: Pick<ProjectOverview, 'id' | 'name' | 'project_code' | 'client_name' | 'booking_status'>[]
  clients: Pick<Client, 'id' | 'full_name' | 'phone' | 'email'>[]
  employees: Pick<Employee, 'id' | 'full_name' | 'team_role' | 'is_active'>[]
}

/** Global search: up to six matches per source, two characters minimum - the same limits as the real query. */
export async function globalSearch(studioId: string, rawTerm: string, canSeeClients: boolean, canSeeTeam: boolean): Promise<SearchResults> {
  const term = rawTerm.trim()
  if (term.length < 2) return { projects: [], clients: [], employees: [] }
  return read((db, at) => ({
    projects: db.projects
      .filter((p) => p.studio_id === studioId)
      .map((p) => overviewOf(db, p, at))
      .filter((p) => includesText([p.name, p.client_name, p.project_code], term))
      .slice(0, 6)
      .map(({ id, name, project_code, client_name, booking_status }) => ({ id, name, project_code, client_name, booking_status })),
    clients: canSeeClients
      ? db.clients
          .filter((c) => c.studio_id === studioId && !c.archived_at && includesText([c.full_name, c.phone, c.email], term))
          .slice(0, 6)
          .map(({ id, full_name, phone, email }) => ({ id, full_name, phone, email }))
      : [],
    employees: canSeeTeam
      ? db.employees
          .filter((e) => e.studio_id === studioId && includesText([e.full_name], term))
          .slice(0, 6)
          .map(({ id, full_name, team_role, is_active }) => ({ id, full_name, team_role, is_active }))
      : [],
  }))
}
