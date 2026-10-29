import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, ArchiveRestore, FolderKanban, Mail, MapPin, Pencil, Phone, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import { toast } from 'sonner'
import { getClient, listClientProjects, setClientArchived } from '@/api/clients'
import { listFinancials } from '@/api/payments'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/dialog'
import { Avatar, Badge, Detail, EmptyState, ErrorState, Notice, PageHeader, Panel, Skeleton, StatCard } from '@/components/ui/display'
import { BookingBadge, StageBadge } from '@/components/ui/status'
import { EVENT_TYPE_LABELS } from '@/lib/constants'
import { errorMessage } from '@/lib/errors'
import { formatMoney } from '@/lib/money'
import { fmtDate } from '@/lib/time'
import type { ProjectOverview } from '@/types/entities'
import { useStudio } from '@/features/studio/StudioProvider'
import { ClientFormDialog } from './ClientFormDialog'

export default function ClientDetailPage() {
  const { id = '' } = useParams()
  const { studio, can, tz, currency } = useStudio()
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)

  const client = useQuery({ queryKey: ['client', id], queryFn: () => getClient(id) })
  const projects = useQuery({ queryKey: ['projects', 'client', id], queryFn: () => listClientProjects(id) })
  const financials = useQuery({ queryKey: ['financials', studio.id], queryFn: () => listFinancials(studio.id), enabled: can('finance.view') })

  const archive = useMutation({
    mutationFn: (archived: boolean) => setClientArchived(id, archived),
    onSuccess: (_d, archived) => {
      toast.success(archived ? 'Client archived' : 'Client restored')
      void qc.invalidateQueries({ queryKey: ['client', id] })
      void qc.invalidateQueries({ queryKey: ['clients'] })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  const totals = useMemo(() => {
    if (!projects.data || !financials.data) return null
    const ids = new Set(projects.data.filter((p) => p.booking_status !== 'cancelled').map((p) => p.id))
    const rows = financials.data.filter((f) => ids.has(f.project_id))
    return {
      value: rows.reduce((s, f) => s + Number(f.agreed_amount), 0),
      received: rows.reduce((s, f) => s + Number(f.paid_amount), 0),
      outstanding: rows.reduce((s, f) => s + Math.max(Number(f.balance), 0), 0),
    }
  }, [projects.data, financials.data])

  if (client.isLoading) return <div className="space-y-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-40 w-full" /></div>
  if (client.isError) return <ErrorState error={client.error} onRetry={() => void client.refetch()} />
  if (!client.data) return <EmptyState title="Client not found" description="It may have been removed, or you may not have access." action={<Button variant="secondary" asChild><Link to="/clients">Back to clients</Link></Button>} />

  const c = client.data
  const now = Date.now()
  const upcoming = (projects.data ?? []).filter((p) => p.last_event_at && new Date(p.last_event_at).getTime() >= now && p.booking_status !== 'cancelled')
  const past = (projects.data ?? []).filter((p) => !upcoming.includes(p))
  const canManage = can('clients.manage')

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Clients', to: '/clients' }, { label: c.full_name }]}
        title={<span className="flex items-center gap-3"><Avatar name={c.full_name} className="size-10" /> {c.full_name}{c.archived_at && <Badge tone="outline">Archived</Badge>}</span>}
        actions={
          <>
            {canManage && !c.archived_at && can('projects.manage') && (
              <Button asChild><Link to={`/projects/new?client=${c.id}`}><Plus className="size-4" /> New project</Link></Button>
            )}
            {canManage && <Button variant="secondary" onClick={() => setEditing(true)}><Pencil className="size-4" /> Edit</Button>}
            {canManage && (
              c.archived_at ? (
                <Button variant="secondary" onClick={() => archive.mutate(false)} loading={archive.isPending}><ArchiveRestore className="size-4" /> Restore</Button>
              ) : (
                <ConfirmDialog
                  trigger={<Button variant="secondary"><Archive className="size-4" /> Archive</Button>}
                  title={`Archive ${c.full_name}?`}
                  description="They'll be hidden from the active client list and can't be picked for new projects. Their existing projects, payments and history are all kept, and you can restore them any time."
                  confirmLabel="Archive client"
                  tone="primary"
                  onConfirm={() => archive.mutateAsync(true)}
                />
              )
            )}
          </>
        }
      />

      {c.archived_at && <Notice tone="warning" className="mb-4">This client is archived. Restore them to create new projects.</Notice>}

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Contact" className="min-w-0 lg:col-span-1">
          <dl className="space-y-3">
            <Detail label="Phone">{c.phone && <a className="inline-flex items-center gap-1.5 hover:underline" href={`tel:${c.phone.replace(/\s/g, '')}`}><Phone className="size-3.5 text-ink-muted" aria-hidden /> {c.phone}</a>}</Detail>
            <Detail label="Email">{c.email && <a className="inline-flex items-center gap-1.5 break-all hover:underline" href={`mailto:${c.email}`}><Mail className="size-3.5 shrink-0 text-ink-muted" aria-hidden /> {c.email}</a>}</Detail>
            <Detail label="Address">{c.address && <span className="inline-flex items-start gap-1.5"><MapPin className="mt-0.5 size-3.5 shrink-0 text-ink-muted" aria-hidden /> {c.address}</span>}</Detail>
            <Detail label="Notes"><span className="whitespace-pre-wrap">{c.notes}</span></Detail>
            <Detail label="Client since">{fmtDate(c.created_at, tz)}</Detail>
          </dl>
        </Panel>

        <div className="min-w-0 space-y-4 lg:col-span-2">
          {can('finance.view') && (
            <div className="grid gap-3 sm:grid-cols-3">
              <StatCard label="Total project value" value={totals ? formatMoney(totals.value, currency) : '—'} />
              <StatCard label="Amount received" value={totals ? formatMoney(totals.received, currency) : '—'} />
              <StatCard label="Outstanding" value={totals ? formatMoney(totals.outstanding, currency) : '—'} hint={totals && totals.outstanding > 0 ? 'Still to collect' : undefined} />
            </div>
          )}
          {projects.isError && <ErrorState error={projects.error} onRetry={() => void projects.refetch()} />}
          {projects.isLoading && <Skeleton className="h-32 w-full" />}
          {projects.data && projects.data.length === 0 && (
            <EmptyState
              icon={<FolderKanban />}
              title="No projects yet"
              description="Create a project to record their events, team and payments."
              action={canManage && !c.archived_at && can('projects.manage') && <Button asChild><Link to={`/projects/new?client=${c.id}`}><Plus className="size-4" /> New project</Link></Button>}
            />
          )}
          {upcoming.length > 0 && <ProjectGroup title="Upcoming events" projects={upcoming} tz={tz} />}
          {past.length > 0 && <ProjectGroup title="Past & other projects" projects={past} tz={tz} />}
        </div>
      </div>

      <ClientFormDialog open={editing} onOpenChange={setEditing} client={c} />
    </>
  )
}

function ProjectGroup({ title, projects, tz }: { title: string; projects: ProjectOverview[]; tz: string }) {
  return (
    <Panel title={title} bodyClassName="p-0">
      <ul className="divide-y divide-line">
        {projects.map((p) => (
          <li key={p.id}>
            <Link to={`/projects/${p.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-sidebar">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{p.name}</p>
                <p className="text-xs text-ink-muted">
                  {p.project_code} · {EVENT_TYPE_LABELS[p.event_type]} · {p.first_event_at ? fmtDate(p.first_event_at, tz) : 'No date'}
                  {p.event_count > 1 && ` (+${p.event_count - 1} more)`}
                </p>
              </div>
              <div className="flex items-center gap-1.5"><BookingBadge status={p.booking_status} />{p.booking_status === 'confirmed' && <StageBadge stage={p.production_stage} />}</div>
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
