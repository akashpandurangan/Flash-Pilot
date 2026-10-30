import { useQuery } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import { Link } from 'react-router'
import { listEmployees } from '@/api/employees'
import { listFinancials, listPaymentsInRange } from '@/api/payments'
import { listActiveProjects } from '@/api/projects'
import { listScheduleEvents } from '@/api/schedule'
import { Button } from '@/components/ui/button'
import { Badge, DataState, EmptyState, ListSkeleton, LoadingState, PageHeader, TableWrap, TD, TH, THead, TR } from '@/components/ui/display'
import { Input, Select } from '@/components/ui/form'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/menu'
import { BOOKING_STATUS_LABELS, EVENT_TYPE_LABELS, PAYMENT_METHOD_LABELS, PRODUCTION_STAGES, PRODUCTION_STAGE_LABELS, TEAM_ROLE_LABELS } from '@/lib/constants'
import { downloadCsv, toCsv, type CsvColumn } from '@/lib/csv'
import { formatMoney } from '@/lib/money'
import { addDaysToDateString, fmtDate, fmtDateOnly, todayKey, zonedDayBounds } from '@/lib/time'
import type { BookingStatus, ProductionStage, ProjectFinancials, ProjectOverview } from '@/types/entities'
import { useStudio } from '@/features/studio/StudioProvider'
import { useUrlState } from '@/hooks/useUrlState'
import { ReportsOverview } from './ReportsOverview'

interface Col<T> extends CsvColumn<T> {
  render?: (row: T) => ReactNode
  align?: 'right'
}

function Report<T>({ rows, columns, summary, filename, query, empty }: {
  rows: T[]
  columns: Col<T>[]
  summary?: ReactNode
  filename: string
  query: { isLoading: boolean; isError: boolean; error: unknown; refetch: () => unknown }
  empty: string
}) {
  return (
    <DataState query={query} isEmpty={rows.length === 0} skeleton={<ListSkeleton />} empty={<EmptyState title={empty} description="Try widening the date range." />}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-muted">{summary ?? `${rows.length} ${rows.length === 1 ? 'row' : 'rows'}`}</p>
        <Button variant="secondary" size="sm" onClick={() => downloadCsv(filename, toCsv(rows, columns))}><Download className="size-4" /> Export CSV</Button>
      </div>
      <TableWrap>
        <THead><tr>{columns.map((c) => <TH key={c.header} className={c.align === 'right' ? 'text-right' : ''}>{c.header}</TH>)}</tr></THead>
        <tbody>
          {rows.map((r, i) => <TR key={i}>{columns.map((c) => <TD key={c.header} className={c.align === 'right' ? 'text-right tabular-nums' : ''}>{c.render ? c.render(r) : (c.value(r) ?? '—')}</TD>)}</TR>)}
        </tbody>
      </TableWrap>
    </DataState>
  )
}

