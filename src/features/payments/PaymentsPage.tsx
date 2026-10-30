import { useQuery } from '@tanstack/react-query'
import { Download, IndianRupee, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { listFinancials, listPaymentsInRange } from '@/api/payments'
import { listActiveProjects } from '@/api/projects'
import { Button } from '@/components/ui/button'
import { Badge, DataState, EmptyState, ListSkeleton, PageHeader, StatCard, TableWrap, TD, TH, THead, TR } from '@/components/ui/display'
import { Input, Select } from '@/components/ui/form'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/menu'
import { PaymentRowBadge, PaymentStateBadge } from '@/components/ui/status'
import { FilterBar, SearchInput } from '@/components/ui/toolbar'
import { downloadCsv, toCsv } from '@/lib/csv'
import { PAYMENT_METHOD_LABELS } from '@/lib/constants'
import { formatMoney, summarizeFinancials } from '@/lib/money'
import { isPendingEligible, pendingAmount } from '@/lib/pending'
import { addDaysToDateString, fmtDateOnly, todayKey } from '@/lib/time'
import { useStudio } from '@/features/studio/StudioProvider'
import { useUrlState } from '@/hooks/useUrlState'
import { PaymentDialog, type PaymentTarget } from './PaymentDialog'

export default function PaymentsPage() {
  const { studio, tz, currency, can } = useStudio()
  const canManage = can('finance.manage')
  const today = todayKey(tz)
  const [f, setF] = useUrlState({ tab: 'balances', q: '', state: 'outstanding', from: addDaysToDateString(today, -30), to: today })
  const [paying, setPaying] = useState<PaymentTarget | null>(null)

  const financials = useQuery({ queryKey: ['financials', studio.id], queryFn: () => listFinancials(studio.id) })
  const projects = useQuery({ queryKey: ['projects', 'active', studio.id], queryFn: () => listActiveProjects(studio.id) })
  const history = useQuery({ queryKey: ['payments', studio.id, f.from, f.to], queryFn: () => listPaymentsInRange(studio.id, f.from, f.to), enabled: f.tab === 'history' })

  const rows = useMemo(() => {
    const byId = new Map((financials.data ?? []).map((x) => [x.project_id, x]))
    const term = f.q.trim().toLowerCase()
    return (projects.data ?? [])
      .filter((p) => p.booking_status !== 'cancelled' && byId.has(p.id))
      .map((p) => {
        const fin = byId.get(p.id)!
        const s = summarizeFinancials(fin.agreed_amount, [{ amount: fin.paid_amount }])
        return { p, fin, s, overdue: !!fin.payment_due_date && fin.payment_due_date < today && s.balance > 0 }
      })
      // "Outstanding" and "Overdue" follow the same eligibility as the Outstanding figure above and the dashboard's
      // Pending amount (confirmed events), so the rows listed here always add up to those totals
      .filter((r) => (f.state === 'all' ? true : f.state === 'outstanding' ? isPendingEligible(r.p) && r.s.balance > 0 : f.state === 'overdue' ? isPendingEligible(r.p) && r.overdue : r.s.balance === 0 && r.s.agreed > 0))
      .filter((r) => !term || [r.p.name, r.p.client_name, r.p.project_code].some((v) => v.toLowerCase().includes(term)))
      .sort((a, b) => Number(b.overdue) - Number(a.overdue) || b.s.balance - a.s.balance)
  }, [financials.data, projects.data, f.q, f.state, today])

  const totals = useMemo(() => {
    const confirmed = (projects.data ?? []).filter((p) => p.booking_status === 'confirmed')
    const ids = new Set(confirmed.map((p) => p.id))
    const list = (financials.data ?? []).filter((x) => ids.has(x.project_id))
    return {
      agreed: list.reduce((s, x) => s + Number(x.agreed_amount), 0),
      paid: list.reduce((s, x) => s + Number(x.paid_amount), 0),
      outstanding: pendingAmount(projects.data ?? [], financials.data ?? []).total,
      overdue: list.filter((x) => x.payment_due_date && x.payment_due_date < today && Number(x.balance) > 0).length,
    }
  }, [financials.data, projects.data, today])

  const received = (history.data ?? []).filter((p) => p.status === 'valid').reduce((s, p) => s + Number(p.amount), 0)

  const exportHistory = () => {
    downloadCsv(`payments_${f.from}_to_${f.to}.csv`, toCsv(history.data ?? [], [
      { header: 'Date', value: (p) => p.paid_on }, { header: 'Event ID', value: (p) => p.project?.project_code }, { header: 'Event', value: (p) => p.project?.name },
      { header: 'Amount', value: (p) => Number(p.amount) }, { header: 'Method', value: (p) => PAYMENT_METHOD_LABELS[p.method] }, { header: 'Reference', value: (p) => p.reference },
      { header: 'Recorded by', value: (p) => p.recorded_by_name }, { header: 'Status', value: (p) => p.status },
    ]))
  }

  return (
    <>
      <PageHeader title="Payments" description="What's been agreed, what's been received and what's still to collect. Payments are recorded here; the money moves outside the app." />
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Agreed (confirmed events)" value={formatMoney(totals.agreed, currency)} />
        <StatCard label="Received" value={formatMoney(totals.paid, currency)} />
        <StatCard label="Outstanding" value={formatMoney(totals.outstanding, currency)} />
        <StatCard label="Overdue" value={totals.overdue} hint={totals.overdue > 0 ? 'Past their due date' : 'Nothing overdue'} />
      </div>

      <Tabs value={f.tab} onValueChange={(tab) => setF({ tab })}>
        <TabsList>
          <TabsTrigger value="balances">Event balances</TabsTrigger>
          <TabsTrigger value="history">Payment history</TabsTrigger>
        </TabsList>

        <TabsContent value="balances">
          <FilterBar>
            <SearchInput className="sm:w-72" value={f.q} onChange={(q) => setF({ q })} placeholder="Search event or client" label="Search balances" />
            <Select aria-label="Show" className="sm:w-44" value={f.state} onChange={(e) => setF({ state: e.target.value })}>
              <option value="outstanding">Outstanding</option><option value="overdue">Overdue</option><option value="paid">Fully paid</option><option value="all">All</option>
            </Select>
          </FilterBar>
          <DataState
            query={financials.isError ? financials : projects}
            isEmpty={rows.length === 0}
            skeleton={<ListSkeleton />}
            empty={<EmptyState icon={<IndianRupee />} title={f.state === 'outstanding' ? 'Nothing outstanding' : 'No events here'} description={f.state === 'outstanding' ? 'Every event is paid up.' : 'Try another filter.'} />}
          >
            <div className="hidden md:block">
              <TableWrap>
                <THead><tr><TH>Event</TH><TH>Client</TH><TH className="text-right">Agreed</TH><TH className="text-right">Received</TH><TH className="text-right">Balance</TH><TH>Due</TH><TH>Status</TH>{canManage && <TH className="w-32"><span className="sr-only">Actions</span></TH>}</tr></THead>
                <tbody>
                  {rows.map(({ p, fin, s, overdue }) => (
                    <TR key={p.id}>
                      <TD><Link to={`/events/${p.id}?tab=payments`} className="font-medium hover:underline">{p.name}</Link><span className="block text-xs text-ink-muted">{p.project_code}</span></TD>
                      <TD>{p.client_name}</TD>
                      <TD className="text-right tabular-nums">{formatMoney(s.agreed, currency)}</TD>
                      <TD className="text-right tabular-nums">{formatMoney(s.paid, currency)}</TD>
                      <TD className="text-right font-medium tabular-nums">{s.credit > 0 ? `Credit ${formatMoney(s.credit, currency)}` : formatMoney(s.balance, currency)}</TD>
                      <TD className="whitespace-nowrap">{fin.payment_due_date ? fmtDateOnly(fin.payment_due_date) : '—'}{overdue && <Badge tone="danger" className="ml-2">Overdue</Badge>}</TD>
                      <TD><PaymentStateBadge state={s.state} /></TD>
                      {canManage && <TD><Button variant="secondary" size="sm" onClick={() => setPaying({ projectId: p.id, projectName: p.name, agreed: s.agreed, paid: s.paid })}><Plus className="size-3.5" /> Payment</Button></TD>}
                    </TR>
                  ))}
                </tbody>
              </TableWrap>
            </div>
            <ul className="space-y-2 md:hidden">
              {rows.map(({ p, fin, s, overdue }) => (
                <li key={p.id} className="rounded-lg border border-line p-3">
                  <Link to={`/events/${p.id}?tab=payments`} className="block"><p className="truncate text-sm font-medium">{p.name}</p><p className="truncate text-xs text-ink-muted">{p.client_name}</p></Link>
                  <div className="mt-2 flex items-end justify-between">
                    <div><p className="text-lg font-semibold tabular-nums">{s.credit > 0 ? `Credit ${formatMoney(s.credit, currency)}` : formatMoney(s.balance, currency)}</p><p className="text-xs text-ink-muted">of {formatMoney(s.agreed, currency)}{fin.payment_due_date && ` · due ${fmtDateOnly(fin.payment_due_date)}`}</p></div>
                    <div className="flex flex-col items-end gap-1.5"><PaymentStateBadge state={s.state} />{overdue && <Badge tone="danger">Overdue</Badge>}</div>
                  </div>
                  {canManage && <Button variant="secondary" size="sm" className="mt-3 w-full" onClick={() => setPaying({ projectId: p.id, projectName: p.name, agreed: s.agreed, paid: s.paid })}><Plus className="size-3.5" /> Record payment</Button>}
                </li>
              ))}
            </ul>
          </DataState>
        </TabsContent>

        <TabsContent value="history">
          <FilterBar>
            <label className="flex items-center gap-2 text-[13px] font-medium">From<Input type="date" className="w-40" value={f.from} max={f.to} onChange={(e) => setF({ from: e.target.value })} /></label>
            <label className="flex items-center gap-2 text-[13px] font-medium">To<Input type="date" className="w-40" value={f.to} min={f.from} onChange={(e) => setF({ to: e.target.value })} /></label>
            <Button variant="secondary" className="sm:ml-auto" onClick={exportHistory} disabled={!history.data?.length}><Download className="size-4" /> Export CSV</Button>
          </FilterBar>
          <DataState query={history} isEmpty={(history.data ?? []).length === 0} skeleton={<ListSkeleton />} empty={<EmptyState icon={<IndianRupee />} title="No payments in this period" description="Change the dates to look further back." />}>
            <p className="mb-3 text-sm text-ink-muted">Received in this period: <span className="font-semibold text-ink tabular-nums">{formatMoney(received, currency)}</span> across {(history.data ?? []).filter((p) => p.status === 'valid').length} payment(s)</p>
            <TableWrap>
              <THead><tr><TH>Date</TH><TH>Event</TH><TH className="text-right">Amount</TH><TH>Method</TH><TH>Reference</TH><TH>Recorded by</TH><TH>Status</TH></tr></THead>
              <tbody>
                {(history.data ?? []).map((p) => (
                  <TR key={p.id} className={p.status === 'void' ? 'text-ink-muted' : ''}>
                    <TD className="whitespace-nowrap">{fmtDateOnly(p.paid_on)}</TD>
                    <TD>{p.project ? <Link to={`/events/${p.project.id}?tab=payments`} className="hover:underline">{p.project.name}</Link> : '—'}</TD>
                    <TD className={`text-right tabular-nums ${p.status === 'void' ? 'line-through' : 'font-medium'}`}>{formatMoney(Number(p.amount), currency)}</TD>
                    <TD>{PAYMENT_METHOD_LABELS[p.method]}</TD>
                    <TD className="max-w-40 truncate">{p.reference ?? '—'}</TD>
                    <TD>{p.recorded_by_name ?? '—'}</TD>
                    <TD><PaymentRowBadge status={p.status} /></TD>
                  </TR>
                ))}
              </tbody>
            </TableWrap>
          </DataState>
        </TabsContent>
      </Tabs>

      <PaymentDialog target={paying} onOpenChange={(o) => !o && setPaying(null)} />
    </>
  )
}
