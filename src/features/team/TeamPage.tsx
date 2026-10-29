import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, MailPlus, MoreHorizontal, Pencil, Plus, ShieldOff, UserCheck, UserX, UsersRound } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { createEmployee, inviteEmployee, listEmployees, revokeAccess, updateAccess, updateEmployee } from '@/api/employees'
import { listScheduleEvents } from '@/api/schedule'
import { Button } from '@/components/ui/button'
import { ConfirmDialog, Dialog, DialogContent } from '@/components/ui/dialog'
import { Avatar, Badge, DataState, EmptyState, ListSkeleton, Notice, PageHeader, TableWrap, TD, TH, THead, TR } from '@/components/ui/display'
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/menu'
import { FilterBar, SearchInput } from '@/components/ui/toolbar'
import { ACCESS_ROLE_DESCRIPTIONS, ACCESS_ROLE_LABELS, DEFAULT_ACCESS_FOR_TEAM_ROLE, TEAM_ROLE_LABELS, options } from '@/lib/constants'
import { errorMessage } from '@/lib/errors'
import { isValidEmail, isValidPhone } from '@/lib/utils'
import type { AccessRole, Employee } from '@/types/entities'
import { useStudio } from '@/features/studio/StudioProvider'
import { useUrlState } from '@/hooks/useUrlState'

const employeeSchema = z.object({
  full_name: z.string().trim().min(2, 'Enter a name').max(120),
  email: z.string().trim().refine((v) => v === '' || isValidEmail(v), 'Enter a valid email address'),
  phone: z.string().trim().refine((v) => v === '' || isValidPhone(v), 'Enter a valid phone number'),
  job_title: z.string().trim().max(80),
  team_role: z.enum(['photographer', 'videographer', 'editor', 'assistant', 'studio_manager']),
  notes: z.string().trim().max(1000),
  is_active: z.boolean(),
})
type EmployeeValues = z.infer<typeof employeeSchema>

function accessLabel(e: Employee): { label: string; tone: 'solid' | 'neutral' | 'warning' | 'outline' } {
  if (!e.access_role) return { label: 'No sign-in', tone: 'outline' }
  if (e.invite_status === 'pending') return { label: 'Invited', tone: 'warning' }
  return { label: ACCESS_ROLE_LABELS[e.access_role], tone: e.access_role === 'owner' ? 'solid' : 'neutral' }
}

