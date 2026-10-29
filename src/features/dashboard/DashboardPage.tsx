import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Camera, CalendarDays, CheckCircle2, Clapperboard, Contact, FolderKanban, IndianRupee, Truck, UsersRound, Zap } from 'lucide-react'
import { useMemo } from 'react'
import { Link } from 'react-router'
import { getDashboardKpis } from '@/api/dashboard'
import { listFinancials } from '@/api/payments'
import { listActiveProjects, listRecentActivity } from '@/api/projects'
import { listInventory, listScheduleEvents } from '@/api/schedule'
import { Button } from '@/components/ui/button'
import { Avatar, Badge, EmptyState, ErrorState, PageHeader, Panel, Skeleton, StatCard } from '@/components/ui/display'
import { BookingBadge } from '@/components/ui/status'
import { PRODUCTION_STAGES, PRODUCTION_STAGE_LABELS } from '@/lib/constants'
import { formatMoney } from '@/lib/money'
import { buildActionItems, type ActionItem } from '@/lib/alerts'
import { toConflictEvent } from '@/lib/schedule'
import { fmtTime, relativeDayLabel } from '@/lib/time'
import { cn, pluralize } from '@/lib/utils'
import { ActivityTimeline } from '@/features/projects/ActivityTimeline'
import { useStudio } from '@/features/studio/StudioProvider'

