import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { listEmployees } from '@/api/employees'
import { saveDelivery, setBookingStatus, setEventTeam, updateProjectFields } from '@/api/projects'
import { updateFinance } from '@/api/payments'
import { listScheduleEvents } from '@/api/schedule'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Notice } from '@/components/ui/display'
import { Field, Input, MoneyInput, Select, Textarea } from '@/components/ui/form'
import { ASSIGNMENT_ROLE_LABELS, DELIVERY_METHOD_LABELS, TEAM_ROLE_LABELS, options } from '@/lib/constants'
import { overlaps } from '@/lib/conflicts'
import { errorMessage } from '@/lib/errors'
import { parseMoneyInput } from '@/lib/money'
import { todayKey } from '@/lib/time'
import type { AssignmentRole, DeliveryMethod, ProjectDelivery, ProjectEvent } from '@/types/entities'
import type { ProjectDetail } from '@/api/projects'
import { useStudio } from '@/features/studio/StudioProvider'
import { defaultRoleFor } from './projectForm'

const PROJECT_KEYS = ['project', 'projects', 'schedule', 'dashboard', 'project-activity', 'activity', 'event-reminders']
export function useInvalidateProject() {
  const qc = useQueryClient()
  return (extra: string[] = []) => {
    for (const key of [...PROJECT_KEYS, ...extra]) void qc.invalidateQueries({ queryKey: [key] })
  }
}

