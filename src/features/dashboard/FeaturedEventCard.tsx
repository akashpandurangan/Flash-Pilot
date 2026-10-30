import { Aperture, ArrowUpRight, CalendarCheck, CalendarClock, Clapperboard, Users } from 'lucide-react'
import { Link } from 'react-router'
import type { ProjectDetail } from '@/api/projects'
import { Avatar, Skeleton } from '@/components/ui/display'
import { ProgressBar } from '@/components/ui/progress-bar'
import { StageBadge } from '@/components/ui/status'
import { EVENT_TYPE_LABELS } from '@/lib/constants'
import { effectiveStage, eventProgress, type EventLite } from '@/lib/dashboard'
import { formatInTimeZone } from 'date-fns-tz'
import { countdownLabel, daysFromToday, fmtTime } from '@/lib/time'
import { cn, pluralize } from '@/lib/utils'
import type { BookingStatus, ProductionTask } from '@/types/entities'

const BOOKING_PILL: Record<BookingStatus, { label: string; cls: string }> = {
  confirmed: { label: 'Confirmed', cls: 'bg-accent text-ink' },
  inquiry: { label: 'Inquiry', cls: 'bg-caution text-ink' },
  cancelled: { label: 'Cancelled', cls: 'bg-risk text-white' },
}

/** One-line description of who is on the shoot, from the real assignments on the event's sessions. */
export function summarizeTeam(detail: ProjectDetail | null | undefined) {
  const people = new Map<string, { name: string; role: string }>()
  for (const s of detail?.project_events ?? []) {
    if (s.cancelled_at) continue
    for (const a of s.event_assignments ?? []) if (a.employee) people.set(a.employee_id, { name: a.employee.full_name, role: a.role })
  }
  const list = [...people.values()]
  const photographers = list.filter((p) => p.role === 'lead_photographer' || p.role === 'second_photographer').length
  const videographers = list.filter((p) => p.role === 'videographer').length
  const parts = [
    photographers && pluralize(photographers, 'photographer'),
    videographers && pluralize(videographers, 'videographer'),
    list.length - photographers - videographers > 0 && `${list.length - photographers - videographers} other`,
  ].filter(Boolean) as string[]
  return { list, text: parts.length ? parts.join(' · ') : 'Not assigned yet', assigned: list.length > 0 }
}

/**
 * The hero of the dashboard: the nearest upcoming event, with its key facts. The whole card opens the
 * event. Events don't have cover photos yet, so the top is a designed placeholder rather than a stock image.
 */
