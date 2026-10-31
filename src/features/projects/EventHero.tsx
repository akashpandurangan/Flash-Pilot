import { formatInTimeZone } from 'date-fns-tz'
import { CalendarClock, ChevronRight, Hourglass, IndianRupee, ListChecks, MapPin, Phone, Users } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import type { ProjectDetail } from '@/api/projects'
import { AvatarStack, Badge, Card } from '@/components/ui/display'
import { ProgressBar } from '@/components/ui/progress-bar'
import { BookingBadge, StageBadge, StageStepper } from '@/components/ui/status'
import { EVENT_TYPE_LABELS } from '@/lib/constants'
import { eventProgress } from '@/lib/dashboard'
import { formatMoney, type FinancialSummary } from '@/lib/money'
import { fmtDateTime, fmtTime } from '@/lib/time'
import { cn } from '@/lib/utils'
import type { ProductionTask, ProjectOverview } from '@/types/entities'
import { summarizeTeam } from './teamSummary'

function Fact({ icon, label, children, className }: { icon: ReactNode; label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0 p-3.5', className)}>
      <dt className="flex items-center gap-1.5 text-xs text-ink-muted"><span className="[&>svg]:size-3.5" aria-hidden>{icon}</span>{label}</dt>
      <dd className="mt-1 text-sm font-semibold">{children}</dd>
    </div>
  )
}

/**
 * The top of an event page: its name and status first, then who it is for, how far production has
 * come, and the handful of facts people look for (next session, venue, team, progress, balance).
 */
export function EventHero({ project: p, overview: o, tasks, finance, clientHref, currency, tz, actions }: {
  project: ProjectDetail
  overview?: ProjectOverview | null
  tasks?: ProductionTask[] | null
  /** null when the viewer has no financial access. */
  finance: FinancialSummary | null
  /** Where the client name links to; null when the viewer may not open clients. */
  clientHref: string | null
  currency: string
  tz: string
  actions?: ReactNode
}) {
  const sessions = p.project_events.filter((s) => !s.cancelled_at)
  const now = Date.now()
  const upcoming = sessions.find((s) => new Date(s.ends_at).getTime() >= now) ?? null
  const next = upcoming ?? sessions.at(-1) ?? null // finished events show their last session
  const venue = next?.venue_name || next?.venue_address || null
  const team = summarizeTeam(p)
  const done = tasks?.filter((t) => t.is_done).length ?? 0
  const progress = eventProgress(tasks ? { done, total: tasks.length } : null, p.production_stage)
  const confirmed = p.booking_status === 'confirmed'

  return (
    <div className="mb-5">
      <nav aria-label="Breadcrumb" className="mb-2.5">
        <ol className="flex items-center gap-1 text-[13px] text-ink-muted">
          <li><Link to="/events" className="hover:text-ink hover:underline">Events</Link></li>
          <li aria-hidden><ChevronRight className="size-3.5" /></li>
          <li aria-current="page" className="truncate font-medium text-ink">{p.name}</li>
        </ol>
      </nav>

      <Card className="rounded-panel p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 text-[13px] text-ink-muted">
              <span className="rounded-full bg-subtle px-2.5 py-0.5 font-mono text-xs font-medium text-ink">{p.project_code}</span>
              {EVENT_TYPE_LABELS[p.event_type]}
            </p>
            <h1 className="mt-2 text-2xl font-semibold leading-tight tracking-tight sm:text-[30px]">{p.name}</h1>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <BookingBadge status={p.booking_status} />
              {confirmed && <StageBadge stage={p.production_stage} />}
              {p.archived_at && <Badge tone="outline">Archived</Badge>}
              {o && (
                <span className="ml-1 inline-flex flex-wrap items-center gap-x-3 text-sm">
                  {clientHref ? <Link to={clientHref} className="font-medium underline-offset-2 hover:underline">{o.client_name}</Link> : <span className="font-medium">{o.client_name}</span>}
                  {o.client_phone && <a href={`tel:${o.client_phone.replace(/\s/g, '')}`} className="inline-flex items-center gap-1 text-ink-muted hover:text-ink"><Phone className="size-3.5" aria-hidden />{o.client_phone}</a>}
                </span>
              )}
            </div>
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </div>

        {confirmed && <StageStepper stage={p.production_stage} className="mt-4" />}
        {confirmed && p.production_stage === 'awaiting_approval' && (
          <p role="status" className="mt-3 flex items-start gap-2 rounded-xl bg-caution/30 px-3 py-2 text-[13px]">
            <Hourglass className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              <strong className="font-semibold">Waiting for client approval</strong>
              {p.shoot_completed_at ? ` since ${fmtDateTime(p.shoot_completed_at, tz)}` : ''}. Editing starts once the approval is recorded in the Production tab.
            </span>
          </p>
        )}

        <dl className={cn('mt-4 grid grid-cols-1 divide-y divide-line overflow-hidden rounded-xl border border-line sm:grid-cols-2 sm:divide-y-0 lg:divide-x', finance ? 'lg:grid-cols-5' : 'lg:grid-cols-4')}>
          <Fact icon={<CalendarClock />} label={upcoming ? 'Next session' : 'Last session'} className="sm:border-b sm:border-line lg:border-b-0">
            {next ? <>{formatInTimeZone(next.starts_at, tz, 'd MMM yyyy')}<span className="block text-xs font-normal text-ink-muted">{formatInTimeZone(next.starts_at, tz, 'EEEE')} · {fmtTime(next.starts_at, tz)}</span></> : <span className="text-ink-muted">No sessions</span>}
          </Fact>
          <Fact icon={<MapPin />} label="Venue" className="sm:border-b sm:border-line sm:border-l lg:border-b-0 lg:border-l-0">
            {venue ? <span className="line-clamp-2">{venue}</span> : <span className="font-normal text-warning">Not added yet</span>}
          </Fact>
          <Fact icon={<Users />} label="Team">
            <span className="flex flex-col items-start gap-1.5">
              <AvatarStack names={team.list.map((m) => m.name)} max={4} />
              <span className={cn('leading-tight', !team.assigned && 'font-normal text-warning')}>{team.text}</span>
            </span>
          </Fact>
          <Fact icon={<ListChecks />} label="Checklist" className="sm:border-l sm:border-line lg:border-l-0">
            <span className="flex items-center gap-3">
              <ProgressBar value={progress.percent} label={`${p.name} progress`} className="max-w-28" />
              <span className="tabular-nums">{progress.percent}%</span>
            </span>
            <span className="mt-1 block text-xs font-normal text-ink-muted">{progress.label}</span>
          </Fact>
          {finance && (
            <Fact icon={<IndianRupee />} label={finance.credit > 0 ? 'Credit' : 'Balance due'} className="sm:col-span-2 sm:border-t sm:border-line lg:col-span-1 lg:border-t-0">
              <span className="tabular-nums">{formatMoney(finance.credit > 0 ? finance.credit : finance.balance, currency)}</span>
              <span className="block text-xs font-normal text-ink-muted">of {formatMoney(finance.agreed, currency)} agreed</span>
            </Fact>
          )}
        </dl>
      </Card>
    </div>
  )
}
