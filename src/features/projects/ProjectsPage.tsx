import { useMutation, useQuery } from '@tanstack/react-query'
import { Archive, ArchiveRestore, Ban, FolderKanban, LayoutGrid, List, MoreHorizontal, Pencil, Plus, SlidersHorizontal } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { listEmployees } from '@/api/employees'
import { listFinancials } from '@/api/payments'
import { listProjects, setProjectArchived, type ProjectSort } from '@/api/projects'
import { Button } from '@/components/ui/button'
import { Avatar, Badge, Card, DataState, EmptyState, ListSkeleton, PageHeader, Pagination, Segmented, TableWrap, TD, TH, THead, TR } from '@/components/ui/display'
import { Input, Select } from '@/components/ui/form'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/menu'
import { BookingBadge, StageBadge } from '@/components/ui/status'
import { FilterBar, SearchInput } from '@/components/ui/toolbar'
import { BOOKING_STATUS_LABELS, EVENT_TYPE_LABELS, PRODUCTION_STAGES, PRODUCTION_STAGE_LABELS, options } from '@/lib/constants'
import { errorMessage } from '@/lib/errors'
import { formatMoney } from '@/lib/money'
import { fmtDate, zonedDayBounds } from '@/lib/time'
import type { ProjectOverview } from '@/types/entities'
import { useStudio } from '@/features/studio/StudioProvider'
import { useLocalStorageState } from '@/hooks/hooks'
import { pageNumber, useUrlState } from '@/hooks/useUrlState'
import { CancelProjectDialog, useInvalidateProject } from './ProjectDialogs'

