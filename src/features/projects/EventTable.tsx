import { CalendarDays, MapPin } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { AvatarStack, Badge, Card, TableWrap, TD, TH, THead, TR } from '@/components/ui/display'
import { BookingBadge, PaymentStateBadge, StageBadge } from '@/components/ui/status'
import { EVENT_TYPE_LABELS } from '@/lib/constants'
import { summarizeFinancials } from '@/lib/money'
import { fmtDateShort } from '@/lib/time'
import { cn } from '@/lib/utils'
import type { ProjectFinancials, ProjectOverview } from '@/types/entities'

/** Everything the list needs besides the rows themselves. */
export interface EventListContext {
  tz: string
  /** Venue label per event (see venueByEvent). */
  venues: Map<string, string>
  /** Employee id -> name, to show who is on each event. */
  people: Map<string, string>
  /** null when the viewer cannot see money - the payment column is then hidden. */
  finance: Map<string, ProjectFinancials> | null
  menu: (p: ProjectOverview) => ReactNode
}

const dateOf = (p: ProjectOverview) => p.next_event_at ?? p.first_event_at

function PaymentCell({ p, finance }: { p: ProjectOverview; finance: Map<string, ProjectFinancials> }) {
  const f = finance.get(p.id)
  if (!f || p.booking_status === 'cancelled') return <span className="text-ink-muted">—</span>
  return <PaymentStateBadge state={summarizeFinancials(f.agreed_amount, [{ amount: f.paid_amount }]).state} />
}

function TeamCell({ p, ctx }: { p: ProjectOverview; ctx: EventListContext }) {
  const names = p.assigned_employee_ids.map((id) => ctx.people.get(id)).filter((n): n is string => !!n)
  if (names.length > 0) return <AvatarStack names={names} />
  return p.booking_status === 'cancelled' ? <span className="text-ink-muted">—</span> : <Badge tone="warning">Unstaffed</Badge>
}

/** The events list as a table: one white card, a soft grey header pill, one row per event. */
export function EventTable({ rows, ctx }: { rows: ProjectOverview[]; ctx: EventListContext }) {
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
            <TR key={p.id}>
              <TD className="py-4">
                <Link to={`/events/${p.id}`} className="block max-w-60 truncate font-semibold hover:underline">{p.name}</Link>
                <span className="text-xs text-ink-muted"><span className="font-mono">{p.project_code}</span> · {EVENT_TYPE_LABELS[p.event_type]}</span>
              </TD>
              <TD className="max-w-36 truncate">{p.client_name}</TD>
              <TD className="whitespace-nowrap">{d ? fmtDateShort(d, ctx.tz) : '—'}{p.event_count > 1 && <span className="ml-1.5 rounded-full bg-subtle px-1.5 py-0.5 text-xs text-ink-muted">+{p.event_count - 1}</span>}</TD>
              <TD className="max-w-40 truncate text-ink-muted">{venue ?? '—'}</TD>
              <TD><TeamCell p={p} ctx={ctx} /></TD>
              <TD><BookingBadge status={p.booking_status} /></TD>
              <TD>{p.booking_status === 'confirmed' ? <StageBadge stage={p.production_stage} /> : <span className="text-ink-muted">—</span>}</TD>
              {ctx.finance && <TD><PaymentCell p={p} finance={ctx.finance} /></TD>}
              <TD>{ctx.menu(p)}</TD>
            </TR>
          )
        })}
      </tbody>
    </TableWrap>
  )
}

/** One event as a card - used for the cards view and for every list on phones. */
export function EventCardItem({ p, ctx }: { p: ProjectOverview; ctx: EventListContext }) {
  const d = dateOf(p)
  const venue = ctx.venues.get(p.id)
  return (
    <Card className="flex h-full flex-col p-4 transition-colors hover:border-line-strong sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <span className="font-mono text-xs text-ink-muted">{p.project_code}</span>
        <div className="flex items-center gap-1.5">
          <BookingBadge status={p.booking_status} />
          {ctx.menu(p)}
        </div>
      </div>
      <Link to={`/events/${p.id}`} className="mt-3 block min-w-0">
        <h3 className="truncate text-base font-semibold tracking-tight hover:underline">{p.name}</h3>
        <p className="truncate text-sm text-ink-muted">{p.client_name} · {EVENT_TYPE_LABELS[p.event_type]}</p>
      </Link>
      <dl className="mt-4 space-y-1.5 text-sm">
        <div className="flex items-center gap-2"><CalendarDays className="size-4 shrink-0 text-ink-faint" aria-hidden /><dt className="sr-only">Date</dt><dd>{d ? fmtDateShort(d, ctx.tz) : 'No date'}{p.event_count > 1 && <span className="text-ink-muted"> · +{p.event_count - 1} more</span>}</dd></div>
        <div className="flex items-center gap-2"><MapPin className="size-4 shrink-0 text-ink-faint" aria-hidden /><dt className="sr-only">Venue</dt><dd className={cn('truncate', !venue && 'text-ink-muted')}>{venue ?? 'Venue to be confirmed'}</dd></div>
      </dl>
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-5">
        <TeamCell p={p} ctx={ctx} />
        <span className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
          {p.booking_status === 'confirmed' && <StageBadge stage={p.production_stage} />}
          {ctx.finance && <PaymentCell p={p} finance={ctx.finance} />}
        </span>
      </div>
    </Card>
  )
}
