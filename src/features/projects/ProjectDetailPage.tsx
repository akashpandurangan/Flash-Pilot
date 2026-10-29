import { useMutation, useQuery } from '@tanstack/react-query'
import {
  Archive, ArchiveRestore, Ban, BellRing, CalendarCheck, Camera, CheckCircle2, ExternalLink, MapPin, MoreHorizontal, Pencil, Phone, RotateCcw, Users, X,
} from 'lucide-react'
import { useState } from 'react'
import { Link, useLocation, useParams } from 'react-router'
import { toast } from 'sonner'
import { getProject, getProjectOverview, listEventReminders, listProjectActivity, setBookingStatus, setProjectArchived } from '@/api/projects'
import { getProjectFinancials } from '@/api/payments'
import { Button } from '@/components/ui/button'
import { ActivityTimeline } from '@/features/projects/ActivityTimeline'
import { Avatar, Badge, Detail, EmptyState, ErrorState, Notice, PageHeader, Panel, Skeleton } from '@/components/ui/display'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/menu'
import { BookingBadge, ReminderBadge, StageBadge, StageStepper } from '@/components/ui/status'
import { ASSIGNMENT_ROLE_LABELS, EVENT_TYPE_LABELS } from '@/lib/constants'
import { errorMessage } from '@/lib/errors'
import { formatMoney, summarizeFinancials } from '@/lib/money'
import { reminderExplanation } from '@/lib/reminders'
import { fmtDate, fmtDateOnly, fmtTimeRange } from '@/lib/time'
import type { EventReminder, ProjectEvent } from '@/types/entities'
import { useStudio } from '@/features/studio/StudioProvider'
import { useUrlState } from '@/hooks/useUrlState'
import { ProjectPaymentsTab } from './PaymentsTab'
import { ProductionTab } from './ProductionTab'
import { CancelProjectDialog, EventTeamDialog, ProductionPlanDialog, useInvalidateProject } from './ProjectDialogs'

