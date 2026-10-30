import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Circle, ExternalLink, Hourglass, MoreHorizontal, Pencil, Plus, Trash2, Truck, Undo2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { listEmployees } from '@/api/employees'
import { addTask, deleteTask, getDelivery, listProjectActivity, listTasks, runWorkflowAction, setTaskDone, updateTask, type ProjectDetail } from '@/api/projects'
import { Button } from '@/components/ui/button'
import { ConfirmDialog, Dialog, DialogContent } from '@/components/ui/dialog'
import { Badge, Detail, EmptyState, ErrorState, Notice, Panel, Skeleton } from '@/components/ui/display'
import { Checkbox, Field, Input, Select } from '@/components/ui/form'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu'
import { StageStepper } from '@/components/ui/status'
import { DELIVERY_METHOD_LABELS, TASK_PHASE_LABELS, options } from '@/lib/constants'
import { errorMessage } from '@/lib/errors'
import { formatMoney } from '@/lib/money'
import { canCompletePhase } from '@/lib/permissions'
import { fmtDateOnly, fmtDateTime } from '@/lib/time'
import { cn } from '@/lib/utils'
import { checkWorkflowAction, nextWorkflowAction, WORKFLOW_LABELS, type WorkflowAction, type WorkflowSubject } from '@/lib/workflow'
import type { ProductionTask, TaskPhase } from '@/types/entities'
import { useStudio } from '@/features/studio/StudioProvider'
import { ApprovalDialog, DeliveryDialog, ProductionPlanDialog, useInvalidateProject } from './ProjectDialogs'

const PHASES: TaskPhase[] = ['preparation', 'shoot', 'post', 'editing', 'delivery']

