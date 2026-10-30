import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Bell, BellRing, CalendarClock, CalendarX, CheckCheck, IndianRupee, Timer, Truck, UserPlus, UsersRound } from 'lucide-react'
import type { ComponentType } from 'react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { countUnread, listNotifications, markAllRead, markRead } from '@/api/notifications'
import { Button } from '@/components/ui/button'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu'
import { errorMessage } from '@/lib/errors'
import { fmtDateTime } from '@/lib/time'
import { cn } from '@/lib/utils'
import type { NotificationType } from '@/types/entities'
import { useStudio } from '@/features/studio/StudioProvider'

const TYPE_ICONS: Record<NotificationType, ComponentType<{ className?: string }>> = {
  event_reminder: BellRing, new_assignment: UserPlus, assignment_changed: UsersRound, event_rescheduled: CalendarClock, event_cancelled: CalendarX,
  production_deadline: Timer, editing_overdue: AlertTriangle, delivery_overdue: Truck, payment_due: IndianRupee,
}

/** The bell in the header and its dropdown of the latest notifications. */
export function NotificationPanel() {
  const { studio, me, tz } = useStudio()
  const qc = useQueryClient()
  const navigate = useNavigate()

  const unread = useQuery({ queryKey: ['notification-count', me.id], queryFn: () => countUnread(me.id), refetchInterval: 60_000 })
  const recent = useQuery({ queryKey: ['notifications', me.id, 'recent'], queryFn: () => listNotifications(me.id, { limit: 6 }) })

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['notifications'] })
    void qc.invalidateQueries({ queryKey: ['notification-count'] })
  }
  const read = useMutation({ mutationFn: (ids: string[]) => markRead(ids), onSettled: refresh })
  const readAll = useMutation({ mutationFn: () => markAllRead(studio.id), onSuccess: refresh, onError: (e) => toast.error(errorMessage(e)) })

  const count = unread.data ?? 0
  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          aria-label={count > 0 ? `Notifications, ${count} unread` : 'Notifications'}
          className="relative flex size-[42px] shrink-0 items-center justify-center rounded-full border border-line bg-surface text-ink transition-colors hover:bg-sidebar"
        >
          <Bell className="size-[18px]" />
          {count > 0 && <span className="absolute right-2.5 top-2.5 size-2 rounded-full bg-risk ring-2 ring-surface" aria-hidden />}
        </button>
      </MenuTrigger>
      <MenuContent className="w-[min(24rem,calc(100vw-1.5rem))] p-0">
        <div className="flex items-center justify-between px-4 pb-2 pt-3.5">
          <div>
            <p className="text-sm font-semibold">Notifications</p>
            <p className="text-xs text-ink-muted">{count > 0 ? `${count} unread` : "You're all caught up"}</p>
          </div>
          <Button variant="ghost" size="sm" disabled={count === 0 || readAll.isPending} onClick={(e) => { e.preventDefault(); readAll.mutate() }}>
            <CheckCheck className="size-4" /> Mark all read
          </Button>
        </div>
        <div className="max-h-96 overflow-y-auto px-1.5 pb-1.5">
          {recent.isLoading && <p className="px-3 py-6 text-center text-sm text-ink-muted">Loading…</p>}
          {recent.isError && <p role="alert" className="px-3 py-6 text-center text-sm text-danger">Could not load notifications.</p>}
          {recent.data?.length === 0 && <p className="px-3 py-8 text-center text-sm text-ink-muted">Nothing new yet.</p>}
          {recent.data?.map((n) => {
            const Icon = TYPE_ICONS[n.type] ?? Bell
            return (
              <MenuItem
                key={n.id}
                className="items-start gap-3 px-2.5 py-2.5"
                onSelect={() => {
                  if (!n.read_at) read.mutate([n.id])
                  if (n.link) navigate(n.link)
                }}
              >
                <span className={cn('mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full', n.read_at ? 'bg-subtle text-ink-muted' : 'bg-accent text-ink')}>
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0">
                  <span className={cn('block text-sm leading-snug', !n.read_at && 'font-semibold')}>{n.title}</span>
                  <span className="mt-0.5 block text-xs text-ink-muted">{fmtDateTime(n.created_at, tz)}</span>
                </span>
              </MenuItem>
            )
          })}
        </div>
        <div className="border-t border-line p-1.5">
          <Link to="/notifications" className="block rounded-xl px-2.5 py-2 text-center text-sm font-medium hover:bg-subtle">View all notifications</Link>
        </div>
      </MenuContent>
    </Menu>
  )
}
