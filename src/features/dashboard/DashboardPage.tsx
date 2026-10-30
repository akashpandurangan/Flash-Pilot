import { useQuery } from '@tanstack/react-query'
import { formatDistanceToNowStrict } from 'date-fns'
import { Camera, CalendarCheck, Clapperboard, Contact, TriangleAlert, UsersRound } from 'lucide-react'
import { useMemo } from 'react'
import { Link } from 'react-router'
import { getDashboardKpis } from '@/api/dashboard'
import { listFinancials } from '@/api/payments'
import { getProject, listActiveProjects, listRecentActivity, listTasks } from '@/api/projects'
import { listInventory, listScheduleEvents } from '@/api/schedule'
import { HeaderContent } from '@/components/layout/header-slot'
import { ActivityFeed } from '@/components/ui/activity-feed'
import { Card, EmptyState, ErrorState, Panel, Skeleton } from '@/components/ui/display'
import { MetricCard } from '@/components/ui/metric-card'
import { buildActionItems, countAttentionEvents } from '@/lib/alerts'
import { attentionHeadline, buildInsights, computeEventKpis, pickFeaturedEvent } from '@/lib/dashboard'
import { formatMoney } from '@/lib/money'
import { toConflictEvent } from '@/lib/schedule'
import { cn } from '@/lib/utils'
import { useStudio } from '@/features/studio/StudioProvider'
import { useNow } from '@/hooks/hooks'
import { AttentionTable } from './AttentionTable'
import { EventPipeline } from './EventPipeline'
import { FeaturedEventCard } from './FeaturedEventCard'
import { InsightCard } from './InsightCard'

const scrollToAttention = () => {
  const el = document.getElementById('needs-attention')
  el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  el?.focus({ preventScroll: true })
}

const ago = (ts: number, now: number) => (now - ts < 60_000 ? 'updated just now' : `updated ${formatDistanceToNowStrict(ts)} ago`)

