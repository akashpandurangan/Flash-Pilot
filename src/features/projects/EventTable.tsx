import { CalendarDays, MapPin, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import { AvatarStack, Badge, Card, TableWrap, TD, TH, THead, TR } from '@/components/ui/display'
import { BookingBadge, PaymentStateBadge, StageBadge, StatusBadge } from '@/components/ui/status'
import { EVENT_TYPE_LABELS } from '@/lib/constants'
import { effectiveStage } from '@/lib/lifecycle'
import { formatMoney, summarizeFinancials } from '@/lib/money'
import { deliveryPaymentDue } from '@/lib/pending'
import { fmtDateShort } from '@/lib/time'
import { cn, pluralize } from '@/lib/utils'
import type { ProjectFinancials, ProjectOverview } from '@/types/entities'

/** Everything the list needs besides the rows themselves. */
export interface EventListContext {
  tz: string
  currency: string
  /** Venue label per event (see venueByEvent). */
  venues: Map<string, string>
  /** Employee id -> name, to show who is on each event. */
  people: Map<string, string>
  /** null when the viewer cannot see money - the payment column is then hidden. */
  finance: Map<string, ProjectFinancials> | null
  menu: (p: ProjectOverview) => ReactNode
}

const dateOf = (p: ProjectOverview) => p.next_event_at ?? p.first_event_at
const detailsHref = (p: ProjectOverview) => `/events/${p.id}`

/** Payment status; a loud warning instead when the event is out for delivery and still owes money. */
function PaymentCell({ p, ctx }: { p: ProjectOverview; ctx: EventListContext }) {
  const f = ctx.finance?.get(p.id)
  if (!f || p.booking_status === 'cancelled') return <span className="text-ink-muted">—</span>
  const due = deliveryPaymentDue(p, f)
  if (due !== null) {
    return (
      <StatusBadge tone="warning" className="gap-1">
        <TriangleAlert className="size-3" aria-hidden />
        <span>Payment pending · {formatMoney(due, ctx.currency)}</span>
      </StatusBadge>
    )
  }
  return <PaymentStateBadge state={summarizeFinancials(f.agreed_amount, [{ amount: f.paid_amount }]).state} />
}

function TeamCell({ p, ctx }: { p: ProjectOverview; ctx: EventListContext }) {
  const names = p.assigned_employee_ids.map((id) => ctx.people.get(id)).filter((n): n is string => !!n)
  if (names.length > 0) return <AvatarStack names={names} />
  return p.booking_status === 'cancelled' ? <span className="text-ink-muted">—</span> : <Badge tone="warning">Unstaffed</Badge>
}

/** The production stage the event is really in; cancelled events have no stage to show. */
function StageCell({ p }: { p: ProjectOverview }) {
  return p.booking_status === 'cancelled' ? <span className="text-ink-muted">—</span> : <StageBadge stage={effectiveStage(p)} />
}

/** Clicks on these (or anything inside them) belong to the control, not to the row. */
const INTERACTIVE = 'a, button, input, select, textarea, [role="menu"], [role="menuitem"], [data-no-row-click]'

/**
 * The events list as a table: one white card, a soft grey header pill, one row per event. The whole row opens the
 * event; the title is a real link (keyboard, middle-click, open in new tab), and the actions menu keeps its own clicks.
 */
export function EventTable({ rows, ctx }: { rows: ProjectOverview[]; ctx: EventListContext }) {
  const navigate = useNavigate()
  return (
    <TableWrap>
      <THead>
        <tr>
          <TH>Event</TH><TH>Client</TH><TH>Date</TH><TH>Venue</TH><TH>Team</TH><TH>Booking</TH><TH>Stage</TH>
          {ctx.finance && <TH>Payment</TH>}
          <TH className="w-12"><span className="sr-only">Actions</span></TH>
        </tr>
      </THead>
      <tbody>
        {rows.map((p) => {
          const d = dateOf(p)
          const venue = ctx.venues.get(p.id)
          return (
            <TR
              key={p.id}
              className="cursor-pointer has-[a:focus-visible]:bg-sidebar"
              onClick={(e) => { if (!(e.target as HTMLElement).closest(INTERACTIVE)) navigate(detailsHref(p)) }}
            >
              <TD className="py-4">
                <Link to={detailsHref(p)} className="block max-w-60 truncate font-semibold hover:underline">{p.name}</Link>
                <span className="text-xs text-ink-muted"><span className="font-mono">{p.project_code}</span> · {EVENT_TYPE_LABELS[p.event_type]}</span>
              </TD>
              <TD className="max-w-36 truncate">{p.client_name}</TD>
              <TD className="whitespace-nowrap">{d ? fmtDateShort(d, ctx.tz) : '—'}{p.event_count > 1 && <span className="ml-1.5 rounded-full bg-subtle px-1.5 py-0.5 text-xs text-ink-muted">{p.event_count} sessions</span>}</TD>
              <TD className="max-w-40 truncate text-ink-muted">{venue ?? '—'}</TD>
              <TD><TeamCell p={p} ctx={ctx} /></TD>
              <TD><BookingBadge status={p.booking_status} /></TD>
              <TD><StageCell p={p} /></TD>
              {ctx.finance && <TD><PaymentCell p={p} ctx={ctx} /></TD>}
              <TD>{ctx.menu(p)}</TD>
            </TR>
          )
        })}
      </tbody>
    </TableWrap>
  )
}

/**
 * One event as a card - used for the cards view, every list on phones and the dashboard's Events panel. The whole
 * card is one surface that opens the event: the title link stretches over it, while the actions menu sits above
 * that link (z-10), so clicking the menu never navigates.
 */
export function EventCardItem({ p, ctx, compact }: { p: ProjectOverview; ctx: EventListContext; compact?: boolean }) {
  const d = dateOf(p)
  const venue = ctx.venues.get(p.id)
  const owes = ctx.finance ? deliveryPaymentDue(p, ctx.finance.get(p.id)) !== null : false
  return (
    <Card
      className={cn(
        'relative flex h-full flex-col transition-[border-color,box-shadow] hover:border-line-strong hover:shadow-[0_8px_22px_-12px_rgb(23_23_27/0.28)] has-[a[data-card-link]:focus-visible]:ring-2 has-[a[data-card-link]:focus-visible]:ring-ink',
        compact ? 'p-3.5' : 'p-4 sm:p-5',
        owes && 'border-warning/50 hover:border-warning',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="font-mono text-xs text-ink-muted">{p.project_code}</span>
        <div className="relative z-10 flex items-center gap-1.5">
          <BookingBadge status={p.booking_status} />
          {ctx.menu(p)}
        </div>
      </div>
      <div className={cn('min-w-0', compact ? 'mt-2' : 'mt-3')}>
        <h3 className={cn('truncate font-semibold tracking-tight', compact ? 'text-[15px]' : 'text-base')}>
          <Link to={detailsHref(p)} data-card-link className="outline-none after:absolute after:inset-0 after:rounded-card">{p.name}</Link>
        </h3>
        <p className="truncate text-sm text-ink-muted">{p.client_name} · {EVENT_TYPE_LABELS[p.event_type]}</p>
      </div>
      <dl className={cn('space-y-1.5', compact ? 'mt-3 text-[13px]' : 'mt-4 text-sm')}>
        <div className="flex items-center gap-2"><CalendarDays className="size-4 shrink-0 text-ink-faint" aria-hidden /><dt className="sr-only">Date</dt><dd>{d ? fmtDateShort(d, ctx.tz) : 'No date'}<span className="text-ink-muted"> · {pluralize(p.event_count, 'session')}</span></dd></div>
        <div className="flex items-center gap-2"><MapPin className="size-4 shrink-0 text-ink-faint" aria-hidden /><dt className="sr-only">Venue</dt><dd className={cn('truncate', !venue && 'text-ink-muted')}>{venue ?? 'Venue to be confirmed'}</dd></div>
      </dl>
      <div className={cn('mt-auto flex flex-wrap items-center gap-2', compact ? 'pt-3' : 'pt-5')}>
        <TeamCell p={p} ctx={ctx} />
        <span className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
          <StageCell p={p} />
          {ctx.finance && <PaymentCell p={p} ctx={ctx} />}
        </span>
      </div>
    </Card>
  )
}
