import { Activity } from 'lucide-react'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/display'
import { formatMoney } from '@/lib/money'
import { fmtDateTime } from '@/lib/time'
import type { ActivityLog } from '@/types/entities'
import { useStudio } from '@/features/studio/StudioProvider'
import { Link } from 'react-router'

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

export function ActivityTimeline({ query, showProject = false, empty = 'Nothing has happened yet.' }: { query: QueryLike; showProject?: boolean; empty?: string }) {
  const { tz, currency } = useStudio()
  if (query.isLoading) return <div className="space-y-2 p-4"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
  if (query.isError) return <div className="p-4"><ErrorState error={query.error} onRetry={() => void query.refetch()} /></div>
  if (!query.data || query.data.length === 0) return <div className="p-4"><EmptyState icon={<Activity />} title={empty} /></div>
  return (
    <ol className="divide-y divide-line">
      {query.data.map((a) => (
        <li key={a.id} className="flex gap-3 px-4 py-3">
          <span className="mt-1.5 size-2 shrink-0 rounded-full bg-ink" aria-hidden />
          <div className="min-w-0 text-sm">
            <p>{activitySummary(a, currency)}</p>
            <p className="mt-0.5 text-xs text-ink-muted">
              {a.actor_name ?? 'System'} · {fmtDateTime(a.created_at, tz)}
              {showProject && a.project_id && a.project?.name && <> · <Link to={`/events/${a.project_id}`} className="underline underline-offset-2">{a.project.name}</Link></>}
            </p>
          </div>
        </li>
      ))}
    </ol>
  )
}