export default function DashboardPage() {
  const { studio, me, tz, currency, can } = useStudio()
  const isStaff = can('projects.manage')
  const canFinance = can('finance.view')
  const now = useNow()

  const kpis = useQuery({ queryKey: ['dashboard', studio.id], queryFn: () => getDashboardKpis(studio.id) })
  const projects = useQuery({ queryKey: ['projects', 'active', studio.id], queryFn: () => listActiveProjects(studio.id) })
  const schedule = useQuery({
    queryKey: ['schedule', studio.id, 'dashboard'],
    queryFn: () => listScheduleEvents({ studioId: studio.id, from: new Date().toISOString(), to: new Date(Date.now() + 60 * 86_400_000).toISOString() }),
  })
  const financials = useQuery({ queryKey: ['financials', studio.id], queryFn: () => listFinancials(studio.id), enabled: canFinance })
  const inventory = useQuery({ queryKey: ['inventory', studio.id], queryFn: () => listInventory(studio.id), enabled: isStaff })
  const activity = useQuery({ queryKey: ['activity', studio.id], queryFn: () => listRecentActivity(studio.id, 8) })

  const events = useMemo(() => projects.data ?? [], [projects.data])
  const featured = useMemo(() => pickFeaturedEvent(events), [events])
  const featuredDetail = useQuery({ queryKey: ['project', featured?.id], queryFn: () => getProject(featured!.id), enabled: !!featured })
  const featuredTasks = useQuery({ queryKey: ['project-tasks', featured?.id], queryFn: () => listTasks(featured!.id), enabled: !!featured })

  const items = useMemo(() => {
    if (!isStaff || !schedule.data || !projects.data) return []
    return buildActionItems({
      events: schedule.data.map(toConflictEvent), projects: projects.data, financials: canFinance ? (financials.data ?? []) : null,
      inventory: inventory.data ?? [], tz, currency,
    })
  }, [isStaff, schedule.data, projects.data, financials.data, inventory.data, canFinance, tz, currency])

  const k = kpis.data
  const derived = useMemo(() => computeEventKpis(events, items, new Date(now)), [events, items, now])
  const insights = useMemo(() => buildInsights(items, events, new Date(now)), [items, events, now])
  const attentionEvents = countAttentionEvents(items)
  const stages = k?.stage_counts ?? {}

  // sessions assigned in the next 7 days - the fourth card for people who don't manage the studio
  const sessionsThisWeek = useMemo(
    () => (schedule.data ?? []).filter((s) => s.project.booking_status !== 'cancelled' && new Date(s.starts_at).getTime() - now <= 7 * 86_400_000 && new Date(s.ends_at).getTime() >= now).length,
    [schedule.data, now],
  )

  const loading = kpis.isLoading || projects.isLoading
  const brandNew = !loading && !kpis.isError && !projects.isError && events.length === 0
  const updatedAt = Math.max(schedule.dataUpdatedAt, projects.dataUpdatedAt, 0)
  const updatedLabel = updatedAt ? ago(updatedAt, now) : undefined

  const firstName = me.full_name.split(' ')[0]
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: tz }).format(new Date(now)))
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  const attentionPill = isStaff && attentionEvents > 0 && (
    <button
      type="button"
      onClick={scrollToAttention}
      className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3.5 py-1.5 text-[13px] font-semibold text-ink transition-colors hover:bg-accent-hover"
    >
      <TriangleAlert className="size-3.5" aria-hidden />
      {attentionEvents} {attentionEvents === 1 ? 'event needs' : 'events need'} attention
    </button>
  )

  return (
    <>
      {/* From `sm` up the greeting shares the header row with search, notifications and "New Event". */}
      <HeaderContent>
        <h2 className="truncate text-lg font-semibold tracking-tight sm:hidden">Overview</h2>
        <div className="hidden min-w-0 flex-wrap items-center gap-x-4 gap-y-2 sm:flex">
          <div className="min-w-0">
            <h1 className="truncate text-[28px] font-semibold leading-tight tracking-tight min-[1440px]:text-[30px]">{greeting}, {firstName}</h1>
            <p className="truncate text-[13px] text-ink-muted md:text-sm">Here's what's happening at your studio today.</p>
          </div>
          {attentionPill}
        </div>
      </HeaderContent>
      {/* On phones four header buttons leave no room for it, so it sits at the top of the page instead. */}
      <div className="mb-4 sm:hidden">
        <h1 className="text-2xl font-semibold leading-tight tracking-tight">{greeting}, {firstName}</h1>
        <p className="mt-0.5 text-[13px] text-ink-muted">Here's what's happening at your studio today.</p>
        {attentionPill && <div className="mt-3">{attentionPill}</div>}
      </div>

      {(kpis.isError || projects.isError) && (
        <div className="mb-4"><ErrorState error={kpis.error ?? projects.error} onRetry={() => { void kpis.refetch(); void projects.refetch() }} /></div>
      )}

      {brandNew ? <GettingStarted canManage={isStaff} /> : (
        <div className={cn('dash-grid', !isStaff && 'dash-grid--crew', !loading && !featured && 'dash-grid--no-featured')}>
          <section className="dash-kpi" aria-label="Key numbers">
            <Card className="rounded-panel p-4 sm:p-5">
              <h2 className="mb-3 px-0.5 text-[17px] font-semibold tracking-tight">Studio overview</h2>
              <div className={cn('grid grid-cols-2 gap-3 md:grid-cols-4', loading || featured ? 'xl:grid-cols-2' : 'xl:grid-cols-4')}>
                {loading ? Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-28 rounded-card" />) : (
                  <>
                    <MetricCard tone="dark" label="Upcoming events" value={derived.upcoming} hint={`${derived.upcomingNext7} in the next 7 days`} to="/events?stage=upcoming" />
                    <MetricCard label="In production" value={stages.production ?? 0} hint={derived.awaitingEditing > 0 ? `${derived.awaitingEditing} shot, awaiting editing` : 'Shoots in progress'} to="/events?stage=production" />
                    <MetricCard label="Editing in progress" value={stages.editing ?? 0} hint={`${stages.ready_for_delivery ?? 0} ready for delivery`} to="/events?stage=editing" />
                    {isStaff ? (
                      <MetricCard
                        label="Needs attention"
                        value={attentionEvents}
                        hint={canFinance && k?.outstanding_amount ? `${formatMoney(k.outstanding_amount, currency)} outstanding` : attentionEvents === 0 ? 'All clear' : 'Events with open issues'}
                        onClick={scrollToAttention}
                      />
                    ) : (
                      <MetricCard label="Assigned this week" value={sessionsThisWeek} hint="Sessions in the next 7 days" to="/calendar?view=list" />
                    )}
                  </>
                )}
              </div>
            </Card>
          </section>

          <div className="dash-featured">
            {loading ? <Skeleton className="h-[22rem] rounded-panel" /> : featured ? (
              <FeaturedEventCard event={featured} detail={featuredDetail.data} tasks={featuredTasks.data ?? null} detailLoading={featuredDetail.isLoading} tz={tz} />
            ) : (
              <EmptyState
                className="h-full min-h-40 rounded-panel"
                icon={<CalendarCheck />}
                title="No upcoming events"
                description={isStaff ? 'Create an event and the next one will be featured here.' : 'When you are assigned to an event, the next one is featured here.'}
              />
            )}
          </div>

          <div className="dash-pipeline">
            {loading ? <Skeleton className="h-36 rounded-panel" /> : <EventPipeline counts={stages} />}
          </div>

          {isStaff && (
            <>
              <div className="dash-attention">
                {schedule.isLoading || projects.isLoading ? <Skeleton className="h-72 rounded-panel" /> : schedule.isError ? <ErrorState error={schedule.error} onRetry={() => void schedule.refetch()} /> : (
                  <AttentionTable items={items} tz={tz} eventCount={attentionEvents} updatedLabel={updatedLabel} />
                )}
              </div>
              <div className="dash-insights">
                {schedule.isLoading || projects.isLoading ? <Skeleton className="h-60 rounded-panel" /> : (
                  <InsightCard headline={attentionHeadline(items)} insights={insights} updatedLabel={updatedLabel ?? 'Live data'} onReview={scrollToAttention} />
                )}
              </div>
            </>
          )}

          <div className="dash-activity">
            <Panel title="Recent activity" className="h-full rounded-panel" bodyClassName="p-0 pt-1">
              <ActivityFeed query={activity} showProject empty="Activity will appear here as you work." compact />
            </Panel>
          </div>
        </div>
      )}
    </>
  )
}

