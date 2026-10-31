import type { ProjectDetail } from '@/api/projects'
import { pluralize } from '@/lib/utils'

/** One-line description of who is on the shoot, from the real assignments on the event's sessions. */
export function summarizeTeam(detail: ProjectDetail | null | undefined) {
  const people = new Map<string, { name: string; role: string }>()
  for (const s of detail?.project_events ?? []) {
    if (s.cancelled_at) continue
    for (const a of s.event_assignments ?? []) if (a.employee) people.set(a.employee_id, { name: a.employee.full_name, role: a.role })
  }
  const list = [...people.values()]
  const photographers = list.filter((p) => p.role === 'lead_photographer' || p.role === 'second_photographer').length
  const videographers = list.filter((p) => p.role === 'videographer').length
  const parts = [
    photographers && pluralize(photographers, 'photographer'),
    videographers && pluralize(videographers, 'videographer'),
    list.length - photographers - videographers > 0 && `${list.length - photographers - videographers} other`,
  ].filter(Boolean) as string[]
  return { list, text: parts.length ? parts.join(' · ') : 'Not assigned yet', assigned: list.length > 0 }
}