export default function TeamPage() {
  const { studio, role, can, tz } = useStudio()
  const qc = useQueryClient()
  const [f, setF] = useUrlState({ q: '', role: '', status: 'active', sort: 'name' })
  const [editing, setEditing] = useState<Employee | 'new' | null>(null)
  const [access, setAccess] = useState<Employee | null>(null)

  const team = useQuery({ queryKey: ['employees', studio.id], queryFn: () => listEmployees(studio.id) })
  const upcoming = useQuery({
    queryKey: ['schedule', studio.id, 'team-upcoming'],
    queryFn: () => listScheduleEvents({ studioId: studio.id, from: new Date().toISOString(), to: new Date(Date.now() + 90 * 86_400_000).toISOString() }),
  })

  const counts = useMemo(() => {
    const map = new Map<string, number>()
    for (const ev of upcoming.data ?? []) {
      if (ev.project.booking_status === 'cancelled' || ev.project.archived_at) continue
      for (const a of ev.event_assignments ?? []) map.set(a.employee_id, (map.get(a.employee_id) ?? 0) + 1)
    }
    return map
  }, [upcoming.data])

  const rows = useMemo(() => {
    const term = f.q.trim().toLowerCase()
    return (team.data ?? [])
      .filter((e) => (f.status === 'all' ? true : f.status === 'active' ? e.is_active : !e.is_active))
      .filter((e) => !f.role || e.team_role === f.role)
      .filter((e) => !term || [e.full_name, e.email, e.phone, e.job_title].some((v) => v?.toLowerCase().includes(term)))
      .sort((a, b) =>
        f.sort === 'role' ? a.team_role.localeCompare(b.team_role) || a.full_name.localeCompare(b.full_name)
        : f.sort === 'assignments' ? (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0)
        : a.full_name.localeCompare(b.full_name))
  }, [team.data, f, counts])

  const toggleActive = useMutation({
    mutationFn: (e: Employee) => updateEmployee(e.id, { is_active: !e.is_active }),
    onSuccess: (_d, e) => {
      toast.success(e.is_active ? `${e.full_name} deactivated. Their history is kept.` : `${e.full_name} reactivated`)
      void qc.invalidateQueries({ queryKey: ['employees'] })
      void qc.invalidateQueries({ queryKey: ['schedule'] })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const canManage = can('team.manage')
  const isOwner = role === 'owner'

  return (
    <>
      <PageHeader
        title="Team"
        description="Photographers, videographers, editors and everyone who works with you."
        actions={canManage && <Button onClick={() => setEditing('new')}><Plus className="size-4" /> Add team member</Button>}
      />
      <FilterBar>
        <SearchInput className="sm:w-72" value={f.q} onChange={(q) => setF({ q })} placeholder="Search name, phone or email" label="Search team" />
        <Select aria-label="Role" className="sm:w-44" value={f.role} onChange={(e) => setF({ role: e.target.value })}>
          <option value="">All roles</option>
          {options(TEAM_ROLE_LABELS).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
        <Select aria-label="Status" className="sm:w-36" value={f.status} onChange={(e) => setF({ status: e.target.value })}>
          <option value="active">Active</option><option value="inactive">Inactive</option><option value="all">All</option>
        </Select>
        <Select aria-label="Sort by" className="sm:w-48" value={f.sort} onChange={(e) => setF({ sort: e.target.value })}>
          <option value="name">Name (A–Z)</option><option value="role">Role</option><option value="assignments">Most upcoming work</option>
        </Select>
      </FilterBar>

      <DataState
        query={team}
        isEmpty={rows.length === 0}
        skeleton={<ListSkeleton />}
        empty={
          (team.data?.length ?? 0) <= 1 && !f.q ? (
            <EmptyState icon={<UsersRound />} title="Build your team" description="Add the people you assign to events. They don't need an account to be scheduled." action={canManage && <Button onClick={() => setEditing('new')}><Plus className="size-4" /> Add team member</Button>} />
          ) : (
            <EmptyState icon={<UsersRound />} title="No one matches" description="Try a different search or filter." action={<Button variant="secondary" onClick={() => setF({ q: '', role: '', status: 'active' })}>Clear filters</Button>} />
          )
        }
      >
        <div className="hidden md:block">
          <TableWrap>
            <THead><tr><TH>Name</TH><TH>Role</TH><TH>Phone</TH><TH>Email</TH><TH>Access</TH><TH className="text-right">Upcoming</TH><TH>Status</TH><TH className="w-12"><span className="sr-only">Actions</span></TH></tr></THead>
            <tbody>
              {rows.map((e) => {
                const acc = accessLabel(e)
                return (
                  <TR key={e.id} className={e.is_active ? '' : 'text-ink-muted'}>
                    <TD><div className="flex items-center gap-3"><Avatar name={e.full_name} /><div className="min-w-0"><p className="truncate font-medium text-ink">{e.full_name}</p>{e.job_title && <p className="truncate text-xs text-ink-muted">{e.job_title}</p>}</div></div></TD>
                    <TD>{TEAM_ROLE_LABELS[e.team_role]}</TD>
                    <TD className="tabular-nums">{e.phone ?? '—'}</TD>
                    <TD className="max-w-52 truncate">{e.email ?? '—'}</TD>
                    <TD><Badge tone={acc.tone}>{acc.label}</Badge></TD>
                    <TD className="text-right tabular-nums">{counts.get(e.id) ?? 0}</TD>
                    <TD>{e.is_active ? <Badge tone="success">Active</Badge> : <Badge tone="outline">Inactive</Badge>}</TD>
                    <TD>{canManage && <RowMenu e={e} isOwner={isOwner} onEdit={() => setEditing(e)} onAccess={() => setAccess(e)} onToggle={() => toggleActive.mutate(e)} />}</TD>
                  </TR>
                )
              })}
            </tbody>
          </TableWrap>
        </div>
        <ul className="space-y-2 md:hidden">
          {rows.map((e) => {
            const acc = accessLabel(e)
            return (
              <li key={e.id} className="flex items-start gap-3 rounded-lg border border-line p-3">
                <Avatar name={e.full_name} className="size-10" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{e.full_name}</p>
                  <p className="text-xs text-ink-muted">{TEAM_ROLE_LABELS[e.team_role]} · {counts.get(e.id) ?? 0} upcoming</p>
                  <p className="truncate text-xs text-ink-muted">{[e.phone, e.email].filter(Boolean).join(' · ')}</p>
                  <div className="mt-1.5 flex gap-1.5"><Badge tone={acc.tone}>{acc.label}</Badge>{!e.is_active && <Badge tone="outline">Inactive</Badge>}</div>
                </div>
                {canManage && <RowMenu e={e} isOwner={isOwner} onEdit={() => setEditing(e)} onAccess={() => setAccess(e)} onToggle={() => toggleActive.mutate(e)} />}
              </li>
            )
          })}
        </ul>
      </DataState>

      <EmployeeFormDialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} employee={editing === 'new' ? null : editing} studioId={studio.id} />
      <AccessDialog employee={access} onClose={() => setAccess(null)} tz={tz} />
    </>
  )
}

function RowMenu({ e, isOwner, onEdit, onAccess, onToggle }: { e: Employee; isOwner: boolean; onEdit: () => void; onAccess: () => void; onToggle: () => void }) {
  const protectedOwner = e.access_role === 'owner'
  // The confirmation lives outside the menu: closing a menu unmounts its content, which would discard the dialog.
  const [confirm, setConfirm] = useState(false)
  return (
    <>
      <Menu>
        <MenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={`Actions for ${e.full_name}`}><MoreHorizontal className="size-4" /></Button></MenuTrigger>
        <MenuContent>
          <MenuItem icon={<Pencil />} onSelect={onEdit}>Edit details</MenuItem>
          {isOwner && !protectedOwner && (
            <MenuItem icon={e.access_role ? <KeyRound /> : <MailPlus />} onSelect={onAccess} disabled={!e.is_active}>
              {e.access_role ? 'Manage sign-in access' : 'Invite to sign in'}
            </MenuItem>
          )}
          {!protectedOwner && (
            <>
              <MenuSeparator />
              <MenuItem danger={e.is_active} icon={e.is_active ? <UserX /> : <UserCheck />} onSelect={() => setConfirm(true)}>
                {e.is_active ? 'Deactivate' : 'Reactivate'}
              </MenuItem>
            </>
          )}
        </MenuContent>
      </Menu>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={e.is_active ? `Deactivate ${e.full_name}?` : `Reactivate ${e.full_name}?`}
        description={
          e.is_active
            ? 'They can no longer sign in or be assigned to new work, and their upcoming event reminders are withdrawn. Their past assignments and history stay on every project.'
            : 'They can be assigned to events again. If they have sign-in access they can use it immediately.'
        }
        confirmLabel={e.is_active ? 'Deactivate' : 'Reactivate'}
        tone={e.is_active ? 'danger' : 'primary'}
        onConfirm={onToggle}
      />
    </>
  )
}

/* ------------------------------------------------------------ create / edit */
export function EmployeeFormDialog({ open, onOpenChange, employee, studioId, onSaved }: {
  open: boolean
  onOpenChange: (o: boolean) => void
  employee: Employee | null
  studioId: string
  onSaved?: (e: Employee) => void
}) {
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<EmployeeValues>({
    resolver: zodResolver(employeeSchema),
    defaultValues: { full_name: '', email: '', phone: '', job_title: '', team_role: 'photographer', notes: '', is_active: true },
  })

  useEffect(() => {
    if (!open) return
    setError(null)
    reset({
      full_name: employee?.full_name ?? '', email: employee?.email ?? '', phone: employee?.phone ?? '', job_title: employee?.job_title ?? '',
      team_role: employee?.team_role ?? 'photographer', notes: employee?.notes ?? '', is_active: employee?.is_active ?? true,
    })
  }, [open, employee, reset])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={employee ? 'Edit team member' : 'Add team member'}
        description="Employee records are separate from sign-in accounts - add someone now, invite them later."
        footer={<><Button variant="secondary" onClick={() => onOpenChange(false)} disabled={isSubmitting}>Cancel</Button><Button type="submit" form="employee-form" loading={isSubmitting}>{employee ? 'Save changes' : 'Add member'}</Button></>}
      >
        <form
          id="employee-form"
          noValidate
          className="space-y-4"
          onSubmit={(ev) => {
            ev.stopPropagation()
            void handleSubmit(async (v) => {
              setError(null)
              try {
                const saved = employee ? await updateEmployee(employee.id, v) : await createEmployee(studioId, v)
                toast.success(employee ? 'Changes saved' : `${v.full_name} added`)
                void qc.invalidateQueries({ queryKey: ['employees'] })
                onSaved?.(saved)
                onOpenChange(false)
              } catch (err) {
                setError(errorMessage(err))
              }
            })(ev)
          }}
        >
          {error && <Notice tone="danger">{error}</Notice>}
          <Field label="Full name" error={errors.full_name?.message} required>{(a) => <Input autoFocus {...a} {...register('full_name')} />}</Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Team role" required>{(a) => <Select {...a} {...register('team_role')}>{options(TEAM_ROLE_LABELS).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>}</Field>
            <Field label="Job title" error={errors.job_title?.message}>{(a) => <Input placeholder="e.g. Senior cinematographer" {...a} {...register('job_title')} />}</Field>
            <Field label="Email" error={errors.email?.message}>{(a) => <Input type="email" {...a} {...register('email')} />}</Field>
            <Field label="Phone" error={errors.phone?.message}>{(a) => <Input type="tel" {...a} {...register('phone')} />}</Field>
          </div>
          <Field label="Notes" hint="Internal - strengths, availability, anything useful.">{(a) => <Textarea rows={2} {...a} {...register('notes')} />}</Field>
          {employee && employee.access_role !== 'owner' && <Checkbox label="Active" description="Inactive people can't be assigned or sign in." {...register('is_active')} />}
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------ invitation & access */
function AccessDialog({ employee, onClose }: { employee: Employee | null; onClose: () => void; tz: string }) {
  const qc = useQueryClient()
  const [accessRole, setAccessRole] = useState<Exclude<AccessRole, 'owner'>>('photographer')
  const [finance, setFinance] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!employee) return
    setError(null)
    setAccessRole(((employee.access_role && employee.access_role !== 'owner' ? employee.access_role : DEFAULT_ACCESS_FOR_TEAM_ROLE[employee.team_role]) ?? 'photographer') as Exclude<AccessRole, 'owner'>)
    setFinance(employee.can_view_financials)
  }, [employee])

  const refresh = () => qc.invalidateQueries({ queryKey: ['employees'] })
  const invite = useMutation({
    mutationFn: () => inviteEmployee({ employeeId: employee!.id, accessRole, canViewFinancials: accessRole === 'manager' && finance }),
    onSuccess: (r) => { toast.success(r.message); void refresh(); onClose() },
    onError: (e) => setError(errorMessage(e)),
  })
  const update = useMutation({
    mutationFn: () => updateAccess(employee!.id, { access_role: accessRole, can_view_financials: accessRole === 'manager' && finance }),
    onSuccess: () => { toast.success('Access updated'); void refresh(); onClose() },
    onError: (e) => setError(errorMessage(e)),
  })
  const revoke = useMutation({
    mutationFn: () => revokeAccess(employee!.id),
    onSuccess: () => { toast.success('Sign-in access removed. The employee record and history are kept.'); void refresh(); onClose() },
    onError: (e) => toast.error(errorMessage(e)),
  })

  const hasAccess = !!employee?.access_role
  const pending = employee?.invite_status === 'pending'

  return (
    <Dialog open={!!employee} onOpenChange={(o) => !o && onClose()}>
      {employee && (
        <DialogContent
          title={hasAccess ? 'Sign-in access' : 'Invite to sign in'}
          description={employee.full_name}
          footer={
            <>
              {hasAccess && (
                <ConfirmDialog
                  title="Remove sign-in access?"
                  description={`${employee.full_name} will no longer be able to sign in. They stay on your team and keep all past assignments; you can invite them again later.`}
                  confirmLabel="Remove access"
                  onConfirm={() => revoke.mutateAsync()}
                  trigger={<Button variant="danger-outline" className="sm:mr-auto"><ShieldOff className="size-4" /> Remove access</Button>}
                />
              )}
              <Button variant="secondary" onClick={onClose}>Close</Button>
              {hasAccess && !pending && <Button onClick={() => update.mutate()} loading={update.isPending}>Save access</Button>}
              {(!hasAccess || pending) && (
                <Button onClick={() => invite.mutate()} loading={invite.isPending} disabled={!employee.email}>
                  <MailPlus className="size-4" /> {pending ? 'Resend invitation' : 'Send invitation'}
                </Button>
              )}
            </>
          }
        >
          <div className="space-y-4">
            {error && <Notice tone="danger">{error}</Notice>}
            {!employee.email && <Notice tone="warning">Add an email address to this person before inviting them (Edit details).</Notice>}
            {pending && <Notice tone="info">An invitation is pending. They'll be able to set a password from the email link. You can resend it if it expired.</Notice>}
            {employee.email && !hasAccess && <p className="text-sm text-ink-muted">We'll email <span className="font-medium text-ink">{employee.email}</span> a secure link to set their own password. No password is ever shared.</p>}
            <Field label="Access level">
              {(a) => (
                <Select {...a} value={accessRole} onChange={(e) => setAccessRole(e.target.value as Exclude<AccessRole, 'owner'>)}>
                  {(['manager', 'photographer', 'editor'] as const).map((r) => <option key={r} value={r}>{ACCESS_ROLE_LABELS[r]}</option>)}
                </Select>
              )}
            </Field>
            <p className="-mt-2 text-[13px] text-ink-muted">{ACCESS_ROLE_DESCRIPTIONS[accessRole]}</p>
            {accessRole === 'manager' && (
              <Checkbox label="Can view and record payments" description="Off by default. Grants access to project amounts, payments and financial reports." checked={finance} onChange={(e) => setFinance(e.target.checked)} />
            )}
          </div>
        </DialogContent>
      )}
    </Dialog>
  )
}