function GettingStarted({ canManage }: { canManage: boolean }) {
  if (!canManage) {
    return <EmptyState icon={<CalendarCheck />} title="Nothing assigned yet" description="When the studio assigns you to a session or an edit it will show up here, and you'll get a reminder the day before." className="rounded-panel" />
  }
  const steps = [
    { to: '/clients', icon: <Contact />, title: 'Add a client', body: 'Contact details and every event in one place.' },
    { to: '/events/new', icon: <Clapperboard />, title: 'Create an event', body: 'Sessions, venue, amount, advance - captured once.' },
    { to: '/team', icon: <UsersRound />, title: 'Build your team', body: 'Photographers, videographers and editors.' },
    { to: '/equipment', icon: <Camera />, title: 'List your equipment', body: 'Reserve gear and catch double-bookings.' },
  ]
  return (
    <Card className="rounded-panel p-5 sm:p-6">
      <h2 className="text-xl font-semibold tracking-tight">Let's get your studio going</h2>
      <p className="mt-1 text-sm text-ink-muted">Four steps and Flash Pilot starts working for you. The dashboard fills in as you go.</p>
      <ul className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {steps.map((s, i) => (
          <li key={s.to}>
            <Link to={s.to} className="flex h-full flex-col rounded-card bg-subtle p-4 transition-colors hover:bg-accent">
              <span className="mb-3 flex size-9 items-center justify-center rounded-full bg-surface [&>svg]:size-4" aria-hidden>{s.icon}</span>
              <span className="text-xs text-ink-muted">Step {i + 1}</span>
              <span className="text-sm font-semibold">{s.title}</span>
              <span className="mt-1 text-[13px] text-ink-muted">{s.body}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  )
}