export default function ProjectsPage() {
  const { studio, can, tz, currency } = useStudio()
  const navigate = useNavigate()
  const invalidate = useInvalidateProject()
  const [view, setView] = useLocalStorageState<'list' | 'cards'>('fp.projects.view', 'list')
  const [f, setF] = useUrlState({ q: '', booking: '', stage: '', type: '', emp: '', from: '', to: '', archived: '0', sort: 'soonest', page: '1' })
  const [showFilters, setShowFilters] = useState(!!(f.type || f.emp || f.from || f.to))
  const [cancelling, setCancelling] = useState<ProjectOverview | null>(null)
  const canManage = can('projects.manage')
  const canFinance = can('finance.view')

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
  const team = useQuery({ queryKey: ['employees', studio.id], queryFn: () => listEmployees(studio.id), enabled: can('team.view') })
  const financials = useQuery({ queryKey: ['financials', studio.id], queryFn: () => listFinancials(studio.id), enabled: canFinance })
  const balances = useMemo(() => new Map((financials.data ?? []).map((x) => [x.project_id, Number(x.balance)])), [financials.data])

  const archive = useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) => setProjectArchived(id, archived),
    onSuccess: (_d, v) => { toast.success(v.archived ? 'Event archived' : 'Event restored'); invalidate() },
    onError: (e) => toast.error(errorMessage(e)),
  })

  const rows = query.data?.rows ?? []
  const filtered = !!(f.q || f.booking || f.stage || f.type || f.emp || f.from || f.to || f.archived === '1')
  const clear = () => setF({ q: '', booking: '', stage: '', type: '', emp: '', from: '', to: '', archived: '0' })

  const menu = (p: ProjectOverview) => (
    <RowMenu
      p={p}
      canManage={canManage}
      onOpen={() => navigate(`/events/${p.id}`)}
      onEdit={() => navigate(`/events/${p.id}/edit`)}
      onCancel={() => setCancelling(p)}
      onArchive={() => archive.mutate({ id: p.id, archived: !p.archived_at })}
    />
  )

  return (
    <>
      <PageHeader
        title="Events"
        description={canManage ? 'Every booking from inquiry to delivery.' : 'The sessions and edits assigned to you.'}
        actions={canManage && <Button asChild><Link to="/events/new"><Plus className="size-4" /> New event</Link></Button>}
      />

      <FilterBar>
        <SearchInput className="sm:w-72" value={f.q} onChange={(q) => setF({ q })} placeholder="Search event, client or ID" label="Search events" />
        <Select aria-label="Booking status" className="sm:w-40" value={f.booking} onChange={(e) => setF({ booking: e.target.value })}>
          <option value="">All bookings</option>
          {options(BOOKING_STATUS_LABELS).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
        <Select aria-label="Production stage" className="sm:w-44" value={f.stage} onChange={(e) => setF({ stage: e.target.value })}>
          <option value="">All stages</option>
          {PRODUCTION_STAGES.map((s) => <option key={s} value={s}>{PRODUCTION_STAGE_LABELS[s]}</option>)}
        </Select>
        <Select aria-label="Sort by" className="sm:w-48" value={f.sort} onChange={(e) => setF({ sort: e.target.value })}>
          <option value="soonest">Next session first</option><option value="latest">Latest session date</option><option value="newest">Recently created</option><option value="name">Name (A–Z)</option>
        </Select>
        <Button variant="secondary" onClick={() => setShowFilters((s) => !s)} aria-expanded={showFilters}><SlidersHorizontal className="size-4" /> Filters</Button>
        <div className="sm:ml-auto">
          <Segmented<'list' | 'cards'> label="View" value={view} onChange={setView} options={[{ value: 'list', label: <><List className="size-4" /> List</> }, { value: 'cards', label: <><LayoutGrid className="size-4" /> Cards</> }]} />
        </div>
      </FilterBar>

      {showFilters && (
        <Card className="mb-4 grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="space-y-1 text-[13px] font-medium">Event type
            <Select value={f.type} onChange={(e) => setF({ type: e.target.value })}><option value="">Any type</option>{options(EVENT_TYPE_LABELS).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
          </label>
          {can('team.view') && (
            <label className="space-y-1 text-[13px] font-medium">Assigned to
              <Select value={f.emp} onChange={(e) => setF({ emp: e.target.value })}><option value="">Anyone</option>{(team.data ?? []).map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}</Select>
            </label>
          )}
          <label className="space-y-1 text-[13px] font-medium">Sessions from<Input type="date" value={f.from} onChange={(e) => setF({ from: e.target.value })} /></label>
          <label className="space-y-1 text-[13px] font-medium">Sessions to<Input type="date" value={f.to} min={f.from} onChange={(e) => setF({ to: e.target.value })} /></label>
          <label className="space-y-1 text-[13px] font-medium">Show
            <Select value={f.archived} onChange={(e) => setF({ archived: e.target.value })}><option value="0">Active events</option><option value="1">Archived</option></Select>
          </label>
        </Card>
      )}

      <DataState
        query={query}
        isEmpty={rows.length === 0}
        skeleton={<ListSkeleton />}
        empty={
          filtered ? (
            <EmptyState icon={<FolderKanban />} title="No events match" description="Try removing a filter or changing your search." action={<Button variant="secondary" onClick={clear}>Clear filters</Button>} />
          ) : canManage ? (
            <EmptyState icon={<FolderKanban />} title="Create your first event" description="An event holds the client, session dates, team, equipment and payments for one booking." action={<Button asChild><Link to="/events/new"><Plus className="size-4" /> New event</Link></Button>} />
          ) : (
            <EmptyState icon={<FolderKanban />} title="Nothing assigned to you yet" description="When the studio assigns you to a session or an edit, it appears here." />
          )
        }
      >
        {view === 'list' ? (
          <>
            <div className="hidden md:block">
              <TableWrap>
                <THead>
                  <tr><TH>Event</TH><TH>Client</TH><TH>Date</TH><TH>Type</TH><TH>Booking</TH><TH>Stage</TH><TH>Team</TH>{canFinance && <TH className="text-right">Balance</TH>}<TH className="w-12"><span className="sr-only">Actions</span></TH></tr>
                </THead>
                <tbody>
                  {rows.map((p) => (
                    <TR key={p.id}>
                      <TD><Link to={`/events/${p.id}`} className="block font-medium hover:underline">{p.name}</Link><span className="text-xs text-ink-muted">{p.project_code}</span></TD>
                      <TD>{p.client_name}</TD>
                      <TD className="whitespace-nowrap">{p.next_event_at ?? p.first_event_at ? fmtDate((p.next_event_at ?? p.first_event_at)!, tz) : '—'}{p.event_count > 1 && <span className="ml-1 text-xs text-ink-muted">+{p.event_count - 1}</span>}</TD>
                      <TD>{EVENT_TYPE_LABELS[p.event_type]}</TD>
                      <TD><BookingBadge status={p.booking_status} /></TD>
                      <TD>{p.booking_status === 'confirmed' ? <StageBadge stage={p.production_stage} /> : <span className="text-ink-muted">—</span>}</TD>
                      <TD>{p.assigned_employee_ids.length > 0 ? <span className="text-sm tabular-nums">{p.assigned_employee_ids.length}</span> : p.booking_status !== 'cancelled' ? <Badge tone="warning">Unstaffed</Badge> : '—'}</TD>
                      {canFinance && <TD className="text-right tabular-nums">{balances.has(p.id) ? (balances.get(p.id)! > 0 ? formatMoney(balances.get(p.id)!, currency) : <span className="text-ink-muted">{balances.get(p.id)! < 0 ? 'Credit' : 'Paid'}</span>) : '—'}</TD>}
                      <TD>{menu(p)}</TD>
                    </TR>
                  ))}
                </tbody>
              </TableWrap>
            </div>
            <ul className="space-y-2 md:hidden">{rows.map((p) => <li key={p.id}><ProjectCard p={p} tz={tz} balance={canFinance ? balances.get(p.id) : undefined} currency={currency} menu={menu(p)} /></li>)}</ul>
          </>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{rows.map((p) => <li key={p.id}><ProjectCard p={p} tz={tz} balance={canFinance ? balances.get(p.id) : undefined} currency={currency} menu={menu(p)} /></li>)}</ul>
        )}
        <Pagination page={pageNumber(f.page)} total={query.data?.total ?? 0} onPage={(p) => setF({ page: String(p) })} />
      </DataState>

      {cancelling && <CancelProjectDialog project={cancelling} open onOpenChange={(o) => !o && setCancelling(null)} />}
    </>
  )
}

function ProjectCard({ p, tz, balance, currency, menu }: { p: ProjectOverview; tz: string; balance?: number; currency: string; menu: React.ReactNode }) {
  const date = p.next_event_at ?? p.first_event_at
  return (
    <Card className="flex h-full flex-col p-4 transition-colors hover:border-line-strong">
      <div className="flex items-start justify-between gap-2">
        <Link to={`/events/${p.id}`} className="min-w-0">
          <p className="truncate text-sm font-semibold hover:underline">{p.name}</p>
          <p className="truncate text-xs text-ink-muted">{p.project_code} · {p.client_name}</p>
        </Link>
        {menu}
      </div>
      <p className="mt-3 text-sm">{date ? fmtDate(date, tz) : 'No date'}{p.event_count > 1 && <span className="text-ink-muted"> · +{p.event_count - 1} more</span>}</p>
      <p className="text-xs text-ink-muted">{EVENT_TYPE_LABELS[p.event_type]}</p>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <BookingBadge status={p.booking_status} />
        {p.booking_status === 'confirmed' && <StageBadge stage={p.production_stage} />}
        {p.booking_status !== 'cancelled' && p.assigned_employee_ids.length === 0 && <Badge tone="warning">Unstaffed</Badge>}
      </div>
      <div className="mt-auto flex items-center justify-between pt-3 text-xs text-ink-muted">
        <span className="inline-flex items-center gap-1.5">{p.assigned_employee_ids.length > 0 && <Avatar name={`${p.assigned_employee_ids.length}`} className="size-5 text-[10px]" />}{p.assigned_employee_ids.length > 0 ? `${p.assigned_employee_ids.length} on team` : ''}</span>
        {balance !== undefined && <span className="tabular-nums">{balance > 0 ? `${formatMoney(balance, currency)} due` : balance < 0 ? 'Credit' : 'Paid'}</span>}
      </div>
    </Card>
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
