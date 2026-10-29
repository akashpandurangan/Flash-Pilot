import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import { Link } from 'react-router'
import { listEmployees } from '@/api/employees'
import { listInventory, listScheduleEvents } from '@/api/schedule'
import { Button } from '@/components/ui/button'
import { Badge, DataState, EmptyState, ListSkeleton, Notice, PageHeader, Segmented } from '@/components/ui/display'
import { Select } from '@/components/ui/form'
import { BookingBadge } from '@/components/ui/status'
import { ASSIGNMENT_ROLE_LABELS, EVENT_TYPE_LABELS, options } from '@/lib/constants'
import { describeConflict, findAllConflicts } from '@/lib/conflicts'
import { toConflictEvent } from '@/lib/schedule'
import { addDaysToDateString, fmtTime, fmtTimeRange, minutesIntoDay, todayKey, zonedDayBounds, zonedDayKey } from '@/lib/time'
import { cn } from '@/lib/utils'
import type { ScheduleEvent } from '@/types/entities'
import { useStudio } from '@/features/studio/StudioProvider'
import { useUrlState } from '@/hooks/useUrlState'
import { dayLabel, layoutLanes, monthGrid, rangeLabel, shiftAnchor, weekKeys, type CalendarView } from './calendarUtils'

const HOUR = 48 // px per hour in the time grid

