import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, CheckCheck, MailWarning } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { DEFAULT_PREFERENCES, getPreferences, listDeliveries, listNotifications, markAllRead, markRead, savePreferences } from '@/api/notifications'
import { Button } from '@/components/ui/button'
import { Badge, DataState, EmptyState, ListSkeleton, Notice, PageHeader, Panel, TableWrap, TD, TH, THead, TR } from '@/components/ui/display'
import { Switch } from '@/components/ui/form'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/menu'
import { DeliveryStatusBadge } from '@/components/ui/status'
import { NOTIFICATION_TYPE_LABELS } from '@/lib/constants'
import { errorMessage } from '@/lib/errors'
import { fmtDateTime } from '@/lib/time'
import { cn } from '@/lib/utils'
import type { NotificationPreferences } from '@/types/entities'
import { useAuth } from '@/features/auth/AuthProvider'
import { useStudio } from '@/features/studio/StudioProvider'
import { useUrlState } from '@/hooks/useUrlState'

export default function NotificationsPage() {
  const { studio, me, tz, role } = useStudio()
  const [f, setF] = useUrlState({ tab: 'inbox', filter: 'all' })
  const qc = useQueryClient()
  const navigate = useNavigate()

  const list = useQuery({ queryKey: ['notifications', me.id, f.filter], queryFn: () => listNotifications(me.id, { unreadOnly: f.filter === 'unread', limit: 200 }) })
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['notifications'] })
    void qc.invalidateQueries({ queryKey: ['notification-count'] })
  }
  const read = useMutation({ mutationFn: (ids: string[]) => markRead(ids), onSuccess: refresh, onError: (e) => toast.error(errorMessage(e)) })
  const readAll = useMutation({ mutationFn: () => markAllRead(studio.id), onSuccess: refresh, onError: (e) => toast.error(errorMessage(e)) })
  const unread = (list.data ?? []).filter((n) => !n.read_at).length

  return (
    <>
      <PageHeader title="Notifications" description="Reminders, assignments and deadlines. Reminders for confirmed sessions go out about a day before the reporting time." />
      <Tabs value={f.tab} onValueChange={(tab) => setF({ tab })}>
        <TabsList>
          <TabsTrigger value="inbox">Inbox{unread > 0 && <Badge tone="solid">{unread}</Badge>}</TabsTrigger>
          <TabsTrigger value="preferences">Preferences</TabsTrigger>
          {role === 'owner' && <TabsTrigger value="delivery">Email delivery</TabsTrigger>}
        </TabsList>

        <TabsContent value="inbox">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex rounded-md border border-line-strong p-0.5" role="group" aria-label="Filter notifications">
              {(['all', 'unread'] as const).map((k) => (
                <button key={k} type="button" aria-pressed={f.filter === k} onClick={() => setF({ filter: k })} className={cn('h-8 rounded px-3 text-[13px] font-medium capitalize', f.filter === k ? 'bg-ink text-white' : 'text-ink-muted hover:text-ink')}>{k}</button>
              ))}
            </div>
            <Button variant="secondary" size="sm" onClick={() => readAll.mutate()} loading={readAll.isPending} disabled={unread === 0}><CheckCheck className="size-4" /> Mark all read</Button>
          </div>
          <DataState query={list} isEmpty={(list.data ?? []).length === 0} skeleton={<ListSkeleton />} empty={<EmptyState icon={<Bell />} title={f.filter === 'unread' ? 'No unread notifications' : "You're all caught up"} description="Reminders and assignment updates will appear here." />}>
            <ul className="divide-y divide-line rounded-lg border border-line">
              {(list.data ?? []).map((n) => (
                <li key={n.id} className={cn('flex items-start gap-3 px-4 py-3', !n.read_at && 'bg-sidebar')}>
                  <span className={cn('mt-2 size-2 shrink-0 rounded-full', n.read_at ? 'bg-transparent' : 'bg-ink')} aria-label={n.read_at ? undefined : 'Unread'} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className={cn('text-sm', !n.read_at && 'font-semibold')}>{n.title}</p>
                      <Badge tone="outline">{NOTIFICATION_TYPE_LABELS[n.type]}</Badge>
                    </div>
                    {n.body && <p className="mt-1 whitespace-pre-line text-[13px] leading-relaxed text-ink-muted">{n.body}</p>}
                    <p className="mt-1.5 text-xs text-ink-muted">{fmtDateTime(n.created_at, tz)}</p>
                  </div>
                  <div className="flex shrink-0 flex-col gap-1.5 sm:flex-row">
                    {n.link && <Button variant="secondary" size="sm" onClick={() => { if (!n.read_at) read.mutate([n.id]); navigate(n.link!) }}>Open</Button>}
                    {!n.read_at && <Button variant="ghost" size="sm" onClick={() => read.mutate([n.id])}>Mark read</Button>}
                  </div>
                </li>
              ))}
            </ul>
          </DataState>
        </TabsContent>

        <TabsContent value="preferences"><Preferences /></TabsContent>
        {role === 'owner' && <TabsContent value="delivery"><DeliveryLog /></TabsContent>}
      </Tabs>
    </>
  )
}

