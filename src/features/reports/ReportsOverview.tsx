import { useMemo } from 'react'
import { BarList, ColumnChart, type BarListItem } from '@/components/ui/charts'
import { Panel } from '@/components/ui/display'
import { MetricCard } from '@/components/ui/metric-card'
import { PRODUCTION_STAGE_LABELS } from '@/lib/constants'
import { formatMoney } from '@/lib/money'
import { bucketByMonth, deliveryPerformance, onTimeRate, withinRange } from '@/lib/report-stats'
import type { ProductionStage, ProjectOverview } from '@/types/entities'

export interface WorkloadRow {
  name: string
  role: string
  events: number
  projects: Set<string>
}

/** What the page already has loaded - the overview adds no queries of its own. */
interface Props {
  /** Events whose sessions fall in the chosen window. */
  inRange: ProjectOverview[]
  /** Every active event, for delivery history. */
  all: ProjectOverview[]
  byStage: { stage: ProductionStage; count: number }[]
  workload: WorkloadRow[]
  overdueCount: number
  pendingDeliveryCount: number
  /** null when the viewer cannot see money. */
  money: { outstanding: number; received: { paid_on: string; amount: number | string }[] } | null
  /** yyyy-MM-dd window, and the same window as instants. */
  dates: { from: string; to: string }
  instants: { from: string; to: string }
  today: string
  tz: string
  currency: string
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export function ReportsOverview({ inRange, all, byStage, workload, overdueCount, pendingDeliveryCount, money, dates, instants, today, tz, currency }: Props) {
  const live = useMemo(() => inRange.filter((p) => p.booking_status !== 'cancelled'), [inRange])
  const perMonth = useMemo(() => bucketByMonth(live, (p) => p.first_event_at, dates, tz), [live, dates, tz])
  const receivedPerMonth = useMemo(() => (money ? bucketByMonth(money.received, (p) => p.paid_on, dates, tz, (p) => Number(p.amount)) : []), [money, dates, tz])
  const receivedTotal = receivedPerMonth.reduce((s, b) => s + b.value, 0)
  const delivered = useMemo(() => all.filter((p) => withinRange(p.delivered_at, instants)), [all, instants])
  const perf = useMemo(() => deliveryPerformance(delivered, tz), [delivered, tz])
  const rate = onTimeRate(perf)
  const currentMonth = today.slice(0, 7)
  const money0 = (n: number) => formatMoney(n, currency)

  const stageItems: BarListItem[] = byStage.map((s) => ({ key: s.stage, label: PRODUCTION_STAGE_LABELS[s.stage], value: s.count, tone: s.stage === 'delivered' ? 'ok' : 'dark' }))
  const deliveryItems: BarListItem[] = [
    { key: 'on', label: 'Delivered on time', value: perf.onTime, tone: 'ok' },
    { key: 'late', label: 'Delivered late', value: perf.late, tone: 'risk' },
    { key: 'none', label: 'No delivery date set', value: perf.noDeadline, tone: 'muted' },
  ]
  const topWorkload = workload.slice(0, 6)

  return (
    <section aria-label="Overview" className="mb-8 space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard tone="dark" label="Events in period" value={live.length} hint={`${live.filter((p) => p.booking_status === 'confirmed').length} confirmed`} />
        {money ? (
          <MetricCard tone="soft" compact label="Payments received" value={money0(receivedTotal)} hint="In this period" />
        ) : (
          <MetricCard tone="soft" label="Delivered" value={perf.delivered} hint="In this period" />
        )}
        {money ? (
          <MetricCard tone="soft" compact label="Outstanding" value={money0(money.outstanding)} hint="Across confirmed events" />
        ) : (
          <MetricCard tone="soft" label="Waiting for delivery" value={pendingDeliveryCount} hint="Shot, not yet delivered" />
        )}
        <MetricCard tone="soft" label="Overdue" value={overdueCount} hint={overdueCount === 0 ? 'Nothing past a deadline' : 'Editing or delivery past due'} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Events per month" description="Events by the month of their first session, cancelled bookings left out.">
          <ColumnChart data={perMonth} label="Events per month" unit="events" highlight={perMonth.some((b) => b.key === currentMonth) ? currentMonth : undefined} />
        </Panel>

        {money ? (
          <Panel title="Payments received" description="Valid payments by the date they were received.">
            <ColumnChart data={receivedPerMonth} label="Payments received per month" unit="received" format={money0} highlight={receivedPerMonth.some((b) => b.key === currentMonth) ? currentMonth : undefined} />
          </Panel>
        ) : (
          <Panel title="Team workload" description="Sessions per person in this period.">
            {topWorkload.length === 0 ? <p className="py-6 text-sm text-ink-muted">No assignments in this period.</p> : <BarList label="Sessions per team member" items={topWorkload.map((w) => ({ key: w.name, label: w.name, value: w.events, display: plural(w.events, 'session') }))} />}
          </Panel>
        )}

        <Panel title="Production pipeline" description="Confirmed events by where they are now.">
          <BarList label="Confirmed events by production stage" items={stageItems} />
        </Panel>

        <Panel title="Delivery performance" description="Events delivered in this period, against the date promised to the client.">
          {perf.delivered === 0 ? (
            <p className="py-6 text-sm text-ink-muted">Nothing was delivered in this period.</p>
          ) : (
            <>
              <BarList label="Deliveries against their promised date" items={deliveryItems} max={perf.delivered} />
              <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-line pt-4">
                <Fact label="On time" value={rate === null ? '—' : `${rate}%`} />
                <Fact label="Shoot to delivery" value={perf.avgDaysToDeliver === null ? '—' : `${perf.avgDaysToDeliver} d`} />
                <Fact label="Editing time" value={perf.avgEditingDays === null ? '—' : `${perf.avgEditingDays} d`} />
              </dl>
            </>
          )}
        </Panel>

        {money && (
          <Panel title="Team workload" description="Sessions per person in this period." className="lg:col-span-2">
            {topWorkload.length === 0 ? (
              <p className="py-6 text-sm text-ink-muted">No assignments in this period.</p>
            ) : (
              <BarList className="grid gap-x-10 gap-y-3.5 space-y-0 md:grid-cols-2" label="Sessions per team member" items={topWorkload.map((w) => ({ key: w.name, label: <>{w.name}{w.role && <span className="text-ink-muted"> · {w.role}</span>}</>, value: w.events, display: plural(w.events, 'session') }))} />
            )}
          </Panel>
        )}
      </div>
    </section>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[13px] text-ink-muted">{label}</dt>
      <dd className="mt-1 text-lg font-semibold tracking-tight">{value}</dd>
    </div>
  )
}
