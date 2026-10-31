import { useQuery } from '@tanstack/react-query'
import { formatDistanceToNowStrict } from 'date-fns'
import { Camera, CalendarCheck, Clapperboard, Contact, TriangleAlert, UsersRound } from 'lucide-react'
import { useMemo } from 'react'
import { Link } from 'react-router'
import { getDashboardKpis } from '@/api/dashboard'
import { listFinancials } from '@/api/payments'
import { listActiveProjects, listRecentActivity } from '@/api/projects'
import { listInventory, listScheduleEvents } from '@/api/schedule'
import { HeaderContent } from '@/components/layout/header-slot'
import { ActivityFeed } from '@/components/ui/activity-feed'
import { Card, EmptyState, ErrorState, Panel, Skeleton } from '@/components/ui/display'
import { MetricCard } from '@/components/ui/metric-card'
import { buildActionItems, countAttentionEvents } from '@/lib/alerts'
import { attentionHeadline, buildInsights, computeEventKpis, pipelineCounts, todaysEvents } from '@/lib/dashboard'
import { formatMoney } from '@/lib/money'
import { pendingAmount } from '@/lib/pending'
import { toConflictEvent } from '@/lib/schedule'
import { todayKey, zonedDayBounds } from '@/lib/time'
import { cn, pluralize } from '@/lib/utils'
import { useStudio } from '@/features/studio/StudioProvider'
import { useNow } from '@/hooks/hooks'
import { AttentionTable } from './AttentionTable'
import { DashboardEvents } from './DashboardEvents'
import { EventPipeline } from './EventPipeline'
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
    // from the start of today in the studio's zone, so "Today's events" still counts sessions that already began
    queryFn: () => listScheduleEvents({ studioId: studio.id, from: zonedDayBounds(todayKey(tz), tz).start, to: new Date(Date.now() + 60 * 86_400_000).toISOString() }),
  })
  const financials = useQuery({ queryKey: ['financials', studio.id], queryFn: () => listFinancials(studio.id), enabled: canFinance })
  const inventory = useQuery({ queryKey: ['inventory', studio.id], queryFn: () => listInventory(studio.id), enabled: isStaff })
  const activity = useQuery({ queryKey: ['activity', studio.id], queryFn: () => listRecentActivity(studio.id, 8) })

  const events = useMemo(() => projects.data ?? [], [projects.data])
  // One clock for every number below, so the KPIs, the Events panel and the pipeline can never disagree about "now".
  const clock = useMemo(() => new Date(now), [now])

  const items = useMemo(() => {
    if (!isStaff || !schedule.data || !projects.data) return []
    return buildActionItems({
      events: schedule.data.map(toConflictEvent), projects: projects.data, financials: canFinance ? (financials.data ?? []) : null,
      inventory: inventory.data ?? [], tz, currency,
    })
  }, [isStaff, schedule.data, projects.data, financials.data, inventory.data, canFinance, tz, currency])

  const derived = useMemo(() => computeEventKpis(events, items, clock), [events, items, clock])
  const today = useMemo(() => todaysEvents(schedule.data ?? [], tz, clock), [schedule.data, tz, clock])
  // the same rule and the same rows as the Payments page, so the two totals always match
  const pending = useMemo(() => pendingAmount(events, financials.data ?? []), [events, financials.data])
  const stages = useMemo(() => pipelineCounts(events, clock), [events, clock])
  const cancelledCount = useMemo(() => events.filter((e) => e.booking_status === 'cancelled' && !e.archived_at).length, [events])
  const insights = useMemo(() => buildInsights(items, events, clock, currency), [items, events, clock, currency])
  const attentionEvents = countAttentionEvents(items)

  const loading = kpis.isLoading || projects.isLoading
  // "Today's events" comes from the schedule query, so the cards wait for it rather than flashing a 0
  const cardsLoading = loading || schedule.isLoading
  // card slots: five (with Pending amount) or four. Three over two on tablets, one equal row from 1280px, a full-width last card on phones.
  const kpiCount = canFinance ? 5 : 4
  const slot = (i: number) => (canFinance ? cn(i < 3 ? 'md:col-span-2' : 'md:col-span-3', i === 4 && 'col-span-2', 'xl:col-span-1') : undefined)
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
      className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3.5 py-1.5 text-[13px] font-semibold text-on-accent transition-colors hover:bg-accent-hover"
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
        <div className={cn('dash-grid', !isStaff && 'dash-grid--crew')}>
          <section className="dash-kpi" aria-label="Key numbers">
            <Card className="rounded-panel p-4 sm:p-5">
              <h2 className="mb-3 px-0.5 text-[17px] font-semibold tracking-tight">Studio overview</h2>
              {/* Five equal cards in one row from 1280px; three-over-two on tablets, two columns (and a full-width last card) on phones.
                  Without financial access there is no Pending amount card, and the other four share the row. */}
              <div className={cn('grid grid-cols-2 gap-3', canFinance ? 'md:grid-cols-6 xl:grid-cols-5' : 'md:grid-cols-4')}>
                {cardsLoading ? Array.from({ length: kpiCount }, (_, i) => <Skeleton key={i} className={cn('h-28 rounded-card', slot(i))} />) : (
                  <>
                    <MetricCard tone="dark" className={slot(0)} label="Upcoming events" value={derived.upcoming} hint={`${derived.upcomingNext7} in the next 7 days`} to="/events?stage=upcoming" />
                    <MetricCard
                      className={slot(1)}
                      label="Today's events"
                      value={schedule.isError ? '—' : today.events}
                      hint={schedule.isError ? 'Could not load today' : `${pluralize(today.sessions, 'session')} scheduled today`}
                      to={`/events?from=${todayKey(tz, clock)}&to=${todayKey(tz, clock)}`}
                    />
                    <MetricCard className={slot(2)} label="Editing in progress" value={derived.editing} hint="Events currently being edited" to="/events?stage=editing" />
                    <MetricCard className={slot(3)} label="Ready for delivery" value={derived.readyForDelivery} hint="Ready to deliver to clients" to="/events?stage=out_for_delivery" />
                    {/* money is only ever loaded for people with financial access, so everyone else simply has four cards */}
                    {canFinance && (financials.isLoading ? <Skeleton className={cn('h-28 rounded-card', slot(4))} /> : (
                      <MetricCard
                        tone="accent"
                        className={slot(4)}
                        label="Pending amount"
                        value={financials.isError ? '—' : formatMoney(pending.total, currency)}
                        hint={financials.isError ? 'Could not load payments' : pending.count === 0 ? 'All payments settled' : `Outstanding across ${pluralize(pending.count, 'event')}`}
                        to="/payments?tab=balances&state=outstanding"
                      />
                    ))}
                  </>
                )}
              </div>
            </Card>
          </section>

          {/* Events (about 65%) and the pipeline (about 35%) share one row on large screens and stack below that */}
          <div className="dash-events">
            {loading ? <Skeleton className="h-[26rem] rounded-panel" /> : <DashboardEvents events={events} now={clock} canManage={isStaff} />}
          </div>

          <div className="dash-pipeline">
            {loading ? <Skeleton className="h-[26rem] rounded-panel" /> : <EventPipeline counts={stages} cancelled={cancelledCount} />}
          </div>

          {isStaff && (
            <>
              <div className="dash-attention">
                {schedule.isLoading || projects.isLoading ? <Skeleton className="h-72 rounded-panel" /> : schedule.isError ? <ErrorState error={schedule.error} onRetry={() => void schedule.refetch()} /> : (
                  <AttentionTable items={items} tz={tz} currency={currency} eventCount={attentionEvents} updatedLabel={updatedLabel} />
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