export function FeaturedEventCard({ event, detail, tasks, detailLoading, tz }: {
  event: EventLite
  detail?: ProjectDetail | null
  tasks?: ProductionTask[] | null
  detailLoading?: boolean
  tz: string
}) {
  const sessions = (detail?.project_events ?? []).filter((s) => !s.cancelled_at)
  const now = Date.now()
  const upcoming = sessions.find((s) => new Date(s.ends_at).getTime() >= now) ?? null
  const next = upcoming ?? sessions.at(-1) ?? null
  const venue = next?.venue_name || next?.venue_address || null
  const team = summarizeTeam(detail)
  const stage = effectiveStage(event, new Date(now))
  const done = tasks?.filter((t) => t.is_done).length ?? 0
  const progress = eventProgress(tasks ? { done, total: tasks.length } : null, stage)
  const pill = BOOKING_PILL[event.booking_status]
  const when = next?.starts_at ?? event.next_event_at ?? event.first_event_at

  return (
    <article className="group relative flex h-full flex-col rounded-panel border border-line bg-surface p-1.5 shadow-card" aria-label="Featured event">
      <div className="relative flex min-h-[10.5rem] flex-1">
        <div className="relative w-full overflow-hidden rounded-[18px] bg-dark" aria-hidden>
          <div
            className="absolute inset-0"
            style={{ backgroundImage: 'radial-gradient(120% 90% at 88% 0%, rgba(199,243,74,0.55), transparent 55%), linear-gradient(135deg, #1b1b21 0%, #2c2c35 100%)' }}
          />
          <Aperture className="absolute -right-10 -top-8 size-56 text-white/[0.07]" strokeWidth={1} />
          <div className="absolute bottom-[4.5rem] left-4 text-white">
            {when && <p className="text-3xl font-semibold leading-none tracking-tight">{countdownLabel(daysFromToday(when, tz, new Date(now)))}</p>}
            <p className="mt-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-white/70">
              {EVENT_TYPE_LABELS[event.event_type]}{event.event_count > 1 ? ` · ${event.event_count} sessions` : ''}
            </p>
          </div>
        </div>
        <div className="absolute inset-x-3 top-3 flex items-start justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-surface px-3 py-1.5 text-xs font-semibold shadow-card">
            <CalendarCheck className="size-3.5" aria-hidden />
            <span className="font-mono tracking-tight">{event.project_code}</span>
          </span>
          <span className={cn('inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold', pill.cls)}>
            <span className="size-1.5 rounded-full bg-ink" aria-hidden />{pill.label}
          </span>
        </div>
      </div>

      <div className="relative z-10 -mt-14 mx-2 mb-2 rounded-[18px] bg-surface p-4 shadow-pop ring-1 ring-line sm:mx-3 sm:mb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-xl font-semibold leading-tight tracking-tight sm:text-[22px]">{event.name}</h2>
            <p className="mt-0.5 truncate text-[13px] text-ink-muted md:text-sm">{event.client_name} · {venue ?? 'Venue to be confirmed'}</p>
          </div>
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-subtle transition-colors group-hover:bg-accent" aria-hidden>
            <ArrowUpRight className="size-4" />
          </span>
        </div>

        <div className="mt-3.5 flex items-center gap-3">
          <ProgressBar value={progress.percent} label={`${event.name} progress`} className="h-2" />
          <span className="text-[13px] font-semibold tabular-nums">{progress.percent}%</span>
        </div>
        <p className="mt-1 text-xs text-ink-muted">{progress.basis === 'checklist' ? `Checklist: ${progress.label}` : `Production: ${progress.label}`}</p>

        <dl className="mt-3.5 grid grid-cols-1 divide-y divide-line overflow-hidden rounded-xl border border-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <div className="p-3">
            <dt className="flex items-center gap-1.5 text-xs text-ink-muted"><CalendarClock className="size-3.5" aria-hidden /> {upcoming ? 'Next session' : 'Last session'}</dt>
            <dd className="mt-1 text-[13px] font-semibold">
              {when ? <>{formatInTimeZone(when, tz, 'd MMM yyyy')}<span className="block text-xs font-normal text-ink-muted">{formatInTimeZone(when, tz, 'EEEE')} · {fmtTime(when, tz)}</span></> : 'No date set'}
            </dd>
          </div>
          <div className="p-3">
            <dt className="flex items-center gap-1.5 text-xs text-ink-muted"><Clapperboard className="size-3.5" aria-hidden /> Production</dt>
            <dd className="mt-1.5"><StageBadge stage={stage} /></dd>
          </div>
          <div className="p-3">
            <dt className="flex items-center gap-1.5 text-xs text-ink-muted"><Users className="size-3.5" aria-hidden /> Team</dt>
            <dd className="mt-1">
              {detailLoading ? <Skeleton className="h-5 w-24" /> : (
                <div className="flex flex-col items-start gap-1">
                  {team.list.length > 0 && (
                    <span className="flex -space-x-1.5">
                      {team.list.slice(0, 4).map((p) => <Avatar key={p.name} name={p.name} className="size-7 bg-subtle text-[10px] ring-2 ring-surface" />)}
                    </span>
                  )}
                  <span className={cn('text-[13px] font-semibold leading-tight', !team.assigned && 'text-warning')}>{team.text}</span>
                </div>
              )}
            </dd>
          </div>
        </dl>
      </div>

      {/* One link over the whole card, so the event opens from anywhere on it. */}
      <Link
        to={`/events/${event.id}`}
        aria-label={`Open ${event.name}`}
        className="absolute inset-0 z-20 rounded-panel outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2"
      />
    </article>
  )
}
