import { useMutation, useQuery } from '@tanstack/react-query'
import { Archive, ArchiveRestore, Ban, CalendarDays, CalendarRange, LayoutGrid, List, MoreHorizontal, Pencil, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { listEmployees } from '@/api/employees'
import { listFinancials } from '@/api/payments'
import { listProjects, setProjectArchived, type ProjectSort } from '@/api/projects'
import { listScheduleEvents } from '@/api/schedule'
import { Button } from '@/components/ui/button'
import { Card, DataState, EmptyState, ListSkeleton, PageHeader, Pagination, Segmented } from '@/components/ui/display'
import { Input, Select } from '@/components/ui/form'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/menu'
import { FilterBar, FilterButton, FilterChips, SearchInput } from '@/components/ui/toolbar'
import { EVENT_TYPE_LABELS, options } from '@/lib/constants'
import { errorMessage } from '@/lib/errors'
import { activeFilterCount, chipFromParams, EVENT_CHIPS, paramsFromChip } from '@/lib/event-filters'
import { venueByEvent } from '@/lib/schedule'
import { zonedDayBounds } from '@/lib/time'
import type { ProjectOverview } from '@/types/entities'
import { useStudio } from '@/features/studio/StudioProvider'
import { useLocalStorageState } from '@/hooks/hooks'
import { pageNumber, useUrlState } from '@/hooks/useUrlState'
import { EventCardItem, EventTable, type EventListContext } from './EventTable'
import { CancelProjectDialog, useInvalidateProject } from './ProjectDialogs'

type View = 'list' | 'cards' | 'calendar'

export default function ProjectsPage() {
  const { studio, can, tz } = useStudio()
  const navigate = useNavigate()
  const invalidate = useInvalidateProject()
  const [view, setView] = useLocalStorageState<'list' | 'cards'>('fp.events.view', 'list')
  const [f, setF] = useUrlState({ q: '', booking: '', stage: '', type: '', emp: '', from: '', to: '', archived: '0', sort: 'soonest', page: '1' })
  const filterCount = activeFilterCount(f)
  const [showFilters, setShowFilters] = useState(filterCount > 0)
  const [cancelling, setCancelling] = useState<ProjectOverview | null>(null)
  const canManage = can('projects.manage')
  const canFinance = can('finance.view')
  const chip = chipFromParams(f)

  const query = useQuery({
    queryKey: ['projects', studio.id, f],
    queryFn: () =>
      listProjects({
        studioId: studio.id,
        search: f.q,
        booking: f.booking as never,
        stage: f.stage as never,
        eventType: f.type as never,
        employeeId: f.emp || undefined,
        from: f.from ? zonedDayBounds(f.from, tz).start : undefined,
        to: f.to ? zonedDayBounds(f.to, tz).end : undefined,
        archived: f.archived === '1',
        sort: f.sort as ProjectSort,
        page: pageNumber(f.page),
      }),
    placeholderData: (prev) => prev,
  })
  // Team names are readable by every member (row level security), so crew see who they work with.
  const team = useQuery({ queryKey: ['employees', studio.id], queryFn: () => listEmployees(studio.id) })
  const financials = useQuery({ queryKey: ['financials', studio.id], queryFn: () => listFinancials(studio.id), enabled: canFinance })
  // Venue lives on the sessions; one wide query covers every event in the list.
  const sessions = useQuery({
    queryKey: ['schedule', studio.id, 'events-list'],
    queryFn: () => listScheduleEvents({ studioId: studio.id, from: new Date(Date.now() - 400 * 86_400_000).toISOString(), to: new Date(Date.now() + 800 * 86_400_000).toISOString() }),
    staleTime: 60_000,
  })

  const archive = useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) => setProjectArchived(id, archived),
    onSuccess: (_d, v) => { toast.success(v.archived ? 'Event archived' : 'Event restored'); invalidate() },
    onError: (e) => toast.error(errorMessage(e)),
  })

  const rows = query.data?.rows ?? []
  const filtered = !!(f.q || f.booking || f.stage || filterCount)
  const clear = () => setF({ q: '', booking: '', stage: '', type: '', emp: '', from: '', to: '', archived: '0' })

  const ctx: EventListContext = useMemo(
    () => ({
      tz,
      venues: venueByEvent(sessions.data ?? []),
      people: new Map((team.data ?? []).map((e) => [e.id, e.full_name])),
      finance: canFinance ? new Map((financials.data ?? []).map((x) => [x.project_id, x])) : null,
      menu: (p: ProjectOverview) => (
        <RowMenu
          p={p}
          canManage={canManage}
          onOpen={() => navigate(`/events/${p.id}`)}
          onEdit={() => navigate(`/events/${p.id}/edit`)}
          onCancel={() => setCancelling(p)}
          onArchive={() => archive.mutate({ id: p.id, archived: !p.archived_at })}
        />
      ),
    }),
    [tz, sessions.data, team.data, financials.data, canFinance, canManage, navigate, archive],
  )

  return (
    <>
      <PageHeader title="Events" description={canManage ? 'Manage your studio bookings and photography assignments.' : 'The sessions and edits assigned to you.'} />

      <FilterBar className="mb-4">
        <SearchInput className="sm:min-w-72 sm:flex-1 lg:max-w-md" value={f.q} onChange={(q) => setF({ q })} placeholder="Search event, client or ID" label="Search events" />
        <FilterButton active={filterCount} open={showFilters} onClick={() => setShowFilters((s) => !s)} />
        <div className="sm:ml-auto">
          <Segmented<View>
            label="View"
            value={view}
            onChange={(v) => (v === 'calendar' ? navigate('/calendar') : setView(v))}
            options={[
              { value: 'list', label: <><List className="size-4" /> List</> },
              { value: 'cards', label: <><LayoutGrid className="size-4" /> Cards</> },
              { value: 'calendar', label: <><CalendarRange className="size-4" /> Calendar</>, ariaLabel: 'Open the calendar' },
            ]}
          />
        </div>
      </FilterBar>

      <div className="mb-5">
        <FilterChips
          label="Filter events by status"
          value={chip}
          onChange={(c) => setF(paramsFromChip(c))}
          options={EVENT_CHIPS.map((c) => ({ value: c.value, label: c.label }))}
        />
      </div>

      {showFilters && (
        <Card className="mb-5 grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <label className="space-y-1.5 text-[13px] font-medium">Event type
            <Select value={f.type} onChange={(e) => setF({ type: e.target.value })}><option value="">Any type</option>{options(EVENT_TYPE_LABELS).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
          </label>
          {can('team.view') && (
            <label className="space-y-1.5 text-[13px] font-medium">Assigned to
              <Select value={f.emp} onChange={(e) => setF({ emp: e.target.value })}><option value="">Anyone</option>{(team.data ?? []).map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}</Select>
            </label>
          )}
          <label className="space-y-1.5 text-[13px] font-medium">Sessions from<Input type="date" value={f.from} onChange={(e) => setF({ from: e.target.value })} /></label>
          <label className="space-y-1.5 text-[13px] font-medium">Sessions to<Input type="date" value={f.to} min={f.from} onChange={(e) => setF({ to: e.target.value })} /></label>
          <label className="space-y-1.5 text-[13px] font-medium">Show
            <Select value={f.archived} onChange={(e) => setF({ archived: e.target.value })}><option value="0">Active events</option><option value="1">Archived</option></Select>
          </label>
          <label className="space-y-1.5 text-[13px] font-medium">Sort by
            <Select value={f.sort} onChange={(e) => setF({ sort: e.target.value })}>
              <option value="soonest">Next session first</option><option value="latest">Latest session date</option><option value="newest">Recently created</option><option value="name">Name (A–Z)</option>
            </Select>
          </label>
        </Card>
      )}

      <DataState
        query={query}
        isEmpty={rows.length === 0}
        skeleton={<ListSkeleton />}
        empty={
          filtered ? (
            <EmptyState icon={<CalendarDays />} title="No events match" description="Try removing a filter or changing your search." action={<Button variant="secondary" onClick={clear}>Clear filters</Button>} />
          ) : canManage ? (
            <EmptyState icon={<CalendarDays />} title="Create your first event" description="An event holds the client, session dates, team, equipment and payments for one booking." action={<Button asChild><Link to="/events/new"><Plus className="size-4" /> New event</Link></Button>} />
          ) : (
            <EmptyState icon={<CalendarDays />} title="Nothing assigned to you yet" description="When the studio assigns you to a session or an edit, it appears here." />
          )
        }
      >
        {view === 'list' ? (
          <>
            <div className="hidden lg:block"><EventTable rows={rows} ctx={ctx} /></div>
            <ul className="grid gap-3 sm:grid-cols-2 lg:hidden">{rows.map((p) => <li key={p.id}><EventCardItem p={p} ctx={ctx} /></li>)}</ul>
          </>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{rows.map((p) => <li key={p.id}><EventCardItem p={p} ctx={ctx} /></li>)}</ul>
        )}
        <Pagination page={pageNumber(f.page)} total={query.data?.total ?? 0} onPage={(p) => setF({ page: String(p) })} />
      </DataState>

      {cancelling && <CancelProjectDialog project={cancelling} open onOpenChange={(o) => !o && setCancelling(null)} />}
    </>
  )
}

function RowMenu({ p, canManage, onOpen, onEdit, onCancel, onArchive }: { p: ProjectOverview; canManage: boolean; onOpen: () => void; onEdit: () => void; onCancel: () => void; onArchive: () => void }) {
  return (
    <Menu>
      <MenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={`Actions for ${p.name}`}><MoreHorizontal className="size-4" /></Button></MenuTrigger>
      <MenuContent>
        <MenuItem onSelect={onOpen}>Open</MenuItem>
        {canManage && !p.archived_at && p.booking_status !== 'cancelled' && <MenuItem icon={<Pencil />} onSelect={onEdit}>Edit</MenuItem>}
        {canManage && !p.archived_at && p.booking_status !== 'cancelled' && <MenuItem danger icon={<Ban />} onSelect={onCancel}>Cancel booking…</MenuItem>}
        {canManage && <MenuSeparator />}
        {canManage && <MenuItem icon={p.archived_at ? <ArchiveRestore /> : <Archive />} onSelect={onArchive}>{p.archived_at ? 'Restore' : 'Archive'}</MenuItem>}
      </MenuContent>
    </Menu>
  )
}
