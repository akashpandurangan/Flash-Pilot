import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, ArchiveRestore, Contact, Eye, MoreHorizontal, Pencil, Plus } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { listClients, setClientArchived, type ClientSort } from '@/api/clients'
import { Button } from '@/components/ui/button'
import { Avatar, Badge, DataState, EmptyState, ListSkeleton, PageHeader, Pagination, TableWrap, TD, TH, THead, TR } from '@/components/ui/display'
import { Select } from '@/components/ui/form'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu'
import { FilterBar, SearchInput } from '@/components/ui/toolbar'
import { fmtDateOnly } from '@/lib/time'
import { errorMessage } from '@/lib/errors'
import { useStudio } from '@/features/studio/StudioProvider'
import { pageNumber, useUrlState } from '@/hooks/useUrlState'
import type { Client } from '@/types/entities'
import { ClientFormDialog } from './ClientFormDialog'

export default function ClientsPage() {
  const { studio, can } = useStudio()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [f, setF] = useUrlState({ q: '', status: 'active', sort: 'name', page: '1' })
  const [editing, setEditing] = useState<Client | null | 'new'>(null)

  const query = useQuery({
    queryKey: ['clients', studio.id, f],
    queryFn: () => listClients({ studioId: studio.id, search: f.q, status: f.status as 'active', sort: f.sort as ClientSort, page: pageNumber(f.page) }),
    placeholderData: (prev) => prev,
  })

  const archive = useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) => setClientArchived(id, archived),
    onSuccess: (_d, v) => {
      toast.success(v.archived ? 'Client archived. Their events and payments are kept.' : 'Client restored')
      void qc.invalidateQueries({ queryKey: ['clients'] })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  const canManage = can('clients.manage')
  const rows = query.data?.rows ?? []
  const filtered = !!f.q || f.status !== 'active'

  return (
    <>
      <PageHeader
        title="Clients"
        description="Everyone you shoot for, with their events and balances."
        actions={canManage && <Button onClick={() => setEditing('new')}><Plus className="size-4" /> New client</Button>}
      />
      <FilterBar>
        <SearchInput className="sm:w-72" value={f.q} onChange={(q) => setF({ q })} placeholder="Search name, phone or email" label="Search clients" />
        <Select aria-label="Status" className="sm:w-40" value={f.status} onChange={(e) => setF({ status: e.target.value })}>
          <option value="active">Active</option>
          <option value="archived">Archived</option>
          <option value="all">All</option>
        </Select>
        <Select aria-label="Sort by" className="sm:w-44" value={f.sort} onChange={(e) => setF({ sort: e.target.value })}>
          <option value="name">Name (A–Z)</option>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </Select>
      </FilterBar>

      <DataState
        query={query}
        isEmpty={rows.length === 0}
        skeleton={<ListSkeleton />}
        empty={
          filtered ? (
            <EmptyState icon={<Contact />} title="No clients match" description="Try a different search or filter." action={<Button variant="secondary" onClick={() => setF({ q: '', status: 'active' })}>Clear filters</Button>} />
          ) : (
            <EmptyState
              icon={<Contact />}
              title="Add your first client"
              description="Clients hold contact details and every event you do for them."
              action={canManage && <Button onClick={() => setEditing('new')}><Plus className="size-4" /> New client</Button>}
            />
          )
        }
      >
        {/* table on larger screens */}
        <div className="hidden md:block">
          <TableWrap>
            <THead><tr><TH>Name</TH><TH>Phone</TH><TH>Email</TH><TH>Added</TH><TH className="w-12"><span className="sr-only">Actions</span></TH></tr></THead>
            <tbody>
              {rows.map((c) => (
                <TR key={c.id}>
                  <TD>
                    <Link to={`/clients/${c.id}`} className="flex items-center gap-3 font-medium hover:underline">
                      <Avatar name={c.full_name} /> {c.full_name}
                      {c.archived_at && <Badge tone="outline">Archived</Badge>}
                    </Link>
                  </TD>
                  <TD className="tabular-nums">{c.phone ?? '—'}</TD>
                  <TD className="max-w-56 truncate">{c.email ?? '—'}</TD>
                  <TD className="text-ink-muted">{fmtDateOnly(c.created_at.slice(0, 10))}</TD>
                  <TD>
                    <RowMenu client={c} canManage={canManage} onView={() => navigate(`/clients/${c.id}`)} onEdit={() => setEditing(c)} onArchive={() => archive.mutate({ id: c.id, archived: !c.archived_at })} />
                  </TD>
                </TR>
              ))}
            </tbody>
          </TableWrap>
        </div>
        {/* cards on phones */}
        <ul className="space-y-2 md:hidden">
          {rows.map((c) => (
            <li key={c.id} className="flex items-center gap-3 rounded-lg border border-line p-3">
              <Avatar name={c.full_name} className="size-10" />
              <Link to={`/clients/${c.id}`} className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{c.full_name}{c.archived_at && ' · archived'}</span>
                <span className="block truncate text-xs text-ink-muted">{[c.phone, c.email].filter(Boolean).join(' · ') || 'No contact details'}</span>
              </Link>
              <RowMenu client={c} canManage={canManage} onView={() => navigate(`/clients/${c.id}`)} onEdit={() => setEditing(c)} onArchive={() => archive.mutate({ id: c.id, archived: !c.archived_at })} />
            </li>
          ))}
        </ul>
        <Pagination page={pageNumber(f.page)} total={query.data?.total ?? 0} onPage={(p) => setF({ page: String(p) })} />
      </DataState>

      <ClientFormDialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} client={editing === 'new' ? null : editing} />
    </>
  )
}

function RowMenu({ client, canManage, onView, onEdit, onArchive }: { client: Client; canManage: boolean; onView: () => void; onEdit: () => void; onArchive: () => void }) {
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${client.full_name}`}><MoreHorizontal className="size-4" /></Button>
      </MenuTrigger>
      <MenuContent>
        <MenuItem icon={<Eye />} onSelect={onView}>View</MenuItem>
        {canManage && <MenuItem icon={<Pencil />} onSelect={onEdit}>Edit</MenuItem>}
        {canManage && (
          <MenuItem icon={client.archived_at ? <ArchiveRestore /> : <Archive />} onSelect={onArchive}>{client.archived_at ? 'Restore' : 'Archive'}</MenuItem>
        )}
      </MenuContent>
    </Menu>
  )
}