export function ProductionTab({ project, balance }: { project: ProjectDetail; balance: number | null }) {
  const { studio, role, can, tz, currency } = useStudio()
  const canManage = can('projects.manage')
  const [plan, setPlan] = useState(false)
  const [deliveryOpen, setDeliveryOpen] = useState(false)
  const [outOpen, setOutOpen] = useState(false)
  const [approvalOpen, setApprovalOpen] = useState(false)

  const delivery = useQuery({ queryKey: ['project-delivery', project.id], queryFn: () => getDelivery(project.id) })
  const activity = useQuery({ queryKey: ['project-activity', project.id], queryFn: () => listProjectActivity(project.id, 100) })

  const subject: WorkflowSubject = project
  const invalidate = useInvalidateProject()
  const run = useMutation({
    mutationFn: (action: WorkflowAction) => runWorkflowAction(project.id, action),
    onSuccess: (_p, action) => { toast.success(WORKFLOW_LABELS[action].done); invalidate(['project-delivery']) },
    onError: (e) => toast.error(errorMessage(e)),
  })

  const stage = project.production_stage
  const confirmed = project.booking_status === 'confirmed'
  const next = nextWorkflowAction(subject)
  const check = next ? checkWorkflowAction(subject, role, next) : null
  const stepBack = checkWorkflowAction(subject, role, 'revert')
  const who = (action: string) => activity.data?.find((a) => a.action === `workflow_${action}`)?.actor_name

  const sessions = project.project_events.filter((s) => !s.cancelled_at)
  const firstStart = sessions[0]?.starts_at
  const lastEnd = sessions.reduce<string | null>((latest, s) => (!latest || s.ends_at > latest ? s.ends_at : latest), null)

  // production starts and ends by itself - say when, so nobody wonders why nothing is happening
  const automatic =
    stage === 'upcoming' && firstStart ? `Production starts automatically at ${fmtDateTime(firstStart, tz)}.`
    : stage === 'production' && lastEnd ? `Production ends automatically at ${fmtDateTime(lastEnd, tz)}, then the event waits for the client's approval.`
    : null

  const milestones: { label: string; at: string | null; action: string; detail?: string | null }[] = [
    { label: 'Production started', at: project.production_started_at, action: 'start_production' },
    { label: 'Production completed', at: project.shoot_completed_at, action: 'complete_shoot' },
    {
      label: 'Client approved', at: project.client_approved_at, action: 'approve_client',
      detail: project.client_approved_at ? [project.client_approved_by_name && `Recorded by ${project.client_approved_by_name}`, project.client_approval_note].filter(Boolean).join(' · ') : null,
    },
    { label: 'Editing completed', at: project.editing_completed_at, action: 'complete_editing' },
    { label: 'Out for delivery', at: project.ready_for_delivery_at, action: 'mark_out_for_delivery' },
    { label: 'Delivered', at: project.delivered_at, action: 'mark_delivered' },
  ]

  /** The next step's button. Approval and "out for delivery" collect details first; the rest run straight away. */
  const primary = (() => {
    if (!next) return null
    const manual = next === 'start_production' || next === 'complete_shoot'
    const label = WORKFLOW_LABELS[next].label
    const common = { size: 'lg' as const, className: 'w-full sm:w-auto', disabled: !check?.ok, variant: manual ? ('secondary' as const) : ('primary' as const) }
    if (next === 'approve_client') return <Button {...common} onClick={() => setApprovalOpen(true)}>{label}</Button>
    if (next === 'mark_out_for_delivery' && canManage) return <Button {...common} onClick={() => setOutOpen(true)}>{label}</Button>
    if (next === 'mark_delivered' && balance !== null && balance > 0) {
      return (
        <ConfirmDialog
          tone="primary"
          title="Deliver with an outstanding balance?"
          description={`${formatMoney(balance, currency)} is still unpaid on this event. You can deliver anyway - the balance stays on record and keeps appearing in Payments.`}
          confirmLabel="Mark delivered anyway"
          onConfirm={() => run.mutateAsync('mark_delivered')}
          trigger={<Button {...common}>{label}</Button>}
        />
      )
    }
    return <Button {...common} loading={run.isPending && run.variables === next} onClick={() => run.mutate(next)}>{label}</Button>
  })()

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <div className="min-w-0 space-y-4">
        <Panel title="Production progress" description="Booking status and production stage are tracked separately.">
          <StageStepper stage={stage} className="mb-5" />
          {!confirmed && <Notice tone="info" className="mb-4">{project.booking_status === 'inquiry' ? 'Confirm the booking to start tracking production.' : 'This booking is cancelled, so production is frozen.'}</Notice>}

          {confirmed && stage === 'awaiting_approval' && (
            <Notice tone="warning" title="Waiting for client approval" className="mb-4">
              Production finished {project.shoot_completed_at ? fmtDateTime(project.shoot_completed_at, tz) : 'and'} - editing starts only once the client approves.
              {can('projects.manage') ? ' Record the approval below when you have it.' : ' The studio owner or a manager records the approval.'}
            </Notice>
          )}
          {confirmed && stage === 'out_for_delivery' && (
            <Notice tone="info" title="Out for delivery" className="mb-4">
              Sent {project.ready_for_delivery_at ? fmtDateTime(project.ready_for_delivery_at, tz) : ''}. Mark it delivered once the client has received everything.
            </Notice>
          )}

          {stage === 'delivered' ? (
            <Notice tone="success" title="Delivered">Delivered {project.delivered_at ? fmtDateTime(project.delivered_at, tz) : ''}. Nothing left to do.</Notice>
          ) : confirmed && next ? (
            <div className="space-y-2">
              {automatic && <p className="text-[13px] text-ink-muted">{automatic}</p>}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                {primary}
                {stepBack.ok && (
                  <ConfirmDialog
                    tone="primary"
                    title="Step back one stage?"
                    description="The latest milestone is cleared and the event returns to the previous stage. The history stays in the activity log, and the automatic schedule will not undo it."
                    confirmLabel="Step back"
                    onConfirm={() => run.mutateAsync('revert')}
                    trigger={<Button variant="ghost"><Undo2 className="size-4" /> Step back</Button>}
                  />
                )}
              </div>
              {check && !check.ok && <p className="text-[13px] text-ink-muted">{check.reason}</p>}
            </div>
          ) : null}
          {stage === 'delivered' && stepBack.ok && (
            <div className="mt-3">
              <ConfirmDialog
                tone="primary"
                title="Reopen this delivery?"
                description="The event returns to “Out for delivery” and the delivery confirmation is cleared. The earlier delivery stays in the activity log."
                confirmLabel="Reopen"
                onConfirm={() => run.mutateAsync('revert')}
                trigger={<Button variant="secondary" size="sm"><Undo2 className="size-3.5" /> Reopen</Button>}
              />
            </div>
          )}

          <ol className="mt-6 space-y-2.5 border-t border-line pt-4">
            {milestones.map((m) => {
              const pending = !m.at && m.action === 'approve_client' && stage === 'awaiting_approval'
              return (
                <li key={m.action} className="flex items-start gap-2.5 text-sm">
                  {m.at ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden /> : pending ? <Hourglass className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden /> : <Circle className="mt-0.5 size-4 shrink-0 text-line-strong" aria-hidden />}
                  <div className="min-w-0">
                    <p className={cn(!m.at && !pending && 'text-ink-muted')}>{pending ? 'Client approval - pending' : m.label}</p>
                    {m.at && <p className="text-xs text-ink-muted">{fmtDateTime(m.at, tz)}{m.action !== 'approve_client' && who(m.action) ? ` · ${who(m.action)}` : ''}</p>}
                    {m.detail && <p className="text-xs text-ink-muted">{m.detail}</p>}
                  </div>
                </li>
              )
            })}
          </ol>
        </Panel>

        <Checklist project={project} />
      </div>

      <div className="min-w-0 space-y-4">
        <Panel
          title="Editor & deadlines"
          action={canManage && project.booking_status !== 'cancelled' && <Button variant="secondary" size="sm" onClick={() => setPlan(true)}><Pencil className="size-3.5" /> Edit</Button>}
        >
          <dl className="space-y-3">
            <Detail label="Editor">{project.editor?.full_name}</Detail>
            <Detail label="Editing due">{project.editing_due_date && fmtDateOnly(project.editing_due_date)}</Detail>
            <Detail label="Delivery due">{project.delivery_due_date && fmtDateOnly(project.delivery_due_date)}</Detail>
          </dl>
        </Panel>

        <Panel
          title="Delivery"
          action={canManage && project.booking_status === 'confirmed' && <Button variant="secondary" size="sm" onClick={() => setDeliveryOpen(true)}>{delivery.data ? <><Pencil className="size-3.5" /> Edit</> : <><Truck className="size-3.5" /> Add link</>}</Button>}
        >
          {delivery.isLoading ? <Skeleton className="h-20 w-full" /> : delivery.isError ? <ErrorState error={delivery.error} onRetry={() => void delivery.refetch()} /> : (
            <dl className="space-y-3">
              <Detail label="Status">
                {stage === 'delivered' ? <Badge tone="success">Delivered</Badge> : stage === 'out_for_delivery' ? <Badge tone="accent">Out for delivery</Badge> : <Badge tone="outline">Not sent yet</Badge>}
              </Detail>
              <Detail label="Out for delivery">{project.ready_for_delivery_at && fmtDateTime(project.ready_for_delivery_at, tz)}</Detail>
              <Detail label="Delivered">{(delivery.data?.confirmed_at ?? project.delivered_at) && fmtDateTime((delivery.data?.confirmed_at ?? project.delivered_at)!, tz)}</Detail>
              {delivery.data && (
                <>
                  <Detail label="Method">{DELIVERY_METHOD_LABELS[delivery.data.method]}</Detail>
                  <Detail label="Link">
                    {delivery.data.link_url && <a href={delivery.data.link_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 break-all underline underline-offset-2">{delivery.data.link_url}<ExternalLink className="size-3 shrink-0" /></a>}
                  </Detail>
                  <Detail label="Notes"><span className="whitespace-pre-wrap">{delivery.data.notes}</span></Detail>
                </>
              )}
              {!delivery.data && <p className="text-[13px] text-ink-muted">No delivery link yet. Add the gallery or download link here, or when you mark the event out for delivery.</p>}
            </dl>
          )}
        </Panel>
      </div>

      <ProductionPlanDialog project={project} open={plan} onOpenChange={setPlan} />
      <DeliveryDialog project={project} delivery={delivery.data ?? null} open={deliveryOpen} onOpenChange={setDeliveryOpen} />
      <DeliveryDialog project={project} delivery={delivery.data ?? null} open={outOpen} onOpenChange={setOutOpen} outForDelivery />
      <ApprovalDialog project={project} open={approvalOpen} onOpenChange={setApprovalOpen} />
      <span className="sr-only" aria-live="polite">{studio.name}</span>
    </div>
  )
}

/* -------------------------------------------------------------- checklist */
function Checklist({ project }: { project: ProjectDetail }) {
  const { studio, role, can } = useStudio()
  const qc = useQueryClient()
  const canManage = can('projects.manage')
  const key = ['project-tasks', project.id]
  const tasks = useQuery({ queryKey: key, queryFn: () => listTasks(project.id) })
  const employees = useQuery({ queryKey: ['employees', studio.id], queryFn: () => listEmployees(studio.id), enabled: canManage })
  const [editing, setEditing] = useState<ProductionTask | null>(null)
  const [title, setTitle] = useState('')
  const [phase, setPhase] = useState<TaskPhase>('preparation')
  const frozen = project.booking_status === 'cancelled' || !!project.archived_at

  const toggle = useMutation({
    mutationFn: ({ id, done }: { id: string; done: boolean }) => setTaskDone(id, done),
    onMutate: async ({ id, done }) => {
      await qc.cancelQueries({ queryKey: key })
      const prev = qc.getQueryData<ProductionTask[]>(key)
      qc.setQueryData<ProductionTask[]>(key, (old) => old?.map((t) => (t.id === id ? { ...t, is_done: done } : t)))
      return { prev }
    },
    onError: (e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(key, ctx.prev); toast.error(errorMessage(e)) },
    onSettled: () => { void qc.invalidateQueries({ queryKey: key }); void qc.invalidateQueries({ queryKey: ['project-activity', project.id] }) },
  })
  const add = useMutation({
    mutationFn: () => addTask(studio.id, project.id, title, phase, (Math.max(0, ...(tasks.data ?? []).map((t) => t.sort_order)) || 0) + 10),
    onSuccess: () => { setTitle(''); void qc.invalidateQueries({ queryKey: key }) },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const remove = useMutation({
    mutationFn: (id: string) => deleteTask(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: key }),
    onError: (e) => toast.error(errorMessage(e)),
  })

  const done = tasks.data?.filter((t) => t.is_done).length ?? 0
  const total = tasks.data?.length ?? 0
  const names = new Map((employees.data ?? []).map((e) => [e.id, e.full_name]))

  return (
    <Panel
      title="Production checklist"
      description={total > 0 ? `${done} of ${total} done · ticking items never changes the event stage` : undefined}
      bodyClassName="p-0"
    >
      {tasks.isLoading && <div className="space-y-2 p-4"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></div>}
      {tasks.isError && <div className="p-4"><ErrorState error={tasks.error} onRetry={() => void tasks.refetch()} /></div>}
      {tasks.data && total === 0 && <div className="p-4"><EmptyState title="No tasks" description={canManage ? 'Add the steps this event needs.' : 'Nothing has been added yet.'} /></div>}
      {tasks.data && total > 0 && (
        <>
          <div className="h-1 bg-subtle" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label="Checklist progress"><div className="h-full bg-ink transition-[width]" style={{ width: `${(done / total) * 100}%` }} /></div>
          {PHASES.filter((p) => tasks.data.some((t) => t.phase === p)).map((p) => (
            <section key={p} className="border-b border-line last:border-0" aria-label={TASK_PHASE_LABELS[p]}>
              <h3 className="bg-sidebar px-4 py-1.5 text-xs font-medium uppercase tracking-wide text-ink-muted">{TASK_PHASE_LABELS[p]}</h3>
              <ul>
                {tasks.data.filter((t) => t.phase === p).map((t) => {
                  const allowed = canCompletePhase(role, t.phase) && !frozen
                  return (
                    <li key={t.id} className="flex items-start gap-2 px-4 py-2.5 hover:bg-sidebar">
                      <Checkbox
                        className="min-w-0 flex-1"
                        checked={t.is_done}
                        disabled={!allowed || (toggle.isPending && toggle.variables?.id === t.id)}
                        onChange={(e) => toggle.mutate({ id: t.id, done: e.target.checked })}
                        label={<span className={cn(t.is_done && 'text-ink-muted line-through')}>{t.title}</span>}
                        description={
                          t.is_done && t.done_at ? `Done ${fmtDateOnly(t.done_at.slice(0, 10))}${t.done_by_name ? ` by ${t.done_by_name}` : ''}`
                          : t.assignee_id && names.get(t.assignee_id) ? `Responsible: ${names.get(t.assignee_id)}` : !allowed && !frozen ? 'Handled by another role' : undefined
                        }
                      />
                      {canManage && !frozen && (
                        <Menu>
                          <MenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={`Actions for ${t.title}`}><MoreHorizontal className="size-4" /></Button></MenuTrigger>
                          <MenuContent>
                            <MenuItem icon={<Pencil />} onSelect={() => setEditing(t)}>Edit</MenuItem>
                            <MenuItem danger icon={<Trash2 />} onSelect={() => remove.mutate(t.id)}>Delete</MenuItem>
                          </MenuContent>
                        </Menu>
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </>
      )}
      {canManage && !frozen && (
        <form className="flex flex-col gap-2 border-t border-line p-3 sm:flex-row" onSubmit={(e) => { e.preventDefault(); if (title.trim()) add.mutate() }}>
          <Input aria-label="New task" placeholder="Add a task…" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
          <Select aria-label="Phase" className="sm:w-44" value={phase} onChange={(e) => setPhase(e.target.value as TaskPhase)}>{options(TASK_PHASE_LABELS).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
          <Button type="submit" variant="secondary" loading={add.isPending} disabled={!title.trim()}><Plus className="size-4" /> Add</Button>
        </form>
      )}
      <TaskEditDialog task={editing} onClose={() => setEditing(null)} employees={(employees.data ?? []).filter((e) => e.is_active || e.id === editing?.assignee_id)} />
    </Panel>
  )
}

function TaskEditDialog({ task, onClose, employees }: { task: ProductionTask | null; onClose: () => void; employees: { id: string; full_name: string }[] }) {
  const qc = useQueryClient()
  const [title, setTitle] = useState('')
  const [phase, setPhase] = useState<TaskPhase>('preparation')
  const [assignee, setAssignee] = useState('')
  useEffect(() => { if (task) { setTitle(task.title); setPhase(task.phase); setAssignee(task.assignee_id ?? '') } }, [task])
  const save = useMutation({
    mutationFn: () => updateTask(task!.id, { title: title.trim(), phase, assignee_id: assignee || null }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['project-tasks'] }); onClose() },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <Dialog open={!!task} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm" title="Edit task" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => save.mutate()} loading={save.isPending} disabled={!title.trim()}>Save</Button></>}>
        <div className="space-y-4">
          <Field label="Task" required>{(a) => <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} {...a} />}</Field>
          <Field label="Phase" hint="Decides which roles can tick it off.">{(a) => <Select value={phase} onChange={(e) => setPhase(e.target.value as TaskPhase)} {...a}>{options(TASK_PHASE_LABELS).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>}</Field>
          <Field label="Responsible person">{(a) => <Select value={assignee} onChange={(e) => setAssignee(e.target.value)} {...a}><option value="">Anyone</option>{employees.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}</Select>}</Field>
        </div>
      </DialogContent>
    </Dialog>
  )
}
