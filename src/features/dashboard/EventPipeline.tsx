import { ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { Card } from '@/components/ui/display'
import { defaultPipelineStage, pipelineSegments, segmentWeight } from '@/lib/dashboard'
import { cn } from '@/lib/utils'
import type { ProductionStage } from '@/types/entities'

/**
 * Where every confirmed event is in production. Segment widths follow the counts; the busiest open
 * stage is lime until you point at another one. Each segment opens the Events list for that stage.
 */
export function EventPipeline({ counts }: { counts: Partial<Record<ProductionStage, number>> }) {
  const segments = pipelineSegments(counts)
  const total = segments.reduce((s, x) => s + x.count, 0)
  const [picked, setPicked] = useState<ProductionStage | null>(null)
  const active = picked ?? defaultPipelineStage(segments)

  return (
    <Card className="rounded-panel p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-[17px] font-semibold tracking-tight">Event pipeline</h2>
        <Link to="/events" className="inline-flex items-center gap-0.5 text-[13px] font-medium hover:underline">
          View all events <ChevronRight className="size-3.5" aria-hidden />
        </Link>
      </div>
      <p className="mt-0.5 text-xs text-ink-muted">{total === 0 ? 'No confirmed events in production yet' : `${total} confirmed ${total === 1 ? 'event' : 'events'} by stage`}</p>

      <div className="-mx-1 mt-3.5 overflow-x-auto px-1 pb-1 scrollbar-thin">
        <ol className="flex min-w-[360px] gap-1.5" aria-label="Events by production stage">
          {segments.map((s) => {
            const selected = active === s.stage
            return (
              <li key={s.stage} className="min-w-[64px]" style={{ flexGrow: segmentWeight(s, segments), flexBasis: 0 }}>
                <Link
                  to={`/events?stage=${s.stage}`}
                  onMouseEnter={() => setPicked(s.stage)}
                  onFocus={() => setPicked(s.stage)}
                  onMouseLeave={() => setPicked(null)}
                  onBlur={() => setPicked(null)}
                  aria-label={`${s.label}: ${s.count} ${s.count === 1 ? 'event' : 'events'}`}
                  className="group block"
                >
                  <span
                    className={cn(
                      'block h-8 rounded-xl transition-colors',
                      selected ? 'bg-accent' : s.stage === 'delivered' ? 'bg-dark' : 'bg-subtle',
                    )}
                    aria-hidden
                  />
                  <span className="mt-2 block text-lg font-semibold leading-none tabular-nums">{s.count}</span>
                  <span className="mt-0.5 block text-xs leading-tight text-ink-muted group-hover:text-ink">{s.label}</span>
                </Link>
              </li>
            )
          })}
        </ol>
      </div>
    </Card>
  )
}
