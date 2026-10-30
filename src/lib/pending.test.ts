import { describe, expect, it } from 'vitest'
import { formatMoney } from './money'
import { isPendingEligible, pendingAmount } from './pending'

type P = Parameters<typeof pendingAmount>[0][number]
type F = Parameters<typeof pendingAmount>[1][number]

const event = (id: string, over: Partial<P> = {}): P => ({ id, booking_status: 'confirmed', archived_at: null, ...over })
const money = (id: string, agreed: number, paid: number): F => ({ project_id: id, agreed_amount: agreed, paid_amount: paid })

describe('pending amount', () => {
  it('1. is zero with no events and no payments', () => {
    expect(pendingAmount([], [])).toEqual({ total: 0, count: 0, events: [] })
  })

  it('2. owes the full amount for an event with no payment', () => {
    expect(pendingAmount([event('a')], [money('a', 80_000, 0)])).toMatchObject({ total: 80_000, count: 1 })
  })

  it('3. owes the remainder after a partial payment', () => {
    expect(pendingAmount([event('a')], [money('a', 80_000, 35_000)])).toMatchObject({ total: 45_000, count: 1 })
  })

  it('4. owes nothing once fully paid', () => {
    expect(pendingAmount([event('a')], [money('a', 80_000, 80_000)])).toEqual({ total: 0, count: 0, events: [] })
  })

  it('5. sums different balances across events and counts only those that still owe', () => {
    const r = pendingAmount(
      [event('a'), event('b'), event('c'), event('d')],
      [money('a', 100_000, 25_000), money('b', 50_000, 50_000), money('c', 30_000, 0), money('d', 12_345.67, 345.67)],
    )
    expect(r.total).toBe(75_000 + 30_000 + 12_000)
    expect(r.count).toBe(3)
    expect(r.events.map((e) => [e.projectId, e.balance])).toEqual([['a', 75_000], ['c', 30_000], ['d', 12_000]])
  })

  it('6. an overpaid event owes nothing and never reduces what other events owe', () => {
    const r = pendingAmount([event('a'), event('b')], [money('a', 10_000, 25_000), money('b', 40_000, 10_000)])
    expect(r.total).toBe(30_000)
    expect(r.count).toBe(1)
  })

  it('7. leaves out cancelled events, inquiries and archived events', () => {
    const r = pendingAmount(
      [event('ok'), event('x', { booking_status: 'cancelled' }), event('i', { booking_status: 'inquiry' }), event('z', { archived_at: '2030-01-01T00:00:00Z' })],
      [money('ok', 20_000, 5_000), money('x', 99_000, 0), money('i', 77_000, 0), money('z', 55_000, 0)],
    )
    expect(r).toMatchObject({ total: 15_000, count: 1 })
    expect(isPendingEligible(event('ok'))).toBe(true)
    expect(isPendingEligible(event('x', { booking_status: 'cancelled' }))).toBe(false)
  })

  it('8. relies on valid payments only: the paid amount it is given is already net of void payments', () => {
    // project_financials sums status = valid payments; a voided 30,000 is simply absent from paid_amount
    expect(pendingAmount([event('a')], [money('a', 100_000, 40_000)]).total).toBe(60_000)
  })

  it('never counts an event twice, however the lists were built', () => {
    const r = pendingAmount([event('a'), event('a')], [money('a', 10_000, 0), money('a', 10_000, 0)])
    expect(r).toMatchObject({ total: 10_000, count: 1 })
  })

  it('ignores events without finance rows and finance rows without events', () => {
    expect(pendingAmount([event('a')], [money('other', 5_000, 0)])).toMatchObject({ total: 0, count: 0 })
  })

  it('accepts amounts as strings, as PostgREST returns numerics', () => {
    expect(pendingAmount([event('a')], [{ project_id: 'a', agreed_amount: '80000.50' as unknown as number, paid_amount: '0.25' as unknown as number }]).total).toBe(80_000.25)
  })

  it('has no floating-point drift', () => {
    const rows = Array.from({ length: 10 }, (_, i) => money(`e${i}`, 0.1 + i * 0.01, 0))
    const total = pendingAmount(rows.map((r) => event(r.project_id)), rows).total
    expect(total).toBe(Math.round(total * 100) / 100)
    expect(total).toBe(1.45)
  })
})

describe('showing the amount in the studio currency', () => {
  it('9. formats the same total in whatever currency the studio uses', () => {
    expect(formatMoney(45_000, 'INR')).toBe('₹45,000')
    expect(formatMoney(1_50_000, 'INR')).toBe('₹1,50,000')
    expect(formatMoney(45_000, 'USD')).toBe('$45,000')
    expect(formatMoney(45_000, 'EUR')).toContain('45,000')
    expect(formatMoney(45_000, 'EUR')).toContain('€')
    expect(formatMoney(45_000, 'AED')).toContain('45,000')
    expect(formatMoney(0, 'INR')).toBe('₹0')
    expect(formatMoney(1234.5, 'GBP')).toBe('£1,234.50')
  })
})
