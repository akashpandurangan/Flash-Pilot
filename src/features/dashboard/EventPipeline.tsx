import { ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { Card } from '@/components/ui/display'
import { defaultPipelineStage, pipelineBarWidth, pipelineSegments } from '@/lib/dashboard'
import { cn, pluralize } from '@/lib/utils'
import type { ProductionStage } from '@/types/entities'

/**
 * Where every live (not cancelled or archived) event is in its lifecycle, one stage per row: the name, a slim bar for its
 * share of the pipeline, and how many events are in it. The busiest open stage is lime (or whichever you point at), the
 * finished stage is dark, empty stages stay grey. Each row opens the Events list for that stage. The counts come from the
 * same rows and rules as the Studio overview numbers and the Events panel tabs.
 *
 * Cancelled is not a stage, so it sits apart underneath as its own link.
 */
export function EventPipeline({ counts, cancelled = 0 }: { counts: Partial<Record<ProductionStage, number>>; cancelled?: number }) {
  const segments = pipelineSegments(counts)
  const total = segments.reduce((s, x) => s + x.count, 0)
  const [picked, setPicked] = useState<ProductionStage | null>(null)
  const active = picked ?? defaultPipelineStage(segments)

  return (
    <Card role="region" aria-label="Event pipeline" className="flex h-full flex-col rounded-panel p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-[17px] font-semibold tracking-tight">Event pipeline</h2>
        <Link to="/events" className="inline-flex items-center gap-0.5 text-[13px] font-medium hover:underline">
          View all events <ChevronRight className="size-3.5" aria-hidden />
        </Link>
      </div>
      <p className="mt-0.5 text-xs text-ink-muted">{total === 0 ? 'No events in the pipeline yet' : `${pluralize(total, 'event')} by stage`}</p>

      <ol className="mt-3.5 flex flex-1 flex-col justify-between gap-2.5" aria-label="Events by production stage">
        {segments.map((s) => {
          const selected = active === s.stage
          const done = s.stage === 'delivered'
          return (
            <li key={s.stage}>
              <Link
                to={`/events?stage=${s.stage}`}
                onMouseEnter={() => setPicked(s.stage)}
                onFocus={() => setPicked(s.stage)}
                onMouseLeave={() => setPicked(null)}
                onBlur={() => setPicked(null)}
                aria-label={`${s.label}: ${pluralize(s.count, 'event')}`}
                className="group -mx-2 block rounded-lg px-2 py-1 transition-colors hover:bg-subtle focus-visible:bg-subtle"
              >
                <span className="flex items-center gap-2 text-[13px]">
                  <span className={cn('size-2 shrink-0 rounded-full', selected ? 'bg-accent ring-2 ring-accent/30' : done && s.count > 0 ? 'bg-dark' : 'bg-line-strong')} aria-hidden />
                  <span className={cn('min-w-0 flex-1 truncate font-medium', s.count === 0 && 'text-ink-muted')}>{s.label}</span>
                </span>
                <span className="mt-1.5 flex items-center gap-3">
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-subtle group-hover:bg-line" aria-hidden>
                    <span
                      className={cn('block h-full rounded-full transition-[width] duration-500', selected ? 'bg-accent' : done ? 'bg-dark' : 'bg-ink-faint')}
                      style={{ width: `${pipelineBarWidth(s)}%` }}
                    />
                  </span>
                  <span className="w-[4.5rem] shrink-0 text-right text-[13px] tabular-nums">
                    <span className="font-semibold">{s.count}</span> <span className="text-ink-muted">{s.count === 1 ? 'event' : 'events'}</span>
                  </span>
                </span>
              </Link>
            </li>
          )
        })}
      </ol>

      <Link
        to="/events?booking=cancelled"
        aria-label={`Cancelled: ${pluralize(cancelled, 'event')}`}
        className="mt-3.5 flex items-center justify-between rounded-lg border-t border-line px-0 pt-3 text-[13px] text-ink-muted transition-colors hover:text-ink"
      >
        <span>Cancelled <span className="text-xs">(not part of the pipeline)</span></span>
        <span className="tabular-nums"><span className="font-semibold text-ink">{cancelled}</span> {cancelled === 1 ? 'event' : 'events'}</span>
      </Link>
    </Card>
  )
}
