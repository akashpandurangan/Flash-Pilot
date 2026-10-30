import { describe, expect, it } from 'vitest'
import { bucketByMonth, deliveryPerformance, MAX_MONTHS, monthKeys, monthOf, onTimeRate, withinRange } from './report-stats'

const TZ = 'Asia/Kolkata'

describe('monthKeys', () => {
  it('lists every month in the range, including empty ones', () => {
    expect(monthKeys('2026-11-20', '2027-02-03')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02'])
  })

  it('keeps only the latest months of a very long range', () => {
    const keys = monthKeys('2020-01-01', '2026-12-31')
    expect(keys).toHaveLength(MAX_MONTHS)
    expect(keys.at(-1)).toBe('2026-12')
  })
})

describe('monthOf', () => {
  it('reads an instant in the studio zone, not UTC', () => {
    // 20:00 UTC on 31 Jan is 01:30 on 1 Feb in Kolkata.
    expect(monthOf('2026-01-31T20:00:00Z', TZ)).toBe('2026-02')
    expect(monthOf('2026-01-31T20:00:00Z', 'UTC')).toBe('2026-01')
  })

  it('takes a plain date as written', () => {
    expect(monthOf('2026-03-31', 'Pacific/Honolulu')).toBe('2026-03')
  })
})

describe('bucketByMonth', () => {
  const range = { from: '2026-06-01', to: '2026-08-31' }

  it('counts rows per month and keeps empty months', () => {
    const rows = [{ at: '2026-06-10T10:00:00Z' }, { at: '2026-06-20T10:00:00Z' }, { at: '2026-08-02T10:00:00Z' }, { at: null }]
    const buckets = bucketByMonth(rows, (r) => r.at, range, TZ)
    expect(buckets.map((b) => [b.label, b.value])).toEqual([['Jun', 2], ['Jul', 0], ['Aug', 1]])
  })

  it('sums a weight and ignores rows outside the range', () => {
    const rows = [{ on: '2026-07-04', amount: 1500 }, { on: '2026-07-19', amount: 500 }, { on: '2026-12-01', amount: 99 }]
    const buckets = bucketByMonth(rows, (r) => r.on, range, TZ, (r) => r.amount)
    expect(buckets.find((b) => b.key === '2026-07')?.value).toBe(2000)
    expect(buckets.reduce((s, b) => s + b.value, 0)).toBe(2000)
  })

  it('adds the year to labels only when the range crosses a year', () => {
    expect(bucketByMonth([], () => null, { from: '2026-12-01', to: '2027-01-31' }, TZ).map((b) => b.label)).toEqual(['Dec 26', 'Jan 27'])
  })
})

describe('withinRange', () => {
  const range = { from: '2026-06-01T00:00:00Z', to: '2026-07-01T00:00:00Z' }
  it('compares moments rather than strings', () => {
    expect(withinRange('2026-06-15T00:00:00+05:30', range)).toBe(true)
    expect(withinRange('2026-07-01T00:00:00Z', range)).toBe(false)
    expect(withinRange(null, range)).toBe(false)
  })
})

describe('deliveryPerformance', () => {
  const base = { delivered_at: null, delivery_due_date: null, shoot_completed_at: null, editing_started_at: null, editing_completed_at: null }

  it('splits delivered events into on time, late and no deadline', () => {
    const stats = deliveryPerformance(
      [
        { ...base, delivered_at: '2026-06-10T05:00:00Z', delivery_due_date: '2026-06-10' },
        { ...base, delivered_at: '2026-06-12T05:00:00Z', delivery_due_date: '2026-06-10' },
        { ...base, delivered_at: '2026-06-12T05:00:00Z' },
        { ...base }, // not delivered yet - not counted
      ],
      TZ,
    )
    expect(stats).toMatchObject({ delivered: 3, onTime: 1, late: 1, noDeadline: 1 })
    expect(onTimeRate(stats)).toBe(50)
  })

  it('judges the delivery day in the studio zone', () => {
    // 20:00 UTC on the 10th is already the 11th in Kolkata, so this is a day late.
    const stats = deliveryPerformance([{ ...base, delivered_at: '2026-06-10T20:00:00Z', delivery_due_date: '2026-06-10' }], TZ)
    expect(stats.late).toBe(1)
  })

  it('averages turnaround only over events that recorded both ends', () => {
    const stats = deliveryPerformance(
      [
        { ...base, shoot_completed_at: '2026-06-01T00:00:00Z', delivered_at: '2026-06-11T00:00:00Z', editing_started_at: '2026-06-02T00:00:00Z', editing_completed_at: '2026-06-06T00:00:00Z' },
        { ...base, shoot_completed_at: '2026-06-01T00:00:00Z', delivered_at: '2026-06-06T00:00:00Z' },
        { ...base, delivered_at: '2026-06-06T00:00:00Z' }, // no shoot date - skipped for delivery time
      ],
      TZ,
    )
    expect(stats.avgDaysToDeliver).toBe(7.5)
    expect(stats.avgEditingDays).toBe(4)
  })

  it('reports nothing rather than zero when there is no data', () => {
    const stats = deliveryPerformance([], TZ)
    expect(stats).toMatchObject({ delivered: 0, avgDaysToDeliver: null, avgEditingDays: null })
    expect(onTimeRate(stats)).toBeNull()
  })
})
