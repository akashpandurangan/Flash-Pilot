import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, UserPlus } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useFieldArray, useForm, useWatch } from 'react-hook-form'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { listAllClients } from '@/api/clients'
import { listEmployees } from '@/api/employees'
import { getProjectFinancials } from '@/api/payments'
import { getProject, saveProject, type ProjectDetail } from '@/api/projects'
import { listInventory, listScheduleEvents } from '@/api/schedule'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/dialog'
import { Badge, EmptyState, ErrorState, Notice, PageHeader, Skeleton } from '@/components/ui/display'
import { Checkbox, Field, FormSection, Input, MoneyInput, Select, Textarea } from '@/components/ui/form'
import { BOOKING_STATUS_LABELS, EVENT_TYPE_LABELS, PAYMENT_METHOD_LABELS, TEAM_ROLE_LABELS, options } from '@/lib/constants'
import { conflictsInvolving, findEmployeeConflicts, findEquipmentConflicts, overlaps, type Conflict, type ConflictEvent } from '@/lib/conflicts'
import { errorMessage } from '@/lib/errors'
import { formatMoney, parseMoneyInput, summarizeFinancials } from '@/lib/money'
import { toConflictEvent } from '@/lib/schedule'
import { addDaysToDateString, buildEventRange, todayKey } from '@/lib/time'
import type { Client, Employee, Equipment, ProjectFinancials } from '@/types/entities'
import { ClientFormDialog } from '@/features/clients/ClientFormDialog'
import { useStudio } from '@/features/studio/StudioProvider'
import { useDebounced, useUnsavedChangesWarning } from '@/hooks/hooks'
import { EventCard } from './EventCard'
import { defaultProjectValues, emptyEvent, formToPayload, projectSchema, projectToForm, type ProjectFormValues } from './projectForm'

export default function ProjectFormPage() {
  const { id } = useParams()
  const [search] = useSearchParams()
  const { studio, can } = useStudio()
  const canFinance = can('finance.manage')
  const isNew = !id

  const clients = useQuery({ queryKey: ['clients', 'all', studio.id], queryFn: () => listAllClients(studio.id) })
  const employees = useQuery({ queryKey: ['employees', studio.id], queryFn: () => listEmployees(studio.id) })
  const inventory = useQuery({ queryKey: ['inventory', studio.id], queryFn: () => listInventory(studio.id) })
  const project = useQuery({ queryKey: ['project', id], queryFn: () => getProject(id!), enabled: !isNew })
  const finance = useQuery({ queryKey: ['project-financials', id], queryFn: () => getProjectFinancials(id!), enabled: !isNew && canFinance })

  const loading = clients.isLoading || employees.isLoading || inventory.isLoading || (!isNew && (project.isLoading || (canFinance && finance.isLoading)))
  const failed = [clients, employees, inventory, project, finance].find((q) => q.isError)

  if (loading) return <div className="space-y-4"><Skeleton className="h-8 w-72" /><Skeleton className="h-64 w-full" /><Skeleton className="h-64 w-full" /></div>
  if (failed) return <ErrorState error={failed.error} onRetry={() => void failed.refetch()} />
  if (!isNew && !project.data) return <EmptyState title="Project not found" description="It may have been removed, or you may not have access." action={<Button variant="secondary" asChild><Link to="/projects">Back to projects</Link></Button>} />
  if (!isNew && project.data?.archived_at) return <EmptyState title="This project is archived" description="Restore it from the project page before editing." action={<Button variant="secondary" asChild><Link to={`/projects/${id}`}>Open project</Link></Button>} />

  return (
    <ProjectForm
      key={id ?? 'new'}
      project={project.data ?? null}
      finance={finance.data ?? null}
      clients={clients.data ?? []}
      employees={employees.data ?? []}
      inventory={inventory.data ?? []}
      presetClient={search.get('client') ?? ''}
    />
  )
}

interface FormProps {
  project: ProjectDetail | null
  finance: (ProjectFinancials & { payment_notes: string | null }) | null
  clients: Client[]
  employees: Employee[]
  inventory: Equipment[]
  presetClient: string
}