export default function CalendarPage() {
  const { studio, tz, can } = useStudio()
  const today = todayKey(tz)
  const [f, setF] = useUrlState({ view: 'month', date: today, emp: '', type: '' })
  const view = (['month', 'week', 'day', 'list'].includes(f.view) ? f.view : 'month') as CalendarView
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(f.date) ? f.date : today

  const range = useMemo(() => {
    let first: string
    let last: string
    if (view === 'month') { const g = monthGrid(anchor); first = g[0]!; last = g.at(-1)! }
    else if (view === 'week') { const w = weekKeys(anchor); first = w[0]!; last = w[6]! }
    else if (view === 'day') { first = last = anchor }
    else { first = anchor; last = addDaysToDateString(anchor, 60) }
    return { first, last, from: zonedDayBounds(first, tz).start, to: zonedDayBounds(last, tz).end }
  }, [view, anchor, tz])

  const events = useQuery({
    queryKey: ['schedule', studio.id, 'calendar', range.from, range.to],
    queryFn: () => listScheduleEvents({ studioId: studio.id, from: range.from, to: range.to }),
    placeholderData: (prev) => prev,
  })
  const employees = useQuery({ queryKey: ['employees', studio.id], queryFn: () => listEmployees(studio.id), enabled: can('team.view') })
  const inventory = useQuery({ queryKey: ['inventory', studio.id], queryFn: () => listInventory(studio.id) })

  const visible = useMemo(
    () => (events.data ?? []).filter((e) => (!f.type || e.event_type === f.type) && (!f.emp || (e.event_assignments ?? []).some((a) => a.employee_id === f.emp)) && !e.project.archived_at),
    [events.data, f.type, f.emp],
  )

  const warnings = useMemo(() => {
    const ce = (events.data ?? []).filter((e) => !e.project.archived_at).map(toConflictEvent)
    const inv = inventory.data ?? []
    return can('projects.manage') ? findAllConflicts(ce, inv) : []
  }, [events.data, inventory.data, can])

  // eventful days for the mini "has warning" dot
  const warnedEventIds = useMemo(() => {
    const ids = new Set<string>()
    for (const c of warnings) {
      if (c.kind === 'unstaffed' || c.kind === 'equipment_unavailable') ids.add(c.event.id)
      else c.events.forEach((e) => ids.add(e.id))
    }
    return ids
  }, [warnings])

  const go = (dir: -1 | 1) => setF({ date: shiftAnchor(view, anchor, dir) })

  return (
    <>
      <PageHeader title="Calendar" description="Every confirmed and tentative event, in your studio's time zone." />

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="icon" aria-label="Previous" onClick={() => go(-1)}><ChevronLeft className="size-4" /></Button>
          <Button variant="secondary" size="icon" aria-label="Next" onClick={() => go(1)}><ChevronRight className="size-4" /></Button>
          <Button variant="secondary" onClick={() => setF({ date: today })}>Today</Button>
          <h2 className="ml-2 text-base font-semibold" aria-live="polite">{rangeLabel(view, anchor)}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {can('team.view') && (
            <Select aria-label="Filter by team member" className="w-44" value={f.emp} onChange={(e) => setF({ emp: e.target.value })}>
              <option value="">Everyone</option>
              {(employees.data ?? []).filter((e) => e.is_active).map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
            </Select>
          )}
          <Select aria-label="Filter by event type" className="w-40" value={f.type} onChange={(e) => setF({ type: e.target.value })}>
            <option value="">All types</option>
            {options(EVENT_TYPE_LABELS).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
          <Segmented<CalendarView> label="Calendar view" value={view} onChange={(v) => setF({ view: v })} options={[{ value: 'month', label: 'Month' }, { value: 'week', label: 'Week' }, { value: 'day', label: 'Day' }, { value: 'list', label: 'Upcoming' }]} />
        </div>
      </div>

      {warnings.length > 0 && <Warnings conflicts={warnings} />}

      <DataState
        query={events}
        isEmpty={false}
        skeleton={<ListSkeleton rows={8} />}
      >
        {view === 'month' && <MonthView grid={monthGrid(anchor)} anchor={anchor} events={visible} tz={tz} today={today} warned={warnedEventIds} onDay={(d) => setF({ view: 'day', date: d })} />}
        {view === 'week' && <TimeGrid days={weekKeys(anchor)} events={visible} tz={tz} today={today} warned={warnedEventIds} onDay={(d) => setF({ view: 'day', date: d })} />}
        {view === 'day' && <TimeGrid days={[anchor]} events={visible} tz={tz} today={today} warned={warnedEventIds} />}
        {view === 'list' && <Agenda events={visible} tz={tz} warned={warnedEventIds} />}
      </DataState>
    </>
  )
}

function Warnings({ conflicts }: { conflicts: ReturnType<typeof findAllConflicts> }) {
  const counts = {
    team: conflicts.filter((c) => c.kind === 'employee').length,
    gear: conflicts.filter((c) => c.kind === 'equipment' || c.kind === 'equipment_unavailable').length,
    unstaffed: conflicts.filter((c) => c.kind === 'unstaffed').length,
    overlap: conflicts.filter((c) => c.kind === 'overlap').length,
  }
  const shown = conflicts.filter((c) => c.kind !== 'overlap').slice(0, 4)
  return (
    <Notice tone="warning" title="Scheduling warnings in this view" className="mb-4">
      <p className="flex flex-wrap gap-x-4 gap-y-0.5">
        {counts.team > 0 && <span>{counts.team} double-booked</span>}
        {counts.gear > 0 && <span>{counts.gear} equipment {counts.gear === 1 ? 'issue' : 'issues'}</span>}
        {counts.unstaffed > 0 && <span>{counts.unstaffed} without a photographer</span>}
        {counts.overlap > 0 && <span>{counts.overlap} overlapping {counts.overlap === 1 ? 'event' : 'events'}</span>}
      </p>
      <ul className="mt-1.5 list-disc space-y-0.5 pl-4">{shown.map((c, i) => <li key={i}>{describeConflict(c)}</li>)}</ul>
    </Notice>
  )
}

function chipStyle(e: ScheduleEvent) {
  if (e.project.booking_status === 'confirmed') return 'bg-ink text-white hover:bg-brand-hover'
  if (e.project.booking_status === 'cancelled') return 'border border-line bg-subtle text-ink-muted line-through'
  return 'border border-dashed border-ink-muted bg-canvas text-ink hover:bg-subtle'
}

function names(e: ScheduleEvent): string {
  return (e.event_assignments ?? []).filter((a) => a.employee).map((a) => a.employee!.full_name.split(' ')[0]).join(', ')
}

function eventLabel(e: ScheduleEvent, tz: string) {
  const who = names(e)
  return `${fmtTime(e.starts_at, tz)} ${e.project.name} — ${e.title}${who ? `, ${who}` : ''} (${EVENT_TYPE_LABELS[e.event_type]}, ${e.project.booking_status})`
}

/* ------------------------------------------------------------------- month */
function MonthView({ grid, anchor, events, tz, today, warned, onDay }: { grid: string[]; anchor: string; events: ScheduleEvent[]; tz: string; today: string; warned: Set<string>; onDay: (d: string) => void }) {
  const byDay = useMemo(() => {
    const m = new Map<string, ScheduleEvent[]>()
    for (const e of events) {
      const k = zonedDayKey(e.starts_at, tz)
      m.set(k, [...(m.get(k) ?? []), e])
    }
    return m
  }, [events, tz])

  return (
    <div className="relative overflow-x-auto rounded-lg border border-line scrollbar-thin">
      <div className="min-w-[640px]">
        <div className="grid grid-cols-7 border-b border-line bg-sidebar text-center text-xs font-medium uppercase tracking-wide text-ink-muted" role="row">
          {weekKeys(anchor).map((d) => <div key={d} role="columnheader" className="py-2">{dayLabel(d, { weekday: 'short' })}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {grid.map((d, i) => {
            const list = (byDay.get(d) ?? []).sort((a, b) => a.starts_at.localeCompare(b.starts_at))
            const inMonth = d.slice(0, 7) === anchor.slice(0, 7)
            return (
              <div key={d} className={cn('min-h-28 border-b border-r border-line p-1.5', (i + 1) % 7 === 0 && 'border-r-0', !inMonth && 'bg-sidebar/60')}>
                <button type="button" onClick={() => onDay(d)} aria-label={`Open ${dayLabel(d, { weekday: 'long', day: 'numeric', month: 'long' })}`} className={cn('mb-1 flex size-6 items-center justify-center rounded-full text-xs tabular-nums hover:bg-subtle', d === today && 'bg-ink font-semibold text-white hover:bg-ink', !inMonth && d !== today && 'text-ink-muted')}>
                  {Number(d.slice(8))}
                </button>
                <ul className="space-y-1">
                  {list.slice(0, 3).map((e) => (
                    <li key={e.id}>
                      <Link to={`/projects/${e.project_id}`} title={eventLabel(e, tz)} aria-label={eventLabel(e, tz)} className={cn('flex items-center gap-1 truncate rounded px-1.5 py-0.5 text-[11px] leading-4', chipStyle(e))}>
                        {warned.has(e.id) && <AlertTriangle className="size-3 shrink-0" aria-hidden />}
                        <span className="truncate"><span className="tabular-nums opacity-80">{fmtTime(e.starts_at, tz).replace(':00', '')}</span> {e.project.name}</span>
                      </Link>
                    </li>
                  ))}
                  {list.length > 3 && <li><button type="button" onClick={() => onDay(d)} className="px-1 text-[11px] font-medium text-ink-muted hover:text-ink">+{list.length - 3} more</button></li>}
                </ul>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/* -------------------------------------------------------- week & day (time grid) */
function TimeGrid({ days, events, tz, today, warned, onDay }: { days: string[]; events: ScheduleEvent[]; tz: string; today: string; warned: Set<string>; onDay?: (d: string) => void }) {
  const scroller = useRef<HTMLDivElement>(null)

  const columns = useMemo(() => days.map((d) => {
    const { start, end } = zonedDayBounds(d, tz)
    const s = new Date(start).getTime()
    const en = new Date(end).getTime()
    const items = events
      .filter((e) => new Date(e.starts_at).getTime() < en && new Date(e.ends_at).getTime() > s)
      .map((e) => {
        const startMin = Math.max(new Date(e.starts_at).getTime() - s, 0) / 60000
        const endMin = Math.min(new Date(e.ends_at).getTime() - s, en - s) / 60000
        return { e, start: startMin, end: Math.max(endMin, startMin + 30) }
      })
    return { d, items: layoutLanes(items) }
  }), [days, events, tz])

  const nowMin = minutesIntoDay(new Date().toISOString(), tz)
  const firstStart = columns.flatMap((c) => c.items.map((i) => i.start)).sort((a, b) => a - b)[0]
  const scrollKey = columns.map((c) => c.items.length).join(',')
  useEffect(() => {
    // open on the first event of the visible days (or 7 AM when there are none)
    if (scroller.current) scroller.current.scrollTop = Math.max(((firstStart ?? 7 * 60) / 60 - 1) * HOUR, 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-anchor only when the visible events change
  }, [scrollKey, days[0]])
  const hours = Array.from({ length: 24 }, (_, h) => h)
  const allDayEmpty = columns.every((c) => c.items.length === 0)

  return (
    <div className="relative overflow-x-auto rounded-lg border border-line scrollbar-thin">
      <div style={{ minWidth: days.length === 1 ? 320 : 720 }}>
        <div className="grid border-b border-line bg-sidebar" style={{ gridTemplateColumns: `3.5rem repeat(${days.length}, minmax(0, 1fr))` }}>
          <div />
          {days.map((d) => (
            <button key={d} type="button" disabled={!onDay} onClick={() => onDay?.(d)} className={cn('py-2 text-center text-xs font-medium', d === today ? 'text-ink' : 'text-ink-muted', onDay && 'hover:bg-subtle')}>
              {dayLabel(d, { weekday: 'short' })} <span className={cn('ml-1 inline-flex size-6 items-center justify-center rounded-full tabular-nums', d === today && 'bg-ink text-white')}>{Number(d.slice(8))}</span>
            </button>
          ))}
        </div>
        {allDayEmpty && <p className="border-b border-line px-4 py-2 text-center text-xs text-ink-muted">No events {days.length === 1 ? 'on this day' : 'this week'}.</p>}
        <div ref={scroller} className="max-h-[68dvh] overflow-y-auto">
          <div className="relative grid" style={{ gridTemplateColumns: `3.5rem repeat(${days.length}, minmax(0, 1fr))`, height: 24 * HOUR }}>
            <div aria-hidden>
              {hours.map((h) => <div key={h} className="relative border-t border-line text-right" style={{ height: HOUR }}><span className="absolute -top-2 right-1.5 bg-canvas px-0.5 text-[10px] text-ink-muted">{h === 0 ? '' : `${((h + 11) % 12) + 1} ${h < 12 ? 'AM' : 'PM'}`}</span></div>)}
            </div>
            {columns.map(({ d, items }) => (
              <div key={d} className="relative border-l border-line">
                {hours.map((h) => <div key={h} className="border-t border-line" style={{ height: HOUR }} aria-hidden />)}
                {d === today && <div className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-ink" style={{ top: (nowMin / 60) * HOUR }} aria-hidden />}
                {items.map(({ e, start, end, lane, lanes }) => (
                  <Link
                    key={`${e.id}-${d}`}
                    to={`/projects/${e.project_id}`}
                    title={eventLabel(e, tz)}
                    aria-label={eventLabel(e, tz)}
                    className={cn('absolute overflow-hidden rounded-md border-l-2 px-1.5 py-1 text-[11px] leading-tight shadow-sm', chipStyle(e), 'border-l-ink')}
                    style={{ top: (start / 60) * HOUR, height: Math.max(((end - start) / 60) * HOUR - 2, 22), left: `calc(${(lane / lanes) * 100}% + 2px)`, width: `calc(${100 / lanes}% - 4px)` }}
                  >
                    <span className="flex items-center gap-1 font-semibold">{warned.has(e.id) && <AlertTriangle className="size-3 shrink-0" aria-hidden />}<span className="truncate">{e.project.name}</span></span>
                    <span className="block truncate opacity-80">{e.title} · {fmtTimeRange(e.starts_at, e.ends_at, tz)}</span>
                    {names(e) && <span className="block truncate opacity-80">{names(e)}</span>}
                  </Link>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ agenda */
function Agenda({ events, tz, warned }: { events: ScheduleEvent[]; tz: string; warned: Set<string> }) {
  const groups = useMemo(() => {
    const m = new Map<string, ScheduleEvent[]>()
    for (const e of events.filter((x) => new Date(x.ends_at).getTime() >= Date.now()).sort((a, b) => a.starts_at.localeCompare(b.starts_at))) {
      const k = zonedDayKey(e.starts_at, tz)
      m.set(k, [...(m.get(k) ?? []), e])
    }
    return [...m.entries()]
  }, [events, tz])

  if (groups.length === 0) return <EmptyState icon={<CalendarDays />} title="Nothing coming up" description="No events in the next 60 days match these filters." />
  return (
    <div className="space-y-5">
      {groups.map(([day, list]) => (
        <section key={day} aria-label={dayLabel(day, { weekday: 'long', day: 'numeric', month: 'long' })}>
          <h3 className="mb-2 text-sm font-semibold">{dayLabel(day, { weekday: 'long', day: 'numeric', month: 'long' })}</h3>
          <ul className="divide-y divide-line rounded-lg border border-line">
            {list.map((e) => (
              <li key={e.id}>
                <Link to={`/projects/${e.project_id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-sidebar">
                  <span className="w-28 shrink-0 text-sm tabular-nums">{fmtTimeRange(e.starts_at, e.ends_at, tz)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{e.project.name} <span className="font-normal text-ink-muted">· {e.title}</span></span>
                    <span className="block truncate text-xs text-ink-muted">
                      {(e.event_assignments ?? []).length > 0 ? (e.event_assignments ?? []).map((a) => `${a.employee?.full_name ?? 'Team member'} (${ASSIGNMENT_ROLE_LABELS[a.role]})`).join(', ') : 'No one assigned'}
                      {e.venue_name && ` · ${e.venue_name}`}
                    </span>
                  </span>
                  {warned.has(e.id) && <Badge tone="warning"><AlertTriangle className="size-3" /> Check</Badge>}
                  <Badge tone="outline">{EVENT_TYPE_LABELS[e.event_type]}</Badge>
                  <BookingBadge status={e.project.booking_status} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

