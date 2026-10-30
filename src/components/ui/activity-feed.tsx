import { formatDistanceToNowStrict } from 'date-fns'
import {
  Activity, Archive, CalendarCheck, CalendarClock, CalendarPlus, CalendarX, CheckCheck, Clapperboard, Contact, IndianRupee, RotateCcw, Truck,
  UserMinus, UserPlus,
} from 'lucide-react'
import type { ComponentType } from 'react'
import { Link } from 'react-router'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/display'
import { formatMoney } from '@/lib/money'
import { fmtDateTime } from '@/lib/time'
import { cn } from '@/lib/utils'
import type { ActivityLog } from '@/types/entities'
import { useStudio } from '@/features/studio/StudioProvider'

interface QueryLike {
  isLoading: boolean
  isError: boolean
  error: unknown
  refetch: () => unknown
  data?: (ActivityLog & { project?: { name: string } | null })[]
}

/** Human sentence for a log row; amounts are formatted at read time from the stored metadata. */
export function activitySummary(a: ActivityLog, currency: string): string {
  const amount = typeof a.metadata?.amount === 'number' ? a.metadata.amount : typeof a.metadata?.amount === 'string' ? Number(a.metadata.amount) : null
  return amount !== null && Number.isFinite(amount) ? `${a.summary} · ${formatMoney(amount, currency)}` : a.summary
}

type IconType = ComponentType<{ className?: string }>

/** Icon for each kind of activity (matched on the action key written by the database). */
export function activityIcon(action: string): IconType {
  if (action === 'project_created') return CalendarPlus
  if (action === 'booking_confirmed') return CalendarCheck
  if (action === 'booking_cancelled' || action === 'event_cancelled') return CalendarX
  if (action === 'event_rescheduled') return CalendarClock
  if (action.includes('payment') || action === 'advance_recorded') return IndianRupee
  if (action === 'team_assigned' || action === 'editor_assigned') return UserPlus
  if (action === 'team_unassigned') return UserMinus
  if (action === 'workflow_mark_delivered' || action === 'delivery_recorded') return Truck
  if (action.startsWith('workflow_')) return Clapperboard
  if (action === 'task_completed') return CheckCheck
  if (action === 'task_reopened') return RotateCcw
  if (action === 'client_created') return Contact
  if (action.includes('archived')) return Archive
  return Activity
}

/** Timeline of what happened, newest first: an icon, the sentence, who did it and how long ago. */
export function ActivityFeed({ query, showProject = false, empty = 'Nothing has happened yet.', compact }: {
  query: QueryLike
  showProject?: boolean
  empty?: string
  compact?: boolean
}) {
  const { tz, currency } = useStudio()
  if (query.isLoading) return <div className="space-y-3 p-5"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
  if (query.isError) return <div className="p-5"><ErrorState error={query.error} onRetry={() => void query.refetch()} /></div>
  if (!query.data || query.data.length === 0) return <div className="p-5"><EmptyState icon={<Activity />} title={empty} /></div>
  return (
    <ol className={cn('px-5', compact ? 'py-1' : 'py-2')}>
      {query.data.map((a, i) => {
        const Icon = activityIcon(a.action)
        const when = new Date(a.created_at)
        return (
          <li key={a.id} className="relative flex gap-3.5 py-3">
            {i < query.data!.length - 1 && <span className="absolute left-[17px] top-12 h-[calc(100%-2rem)] w-px bg-line" aria-hidden />}
            <span className="relative flex size-9 shrink-0 items-center justify-center rounded-full bg-subtle text-ink"><Icon className="size-4" /></span>
            <div className="min-w-0 pt-0.5 text-sm">
              <p className="font-medium leading-snug">{activitySummary(a, currency)}</p>
              <p className="mt-0.5 text-xs text-ink-muted">
                {a.actor_name ?? 'System'} ·{' '}
                <time dateTime={a.created_at} title={fmtDateTime(a.created_at, tz)}>{formatDistanceToNowStrict(when, { addSuffix: true })}</time>
                {showProject && a.project_id && a.project?.name && <> · <Link to={`/events/${a.project_id}`} className="underline underline-offset-2 hover:text-ink">{a.project.name}</Link></>}
              </p>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