/* ------------------------------------------------------------ cancel booking */
export function CancelProjectDialog({ project, open, onOpenChange }: { project: Pick<ProjectDetail, 'id' | 'name'>; open: boolean; onOpenChange: (o: boolean) => void }) {
  const invalidate = useInvalidateProject()
  const [reason, setReason] = useState('')
  const cancel = useMutation({
    mutationFn: () => setBookingStatus(project.id, 'cancelled', reason),
    onSuccess: () => { toast.success('Booking cancelled'); invalidate(); onOpenChange(false); setReason('') },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="sm"
        title="Cancel this booking?"
        description={project.name}
        footer={<><Button variant="secondary" onClick={() => onOpenChange(false)} disabled={cancel.isPending}>Keep booking</Button><Button variant="danger" loading={cancel.isPending} onClick={() => cancel.mutate()}>Cancel booking</Button></>}
      >
        <div className="space-y-3 text-sm">
          <ul className="list-disc space-y-1 pl-5 text-ink-muted">
            <li>The assigned team is notified and their reminders are withdrawn.</li>
            <li>Reserved equipment is released for other events.</li>
            <li>Payments, notes and history are kept. You can reopen it later as an inquiry.</li>
          </ul>
          <Field label="Reason (optional)">{(a) => <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Client postponed to next year" {...a} />}</Field>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/* ---------------------------------------------------------- production plan */
export function ProductionPlanDialog({ project, open, onOpenChange }: { project: ProjectDetail; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { studio } = useStudio()
  const invalidate = useInvalidateProject()
  const employees = useQuery({ queryKey: ['employees', studio.id], queryFn: () => listEmployees(studio.id), enabled: open })
  const [editor, setEditor] = useState('')
  const [editing, setEditing] = useState('')
  const [delivery, setDelivery] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setEditor(project.editor_id ?? ''); setEditing(project.editing_due_date ?? ''); setDelivery(project.delivery_due_date ?? ''); setError(null)
    }
  }, [open, project])

  const save = useMutation({
    mutationFn: () => updateProjectFields(project.id, { editor_id: editor || null, editing_due_date: editing || null, delivery_due_date: delivery || null }),
    onSuccess: () => { toast.success('Production plan saved'); invalidate(); onOpenChange(false) },
    onError: (e) => setError(errorMessage(e)),
  })
  const bad = !!editing && !!delivery && delivery < editing

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="sm"
        title="Editor & deadlines"
        footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={() => save.mutate()} loading={save.isPending} disabled={bad}>Save</Button></>}
      >
        <div className="space-y-4">
          {error && <Notice tone="danger">{error}</Notice>}
          <Field label="Editor" hint="Assigned editors can see this project and update editing progress.">
            {(a) => (
              <Select {...a} value={editor} onChange={(e) => setEditor(e.target.value)}>
                <option value="">Not assigned</option>
                {(employees.data ?? []).filter((e) => e.is_active || e.id === editor).sort((x, y) => Number(y.team_role === 'editor') - Number(x.team_role === 'editor') || x.full_name.localeCompare(y.full_name))
                  .map((e) => <option key={e.id} value={e.id}>{e.full_name} · {TEAM_ROLE_LABELS[e.team_role]}</option>)}
              </Select>
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Editing due">{(a) => <Input type="date" value={editing} onChange={(e) => setEditing(e.target.value)} {...a} />}</Field>
            <Field label="Delivery due" error={bad ? 'Delivery should not be before editing is due' : undefined}>{(a) => <Input type="date" value={delivery} onChange={(e) => setDelivery(e.target.value)} {...a} />}</Field>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/* -------------------------------------------------------------- event team */
export function EventTeamDialog({ event, open, onOpenChange }: { event: ProjectEvent | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { studio } = useStudio()
  const invalidate = useInvalidateProject()
  const [rows, setRows] = useState<{ employee_id: string; role: AssignmentRole }[]>([])
  const [error, setError] = useState<string | null>(null)
  const employees = useQuery({ queryKey: ['employees', studio.id], queryFn: () => listEmployees(studio.id), enabled: open })
  const around = useQuery({
    queryKey: ['schedule', studio.id, 'team-dialog', event?.id],
    queryFn: () => listScheduleEvents({ studioId: studio.id, from: event!.starts_at, to: event!.ends_at }),
    enabled: open && !!event,
  })

  useEffect(() => {
    if (open && event) { setRows((event.event_assignments ?? []).map((a) => ({ employee_id: a.employee_id, role: a.role }))); setError(null) }
  }, [open, event])

  /** People already booked on a different, overlapping, live event. */
  const busy = useMemo(() => {
    const set = new Set<string>()
    if (!event) return set
    for (const e of around.data ?? []) {
      if (e.id === event.id || e.project.booking_status === 'cancelled' || e.project.archived_at) continue
      if (overlaps(e.starts_at, e.ends_at, event.starts_at, event.ends_at)) (e.event_assignments ?? []).forEach((a) => set.add(a.employee_id))
    }
    return set
  }, [around.data, event])

  const save = useMutation({
    mutationFn: () => setEventTeam(event!.id, rows.filter((r) => r.employee_id)),
    onSuccess: () => { toast.success('Team updated'); invalidate(); onOpenChange(false) },
    onError: (e) => setError(errorMessage(e)),
  })

  const chosen = new Set(rows.map((r) => r.employee_id).filter(Boolean))
  const active = (employees.data ?? []).filter((e) => e.is_active)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {event && (
        <DialogContent
          title="Manage team"
          description={event.title}
          footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={() => save.mutate()} loading={save.isPending}>Save team</Button></>}
        >
          <div className="space-y-3">
            {error && <Notice tone="danger">{error}</Notice>}
            <p className="text-[13px] text-ink-muted">People you add are notified (for confirmed bookings) and reminded the day before. Anyone you remove is told, and their reminder is withdrawn.</p>
            {rows.map((r, i) => (
              <div key={i} className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[1fr_190px_auto]">
                <Select aria-label="Person" value={r.employee_id} onChange={(e) => { const emp = active.find((x) => x.id === e.target.value); setRows((rs) => rs.map((x, j) => (j === i ? { employee_id: e.target.value, role: emp ? defaultRoleFor(emp.team_role) : x.role } : x))) }}>
                  <option value="">Choose person…</option>
                  {active.map((emp) => <option key={emp.id} value={emp.id} disabled={chosen.has(emp.id) && r.employee_id !== emp.id}>{emp.full_name} · {TEAM_ROLE_LABELS[emp.team_role]}{busy.has(emp.id) ? ' · busy at this time' : ''}</option>)}
                  {(employees.data ?? []).filter((e) => !e.is_active && e.id === r.employee_id).map((e) => <option key={e.id} value={e.id}>{e.full_name} (inactive)</option>)}
                </Select>
                <Select aria-label="Role" className="hidden sm:block" value={r.role} onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, role: e.target.value as AssignmentRole } : x)))}>
                  {options(ASSIGNMENT_ROLE_LABELS).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
                <Button variant="ghost" size="icon" aria-label="Remove person" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>
                <Select aria-label="Role" className="col-span-2 sm:hidden" value={r.role} onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, role: e.target.value as AssignmentRole } : x)))}>
                  {options(ASSIGNMENT_ROLE_LABELS).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
                {busy.has(r.employee_id) && <p className="col-span-2 text-xs text-warning sm:col-span-3">Already booked on another event at this time.</p>}
              </div>
            ))}
            <Button variant="secondary" size="sm" onClick={() => setRows((rs) => [...rs, { employee_id: '', role: 'lead_photographer' }])}><Plus className="size-3.5" /> Assign person</Button>
          </div>
        </DialogContent>
      )}
    </Dialog>
  )
}