export default function ProjectDetailPage() {
  const { id = '' } = useParams()
  const { can, tz, currency, role } = useStudio()
  const location = useLocation()
  const [{ tab }, setUrl] = useUrlState({ tab: 'overview' })
  const [cancelOpen, setCancelOpen] = useState(false)
  const [planOpen, setPlanOpen] = useState(false)
  const [teamEvent, setTeamEvent] = useState<ProjectEvent | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const invalidate = useInvalidateProject()

  const canManage = can('projects.manage')
  const canFinance = can('finance.view')

  const project = useQuery({ queryKey: ['project', id], queryFn: () => getProject(id) })
  const overview = useQuery({ queryKey: ['project-overview', id], queryFn: () => getProjectOverview(id) })
  const fin = useQuery({ queryKey: ['project-financials', id], queryFn: () => getProjectFinancials(id), enabled: canFinance })
  const activity = useQuery({ queryKey: ['project-activity', id], queryFn: () => listProjectActivity(id), enabled: tab === 'activity' })
  const eventIds = (project.data?.project_events ?? []).map((e) => e.id)
  const reminders = useQuery({ queryKey: ['event-reminders', id, eventIds.join(',')], queryFn: () => listEventReminders(eventIds), enabled: canManage && eventIds.length > 0 })

  const status = useMutation({
    mutationFn: (s: 'confirmed' | 'inquiry') => setBookingStatus(id, s),
    onSuccess: (_p, s) => { toast.success(s === 'confirmed' ? 'Booking confirmed. The team has been notified.' : 'Moved back to inquiry'); invalidate() },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const archive = useMutation({
    mutationFn: (archived: boolean) => setProjectArchived(id, archived),
    onSuccess: (_d, archived) => { toast.success(archived ? 'Event archived' : 'Event restored'); invalidate() },
    onError: (e) => toast.error(errorMessage(e)),
  })

  if (project.isLoading) return <div className="space-y-4"><Skeleton className="h-8 w-80" /><Skeleton className="h-10 w-full" /><Skeleton className="h-72 w-full" /></div>
  if (project.isError) return <ErrorState error={project.error} onRetry={() => void project.refetch()} />
  const p = project.data
  if (!p) {
    return <EmptyState title="Event not found" description="It may have been removed, or you may not have access to it." action={<Button variant="secondary" asChild><Link to="/events">Back to events</Link></Button>} />
  }

  const o = overview.data
  const events = p.project_events.filter((e) => !e.cancelled_at)
  const cancelledEvents = p.project_events.filter((e) => e.cancelled_at)
  const summary = fin.data ? summarizeFinancials(fin.data.agreed_amount, [{ amount: fin.data.paid_amount }]) : null
  const saved = (location.state as { saved?: 'created' | 'updated' } | null)?.saved
  const frozen = !!p.archived_at
  const unstaffed = events.filter((e) => !(e.event_assignments ?? []).some((a) => a.role === 'lead_photographer' || a.role === 'second_photographer'))

  const nextStep = (() => {
    if (!saved || dismissed || !canManage) return null
    if (p.booking_status === 'inquiry') return { text: 'Next: confirm the booking so the team is notified and reminders are scheduled.', action: <Button size="sm" loading={status.isPending} onClick={() => status.mutate('confirmed')}><CalendarCheck className="size-4" /> Confirm booking</Button> }
    if (unstaffed.length > 0) return { text: 'Next: assign a photographer to every session.', action: <Button size="sm" variant="secondary" onClick={() => setTeamEvent(unstaffed[0]!)}><Users className="size-4" /> Assign team</Button> }
    if (canFinance && summary && summary.paid === 0 && summary.agreed > 0) return { text: 'Next: record the advance when it arrives.', action: <Button size="sm" variant="secondary" onClick={() => setUrl({ tab: 'payments' })}>Open payments</Button> }
    return null
  })()

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Events', to: '/events' }, { label: p.name }]}
        title={<span className="flex flex-wrap items-center gap-x-3 gap-y-1">{p.name}<span className="text-sm font-normal text-ink-muted">{p.project_code}</span></span>}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <BookingBadge status={p.booking_status} />
            {p.booking_status === 'confirmed' && <StageBadge stage={p.production_stage} />}
            {frozen && <Badge tone="outline">Archived</Badge>}
            {o && (can('clients.view') ? <Link to={`/clients/${p.client_id}`} className="text-sm underline-offset-2 hover:underline">{o.client_name}</Link> : <span className="text-sm">{o.client_name}</span>)}
            {o?.client_phone && <a href={`tel:${o.client_phone.replace(/\s/g, '')}`} className="inline-flex items-center gap-1 text-sm hover:underline"><Phone className="size-3" aria-hidden />{o.client_phone}</a>}
          </span>
        }
        actions={canManage && (
          <>
            {p.booking_status === 'inquiry' && !frozen && <Button onClick={() => status.mutate('confirmed')} loading={status.isPending}><CalendarCheck className="size-4" /> Confirm booking</Button>}
            {!frozen && p.booking_status !== 'cancelled' && <Button variant="secondary" asChild><Link to={`/events/${p.id}/edit`}><Pencil className="size-4" /> Edit</Link></Button>}
            {p.booking_status === 'cancelled' && !frozen && <Button variant="secondary" onClick={() => status.mutate('inquiry')} loading={status.isPending}><RotateCcw className="size-4" /> Reopen as inquiry</Button>}
            <Menu>
              <MenuTrigger asChild><Button variant="secondary" size="icon" aria-label="More actions"><MoreHorizontal className="size-4" /></Button></MenuTrigger>
              <MenuContent>
                {p.booking_status === 'confirmed' && p.production_stage === 'upcoming' && !frozen && <MenuItem icon={<RotateCcw />} onSelect={() => status.mutate('inquiry')}>Move back to inquiry</MenuItem>}
                {p.booking_status !== 'cancelled' && !frozen && <MenuItem danger icon={<Ban />} onSelect={() => setCancelOpen(true)}>Cancel booking…</MenuItem>}
                {p.booking_status !== 'cancelled' && !frozen && <MenuSeparator />}
                <MenuItem icon={frozen ? <ArchiveRestore /> : <Archive />} onSelect={() => archive.mutate(!frozen)}>{frozen ? 'Restore from archive' : 'Archive event'}</MenuItem>
              </MenuContent>
            </Menu>
          </>
        )}
      />

      {nextStep && (
        <Notice
          tone="success"
          title={saved === 'created' ? 'Event created' : 'Changes saved'}
          className="mb-4"
          action={<div className="flex items-center gap-1">{nextStep.action}<Button variant="ghost" size="icon-sm" aria-label="Dismiss" onClick={() => setDismissed(true)}><X className="size-4" /></Button></div>}
        >
          {nextStep.text}
        </Notice>
      )}
      {p.booking_status === 'cancelled' && <Notice tone="danger" title="This booking is cancelled" className="mb-4">{p.cancel_reason ? `Reason: ${p.cancel_reason}. ` : ''}Reminders are withdrawn and equipment is released. Payments and history are kept.</Notice>}
      {frozen && <Notice tone="warning" className="mb-4">This event is archived and read-only. Restore it from the menu to make changes.</Notice>}

      {p.booking_status === 'confirmed' && <StageStepper stage={p.production_stage} className="mb-5" />}

      <Tabs value={tab} onValueChange={(v) => setUrl({ tab: v })}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="production">Production</TabsTrigger>
          {canFinance && <TabsTrigger value="payments">Payments</TabsTrigger>}
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
            <div className="min-w-0 space-y-4">
              {events.map((e) => (
                <EventPanel key={e.id} event={e} tz={tz} canManage={canManage && !frozen && p.booking_status !== 'cancelled'} reminders={reminders.data?.filter((r) => r.event_id === e.id)} onTeam={() => setTeamEvent(e)} booking={p.booking_status} archived={frozen} />
              ))}
              {cancelledEvents.length > 0 && (
                <Panel title="Cancelled sessions" description="Kept for history. Their reminders and equipment reservations were released.">
                  <ul className="space-y-1 text-sm text-ink-muted">{cancelledEvents.map((e) => <li key={e.id}><span className="line-through">{e.title}</span> · {fmtDate(e.starts_at, tz)}</li>)}</ul>
                </Panel>
              )}
            </div>
            <div className="min-w-0 space-y-4">
              <Panel title="Client">
                {o ? (
                  <div className="flex items-start gap-3">
                    <Avatar name={o.client_name} className="size-10" />
                    <dl className="min-w-0 space-y-1.5 text-sm">
                      <dt className="sr-only">Name</dt><dd className="font-medium">{o.client_name}</dd>
                      {o.client_phone && <><dt className="sr-only">Phone</dt><dd><a className="hover:underline" href={`tel:${o.client_phone.replace(/\s/g, '')}`}>{o.client_phone}</a></dd></>}
                      {o.client_email && <><dt className="sr-only">Email</dt><dd className="break-all"><a className="hover:underline" href={`mailto:${o.client_email}`}>{o.client_email}</a></dd></>}
                    </dl>
                  </div>
                ) : <Skeleton className="h-12 w-full" />}
              </Panel>
              {summary && (
                <Panel title="Financial summary" action={<Button variant="ghost" size="sm" onClick={() => setUrl({ tab: 'payments' })}>Details</Button>}>
                  <dl className="space-y-2 text-sm">
                    <div className="flex justify-between"><dt className="text-ink-muted">Agreed</dt><dd className="tabular-nums">{formatMoney(summary.agreed, currency)}</dd></div>
                    <div className="flex justify-between"><dt className="text-ink-muted">Received</dt><dd className="tabular-nums">{formatMoney(summary.paid, currency)}</dd></div>
                    <div className="flex justify-between border-t border-line pt-2 font-semibold"><dt>{summary.credit > 0 ? 'Credit' : 'Balance'}</dt><dd className="tabular-nums">{formatMoney(summary.credit > 0 ? summary.credit : summary.balance, currency)}</dd></div>
                  </dl>
                </Panel>
              )}
              <Panel title="Production plan" action={canManage && !frozen && p.booking_status !== 'cancelled' && <Button variant="ghost" size="sm" onClick={() => setPlanOpen(true)}><Pencil className="size-3.5" /></Button>}>
                <dl className="space-y-3">
                  <Detail label="Editor">{p.editor?.full_name}</Detail>
                  <Detail label="Editing due">{p.editing_due_date && fmtDateOnly(p.editing_due_date)}</Detail>
                  <Detail label="Delivery due">{p.delivery_due_date && fmtDateOnly(p.delivery_due_date)}</Detail>
                </dl>
              </Panel>
              {(p.description || p.internal_notes) && (
                <Panel title="Notes">
                  <dl className="space-y-3">
                    <Detail label="Description"><span className="whitespace-pre-wrap">{p.description}</span></Detail>
                    {canManage && <Detail label="Internal notes"><span className="whitespace-pre-wrap">{p.internal_notes}</span></Detail>}
                  </dl>
                </Panel>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="production"><ProductionTab project={p} balance={summary ? summary.balance : null} /></TabsContent>
        {canFinance && <TabsContent value="payments"><ProjectPaymentsTab project={p} /></TabsContent>}
        <TabsContent value="activity">
          <Panel title="Activity" description={role === 'owner' || role === 'manager' ? 'Every change, with who made it and when.' : 'Updates on this event.'} bodyClassName="p-0">
            <ActivityTimeline query={activity} />
          </Panel>
        </TabsContent>
      </Tabs>

      <CancelProjectDialog project={p} open={cancelOpen} onOpenChange={setCancelOpen} />
      <ProductionPlanDialog project={p} open={planOpen} onOpenChange={setPlanOpen} />
      <EventTeamDialog event={teamEvent} open={!!teamEvent} onOpenChange={(o) => !o && setTeamEvent(null)} />
    </>
  )
}

function EventPanel({ event: e, tz, canManage, reminders, onTeam, booking, archived }: {
  event: ProjectEvent
  tz: string
  canManage: boolean
  reminders?: EventReminder[]
  onTeam: () => void
  booking: 'inquiry' | 'confirmed' | 'cancelled'
  archived: boolean
}) {
  const team = e.event_assignments ?? []
  const gear = e.event_equipment ?? []
  const upcoming = new Date(e.ends_at).getTime() >= Date.now()
  const active = reminders?.filter((r) => r.status === 'scheduled' || r.status === 'sent' || r.status === 'failed' || r.status === 'skipped') ?? []
  const explanation = reminderExplanation({ startsAt: e.starts_at, bookingStatus: booking, archived })

  return (
    <Panel
      title={<span className="flex flex-wrap items-center gap-2">{e.title}<Badge tone="outline">{EVENT_TYPE_LABELS[e.event_type]}</Badge></span>}
      description={`${fmtDate(e.starts_at, tz)} · ${fmtTimeRange(e.starts_at, e.ends_at, tz)}`}
      action={canManage && <Button variant="secondary" size="sm" onClick={onTeam}><Users className="size-3.5" /> Manage team</Button>}
    >
      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-4">
          <div>
            <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-ink-muted"><MapPin className="size-3.5" aria-hidden /> Venue</h3>
            {e.venue_name || e.venue_address ? (
              <div className="text-sm">
                {e.venue_name && <p className="font-medium">{e.venue_name}</p>}
                {e.venue_address && <p className="whitespace-pre-wrap text-ink-muted">{e.venue_address}</p>}
                {e.map_url && <a href={e.map_url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-[13px] underline underline-offset-2">Open map <ExternalLink className="size-3" aria-hidden /></a>}
              </div>
            ) : <p className="text-sm text-warning">No venue added yet.</p>}
          </div>
          {e.notes && <div><h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink-muted">Notes</h3><p className="whitespace-pre-wrap text-sm">{e.notes}</p></div>}
        </div>
        <div className="space-y-4">
          <div>
            <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-ink-muted"><Users className="size-3.5" aria-hidden /> Team</h3>
            {team.length === 0 ? <p className="text-sm text-warning">No one assigned yet.</p> : (
              <ul className="space-y-1.5">
                {team.map((a) => (
                  <li key={a.id} className="flex items-center gap-2.5">
                    <Avatar name={a.employee?.full_name} className="size-7 text-[11px]" />
                    <div className="min-w-0 text-sm"><span className="font-medium">{a.employee?.full_name ?? 'Team member'}</span>{a.employee && !a.employee.is_active && <span className="text-ink-muted"> (inactive)</span>}<span className="block text-xs text-ink-muted">{ASSIGNMENT_ROLE_LABELS[a.role]}</span></div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-ink-muted"><Camera className="size-3.5" aria-hidden /> Equipment</h3>
            {gear.length === 0 ? <p className="text-sm text-ink-muted">None reserved.</p> : (
              <ul className="space-y-1 text-sm">
                {gear.map((g) => (
                  <li key={g.id}>
                    {g.equipment?.name ?? g.custom_name}{g.quantity > 1 && <span className="text-ink-muted"> × {g.quantity}</span>}
                    {!g.equipment_id && <Badge tone="outline" className="ml-2">Custom</Badge>}
                    {g.equipment && !g.equipment.is_active && <Badge tone="warning" className="ml-2">Retired</Badge>}
                    {g.notes && <span className="block text-xs text-ink-muted">{g.notes}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {canManage && upcoming && (
        <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-line pt-3 text-[13px] text-ink-muted">
          <BellRing className="size-3.5 shrink-0" aria-hidden />
          {active.length > 0 ? (
            <span className="flex flex-wrap items-center gap-1.5">Reminders: {active.map((r) => <span key={r.id} className="inline-flex items-center gap-1"><ReminderBadge status={r.status} /></span>)}</span>
          ) : <span>{explanation}</span>}
          {team.length === 0 && booking === 'confirmed' && <span className="inline-flex items-center gap-1 text-warning"><CheckCircle2 className="size-3.5" aria-hidden /> Assign people to schedule reminders.</span>}
        </div>
      )}
    </Panel>
  )
}
