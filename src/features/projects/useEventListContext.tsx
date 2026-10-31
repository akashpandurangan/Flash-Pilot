import { useMutation, useQuery } from '@tanstack/react-query'
import { Archive, ArchiveRestore, Ban, MoreHorizontal, Pencil } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { listEmployees } from '@/api/employees'
import { listFinancials } from '@/api/payments'
import { setProjectArchived } from '@/api/projects'
import { listScheduleEvents } from '@/api/schedule'
import { Button } from '@/components/ui/button'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/menu'
import { errorMessage } from '@/lib/errors'
import { venueByEvent } from '@/lib/schedule'
import type { ProjectOverview } from '@/types/entities'
import { useStudio } from '@/features/studio/StudioProvider'
import type { EventListContext } from './EventTable'
import { CancelProjectDialog, useInvalidateProject } from './ProjectDialogs'

/** The per-event actions menu (three dots): Open, Edit, Cancel booking, Archive - with the same permissions everywhere. */
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

/**
 * Everything an event list needs besides the rows: venues, team names, payment figures (only for people with financial
 * access) and the actions menu. Used by the Events page and the dashboard's Events panel, so both behave identically.
 * Render `dialog` somewhere on the page: it is the "cancel booking" confirmation.
 */
export function useEventListContext() {
  const { studio, can, tz, currency } = useStudio()
  const navigate = useNavigate()
  const invalidate = useInvalidateProject()
  const canManage = can('projects.manage')
  const canFinance = can('finance.view')
  const [cancelling, setCancelling] = useState<ProjectOverview | null>(null)

  // Team names are readable by every member (row level security), so crew see who they work with.
  const team = useQuery({ queryKey: ['employees', studio.id], queryFn: () => listEmployees(studio.id) })
  const financials = useQuery({ queryKey: ['financials', studio.id], queryFn: () => listFinancials(studio.id), enabled: canFinance })
  // Venue lives on the sessions; one wide query covers every event in a list.
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

  const ctx: EventListContext = useMemo(
    () => ({
      tz,
      currency,
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
    [tz, currency, sessions.data, team.data, financials.data, canFinance, canManage, navigate, archive],
  )

  const dialog = cancelling ? <CancelProjectDialog project={cancelling} open onOpenChange={(o) => !o && setCancelling(null)} /> : null
  return { ctx, dialog, team }
}