/* ---------------------------------------------------------------- delivery */
export function DeliveryDialog({ project, delivery, open, onOpenChange }: { project: Pick<ProjectDetail, 'id' | 'studio_id'>; delivery: ProjectDelivery | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { tz } = useStudio()
  const qc = useQueryClient()
  const [method, setMethod] = useState<DeliveryMethod>('online_gallery')
  const [date, setDate] = useState('')
  const [link, setLink] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setMethod(delivery?.method ?? 'online_gallery'); setDate(delivery?.delivered_on ?? todayKey(tz)); setLink(delivery?.link_url ?? ''); setNotes(delivery?.notes ?? ''); setError(null)
    }
  }, [open, delivery, tz])

  const linkBad = link.trim() !== '' && !/^https?:\/\/\S+$/i.test(link.trim())
  const save = useMutation({
    mutationFn: () => saveDelivery(project.studio_id, project.id, { method, delivered_on: date, link_url: link, notes }),
    onSuccess: () => {
      toast.success('Delivery details saved')
      for (const k of ['project-delivery', 'project-activity', 'activity']) void qc.invalidateQueries({ queryKey: [k] })
      onOpenChange(false)
    },
    onError: (e) => setError(errorMessage(e)),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="sm"
        title="Delivery details"
        description="Files stay in your own storage - record how and where the client received them."
        footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={() => save.mutate()} loading={save.isPending} disabled={!date || linkBad}>Save</Button></>}
      >
        <div className="space-y-4">
          {error && <Notice tone="danger">{error}</Notice>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Delivery method" required>{(a) => <Select {...a} value={method} onChange={(e) => setMethod(e.target.value as DeliveryMethod)}>{options(DELIVERY_METHOD_LABELS).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>}</Field>
            <Field label="Delivery date" required>{(a) => <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} {...a} />}</Field>
          </div>
          <Field label="Download or gallery link" error={linkBad ? 'Enter a full link starting with https://' : undefined} hint="Optional">{(a) => <Input type="url" inputMode="url" placeholder="https://…" value={link} onChange={(e) => setLink(e.target.value)} {...a} />}</Field>
          <Field label="Notes">{(a) => <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} {...a} />}</Field>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/* --------------------------------------------------------- finance (amount) */
export function FinanceEditDialog({ projectId, agreed, dueDate, notes, open, onOpenChange, currency }: {
  projectId: string; agreed: number; dueDate: string | null; notes: string | null; open: boolean; onOpenChange: (o: boolean) => void; currency: string
}) {
  const qc = useQueryClient()
  const [amount, setAmount] = useState('')
  const [due, setDue] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) { setAmount(agreed > 0 ? String(agreed) : ''); setDue(dueDate ?? ''); setNote(notes ?? ''); setError(null) }
  }, [open, agreed, dueDate, notes])

  const parsed = amount === '' ? 0 : parseMoneyInput(amount)
  const save = useMutation({
    mutationFn: () => updateFinance(projectId, { agreed_amount: parsed ?? 0, payment_due_date: due || null, payment_notes: note.trim() || null }),
    onSuccess: () => {
      toast.success('Financial details saved')
      for (const k of ['project-financials', 'financials', 'dashboard', 'project-payments']) void qc.invalidateQueries({ queryKey: [k] })
      onOpenChange(false)
    },
    onError: (e) => setError(errorMessage(e)),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" title="Amount & due date" footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={() => save.mutate()} loading={save.isPending} disabled={parsed === null}>Save</Button></>}>
        <div className="space-y-4">
          {error && <Notice tone="danger">{error}</Notice>}
          <Field label="Total agreed amount" error={parsed === null ? 'Enter a valid amount (up to 2 decimals)' : undefined} hint="The balance is recalculated from payments received.">
            {(a) => <MoneyInput symbol={currency === 'INR' ? '₹' : currency} value={amount} onChange={(e) => setAmount(e.target.value)} {...a} />}
          </Field>
          <Field label="Payment due date">{(a) => <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} {...a} />}</Field>
          <Field label="Payment notes">{(a) => <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} {...a} />}</Field>
        </div>
      </DialogContent>
    </Dialog>
  )
}