function Preferences() {
  const { user } = useAuth()
  const { studio, can } = useStudio()
  const qc = useQueryClient()
  const prefs = useQuery({ queryKey: ['notification-prefs', user!.id, studio.id], queryFn: () => getPreferences(user!.id, studio.id) })
  const [draft, setDraft] = useState<NotificationPreferences>(DEFAULT_PREFERENCES)
  useEffect(() => { if (prefs.data) setDraft(prefs.data) }, [prefs.data])

  const save = useMutation({
    mutationFn: () => savePreferences(user!.id, studio.id, draft),
    onSuccess: () => { toast.success('Preferences saved'); void qc.invalidateQueries({ queryKey: ['notification-prefs'] }) },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const dirty = prefs.data && JSON.stringify(prefs.data) !== JSON.stringify(draft)
  const set = (k: keyof NotificationPreferences) => (v: boolean) => setDraft((d) => ({ ...d, [k]: v }))

  return (
    <DataState query={prefs} skeleton={<ListSkeleton rows={4} />}>
      <div className="grid max-w-3xl gap-4">
        <Panel title="Channels" description="Where you want to hear from Flash Pilot.">
          <div className="space-y-4">
            <Switch label="In-app notifications" description="Shown in the bell and the inbox." checked={draft.in_app_enabled} onCheckedChange={set('in_app_enabled')} />
            <Switch label="Email" description="Sent to your sign-in email, if your studio has email delivery set up." checked={draft.email_enabled} onCheckedChange={set('email_enabled')} />
          </div>
        </Panel>
        <Panel title="What to notify me about">
          <div className="space-y-4">
            <Switch label="Session reminders" description="About 24 hours before a shoot you're assigned to." checked={draft.cat_reminders} onCheckedChange={set('cat_reminders')} />
            <Switch label="Assignments" description="When you're assigned, or your role changes." checked={draft.cat_assignments} onCheckedChange={set('cat_assignments')} />
            <Switch label="Schedule changes" description="When a session you're on is rescheduled or cancelled." checked={draft.cat_schedule} onCheckedChange={set('cat_schedule')} />
            <Switch label="Production deadlines" description="Editing and delivery due dates and overdue work." checked={draft.cat_production} onCheckedChange={set('cat_production')} />
            {can('finance.view') && <Switch label="Payments" description="Payments that are due or overdue." checked={draft.cat_payments} onCheckedChange={set('cat_payments')} />}
          </div>
        </Panel>
        <div><Button onClick={() => save.mutate()} loading={save.isPending} disabled={!dirty}>Save preferences</Button></div>
      </div>
    </DataState>
  )
}

function DeliveryLog() {
  const { studio, tz } = useStudio()
  const log = useQuery({ queryKey: ['notification-deliveries', studio.id], queryFn: () => listDeliveries(studio.id, 100), refetchInterval: 60_000 })
  const rows = log.data ?? []
  const notSent = rows.filter((r) => r.status === 'skipped').length
  const failed = rows.filter((r) => r.status === 'failed').length

  return (
    <div className="space-y-4">
      {notSent > 0 && (
        <Notice tone="warning" title="Some emails were not sent" action={<Button variant="secondary" size="sm" asChild><Link to="/settings">Settings</Link></Button>}>
          {notSent} email{notSent === 1 ? ' was' : 's were'} not sent because no email provider is configured yet. In-app notifications still work. See <code>docs/SETUP.md</code> to enable email.
        </Notice>
      )}
      {failed > 0 && <Notice tone="danger" title={`${failed} email${failed === 1 ? '' : 's'} failed`}>The error for each attempt is shown below and kept in the delivery history.</Notice>}
      <DataState query={log} isEmpty={rows.length === 0} skeleton={<ListSkeleton />} empty={<EmptyState icon={<MailWarning />} title="No emails yet" description="Emails are queued whenever someone with an email address receives a notification." />}>
        <TableWrap>
          <THead><tr><TH>When</TH><TH>Notification</TH><TH>To</TH><TH>Status</TH><TH className="text-right">Attempts</TH><TH>Detail</TH></tr></THead>
          <tbody>
            {rows.map((d) => (
              <TR key={d.id}>
                <TD className="whitespace-nowrap">{fmtDateTime(d.created_at, tz)}</TD>
                <TD className="max-w-64 truncate">{d.notification?.title ?? '—'}</TD>
                <TD className="max-w-48 truncate">{d.to_address}</TD>
                <TD><DeliveryStatusBadge status={d.status} /></TD>
                <TD className="text-right tabular-nums">{d.attempts}/{d.max_attempts}</TD>
                <TD className="max-w-72 truncate text-xs text-ink-muted" title={d.last_error ?? undefined}>{d.last_error ?? (d.sent_at ? `Sent ${fmtDateTime(d.sent_at, tz)}` : '')}</TD>
              </TR>
            ))}
          </tbody>
        </TableWrap>
      </DataState>
    </div>
  )
}
