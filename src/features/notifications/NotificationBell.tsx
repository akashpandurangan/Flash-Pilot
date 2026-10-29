import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell } from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { countUnread, listNotifications, markAllRead, markRead } from '@/api/notifications'
import { Button } from '@/components/ui/button'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/menu'
import { errorMessage } from '@/lib/errors'
import { fmtDateTime } from '@/lib/time'
import { cn } from '@/lib/utils'
import { useStudio } from '@/features/studio/StudioProvider'

export function NotificationBell() {
  const { studio, me, tz } = useStudio()
  const qc = useQueryClient()
  const navigate = useNavigate()

  const unread = useQuery({ queryKey: ['notification-count', me.id], queryFn: () => countUnread(me.id), refetchInterval: 60_000 })
  const recent = useQuery({ queryKey: ['notifications', me.id, 'recent'], queryFn: () => listNotifications(me.id, { limit: 6 }) })

  const read = useMutation({
    mutationFn: (ids: string[]) => markRead(ids),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['notifications'] })
      void qc.invalidateQueries({ queryKey: ['notification-count'] })
    },
  })
  const readAll = useMutation({
    mutationFn: () => markAllRead(studio.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notifications'] })
      void qc.invalidateQueries({ queryKey: ['notification-count'] })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  const count = unread.data ?? 0
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={count > 0 ? `Notifications, ${count} unread` : 'Notifications'}>
          <Bell className="size-[18px]" />
          {count > 0 && (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-ink px-1 text-[10px] font-semibold text-white tabular-nums" aria-hidden>
              {count > 9 ? '9+' : count}
            </span>
          )}
        </Button>
      </MenuTrigger>
      <MenuContent className="w-[min(22rem,calc(100vw-1.5rem))] p-0">
        <div className="flex items-center justify-between border-b border-line px-3 py-2.5">
          <span className="text-sm font-semibold">Notifications</span>
          <Button variant="ghost" size="sm" disabled={count === 0 || readAll.isPending} onClick={(e) => { e.preventDefault(); readAll.mutate() }}>Mark all read</Button>
        </div>
        <div className="max-h-96 overflow-y-auto">
          {recent.isLoading && <p className="px-3 py-6 text-center text-sm text-ink-muted">Loading…</p>}
          {recent.isError && <p role="alert" className="px-3 py-6 text-center text-sm text-danger">Could not load notifications.</p>}
          {recent.data?.length === 0 && <p className="px-3 py-8 text-center text-sm text-ink-muted">You're all caught up.</p>}
          {recent.data?.map((n) => (
            <MenuItem
              key={n.id}
              className="items-start rounded-none border-b border-line px-3 py-2.5 last:border-0"
              onSelect={() => {
                if (!n.read_at) read.mutate([n.id])
                if (n.link) navigate(n.link)
              }}
            >
              <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', n.read_at ? 'bg-transparent' : 'bg-ink')} aria-hidden />
              <span className="min-w-0">
                <span className={cn('block text-sm', !n.read_at && 'font-semibold')}>{n.title}</span>
                <span className="mt-0.5 block text-xs text-ink-muted">{fmtDateTime(n.created_at, tz)}</span>
              </span>
            </MenuItem>
          ))}
        </div>
        <MenuSeparator className="my-0" />
        <div className="p-1.5">
          <Link to="/notifications" className="block rounded-md px-2.5 py-2 text-center text-sm font-medium hover:bg-subtle">View all notifications</Link>
        </div>
      </MenuContent>
    </Menu>
  )
}