export default function ReportsPage() {
  const { studio, tz, currency, can } = useStudio()
  const canFinance = can('finance.view')
  const today = todayKey(tz)
  const [f, setF] = useUrlState({ tab: 'bookings', from: addDaysToDateString(today, -90), to: addDaysToDateString(today, 180) })
  const range = useMemo(() => ({ from: zonedDayBounds(f.from, tz).start, to: zonedDayBounds(f.to, tz).end }), [f.from, f.to, tz])

  const projects = useQuery({ queryKey: ['projects', 'active', studio.id], queryFn: () => listActiveProjects(studio.id, 1000) })
  const financials = useQuery({ queryKey: ['financials', studio.id], queryFn: () => listFinancials(studio.id), enabled: canFinance })
  const events = useQuery({ queryKey: ['schedule', studio.id, 'report', range.from, range.to], queryFn: () => listScheduleEvents({ studioId: studio.id, ...range }) })
  const employees = useQuery({ queryKey: ['employees', studio.id], queryFn: () => listEmployees(studio.id) })
  const payments = useQuery({ queryKey: ['payments', studio.id, f.from, f.to], queryFn: () => listPaymentsInRange(studio.id, f.from, f.to), enabled: canFinance })

  // Projects whose events fall inside the chosen window.
  const inRange = useMemo(
    () => (projects.data ?? []).filter((p) => p.first_event_at && p.last_event_at && p.last_event_at >= range.from && p.first_event_at <= range.to),
    [projects.data, range],
  )
  const confirmed = useMemo(() => (projects.data ?? []).filter((p) => p.booking_status === 'confirmed'), [projects.data])
  const finById = useMemo(() => new Map((financials.data ?? []).map((x) => [x.project_id, x])), [financials.data])
  const link = (p: Pick<ProjectOverview, 'id' | 'name'>) => <Link to={`/events/${p.id}`} className="font-medium hover:underline">{p.name}</Link>

  const byStatus = useMemo(() => (Object.keys(BOOKING_STATUS_LABELS) as BookingStatus[]).map((s) => {
    const list = inRange.filter((p) => p.booking_status === s)
    return { status: s, count: list.length, value: list.reduce((sum, p) => sum + Number(finById.get(p.id)?.agreed_amount ?? 0), 0) }
  }), [inRange, finById])

  const byStage = useMemo(() => PRODUCTION_STAGES.map((s) => ({ stage: s as ProductionStage, count: confirmed.filter((p) => p.production_stage === s).length })), [confirmed])

  const upcoming = useMemo(() => (events.data ?? []).filter((e) => e.project.booking_status !== 'cancelled' && new Date(e.ends_at).getTime() >= Date.now()), [events.data])

  const workload = useMemo(() => {
    const map = new Map<string, { name: string; role: string; events: number; projects: Set<string> }>()
    for (const e of events.data ?? []) {
      if (e.project.booking_status === 'cancelled') continue
      for (const a of e.event_assignments ?? []) {
        const emp = (employees.data ?? []).find((x) => x.id === a.employee_id)
        const cur = map.get(a.employee_id) ?? { name: a.employee?.full_name ?? 'Team member', role: emp ? TEAM_ROLE_LABELS[emp.team_role] : '', events: 0, projects: new Set<string>() }
        cur.events += 1
        cur.projects.add(e.project_id)
        map.set(a.employee_id, cur)
      }
    }
    return [...map.values()].sort((a, b) => b.events - a.events)
  }, [events.data, employees.data])

  const outstanding = useMemo(() => confirmed.map((p) => ({ p, fin: finById.get(p.id) })).filter((x): x is { p: ProjectOverview; fin: ProjectFinancials } => !!x.fin && Number(x.fin.balance) > 0).sort((a, b) => Number(b.fin.balance) - Number(a.fin.balance)), [confirmed, finById])
  const pendingDelivery = useMemo(() => confirmed.filter((p) => p.production_stage === 'editing' || p.production_stage === 'ready_for_delivery' || (p.production_stage === 'production' && p.shoot_completed_at)), [confirmed])
  const overdue = useMemo(() => confirmed.filter((p) => p.production_stage !== 'delivered' && ((p.editing_due_date && p.editing_due_date < today && !p.editing_completed_at) || (p.delivery_due_date && p.delivery_due_date < today))), [confirmed, today])

  const q = projects
  const overviewReady = projects.isSuccess && events.isSuccess && (!canFinance || (financials.isSuccess && payments.isSuccess))
  const overviewPending = projects.isPending || events.isPending || (canFinance && (financials.isPending || payments.isPending))
  return (
    <>
      <PageHeader title="Reports" description="Bookings, revenue, production and delivery from live data. Every table can be exported to CSV." />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-[13px] font-medium">From<Input type="date" className="w-40" value={f.from} max={f.to} onChange={(e) => setF({ from: e.target.value })} /></label>
        <label className="flex items-center gap-2 text-[13px] font-medium">To<Input type="date" className="w-40" value={f.to} min={f.from} onChange={(e) => setF({ to: e.target.value })} /></label>
        <Select aria-label="Quick range" className="w-44" value="" onChange={(e) => {
          const v = e.target.value
          if (v === 'month') setF({ from: `${today.slice(0, 7)}-01`, to: today })
          if (v === '30') setF({ from: addDaysToDateString(today, -30), to: today })
          if (v === 'next30') setF({ from: today, to: addDaysToDateString(today, 30) })
          if (v === 'year') setF({ from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` })
        }}>
          <option value="">Quick range…</option><option value="month">This month</option><option value="30">Last 30 days</option><option value="next30">Next 30 days</option><option value="year">This year</option>
        </Select>
      </div>

      {overviewReady ? (
        <ReportsOverview
          inRange={inRange}
          all={projects.data ?? []}
          byStage={byStage}
          workload={workload}
          overdueCount={overdue.length}
          pendingDeliveryCount={pendingDelivery.length}
          money={canFinance ? { outstanding: outstanding.reduce((s, x) => s + Number(x.fin.balance), 0), received: (payments.data ?? []).filter((p) => p.status === 'valid') } : null}
          dates={{ from: f.from, to: f.to }}
          instants={range}
          today={today}
          tz={tz}
          currency={currency}
        />
      ) : overviewPending ? (
        <LoadingState label="Loading overview" rows={3} className="mb-8" />
      ) : null}

      <h2 className="mb-3 text-lg font-semibold tracking-tight">Detailed reports</h2>
      <Tabs value={f.tab} onValueChange={(tab) => setF({ tab })}>
        <TabsList className="lg:min-w-0 lg:max-w-full lg:flex-wrap lg:rounded-3xl">
          <TabsTrigger value="bookings">Bookings</TabsTrigger>
          <TabsTrigger value="stages">Production stages</TabsTrigger>
          <TabsTrigger value="upcoming">Upcoming sessions</TabsTrigger>
          <TabsTrigger value="team">Team assignments</TabsTrigger>
          {canFinance && <TabsTrigger value="outstanding">Outstanding</TabsTrigger>}
          {canFinance && <TabsTrigger value="received">Payments received</TabsTrigger>}
          <TabsTrigger value="delivery">Pending delivery</TabsTrigger>
          <TabsTrigger value="overdue">Overdue</TabsTrigger>
        </TabsList>

        <TabsContent value="bookings">
          <Report query={q} rows={byStatus} filename="events_by_booking_status.csv" empty="No events" summary={`${inRange.length} events with sessions in this period`}
            columns={[
              { header: 'Booking status', value: (r) => BOOKING_STATUS_LABELS[r.status] }, { header: 'Events', value: (r) => r.count, align: 'right' },
              ...(canFinance ? [{ header: 'Agreed value', value: (r: (typeof byStatus)[number]) => r.value, render: (r: (typeof byStatus)[number]) => formatMoney(r.value, currency), align: 'right' as const }] : []),
            ]} />
        </TabsContent>

        <TabsContent value="stages">
          <Report query={q} rows={byStage} filename="events_by_production_stage.csv" empty="No confirmed events" summary={`${confirmed.length} confirmed events (all dates)`}
            columns={[{ header: 'Production stage', value: (r) => PRODUCTION_STAGE_LABELS[r.stage] }, { header: 'Events', value: (r) => r.count, align: 'right' }]} />
        </TabsContent>

        <TabsContent value="upcoming">
          <Report query={events} rows={upcoming} filename="upcoming_sessions.csv" empty="No upcoming sessions"
            columns={[
              { header: 'Date', value: (e) => fmtDate(e.starts_at, tz) }, { header: 'Session', value: (e) => e.title },
              { header: 'Event', value: (e) => e.project.name, render: (e) => link({ id: e.project_id, name: e.project.name }) },
              { header: 'Type', value: (e) => EVENT_TYPE_LABELS[e.event_type] }, { header: 'Venue', value: (e) => e.venue_name },
              { header: 'Team', value: (e) => (e.event_assignments ?? []).map((a) => a.employee?.full_name).join('; ') },
              { header: 'Booking', value: (e) => BOOKING_STATUS_LABELS[e.project.booking_status] },
            ]} />
        </TabsContent>

        <TabsContent value="team">
          <Report query={events} rows={workload} filename="employee_assignments.csv" empty="No assignments" summary={`${workload.reduce((s, w) => s + w.events, 0)} assignments in this period`}
            columns={[{ header: 'Team member', value: (w) => w.name }, { header: 'Role', value: (w) => w.role }, { header: 'Sessions', value: (w) => w.events, align: 'right' }, { header: 'Events', value: (w) => w.projects.size, align: 'right' }]} />
        </TabsContent>

        {canFinance && (
          <TabsContent value="outstanding">
            <Report query={financials.isError ? financials : projects} rows={outstanding} filename="outstanding_payments.csv" empty="Nothing outstanding"
              summary={<>Total outstanding: <span className="font-semibold text-ink">{formatMoney(outstanding.reduce((s, x) => s + Number(x.fin.balance), 0), currency)}</span> across {outstanding.length} events</>}
              columns={[
                { header: 'Event', value: (x) => x.p.name, render: (x) => link(x.p) }, { header: 'Client', value: (x) => x.p.client_name },
                { header: 'Agreed', value: (x) => Number(x.fin.agreed_amount), render: (x) => formatMoney(Number(x.fin.agreed_amount), currency), align: 'right' },
                { header: 'Received', value: (x) => Number(x.fin.paid_amount), render: (x) => formatMoney(Number(x.fin.paid_amount), currency), align: 'right' },
                { header: 'Balance', value: (x) => Number(x.fin.balance), render: (x) => formatMoney(Number(x.fin.balance), currency), align: 'right' },
                { header: 'Due date', value: (x) => x.fin.payment_due_date, render: (x) => <>{fmtDateOnly(x.fin.payment_due_date)}{x.fin.payment_due_date && x.fin.payment_due_date < today && <Badge tone="danger" className="ml-2">Overdue</Badge>}</> },
              ]} />
          </TabsContent>
        )}

        {canFinance && (
          <TabsContent value="received">
            <Report query={payments} rows={(payments.data ?? []).filter((p) => p.status === 'valid')} filename={`payments_received_${f.from}_to_${f.to}.csv`} empty="No payments in this period"
              summary={<>Received: <span className="font-semibold text-ink">{formatMoney((payments.data ?? []).filter((p) => p.status === 'valid').reduce((s, p) => s + Number(p.amount), 0), currency)}</span></>}
              columns={[
                { header: 'Date', value: (p) => p.paid_on, render: (p) => fmtDateOnly(p.paid_on) }, { header: 'Event', value: (p) => p.project?.name, render: (p) => (p.project ? link(p.project) : '—') },
                { header: 'Amount', value: (p) => Number(p.amount), render: (p) => formatMoney(Number(p.amount), currency), align: 'right' },
                { header: 'Method', value: (p) => PAYMENT_METHOD_LABELS[p.method] }, { header: 'Reference', value: (p) => p.reference }, { header: 'Recorded by', value: (p) => p.recorded_by_name },
              ]} />
          </TabsContent>
        )}

        <TabsContent value="delivery">
          <Report query={q} rows={pendingDelivery} filename="events_pending_delivery.csv" empty="Nothing waiting for delivery" summary={`${pendingDelivery.length} events shot but not yet delivered`}
            columns={[
              { header: 'Event', value: (p) => p.name, render: (p) => link(p) }, { header: 'Client', value: (p) => p.client_name }, { header: 'Stage', value: (p) => PRODUCTION_STAGE_LABELS[p.production_stage] },
              { header: 'Editing due', value: (p) => p.editing_due_date, render: (p) => fmtDateOnly(p.editing_due_date) }, { header: 'Delivery due', value: (p) => p.delivery_due_date, render: (p) => fmtDateOnly(p.delivery_due_date) },
            ]} />
        </TabsContent>

        <TabsContent value="overdue">
          <Report query={q} rows={overdue} filename="overdue_editing_and_delivery.csv" empty="Nothing is overdue" summary={`${overdue.length} events past an editing or delivery deadline`}
            columns={[
              { header: 'Event', value: (p) => p.name, render: (p) => link(p) }, { header: 'Client', value: (p) => p.client_name }, { header: 'Stage', value: (p) => PRODUCTION_STAGE_LABELS[p.production_stage] },
              { header: 'Editing overdue', value: (p) => (p.editing_due_date && p.editing_due_date < today && !p.editing_completed_at ? p.editing_due_date : ''), render: (p) => (p.editing_due_date && p.editing_due_date < today && !p.editing_completed_at ? <Badge tone="danger">Since {fmtDateOnly(p.editing_due_date)}</Badge> : '—') },
              { header: 'Delivery overdue', value: (p) => (p.delivery_due_date && p.delivery_due_date < today ? p.delivery_due_date : ''), render: (p) => (p.delivery_due_date && p.delivery_due_date < today ? <Badge tone="danger">Since {fmtDateOnly(p.delivery_due_date)}</Badge> : '—') },
            ]} />
        </TabsContent>
      </Tabs>
    </>
  )
}
