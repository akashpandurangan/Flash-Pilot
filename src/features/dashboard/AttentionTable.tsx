import { ChevronDown, ChevronUp, CircleCheck } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import { Card, EmptyState, TableWrap, TD, TH, THead } from '@/components/ui/display'
import { SEVERITY_LABELS, type ActionItem, type Severity } from '@/lib/alerts'
import { formatMoney } from '@/lib/money'
import { fmtDateShort } from '@/lib/time'
import { cn } from '@/lib/utils'

const ROWS_COLLAPSED = 6

function RiskBadge({ severity }: { severity: Severity }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold',
        severity === 'high' && 'bg-danger-solid text-white',
        severity === 'medium' && 'bg-warning-soft text-warning',
        severity === 'low' && 'bg-subtle text-ink-muted',
      )}
    >
      {SEVERITY_LABELS[severity]}
    </span>
  )
}

/**
 * Events that need someone to do something. One row per problem; the whole row opens the event, and
 * the button names the fix ("Assign team", "Record payment"…). On phones each row becomes a card.
 */
export function AttentionTable({ items, tz, currency, eventCount, updatedLabel }: { items: ActionItem[]; tz: string; currency: string; eventCount: number; updatedLabel?: string }) {
  const navigate = useNavigate()
  // events out for delivery that still owe money: how many, and how much
  const payments = items.filter((i) => i.kind === 'delivery_payment')
  const owed = payments.reduce((sum, i) => sum + (i.amount ?? 0), 0)
  const [expanded, setExpanded] = useState(false)
  const shown = expanded ? items : items.slice(0, ROWS_COLLAPSED)

  return (
    <section id="needs-attention" tabIndex={-1} aria-labelledby="needs-attention-title" className="scroll-mt-24 outline-none">
      <Card className="rounded-panel p-4 sm:p-5">
        <div className="mb-3">
          <h2 id="needs-attention-title" className="text-lg font-semibold tracking-tight">Needs attention</h2>
          <p className="mt-0.5 text-xs text-ink-muted">
            {items.length === 0 ? 'Nothing is flagged right now' : `${eventCount} ${eventCount === 1 ? 'event' : 'events'} flagged`}
            {payments.length > 0 && ` · ${formatMoney(owed, currency)} payment pending on ${payments.length} ${payments.length === 1 ? 'delivery' : 'deliveries'}`}
            {updatedLabel ? ` · ${updatedLabel}` : ''}
          </p>
        </div>

        {items.length === 0 ? (
          <EmptyState icon={<CircleCheck />} title="You're all caught up" description="Unstaffed sessions, overdue work and unpaid deliveries will appear here." className="border-0 bg-subtle/60 py-8" />
        ) : (
          <>
            <div className="hidden md:block">
              <TableWrap className="border-0 p-0 shadow-none">
                <THead>
                  <tr><TH>Event</TH><TH>Client</TH><TH>Date</TH><TH>Issue</TH><TH>Status</TH><TH className="text-right"><span className="sr-only">Action</span></TH></tr>
                </THead>
                <tbody>
                  {shown.map((i) => (
                    <tr
                      key={i.id}
                      onClick={() => navigate(i.href)}
                      className="cursor-pointer hover:bg-sidebar [&>td]:border-b [&>td]:border-line last:[&>td]:border-b-0"
                    >
                      <TD className="py-3">
                        <Link to={i.href} onClick={(e) => e.stopPropagation()} className="block max-w-56 truncate font-medium hover:underline">{i.projectName}</Link>
                      </TD>
                      <TD className="max-w-40 truncate text-ink-muted">{i.clientName ?? '—'}</TD>
                      <TD className="whitespace-nowrap text-ink-muted">{i.date ? fmtDateShort(i.date, tz) : '—'}</TD>
                      <TD className="max-w-52 font-medium">{i.issue}</TD>
                      <TD><RiskBadge severity={i.severity} /></TD>
                      <TD className="text-right">
                        <Button asChild variant="secondary" size="sm"><Link to={i.href} onClick={(e) => e.stopPropagation()}>{i.actionLabel}</Link></Button>
                      </TD>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            </div>

            <ul className="space-y-2 md:hidden">
              {shown.map((i) => (
                <li key={i.id}>
                  <Link to={i.href} className="block rounded-xl border border-line p-3.5 transition-colors hover:bg-sidebar">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{i.projectName}</p>
                        <p className="truncate text-xs text-ink-muted">{[i.clientName, i.date && fmtDateShort(i.date, tz)].filter(Boolean).join(' · ')}</p>
                      </div>
                      <RiskBadge severity={i.severity} />
                    </div>
                    <p className="mt-2 text-[13px] font-medium">{i.issue}</p>
                    <p className="mt-0.5 text-xs text-ink-muted">{i.actionLabel} →</p>
                  </Link>
                </li>
              ))}
            </ul>

            {items.length > ROWS_COLLAPSED && (
              <div className="mt-3 flex justify-center">
                <Button variant="secondary" size="sm" onClick={() => setExpanded((e) => !e)} aria-expanded={expanded}>
                  {expanded ? <>Show fewer <ChevronUp className="size-4" /></> : <>Show all {items.length} <ChevronDown className="size-4" /></>}
                </Button>
              </div>
            )}
          </>
        )}
      </Card>
    </section>
  )
}
