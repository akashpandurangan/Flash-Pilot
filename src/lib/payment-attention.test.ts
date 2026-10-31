import { describe, expect, it } from 'vitest'
import { buildActionItems, countAttentionEvents } from './alerts'
import { buildInsights } from './dashboard'
import { deliveryPaymentDue, pendingAmount } from './pending'

/**
 * The delivery-payment attention rule: an event needs attention when it is Out for Delivery, not cancelled, not archived,
 * and its calculated balance (agreed − valid payments) is above zero. Nothing else is flagged just for owing money.
 */

const NOW = new Date('2030-06-01T08:00:00Z')
const iso = (days: number) => new Date(NOW.getTime() + days * 86_400_000).toISOString()

type Case = { stage: 'upcoming' | 'production' | 'awaiting_approval' | 'editing' | 'out_for_delivery' | 'delivered'; booking?: 'confirmed' | 'inquiry' | 'cancelled'; archived?: boolean }
const project = (id: string, c: Case) => ({
  id, name: `SN Wedding ${id}`, project_code: `FP-${id}`, client_name: 'Client', booking_status: c.booking ?? 'confirmed', production_stage: c.stage,
  archived_at: c.archived ? iso(-1) : null, editing_due_date: null, delivery_due_date: null, editing_completed_at: null,
  // sessions long over, so what is stored is what is shown (see lifecycle.ts)
  first_event_at: iso(-40), last_event_at: iso(-39), next_event_at: null, production_start_applied_at: iso(-40), production_end_applied_at: iso(-39),
})
const money = (id: string, agreed: number, paid: number) => ({ project_id: id, agreed_amount: agreed, paid_amount: paid })
const run = (cases: Record<string, Case>, finance: ReturnType<typeof money>[], viewerCanSeeMoney = true) =>
  buildActionItems({ events: [], projects: Object.entries(cases).map(([id, c]) => project(id, c)), financials: viewerCanSeeMoney ? finance : null, inventory: [], tz: 'Asia/Kolkata', currency: 'INR', now: NOW })
    .filter((i) => i.kind === 'delivery_payment')

describe('payment attention for events that are out for delivery', () => {
  it('1. out for delivery and fully paid: no alert', () => {
    expect(run({ a: { stage: 'out_for_delivery' } }, [money('a', 50000, 50000)])).toEqual([])
  })

  it('2. out for delivery with a partial payment: an alert for the amount still owed (the SN Wedding example)', () => {
    const [item] = run({ a: { stage: 'out_for_delivery' } }, [money('a', 50000, 35000)])
    expect(item).toMatchObject({ kind: 'delivery_payment', severity: 'high', amount: 15000, issue: 'Payment pending — ₹15,000 outstanding', projectId: 'a', href: '/events/a?tab=payments' })
    expect(item!.title).toBe('Payment pending — ₹15,000 outstanding · SN Wedding a')
  })

  it('3. out for delivery with no payment at all: an alert for the whole amount', () => {
    expect(run({ a: { stage: 'out_for_delivery' } }, [money('a', 50000, 0)])[0]).toMatchObject({ amount: 50000 })
  })

  it('4. editing with a partial payment: no delivery-payment alert', () => {
    expect(run({ a: { stage: 'editing' } }, [money('a', 50000, 35000)])).toEqual([])
  })

  it('5. delivered with a partial payment: not flagged under this rule', () => {
    expect(run({ a: { stage: 'delivered' } }, [money('a', 50000, 35000)])).toEqual([])
  })

  it('6. a cancelled event: no alert', () => {
    expect(run({ a: { stage: 'out_for_delivery', booking: 'cancelled' } }, [money('a', 50000, 0)])).toEqual([])
  })

  it('7. an archived event: no alert', () => {
    expect(run({ a: { stage: 'out_for_delivery', archived: true } }, [money('a', 50000, 0)])).toEqual([])
  })

  it('8. an overpaid event: no alert', () => {
    expect(run({ a: { stage: 'out_for_delivery' } }, [money('a', 50000, 60000)])).toEqual([])
  })

  it('does not flag every stage that merely owes money - only the delivery stage', () => {
    const stages = ['upcoming', 'production', 'awaiting_approval', 'editing', 'delivered'] as const
    const cases = Object.fromEntries(stages.map((s) => [s, { stage: s }]))
    const finance = stages.map((s) => money(s, 50000, 35000))
    expect(run(cases, finance)).toEqual([])
    expect(run({ ...cases, out: { stage: 'out_for_delivery' } }, [...finance, money('out', 50000, 35000)]).map((i) => i.projectId)).toEqual(['out'])
  })

  it('flags an event that is out for delivery even when its stored stage is older, using the same lifecycle rules as the dashboard', () => {
    // stored as "upcoming" but its sessions are long over -> really waiting for approval, so not out for delivery: no alert
    expect(run({ a: { stage: 'upcoming' } }, [money('a', 50000, 0)])).toEqual([])
  })

  it('shows nothing to people without financial access', () => {
    expect(run({ a: { stage: 'out_for_delivery' } }, [money('a', 50000, 0)], false)).toEqual([])
  })

  it('counts an event once, with the right total, across several events', () => {
    const items = buildActionItems({
      events: [], projects: [project('a', { stage: 'out_for_delivery' }), project('b', { stage: 'out_for_delivery' }), project('c', { stage: 'out_for_delivery' })],
      financials: [money('a', 50000, 35000), money('b', 20000, 20000), money('c', 10000, 0)], inventory: [], tz: 'Asia/Kolkata', currency: 'INR', now: NOW,
    })
    expect(items.filter((i) => i.kind === 'delivery_payment').map((i) => [i.projectId, i.amount])).toEqual([['a', 15000], ['c', 10000]])
    expect(countAttentionEvents(items)).toBe(2)
    const insight = buildInsights(items, [], NOW, 'INR').find((i) => i.id === 'payments-late')
    expect(insight).toMatchObject({ count: 2, text: '2 deliveries have payment pending (₹25,000 outstanding)', href: '/events?stage=out_for_delivery' })
  })

  it('uses the same money maths as the Payments page and the Pending amount card', () => {
    // 50,000 agreed, 35,000 paid: the per-event helper, the card total and the alert all say 15,000
    const p = project('a', { stage: 'out_for_delivery' })
    expect(deliveryPaymentDue(p, money('a', 50000, 35000), NOW)).toBe(15000)
    expect(pendingAmount([p], [money('a', 50000, 35000)]).total).toBe(15000)
    expect(run({ a: { stage: 'out_for_delivery' } }, [money('a', 50000, 35000)])[0]!.amount).toBe(15000)
  })

  it('never lets a decimal slip: paise-exact amounts', () => {
    expect(deliveryPaymentDue(project('a', { stage: 'out_for_delivery' }), money('a', 100.1, 100.09), NOW)).toBeCloseTo(0.01, 10)
    expect(deliveryPaymentDue(project('a', { stage: 'out_for_delivery' }), money('a', 100.1, 100.1), NOW)).toBeNull()
  })
})