function ProjectForm({ project, finance, clients, employees, inventory, presetClient }: FormProps) {
  const { studio, tz, currency, can } = useStudio()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const canFinance = can('finance.manage')
  const isNew = !project
  const [removed, setRemoved] = useState<string[]>([])
  const [newClient, setNewClient] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const submitting = useRef(false)

  const form = useForm<ProjectFormValues>({
    resolver: zodResolver(projectSchema),
    defaultValues: project ? projectToForm(project, finance, tz) : defaultProjectValues(clients.some((c) => c.id === presetClient) ? presetClient : ''),
    mode: 'onTouched',
  })
  const { control, register, handleSubmit, setValue, watch, formState: { errors, isDirty, isSubmitting, submitCount } } = form
  const events = useFieldArray({ control, name: 'events' })
  useUnsavedChangesWarning(isDirty && !done)

  const watchedEvents = useWatch({ control, name: 'events' })
  const name = watch('name')
  const bookingStatus = watch('booking_status')
  const clientId = watch('client_id')
  const agreed = parseMoneyInput(watch('agreed_amount')) ?? 0
  const advance = parseMoneyInput(watch('advance_amount')) ?? 0
  const overpaying = advance > 0 && advance > agreed

  const preview = useConflictPreview({ studioId: studio.id, tz, projectId: project?.id ?? null, name, bookingStatus: project?.booking_status ?? bookingStatus, events: watchedEvents, employees, inventory, removed })

  async function onValid(values: ProjectFormValues) {
    if (submitting.current) return // belt and braces against double clicks
    submitting.current = true
    setFormError(null)
    try {
      const payload = formToPayload(values, { studioId: studio.id, tz, canFinance, isNew, removedEventIds: removed, today: todayKey(tz) })
      const savedId = await saveProject(project?.id ?? null, payload)
      setDone(true)
      toast.success(isNew ? 'Project created' : 'Changes saved')
      for (const key of ['projects', 'project', 'schedule', 'dashboard', 'project-financials', 'project-payments', 'financials', 'client', 'activity']) void qc.invalidateQueries({ queryKey: [key] })
      navigate(`/projects/${savedId}`, { state: { saved: isNew ? 'created' : 'updated' } })
    } catch (err) {
      // The form keeps everything the user typed; they can fix the problem and retry.
      const msg = errorMessage(err)
      setFormError(msg)
      toast.error(msg)
    } finally {
      submitting.current = false
    }
  }

  const invalidCount = Object.keys(errors).length
  const activeClients = clients
  const typeAhead = clients.length > 12

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Projects', to: '/projects' }, ...(project ? [{ label: project.name, to: `/projects/${project.id}` }, { label: 'Edit' }] : [{ label: 'New project' }])]}
        title={isNew ? 'New project' : 'Edit project'}
        description={isNew ? 'Capture the booking once: client, events, team, equipment and money.' : `${project.project_code} · changes are saved together.`}
      />

      <form noValidate onSubmit={(e) => void handleSubmit(onValid, () => { setFormError(null); toast.error('Please fix the highlighted fields.') })(e)} className="pb-4">
        <div className="divide-y divide-line">
          <FormSection title="Project details" description="Who it's for and what it is.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Project ID" hint={isNew ? 'Assigned automatically when you save.' : undefined}>
                {(a) => <Input readOnly disabled value={project?.project_code ?? 'Generated on save'} {...a} />}
              </Field>
              <Field label="Primary event type" error={errors.event_type?.message}>
                {(a) => <Select {...a} {...register('event_type')}>{options(EVENT_TYPE_LABELS).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>}
              </Field>
            </div>
            <Field label="Client" error={errors.client_id?.message} required>
              {(a) => (
                <div className="flex gap-2">
                  <Select {...a} {...register('client_id')} className="flex-1">
                    <option value="">Choose a client…</option>
                    {activeClients.map((c) => <option key={c.id} value={c.id}>{c.full_name}{c.phone ? ` · ${c.phone}` : ''}</option>)}
                    {project && !clients.some((c) => c.id === project.client_id) && <option value={project.client_id}>(archived client)</option>}
                  </Select>
                  <Button variant="secondary" onClick={() => setNewClient(true)}><UserPlus className="size-4" /> New</Button>
                </div>
              )}
            </Field>
            {typeAhead && <p className="-mt-2 text-xs text-ink-muted">Tip: with the list focused, type a client's name to jump to it.</p>}
            <Field label="Project name" error={errors.name?.message} hint='e.g. "Sharma–Rao Wedding"' required>{(a) => <Input {...a} {...register('name')} />}</Field>
            {isNew ? (
              <Field label="Booking status" hint="Only confirmed bookings trigger team notifications and reminders. Keep it as an inquiry until the client commits.">
                {(a) => <Select {...a} {...register('booking_status')}>{(['inquiry', 'confirmed'] as const).map((s) => <option key={s} value={s}>{BOOKING_STATUS_LABELS[s]}</option>)}</Select>}
              </Field>
            ) : (
              <p className="text-sm text-ink-muted">Booking status: <Badge>{BOOKING_STATUS_LABELS[project.booking_status]}</Badge> - change it from the project page.</p>
            )}
            <Field label="Description" error={errors.description?.message}>{(a) => <Textarea rows={2} {...a} {...register('description')} />}</Field>
            <Field label="Internal notes" hint="Never shown to the client." error={errors.internal_notes?.message}>{(a) => <Textarea rows={2} {...a} {...register('internal_notes')} />}</Field>
          </FormSection>

          <FormSection title="Events" description="A project can span several days - engagement, wedding, reception. Each event has its own time, venue, team and equipment.">
            {errors.events?.message && <Notice tone="danger">{errors.events.message}</Notice>}
            {events.fields.map((f, i) => (
              <RemovableEvent
                key={f.id}
                persisted={!!watchedEvents?.[i]?.dbId}
                eventTitle={watchedEvents?.[i]?.title || `Event ${i + 1}`}
                canRemove={events.fields.length > 1}
                onRemove={() => {
                  const existing = watchedEvents?.[i]?.dbId
                  if (existing) setRemoved((r) => [...r, existing])
                  events.remove(i)
                }}
              >
                {(requestRemove) => (
                  <EventCard
                    index={i}
                    control={control}
                    register={register}
                    setValue={setValue}
                    errors={errors}
                    employees={employees}
                    inventory={inventory}
                    busy={preview.busy[i] ?? new Set()}
                    reserved={preview.reserved[i] ?? new Map()}
                    conflicts={preview.byEvent[i] ?? []}
                    persisted={!!watchedEvents?.[i]?.dbId}
                    canRemove={events.fields.length > 1}
                    onRemove={requestRemove}
                  />
                )}
              </RemovableEvent>
            ))}
            <Button variant="secondary" onClick={() => events.append({ ...emptyEvent(watch('event_type')), venue_name: watchedEvents?.[0]?.venue_name ?? '' })}>
              <Plus className="size-4" /> Add another event date
            </Button>
          </FormSection>

          <FormSection title="Production planning" description="Optional now - you can set these later from the project page.">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Editor">
                {(a) => (
                  <Select {...a} {...register('editor_id')}>
                    <option value="">Not assigned</option>
                    {[...employees].filter((e) => e.is_active || e.id === watch('editor_id')).sort((x, y) => Number(y.team_role === 'editor') - Number(x.team_role === 'editor') || x.full_name.localeCompare(y.full_name)).map((e) => (
                      <option key={e.id} value={e.id}>{e.full_name} · {TEAM_ROLE_LABELS[e.team_role]}</option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Editing due">{(a) => <Input type="date" {...a} {...register('editing_due_date')} />}</Field>
              <Field label="Delivery due" error={errors.delivery_due_date?.message}>{(a) => <Input type="date" {...a} {...register('delivery_due_date')} />}</Field>
            </div>
          </FormSection>

          {canFinance ? (
            <FormSection title="Financial details" description="Enter the agreed amount yourself - there are no preset packages. Balances are always calculated from recorded payments.">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Total agreed amount" error={errors.agreed_amount?.message}>{(a) => <MoneyInput symbol={currency === 'INR' ? '₹' : currency} placeholder="0" {...a} {...register('agreed_amount')} />}</Field>
                <Field label="Payment due date" hint="Optional - used for overdue reminders.">{(a) => <Input type="date" {...a} {...register('payment_due_date')} />}</Field>
              </div>
              {isNew ? (
                <div className="space-y-4 rounded-lg border border-line p-4">
                  <div>
                    <h3 className="text-sm font-semibold">Advance payment</h3>
                    <p className="text-xs text-ink-muted">Optional. Recorded as the first payment on this project. Add later installments from the project page.</p>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <Field label="Amount received" error={errors.advance_amount?.message}>{(a) => <MoneyInput symbol={currency === 'INR' ? '₹' : currency} {...a} {...register('advance_amount')} />}</Field>
                    <Field label="Date received">{(a) => <Input type="date" max={todayKey(tz)} {...a} {...register('advance_paid_on')} />}</Field>
                    <Field label="Method">{(a) => <Select {...a} {...register('advance_method')}>{options(PAYMENT_METHOD_LABELS).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>}</Field>
                    <Field label="Reference">{(a) => <Input placeholder="UTR / receipt no." {...a} {...register('advance_reference')} />}</Field>
                  </div>
                  {overpaying && (
                    <Notice tone="warning" title="The advance is more than the project amount">
                      Recording it leaves the client with a credit of {formatMoney(advance - agreed, currency)}.
                      <div className="mt-2"><Checkbox label="Yes, record it anyway" {...register('allow_overpayment')} /></div>
                    </Notice>
                  )}
                  <p className="text-sm">
                    Balance after advance: <span className="font-semibold tabular-nums">{formatMoney(summarizeFinancials(agreed, advance > 0 ? [{ amount: advance }] : []).balance, currency)}</span>
                  </p>
                </div>
              ) : (
                <Notice tone="info">
                  To add an installment or fix a payment, use the Payments tab on the project page - every payment keeps its own record. Current balance:{' '}
                  <span className="font-semibold text-ink">{finance ? formatMoney(Math.max(finance.balance, 0), currency) : '—'}</span>
                </Notice>
              )}
              <Field label="Payment notes">{(a) => <Textarea rows={2} {...a} {...register('payment_notes')} />}</Field>
            </FormSection>
          ) : (
            <FormSection title="Financial details">
              <Notice tone="info">Amounts and payments are visible to the owner and to managers with payment access, so they aren't shown here.</Notice>
            </FormSection>
          )}
        </div>

        {/* sticky action bar */}
        <div className="sticky bottom-0 z-20 -mx-4 border-t border-line bg-canvas/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 text-sm">
              {formError ? (
                <span role="alert" className="font-medium text-danger">{formError}</span>
              ) : submitCount > 0 && invalidCount > 0 ? (
                <span role="alert" className="font-medium text-danger">Please fix the highlighted fields.</span>
              ) : preview.total > 0 ? (
                <span className="text-warning">{preview.total} scheduling {preview.total === 1 ? 'warning' : 'warnings'} - you can still save.</span>
              ) : (
                <span className="text-ink-muted">{isDirty ? 'Unsaved changes' : clientId ? 'No changes yet' : ''}</span>
              )}
            </div>
            <div className="flex gap-2 sm:shrink-0">
              {isDirty ? (
                <ConfirmDialog
                  trigger={<Button variant="secondary" disabled={isSubmitting}>Cancel</Button>}
                  title="Discard your changes?"
                  description="Everything you've entered on this form will be lost."
                  confirmLabel="Discard"
                  onConfirm={() => { setDone(true); navigate(project ? `/projects/${project.id}` : '/projects') }}
                />
              ) : (
                <Button variant="secondary" asChild><Link to={project ? `/projects/${project.id}` : '/projects'}>Cancel</Link></Button>
              )}
              <Button type="submit" loading={isSubmitting}>{isSubmitting ? 'Saving…' : isNew ? 'Create project' : 'Save changes'}</Button>
            </div>
          </div>
        </div>
      </form>

      <ClientFormDialog
        open={newClient}
        onOpenChange={setNewClient}
        onSaved={(c) => {
          void qc.invalidateQueries({ queryKey: ['clients', 'all'] }).then(() => setValue('client_id', c.id, { shouldDirty: true, shouldValidate: true }))
        }}
      />
    </>
  )
}

/** Wraps an event so removing a *saved* event asks first (it is cancelled, not deleted). */
function RemovableEvent({ persisted, eventTitle, canRemove, onRemove, children }: {
  persisted: boolean
  eventTitle: string
  canRemove: boolean
  onRemove: () => void
  children: (requestRemove: () => void) => React.ReactNode
}) {
  const [confirm, setConfirm] = useState(false)
  return (
    <>
      {children(() => (persisted ? setConfirm(true) : onRemove()))}
      {canRemove && (
        <ConfirmDialog
          open={confirm}
          onOpenChange={setConfirm}
          title={`Cancel “${eventTitle}”?`}
          description="When you save, this event is cancelled: its team is notified, its reminders are withdrawn and its equipment is released. The event stays in the project's history."
          confirmLabel="Cancel this event"
          onConfirm={onRemove}
        />
      )}
    </>
  )
}

/* ---------------------------------------------------------------------------
 * Live scheduling check while editing: compares the events on screen with every
 * other booking in the same window, so people and gear that are already spoken
 * for are flagged before anything is saved.
 * ------------------------------------------------------------------------- */
function useConflictPreview({ studioId, tz, projectId, name, bookingStatus, events, employees, inventory, removed }: {
  studioId: string
  tz: string
  projectId: string | null
  name: string
  bookingStatus: 'inquiry' | 'confirmed' | 'cancelled'
  events: ProjectFormValues['events']
  employees: Employee[]
  inventory: Equipment[]
  removed: string[]
}) {
  const debounced = useDebounced(events, 400)
  const names = useMemo(() => new Map(employees.map((e) => [e.id, e.full_name])), [employees])

  const drafts = useMemo(() => {
    const out: { idx: number; ce: ConflictEvent }[] = []
    debounced?.forEach((e, idx) => {
      if (!e.date || !e.start_time || !e.end_time || e.start_time === e.end_time) return
      const { startsAt, endsAt } = buildEventRange(e.date, e.start_time, e.end_time, tz)
      out.push({
        idx,
        ce: {
          id: e.dbId ?? `draft-${idx}`, projectId: projectId ?? 'draft', projectName: name || 'This project', title: e.title || `Event ${idx + 1}`,
          startsAt, endsAt, bookingStatus, cancelled: false, archived: false, venueName: e.venue_name, venueAddress: e.venue_address,
          assignments: e.assignments.filter((a) => a.employee_id).map((a) => ({ employeeId: a.employee_id, employeeName: names.get(a.employee_id) ?? 'Team member', role: a.role })),
          equipment: e.equipment.map((r) => ({ equipmentId: r.equipment_id || null, customName: r.custom_name || null, quantity: Number(r.quantity) || 1 })),
        },
      })
    })
    return out
  }, [debounced, tz, projectId, name, bookingStatus, names])

  const window = useMemo(() => {
    if (drafts.length === 0) return null
    const starts = drafts.map((d) => new Date(d.ce.startsAt).getTime())
    const ends = drafts.map((d) => new Date(d.ce.endsAt).getTime())
    return {
      from: addDaysToDateString(new Date(Math.min(...starts)).toISOString().slice(0, 10), -1),
      to: addDaysToDateString(new Date(Math.max(...ends)).toISOString().slice(0, 10), 2),
    }
  }, [drafts])

  const existing = useQuery({
    queryKey: ['schedule', studioId, 'form', window?.from, window?.to],
    queryFn: () => listScheduleEvents({ studioId, from: `${window!.from}T00:00:00Z`, to: `${window!.to}T00:00:00Z` }),
    enabled: !!window,
    staleTime: 30_000,
  })

  return useMemo(() => {
    const draftIds = new Set(drafts.map((d) => d.ce.id))
    const gone = new Set(removed)
    const others = (existing.data ?? []).filter((e) => !draftIds.has(e.id) && !gone.has(e.id)).map(toConflictEvent)
    const all = [...others, ...drafts.map((d) => d.ce)]
    const conflicts: Conflict[] = conflictsInvolving([...findEmployeeConflicts(all), ...findEquipmentConflicts(all, inventory)], draftIds)

    const byEvent: Conflict[][] = []
    const busy: Set<string>[] = []
    const reserved: Map<string, number>[] = []
    for (const d of drafts) {
      byEvent[d.idx] = conflicts.filter((c) => (c.kind === 'unstaffed' || c.kind === 'equipment_unavailable' ? c.event.id === d.ce.id : c.events.some((e) => e.id === d.ce.id)))
      const b = new Set<string>()
      const r = new Map<string, number>()
      for (const o of others) {
        if (!overlaps(o.startsAt, o.endsAt, d.ce.startsAt, d.ce.endsAt) || o.bookingStatus === 'cancelled') continue
        o.assignments.forEach((a) => b.add(a.employeeId))
        o.equipment.forEach((q) => q.equipmentId && r.set(q.equipmentId, (r.get(q.equipmentId) ?? 0) + q.quantity))
      }
      busy[d.idx] = b
      reserved[d.idx] = r
    }
    return { byEvent, busy, reserved, total: conflicts.length }
  }, [drafts, existing.data, inventory, removed])
}