export default function DashboardPage() {
  const { studio, me, tz, currency, can, role } = useStudio()
  const isStaff = can('projects.manage')
  const canFinance = can('finance.view')

  const kpis = useQuery({ queryKey: ['dashboard', studio.id], queryFn: () => getDashboardKpis(studio.id) })
  const schedule = useQuery({
    queryKey: ['schedule', studio.id, 'dashboard'],
    queryFn: () => listScheduleEvents({ studioId: studio.id, from: new Date().toISOString(), to: new Date(Date.now() + 60 * 86_400_000).toISOString() }),
  })
  const projects = useQuery({ queryKey: ['projects', 'active', studio.id], queryFn: () => listActiveProjects(studio.id) })
  const financials = useQuery({ queryKey: ['financials', studio.id], queryFn: () => listFinancials(studio.id), enabled: canFinance })
  const inventory = useQuery({ queryKey: ['inventory', studio.id], queryFn: () => listInventory(studio.id), enabled: isStaff })
  const activity = useQuery({ queryKey: ['activity', studio.id], queryFn: () => listRecentActivity(studio.id, 10) })

  const clientByProject = useMemo(() => new Map((projects.data ?? []).map((p) => [p.id, p.client_name])), [projects.data])

  const upcoming = useMemo(
    () => (schedule.data ?? []).filter((e) => e.project.booking_status !== 'cancelled' && !e.project.archived_at && new Date(e.ends_at).getTime() >= Date.now()).slice(0, 8),
    [schedule.data],
  )

  const actions = useMemo(() => {
    if (!isStaff || !schedule.data || !projects.data) return []
    return buildActionItems({
      events: schedule.data.map(toConflictEvent), projects: projects.data, financials: canFinance ? (financials.data ?? []) : null,
      inventory: inventory.data ?? [], tz, currency,
    })
  }, [isStaff, schedule.data, projects.data, financials.data, inventory.data, canFinance, tz, currency])

  const k = kpis.data
  const brandNew = !!k && !projects.isLoading && (projects.data?.length ?? 0) === 0 && (schedule.data?.length ?? 0) === 0

  const firstName = me.full_name.split(' ')[0]
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: tz }).format(new Date()))
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  return (
    <>
      <PageHeader
        title={`${greeting}, ${firstName}`}
        description={role === 'photographer' || role === 'editor' ? 'Here is the work assigned to you.' : `Here's what's happening at ${studio.name}.`}
        actions={isStaff && <Button asChild><Link to="/projects/new"><FolderKanban className="size-4" /> New project</Link></Button>}
      />

      {kpis.isError && <div className="mb-6"><ErrorState error={kpis.error} onRetry={() => void kpis.refetch()} /></div>}

      <section aria-label="Key numbers" className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {kpis.isLoading ? Array.from({ length: canFinance ? 6 : 5 }, (_, i) => <Skeleton key={i} className="h-24" />) : k && (
          <>
            <StatCard label="Active projects" value={k.active_projects} hint={k.inquiries > 0 ? pluralize(k.inquiries, 'inquiry', 'inquiries') : 'Confirmed & in progress'} to="/projects?booking=confirmed" icon={<FolderKanban />} />
            <StatCard label="Upcoming events" value={k.upcoming_events} to="/calendar?view=list" icon={<CalendarDays />} />
            <StatCard label="Today" value={k.today_events} hint={k.today_events === 1 ? 'event today' : 'events today'} to="/calendar?view=day" icon={<Zap />} />
            {canFinance && <StatCard label="Outstanding" value={formatMoney(k.outstanding_amount ?? 0, currency)} hint="Still to collect" to="/payments" icon={<IndianRupee />} />}
            <StatCard label="In production" value={k.in_production} to="/projects?stage=production" icon={<Camera />} />
            <StatCard label="Pending delivery" value={k.pending_delivery} hint="Editing or ready" to="/projects?stage=editing" icon={<Truck />} />
          </>
        )}
      </section>

      {brandNew ? (
        <GettingStarted canManage={isStaff} />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
          <div className="min-w-0 space-y-4">
            <Panel title="Upcoming events" description="Next on the schedule" action={<Button variant="ghost" size="sm" asChild><Link to="/calendar">Calendar</Link></Button>} bodyClassName="p-0">
              {schedule.isLoading ? <div className="space-y-2 p-4"><Skeleton className="h-14" /><Skeleton className="h-14" /><Skeleton className="h-14" /></div>
                : schedule.isError ? <div className="p-4"><ErrorState error={schedule.error} onRetry={() => void schedule.refetch()} /></div>
                : upcoming.length === 0 ? <div className="p-4"><EmptyState icon={<CalendarDays />} title="No upcoming events" description={isStaff ? 'Create a project to put events on the calendar.' : 'You have no upcoming assignments.'} /></div>
                : (
                  <ul className="divide-y divide-line">
                    {upcoming.map((e) => {
                      const photographers = (e.event_assignments ?? []).filter((a) => a.role === 'lead_photographer' || a.role === 'second_photographer')
                      return (
                        <li key={e.id}>
                          <Link to={`/projects/${e.project_id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3 hover:bg-sidebar">
                            <div className="w-24 shrink-0">
                              <p className="text-sm font-semibold">{relativeDayLabel(e.starts_at, tz).replace(/^\w{3}, /, '')}</p>
                              <p className="text-xs tabular-nums text-ink-muted">{fmtTime(e.starts_at, tz)}</p>
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium">{e.project.name} <span className="font-normal text-ink-muted">· {e.title}</span></p>
                              <p className="truncate text-xs text-ink-muted">{[clientByProject.get(e.project_id), e.venue_name].filter(Boolean).join(' · ') || 'No venue yet'}</p>
                            </div>
                            <div className="flex items-center gap-2">
                              {photographers.length > 0 ? (
                                <span className="flex -space-x-1.5" title={photographers.map((a) => a.employee?.full_name).join(', ')}>
                                  {photographers.slice(0, 3).map((a) => <Avatar key={a.id} name={a.employee?.full_name} className="size-6 border-2 border-canvas text-[10px]" />)}
                                </span>
                              ) : isStaff ? <Badge tone="warning">Unstaffed</Badge> : null}
                              <BookingBadge status={e.project.booking_status} />
                            </div>
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                )}
            </Panel>

            <Panel title="Production overview" description="Confirmed projects by stage">
              {kpis.isLoading ? <Skeleton className="h-32" /> : <StageBars counts={k?.stage_counts ?? {}} />}
            </Panel>
          </div>

          <div className="min-w-0 space-y-4">
            {isStaff && (
              <Panel title="Action required" description={actions.length ? `${actions.length} ${actions.length === 1 ? 'item needs' : 'items need'} attention` : undefined} bodyClassName="p-0">
                {schedule.isLoading || projects.isLoading ? <div className="space-y-2 p-4"><Skeleton className="h-12" /><Skeleton className="h-12" /></div>
                  : actions.length === 0 ? (
                    <div className="flex items-center gap-3 p-4 text-sm text-ink-muted"><CheckCircle2 className="size-5 shrink-0 text-success" aria-hidden /> You're all caught up - nothing needs attention.</div>
                  ) : (
                    <ul className="max-h-[26rem] divide-y divide-line overflow-y-auto">{actions.slice(0, 12).map((a) => <ActionRow key={a.id} item={a} />)}</ul>
                  )}
              </Panel>
            )}
            <Panel title="Recent activity" bodyClassName="p-0">
              <ActivityTimeline query={activity} showProject empty="Activity will appear here as you work." />
            </Panel>
          </div>
        </div>
      )}
    </>
  )
}

function ActionRow({ item }: { item: ActionItem }) {
  return (
    <li>
      <Link to={item.href} className="flex items-start gap-3 px-4 py-3 hover:bg-sidebar">
        <AlertTriangle className={cn('mt-0.5 size-4 shrink-0', item.severity === 'high' ? 'text-danger' : item.severity === 'medium' ? 'text-warning' : 'text-ink-muted')} aria-hidden />
        <span className="min-w-0 text-sm"><span className="block font-medium">{item.title}</span><span className="block truncate text-xs text-ink-muted">{item.detail}</span></span>
      </Link>
    </li>
  )
}

function StageBars({ counts }: { counts: Partial<Record<(typeof PRODUCTION_STAGES)[number], number>> }) {
  const total = PRODUCTION_STAGES.reduce((s, st) => s + Number(counts[st] ?? 0), 0)
  if (total === 0) return <p className="py-4 text-center text-sm text-ink-muted">No confirmed projects yet.</p>
  const max = Math.max(...PRODUCTION_STAGES.map((s) => Number(counts[s] ?? 0)))
  return (
    <ul className="space-y-3">
      {PRODUCTION_STAGES.map((s) => {
        const n = Number(counts[s] ?? 0)
        return (
          <li key={s}>
            <Link to={`/projects?booking=confirmed&stage=${s}`} className="group block">
              <div className="mb-1 flex justify-between text-sm"><span className="group-hover:underline">{PRODUCTION_STAGE_LABELS[s]}</span><span className="tabular-nums font-medium">{n}</span></div>
              <div className="h-2 rounded-full bg-subtle" role="presentation"><div className="h-full rounded-full bg-ink transition-[width]" style={{ width: `${max ? (n / max) * 100 : 0}%` }} /></div>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

function GettingStarted({ canManage }: { canManage: boolean }) {
  if (!canManage) {
    return <EmptyState icon={<CalendarDays />} title="Nothing assigned yet" description="When the studio assigns you to an event or an edit it will show up here, and you'll get a reminder the day before." />
  }
  const steps = [
    { to: '/clients', icon: <Contact />, title: 'Add a client', body: 'Contact details and every project in one place.' },
    { to: '/projects/new', icon: <Clapperboard />, title: 'Create a project', body: 'Events, venue, amount, advance - captured once.' },
    { to: '/team', icon: <UsersRound />, title: 'Build your team', body: 'Photographers, videographers and editors.' },
    { to: '/equipment', icon: <Camera />, title: 'List your equipment', body: 'Reserve gear and catch double-bookings.' },
  ]
  return (
    <Panel title="Let's get your studio going" description="Four steps and Flash Pilot starts working for you. The dashboard fills in as you go.">
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {steps.map((s, i) => (
          <li key={s.to}>
            <Link to={s.to} className="flex h-full flex-col rounded-lg border border-line p-4 transition-colors hover:border-ink hover:bg-sidebar">
              <span className="mb-3 flex size-9 items-center justify-center rounded-full bg-subtle [&>svg]:size-4" aria-hidden>{s.icon}</span>
              <span className="text-xs text-ink-muted">Step {i + 1}</span>
              <span className="text-sm font-semibold">{s.title}</span>
              <span className="mt-1 text-[13px] text-ink-muted">{s.body}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
