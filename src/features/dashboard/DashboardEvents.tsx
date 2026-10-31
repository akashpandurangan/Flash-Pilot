import { CalendarDays, ChevronRight, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { Card, EmptyState } from '@/components/ui/display'
import { FilterChips } from '@/components/ui/toolbar'
import { chipCounts, EVENT_CHIPS, eventsLink, matchesChip, sortSoonest, type EventChip } from '@/lib/event-filters'
import { useMediaQuery } from '@/hooks/hooks'
import { pluralize } from '@/lib/utils'
import type { ProjectOverview } from '@/types/entities'
import { EventCardItem } from '@/features/projects/EventTable'
import { useEventListContext } from '@/features/projects/useEventListContext'

/** How many event cards the panel shows before pointing at the full Events page: two rows of two on wide screens, and on laptops (where
 *  the panel is one column beside the pipeline) just two, so the panel and the pipeline stay about the same height. */
const SHOWN = 4
const SHOWN_LAPTOP = 2

const EMPTY: Record<EventChip, { title: string; description: string }> = {
  all: { title: 'No events yet', description: 'Create an event and it will show up here.' },
  upcoming: { title: 'No upcoming events', description: 'Create an event and the next one will be listed here.' },
  production: { title: 'Nothing in production right now', description: 'Events appear here from the moment their first session starts.' },
  awaiting_approval: { title: 'No events are waiting for client approval', description: 'Events appear here once their last session has ended.' },
  editing: { title: 'No events are being edited', description: 'Events move here when the client approval is recorded.' },
  out_for_delivery: { title: 'Nothing is out for delivery', description: 'Events appear here once editing is done and they are sent to the client.' },
  delivered: { title: 'No delivered events yet', description: 'Events appear here once they have been delivered to the client.' },
  cancelled: { title: 'No cancelled events', description: 'Cancelled bookings are listed here.' },
}

/**
 * A compact Events section for the dashboard: the studio's events with status tabs (the same tabs as the Events page), the
 * next few as cards, and a link to the full list. Everything is filtered in the browser from the events the dashboard has
 * already loaded, so switching tabs is instant and never reloads the page. The tab counts, the pipeline and the Studio
 * overview numbers all come from the same rule (lib/event-filters.ts + lib/lifecycle.ts).
 */
export function DashboardEvents({ events, now, canManage }: { events: ProjectOverview[]; now: Date; canManage: boolean }) {
  const [chip, setChip] = useState<EventChip>('all')
  const { ctx, dialog } = useEventListContext()
  const laptop = useMediaQuery('(min-width: 1024px) and (max-width: 1279.98px)')

  const counts = useMemo(() => chipCounts(events, now), [events, now])
  const matching = useMemo(() => sortSoonest(events.filter((e) => matchesChip(e, chip, now))), [events, chip, now])
  const shown = matching.slice(0, laptop ? SHOWN_LAPTOP : SHOWN)
  const label = EVENT_CHIPS.find((c) => c.value === chip)!.label
  const canCreate = canManage && (chip === 'all' || chip === 'upcoming')

  return (
    <Card role="region" aria-label="Events" className="flex h-full flex-col rounded-panel p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 className="text-[17px] font-semibold tracking-tight">Events</h2>
        <div className="flex items-center gap-3">
          <Link to={eventsLink(chip)} className="inline-flex items-center gap-0.5 text-[13px] font-medium hover:underline">
            View all events <ChevronRight className="size-3.5" aria-hidden />
          </Link>
          {canManage && (
            <Button asChild size="sm"><Link to="/events/new"><Plus className="size-3.5" /> Create event</Link></Button>
          )}
        </div>
      </div>

      <FilterChips
        compact
        className="mt-3 -mx-1 px-1"
        label="Filter dashboard events by status"
        value={chip}
        onChange={setChip}
        options={EVENT_CHIPS.map((c) => ({ value: c.value, label: c.label, count: counts[c.value] }))}
      />

      <p className="mb-3 mt-2.5 text-xs text-ink-muted" aria-live="polite">
        {matching.length === 0 ? `0 events · ${label}` : matching.length > shown.length ? `Showing ${shown.length} of ${pluralize(matching.length, 'event')} · ${label}` : `${pluralize(matching.length, 'event')} · ${label}`}
      </p>

      {shown.length === 0 ? (
        <EmptyState
          className="flex-1 py-6"
          icon={<CalendarDays />}
          title={canManage || chip !== 'all' ? EMPTY[chip].title : 'Nothing assigned to you yet'}
          description={canManage || chip !== 'all' ? EMPTY[chip].description : 'When the studio assigns you to a session or an edit, it appears here.'}
          action={canCreate ? <Button asChild size="sm"><Link to="/events/new"><Plus className="size-3.5" /> Create event</Link></Button> : undefined}
        />
      ) : (
        <ul className="grid flex-1 content-start gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          {shown.map((p) => <li key={p.id} className="min-w-0"><EventCardItem p={p} ctx={ctx} compact /></li>)}
        </ul>
      )}

      {matching.length > shown.length && (
        <Link to={eventsLink(chip)} className="mt-3 inline-flex items-center gap-0.5 self-start text-[13px] font-medium hover:underline">
          See all {matching.length} on the Events page <ChevronRight className="size-3.5" aria-hidden />
        </Link>
      )}
      {dialog}
    </Card>
  )
}
