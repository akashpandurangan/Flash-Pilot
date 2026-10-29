import { AlertTriangle, CalendarClock, PackagePlus, Plus, Trash2, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { useFieldArray, useWatch, type Control, type FieldErrors, type UseFormRegister, type UseFormSetValue } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { Notice } from '@/components/ui/display'
import { Field, Input, Select, Textarea } from '@/components/ui/form'
import { ASSIGNMENT_ROLE_LABELS, EVENT_TYPE_LABELS, TEAM_ROLE_LABELS, options } from '@/lib/constants'
import { describeConflict, type Conflict } from '@/lib/conflicts'
import { cn } from '@/lib/utils'
import type { Employee, Equipment, EventType } from '@/types/entities'
import { EquipmentFormDialog } from '@/features/equipment/EquipmentPage'
import { defaultEventTitle, defaultRoleFor, type ProjectFormValues } from './projectForm'

/** Titles we generated ourselves; a typed custom title is never overwritten when the type changes. */
const DEFAULT_TITLES = new Set(Object.keys(EVENT_TYPE_LABELS).map((t) => defaultEventTitle(t as EventType)))

interface Props {
  index: number
  control: Control<ProjectFormValues>
  register: UseFormRegister<ProjectFormValues>
  setValue: UseFormSetValue<ProjectFormValues>
  errors: FieldErrors<ProjectFormValues>
  employees: Employee[]
  inventory: Equipment[]
  /** Employees already booked elsewhere at this event's time. */
  busy: Set<string>
  /** Units of each inventory item already reserved elsewhere at this event's time. */
  reserved: Map<string, number>
  conflicts: Conflict[]
  persisted: boolean
  canRemove: boolean
  onRemove: () => void
}

export function EventCard({ index, control, register, setValue, errors, employees, inventory, busy, reserved, conflicts, persisted, canRemove, onRemove }: Props) {
  const e = errors.events?.[index]
  const assignments = useFieldArray({ control, name: `events.${index}.assignments` })
  const equipment = useFieldArray({ control, name: `events.${index}.equipment` })
  const rows = useWatch({ control, name: `events.${index}.equipment` })
  const people = useWatch({ control, name: `events.${index}.assignments` })
  const title = useWatch({ control, name: `events.${index}.title` })
  const [newGear, setNewGear] = useState(false)

  const activeEmployees = employees.filter((x) => x.is_active)
  const assignedIds = new Set(people.map((p) => p.employee_id))
  const photographers = people.filter((p) => p.role === 'lead_photographer' || p.role === 'second_photographer').length

  return (
    <fieldset className="rounded-lg border border-line">
      <legend className="sr-only">Event {index + 1}: {title}</legend>
      <div className="flex items-center justify-between gap-3 border-b border-line bg-sidebar px-4 py-2.5">
        <div className="flex items-center gap-2 text-sm font-semibold"><CalendarClock className="size-4 text-ink-muted" aria-hidden /> Event {index + 1}</div>
        {canRemove && (
          <Button variant="ghost" size="sm" className="text-danger hover:bg-danger-soft" onClick={onRemove}>
            <Trash2 className="size-3.5" /> {persisted ? 'Cancel event' : 'Remove'}
          </Button>
        )}
      </div>

      <div className="space-y-5 p-4">
        {conflicts.length > 0 && (
          <Notice tone="warning" title="Heads up">
            <ul className="list-disc space-y-0.5 pl-4">{conflicts.map((c, i) => <li key={i}>{describeConflict(c)}</li>)}</ul>
            <p className="mt-1">These are warnings - you can still save.</p>
          </Notice>
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Event name" error={e?.title?.message} required className="lg:col-span-2">{(a) => <Input {...a} {...register(`events.${index}.title`)} />}</Field>
          <Field label="Type" error={e?.event_type?.message}>
            {(a) => (
              <Select
                {...a}
                {...register(`events.${index}.event_type`, {
                  onChange: (ev) => { if (!title || DEFAULT_TITLES.has(title)) setValue(`events.${index}.title`, defaultEventTitle(ev.target.value as EventType)) },
                })}
              >
                {options(EVENT_TYPE_LABELS).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Date" error={e?.date?.message} required>{(a) => <Input type="date" {...a} {...register(`events.${index}.date`)} />}</Field>
          <Field label="Reporting time" error={e?.start_time?.message} required>{(a) => <Input type="time" {...a} {...register(`events.${index}.start_time`)} />}</Field>
          <Field label="End time" error={e?.end_time?.message} hint="Earlier than the start = after midnight." required>{(a) => <Input type="time" {...a} {...register(`events.${index}.end_time`)} />}</Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Venue name" error={e?.venue_name?.message}>{(a) => <Input placeholder="e.g. The Grand Hall" {...a} {...register(`events.${index}.venue_name`)} />}</Field>
          <Field label="Map / location link" error={e?.map_url?.message}>{(a) => <Input type="url" inputMode="url" placeholder="https://maps.app.goo.gl/…" {...a} {...register(`events.${index}.map_url`)} />}</Field>
          <Field label="Full venue address" error={e?.venue_address?.message} className="sm:col-span-2">{(a) => <Textarea rows={2} {...a} {...register(`events.${index}.venue_address`)} />}</Field>
          <Field label="Event notes" hint="Shared with the assigned team in reminders." error={e?.notes?.message} className="sm:col-span-2">{(a) => <Textarea rows={2} {...a} {...register(`events.${index}.notes`)} />}</Field>
        </div>

        {/* team */}
        <section aria-labelledby={`team-${index}`}>
          <div className="mb-2 flex items-center justify-between">
            <h3 id={`team-${index}`} className="text-sm font-semibold">Team</h3>
            <Button variant="secondary" size="sm" onClick={() => assignments.append({ employee_id: '', role: 'lead_photographer' })}><UserPlus className="size-3.5" /> Assign person</Button>
          </div>
          {assignments.fields.length === 0 && (
            <p className="rounded-md border border-dashed border-line-strong px-3 py-4 text-center text-[13px] text-ink-muted">No one assigned yet. You can assign people now or after the project is created.</p>
          )}
          {assignments.fields.length > 0 && photographers === 0 && <p className="mb-2 flex items-center gap-1.5 text-xs text-warning"><AlertTriangle className="size-3.5" aria-hidden /> No photographer assigned yet.</p>}
          <div className="space-y-2">
            {assignments.fields.map((f, j) => {
              const err = e?.assignments?.[j]
              return (
                <div key={f.id} className="grid grid-cols-[1fr_auto] items-start gap-2 sm:grid-cols-[1fr_200px_auto]">
                  <Field label="Person" error={err?.employee_id?.message} className="[&>label]:sr-only">
                    {(a) => (
                      <Select
                        {...a}
                        {...register(`events.${index}.assignments.${j}.employee_id`, {
                          onChange: (ev) => {
                            const emp = employees.find((x) => x.id === ev.target.value)
                            if (emp) setValue(`events.${index}.assignments.${j}.role`, defaultRoleFor(emp.team_role))
                          },
                        })}
                      >
                        <option value="">Choose person…</option>
                        {activeEmployees.map((emp) => (
                          <option key={emp.id} value={emp.id} disabled={assignedIds.has(emp.id) && people[j]?.employee_id !== emp.id}>
                            {emp.full_name} · {TEAM_ROLE_LABELS[emp.team_role]}{busy.has(emp.id) ? ' · busy at this time' : ''}
                          </option>
                        ))}
                        {/* keep a deactivated person visible on events they already worked */}
                        {employees.filter((x) => !x.is_active && x.id === people[j]?.employee_id).map((emp) => <option key={emp.id} value={emp.id}>{emp.full_name} (inactive)</option>)}
                      </Select>
                    )}
                  </Field>
                  <Field label="Role" className="hidden [&>label]:sr-only sm:block">
                    {(a) => <Select {...a} {...register(`events.${index}.assignments.${j}.role`)}>{options(ASSIGNMENT_ROLE_LABELS).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>}
                  </Field>
                  <Button variant="ghost" size="icon" onClick={() => assignments.remove(j)} aria-label="Remove person"><Trash2 className="size-4" /></Button>
                  <div className="col-span-2 sm:hidden">
                    <Select aria-label="Role" {...register(`events.${index}.assignments.${j}.role`)}>{options(ASSIGNMENT_ROLE_LABELS).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        {/* equipment */}
        <section aria-labelledby={`gear-${index}`}>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 id={`gear-${index}`} className="text-sm font-semibold">Equipment needed</h3>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => setNewGear(true)}><PackagePlus className="size-3.5" /> New inventory item</Button>
              <Button variant="secondary" size="sm" onClick={() => equipment.append({ equipment_id: '', custom_name: '', quantity: '1', notes: '' })}><Plus className="size-3.5" /> Add equipment</Button>
            </div>
          </div>
          {equipment.fields.length === 0 && <p className="rounded-md border border-dashed border-line-strong px-3 py-4 text-center text-[13px] text-ink-muted">No equipment reserved for this event.</p>}
          <div className="space-y-3">
            {equipment.fields.map((f, j) => {
              const err = e?.equipment?.[j]
              const row = rows?.[j]
              const item = inventory.find((x) => x.id === row?.equipment_id)
              const elsewhere = row?.equipment_id ? (reserved.get(row.equipment_id) ?? 0) : 0
              const short = item ? elsewhere + (Number(row?.quantity) || 1) > item.quantity_owned : false
              return (
                <div key={f.id} className={cn('grid gap-2 rounded-md border border-line p-3 sm:grid-cols-[1fr_90px_1fr_auto]', short && 'border-warning/40 bg-warning-soft/40')}>
                  <Field label="Item" error={err?.equipment_id?.message}>
                    {(a) => (
                      <Select {...a} {...register(`events.${index}.equipment.${j}.equipment_id`)}>
                        <option value="">Other / not in inventory…</option>
                        {inventory.filter((x) => x.is_active || x.id === row?.equipment_id).map((x) => {
                          const used = reserved.get(x.id) ?? 0
                          return <option key={x.id} value={x.id}>{x.name}{x.asset_tag ? ` (${x.asset_tag})` : ''}{x.quantity_owned > 1 ? ` · ${x.quantity_owned} owned` : ''}{used > 0 ? ` · ${used} reserved then` : ''}{x.condition === 'out_of_service' ? ' · out of service' : ''}</option>
                        })}
                      </Select>
                    )}
                  </Field>
                  <Field label="Qty" error={err?.quantity?.message}>{(a) => <Input type="number" min={1} step={1} inputMode="numeric" {...a} {...register(`events.${index}.equipment.${j}.quantity`)} />}</Field>
                  {row?.equipment_id === '' ? (
                    <Field label="Describe the item" error={err?.custom_name?.message}>{(a) => <Input placeholder="e.g. Rented fog machine" {...a} {...register(`events.${index}.equipment.${j}.custom_name`)} />}</Field>
                  ) : (
                    <Field label="Note for this event" error={err?.notes?.message}>{(a) => <Input placeholder="Optional" {...a} {...register(`events.${index}.equipment.${j}.notes`)} />}</Field>
                  )}
                  <div className="flex items-end"><Button variant="ghost" size="icon" onClick={() => equipment.remove(j)} aria-label="Remove equipment"><Trash2 className="size-4" /></Button></div>
                  {short && <p className="flex items-center gap-1.5 text-xs text-warning sm:col-span-4"><AlertTriangle className="size-3.5" aria-hidden /> Not enough units free at this time - {item?.quantity_owned} owned, {elsewhere} reserved elsewhere.</p>}
                  {item && item.condition === 'out_of_service' && <p className="flex items-center gap-1.5 text-xs text-warning sm:col-span-4"><AlertTriangle className="size-3.5" aria-hidden /> This item is marked out of service.</p>}
                </div>
              )
            })}
          </div>
        </section>
      </div>

      <EquipmentFormDialog
        open={newGear}
        onOpenChange={setNewGear}
        item={null}
        onSaved={(item) => equipment.append({ equipment_id: item.id, custom_name: '', quantity: '1', notes: '' })}
      />
    </fieldset>
  )
}
