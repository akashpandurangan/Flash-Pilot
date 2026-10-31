import { effectiveStage, isLive, type LifecycleSubject } from './lifecycle'
import { fromMinor, summarizeFinancials, toMinor } from './money'
import type { ProjectFinancials, ProjectOverview } from '@/types/entities'

/**
 * "Pending amount": what the studio still has to collect. One definition, used by the dashboard card and the
 * Payments page, so the two can never disagree.
 *
 *   per event:  balance = agreed amount − valid payments           (the `project_financials` view; void payments
 *                                                                   are excluded there, each payment is one row)
 *   total:      Σ balance of events that are confirmed and not archived, counting only balances above zero
 *
 * That is the rule the app already uses for "Outstanding" (Payments, Reports, the dashboard RPC, the attention
 * list). Cancelled events and inquiries are not owed anything yet; an overpaid event owes nothing but never
 * cancels out what another event owes. Nothing is stored: it is recomputed from the payment records every time.
 */

type PendingProject = Pick<ProjectOverview, 'id' | 'booking_status' | 'archived_at'>
type PendingFinancials = Pick<ProjectFinancials, 'project_id' | 'agreed_amount' | 'paid_amount'>

/** What is still owed on one event, from its finance row: agreed amount − valid payments, never below zero (an overpayment owes nothing). */
export const outstandingBalance = (f: Pick<ProjectFinancials, 'agreed_amount' | 'paid_amount'>): number =>
  summarizeFinancials(f.agreed_amount, [{ amount: f.paid_amount }]).balance

export const isPendingEligible = (p: Pick<ProjectOverview, 'booking_status' | 'archived_at'>) => p.booking_status === 'confirmed' && !p.archived_at

export interface PendingSummary {
  /** Total still to collect, in major units (e.g. rupees). */
  total: number
  /** Events with a balance above zero. */
  count: number
  events: { projectId: string; balance: number }[]
}

export function pendingAmount(projects: PendingProject[], financials: PendingFinancials[]): PendingSummary {
  // keyed by event: an event can contribute once, however the lists were fetched
  const finance = new Map(financials.map((f) => [f.project_id, f]))
  const seen = new Set<string>()
  const events: PendingSummary['events'] = []
  let totalMinor = 0
  for (const p of projects) {
    if (seen.has(p.id) || !isPendingEligible(p)) continue
    seen.add(p.id)
    const f = finance.get(p.id)
    if (!f) continue
    const minor = toMinor(outstandingBalance(f)) // already clamped at 0
    if (minor <= 0) continue
    totalMinor += minor // integer paise: no floating-point drift however many events there are
    events.push({ projectId: p.id, balance: fromMinor(minor) })
  }
  return { total: fromMinor(totalMinor), count: events.length, events }
}

/**
 * The delivery-payment alert rule, in one place (the event card badge and the Needs attention list both use it):
 * an event needs attention when it is Out for Delivery, not cancelled, not archived and still owes money. Returns the
 * amount owed, or null when the rule does not apply. Events at any other stage are never flagged by this rule just
 * because they have a balance; that overall figure is the Pending amount card.
 */
export function deliveryPaymentDue(
  p: LifecycleSubject, f: Pick<ProjectFinancials, 'agreed_amount' | 'paid_amount'> | null | undefined, now: Date = new Date(),
): number | null {
  if (!f || !isLive(p) || effectiveStage(p, now) !== 'out_for_delivery') return null
  const balance = outstandingBalance(f)
  return toMinor(balance) > 0 ? balance : null
}
