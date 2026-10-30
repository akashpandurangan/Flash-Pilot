import type { Project, ProjectFinancials } from '@/types/entities'

export interface ClientStat {
  /** Events still on the books - cancelled bookings don't count. */
  events: number
  /** Money still owed across those events. Credit on one event never offsets a balance on another. */
  outstanding: number
}

/**
 * Per-client totals for the clients list, from the events and (when the viewer may see money) the financials
 * the app has already loaded. Pass `financials: null` for viewers without finance access: outstanding stays 0
 * and the page should not show it.
 */
export function clientStats(
  projects: Pick<Project, 'id' | 'client_id' | 'booking_status'>[],
  financials: Pick<ProjectFinancials, 'project_id' | 'balance'>[] | null,
): Map<string, ClientStat> {
  const stats = new Map<string, ClientStat>()
  const owner = new Map<string, string>()
  for (const p of projects) {
    if (p.booking_status === 'cancelled') continue
    owner.set(p.id, p.client_id)
    const s = stats.get(p.client_id) ?? { events: 0, outstanding: 0 }
    s.events += 1
    stats.set(p.client_id, s)
  }
  for (const f of financials ?? []) {
    const client = owner.get(f.project_id)
    const balance = Number(f.balance)
    if (client && balance > 0) stats.get(client)!.outstanding += balance
  }
  return stats
}
