import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Camera, MoreHorizontal, Package, Pencil, Plus, Power } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { z } from 'zod'
import { createEquipment, updateEquipment, type EquipmentInput } from '@/api/equipment'
import { listInventory, listScheduleEvents } from '@/api/schedule'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Badge, Card, DataState, EmptyState, ListSkeleton, Notice, PageHeader, TableWrap, TD, TH, THead, TR } from '@/components/ui/display'
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form'
import { MetricCard } from '@/components/ui/metric-card'
import { Menu, MenuContent, MenuItem, MenuTrigger, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/menu'
import { FilterBar, SearchInput } from '@/components/ui/toolbar'
import { BookingBadge } from '@/components/ui/status'
import { EQUIPMENT_CATEGORY_LABELS, EQUIPMENT_CONDITION_LABELS, options } from '@/lib/constants'
import { describeConflict, findEquipmentConflicts, isActiveEvent } from '@/lib/conflicts'
import { errorMessage } from '@/lib/errors'
import { toConflictEvent } from '@/lib/schedule'
import { fmtDate, fmtTimeRange } from '@/lib/time'
import type { Equipment } from '@/types/entities'
import { useStudio } from '@/features/studio/StudioProvider'
import { useUrlState } from '@/hooks/useUrlState'

const schema = z.object({
  name: z.string().trim().min(2, 'Enter a name').max(120),
  category: z.enum(['still_camera', 'video_camera', 'lens', 'tripod', 'gimbal', 'lighting', 'flash', 'drone', 'microphone', 'other']),
  brand_model: z.string().trim().max(120),
  asset_tag: z.string().trim().max(60),
  quantity_owned: z.coerce.number().int('Whole numbers only').min(0, 'Cannot be negative').max(9999),
  condition: z.enum(['excellent', 'good', 'fair', 'needs_repair', 'out_of_service']),
  notes: z.string().trim().max(1000),
  is_active: z.boolean(),
})
type Values = z.input<typeof schema>

export default function EquipmentPage() {
  const { studio, can, tz } = useStudio()
  const qc = useQueryClient()
  const [f, setF] = useUrlState({ q: '', category: '', status: 'active', tab: 'inventory' })
  const [editing, setEditing] = useState<Equipment | 'new' | null>(null)

  const inventory = useQuery({ queryKey: ['inventory', studio.id], queryFn: () => listInventory(studio.id) })
  const schedule = useQuery({
    queryKey: ['schedule', studio.id, 'equipment'],
    queryFn: () => listScheduleEvents({ studioId: studio.id, from: new Date(Date.now() - 12 * 3_600_000).toISOString(), to: new Date(Date.now() + 120 * 86_400_000).toISOString() }),
  })

  const events = useMemo(() => (schedule.data ?? []).map(toConflictEvent), [schedule.data])
  const conflicts = useMemo(() => findEquipmentConflicts(events, inventory.data ?? []), [events, inventory.data])

  /** Units tied up by events happening right now. */
  const inUseNow = useMemo(() => {
    const now = Date.now()
    const map = new Map<string, number>()
    for (const e of events.filter(isActiveEvent)) {
      if (new Date(e.startsAt).getTime() <= now && new Date(e.endsAt).getTime() > now) {
        for (const r of e.equipment) if (r.equipmentId) map.set(r.equipmentId, (map.get(r.equipmentId) ?? 0) + r.quantity)
      }
    }
    return map
  }, [events])

  /** How many upcoming sessions hold each item. */
  const reservedBy = useMemo(() => {
    const map = new Map<string, number>()
    for (const e of events.filter((x) => isActiveEvent(x) && new Date(x.endsAt).getTime() >= Date.now())) {
      for (const id of new Set(e.equipment.map((r) => r.equipmentId).filter((x): x is string => !!x))) map.set(id, (map.get(id) ?? 0) + 1)
    }
    return map
  }, [events])

  const summary = useMemo(() => {
    const active = (inventory.data ?? []).filter((i) => i.is_active)
    const usable = active.filter((i) => i.condition !== 'out_of_service')
    const units = usable.reduce((s, i) => s + i.quantity_owned, 0)
    const inUse = usable.reduce((s, i) => s + Math.min(inUseNow.get(i.id) ?? 0, i.quantity_owned), 0)
    return {
      items: active.length,
      units,
      available: units - inUse,
      inUse,
      attention: active.filter((i) => i.condition === 'needs_repair' || i.condition === 'out_of_service').length,
    }
  }, [inventory.data, inUseNow])

  const reservations = useMemo(() => {
    const names = new Map((inventory.data ?? []).map((i) => [i.id, i.name]))
    const out: { key: string; event: (typeof events)[number]; name: string; qty: number; custom: boolean }[] = []
    for (const e of events.filter((x) => isActiveEvent(x) && new Date(x.endsAt).getTime() >= Date.now())) {
      for (const [i, r] of e.equipment.entries()) {
        out.push({ key: `${e.id}:${i}`, event: e, name: r.equipmentId ? (names.get(r.equipmentId) ?? 'Equipment') : (r.customName ?? 'Custom item'), qty: r.quantity, custom: !r.equipmentId })
      }
    }
    return out
  }, [events, inventory.data])

  const rows = useMemo(() => {
    const term = f.q.trim().toLowerCase()
    return (inventory.data ?? [])
      .filter((i) => (f.status === 'all' ? true : f.status === 'active' ? i.is_active : !i.is_active))
      .filter((i) => !f.category || i.category === f.category)
      .filter((i) => !term || [i.name, i.brand_model, i.asset_tag].some((v) => v?.toLowerCase().includes(term)))
  }, [inventory.data, f])

  const retire = useMutation({
    mutationFn: (i: Equipment) => updateEquipment(i.id, { ...i, brand_model: i.brand_model ?? '', asset_tag: i.asset_tag ?? '', notes: i.notes ?? '', is_active: !i.is_active }),
    onSuccess: (_d, i) => { toast.success(i.is_active ? `${i.name} retired. Past reservations are kept.` : `${i.name} is active again`); void qc.invalidateQueries({ queryKey: ['inventory'] }) },
    onError: (e) => toast.error(errorMessage(e)),
  })

  const canManage = can('equipment.manage')

  return (
    <>
      <PageHeader
        title="Equipment"
        description="Cameras, lenses and gear - and where each piece is needed."
        actions={canManage && <Button onClick={() => setEditing('new')}><Plus className="size-4" /> Add equipment</Button>}
      />

      {conflicts.length > 0 && (
        <Notice tone="warning" title={`${conflicts.length} equipment ${conflicts.length === 1 ? 'issue' : 'issues'} on upcoming sessions`} className="mb-4">
          <ul className="mt-1 list-disc space-y-0.5 pl-4">{conflicts.slice(0, 5).map((c, i) => <li key={i}>{describeConflict(c)}</li>)}</ul>
          {conflicts.length > 5 && <p className="mt-1">…and {conflicts.length - 5} more. See the Reservations tab.</p>}
        </Notice>
      )}

      {inventory.isSuccess && summary.items > 0 && (
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricCard tone="dark" label="Equipment items" value={summary.items} hint={`${summary.units} ${summary.units === 1 ? 'unit' : 'units'} in service`} />
          <MetricCard tone="soft" label="Available now" value={summary.available} hint="Units not in use right now" />
          <MetricCard tone="soft" label="In use now" value={summary.inUse} hint="Reserved for a session under way" />
          <MetricCard tone="soft" label="Needs attention" value={summary.attention} hint={summary.attention === 0 ? 'Everything is in working order' : 'Needs repair or out of service'} />
        </div>
      )}

      <Tabs value={f.tab} onValueChange={(tab) => setF({ tab })}>
        <TabsList>
          <TabsTrigger value="inventory">Inventory</TabsTrigger>
          <TabsTrigger value="reservations">Upcoming reservations{reservations.length > 0 && <Badge tone="neutral">{reservations.length}</Badge>}</TabsTrigger>
        </TabsList>

        <TabsContent value="inventory">
          <FilterBar>
            <SearchInput className="sm:w-72" value={f.q} onChange={(q) => setF({ q })} placeholder="Search name, model or asset ID" label="Search equipment" />
            <Select aria-label="Category" className="sm:w-48" value={f.category} onChange={(e) => setF({ category: e.target.value })}>
              <option value="">All categories</option>
              {options(EQUIPMENT_CATEGORY_LABELS).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
            <Select aria-label="Status" className="sm:w-36" value={f.status} onChange={(e) => setF({ status: e.target.value })}>
              <option value="active">Active</option><option value="retired">Retired</option><option value="all">All</option>
            </Select>
          </FilterBar>
          <DataState
            query={inventory}
            isEmpty={rows.length === 0}
            skeleton={<ListSkeleton />}
            empty={
              (inventory.data?.length ?? 0) === 0 ? (
                <EmptyState icon={<Camera />} title="Add your gear" description="Track cameras, lenses and lighting, then reserve them for sessions and catch double-bookings early." action={canManage && <Button onClick={() => setEditing('new')}><Plus className="size-4" /> Add equipment</Button>} />
              ) : (
                <EmptyState icon={<Package />} title="Nothing matches" description="Try a different search or filter." />
              )
            }
          >
            <div className="hidden md:block">
              <TableWrap>
                <THead><tr><TH>Item</TH><TH>Category</TH><TH>Asset ID</TH><TH className="text-right">Owned</TH><TH className="text-right">Available now</TH><TH className="text-right">Reserved</TH><TH>Condition</TH><TH>Status</TH><TH className="w-12"><span className="sr-only">Actions</span></TH></tr></THead>
                <tbody>
                  {rows.map((i) => {
                    const used = inUseNow.get(i.id) ?? 0
                    const avail = i.is_active && i.condition !== 'out_of_service' ? Math.max(i.quantity_owned - used, 0) : 0
                    return (
                      <TR key={i.id} className={i.is_active ? '' : 'text-ink-muted'}>
                        <TD><p className="font-medium text-ink">{i.name}</p>{i.brand_model && <p className="text-xs text-ink-muted">{i.brand_model}</p>}</TD>
                        <TD>{EQUIPMENT_CATEGORY_LABELS[i.category]}</TD>
                        <TD className="tabular-nums">{i.asset_tag ?? '—'}</TD>
                        <TD className="text-right tabular-nums">{i.quantity_owned}</TD>
                        <TD className="text-right tabular-nums">{avail}{used > 0 && <span className="ml-1 text-xs text-ink-muted">({used} in use)</span>}</TD>
                        <TD className="text-right tabular-nums text-ink-muted">{reservedBy.get(i.id) ? <button type="button" onClick={() => setF({ tab: 'reservations' })} className="text-ink underline-offset-2 hover:underline">{reservedBy.get(i.id)} upcoming</button> : '—'}</TD>
                        <TD><Badge tone={i.condition === 'out_of_service' || i.condition === 'needs_repair' ? 'warning' : 'neutral'}>{EQUIPMENT_CONDITION_LABELS[i.condition]}</Badge></TD>
                        <TD>{i.is_active ? <Badge tone="success">Active</Badge> : <Badge tone="outline">Retired</Badge>}</TD>
                        <TD>{canManage && <ItemMenu item={i} onEdit={() => setEditing(i)} onToggle={() => retire.mutate(i)} />}</TD>
                      </TR>
                    )
                  })}
                </tbody>
              </TableWrap>
            </div>
            <ul className="space-y-3 md:hidden">
              {rows.map((i) => (
                <li key={i.id}>
                  <Card className="flex items-start gap-3 p-4">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{i.name}</p>
                      <p className="text-xs text-ink-muted">{EQUIPMENT_CATEGORY_LABELS[i.category]}{i.asset_tag && ` · ${i.asset_tag}`} · {i.quantity_owned} owned{reservedBy.get(i.id) ? ` · ${reservedBy.get(i.id)} upcoming` : ''}</p>
                      <div className="mt-2 flex gap-1.5"><Badge tone={i.condition === 'out_of_service' || i.condition === 'needs_repair' ? 'warning' : 'neutral'}>{EQUIPMENT_CONDITION_LABELS[i.condition]}</Badge>{!i.is_active && <Badge tone="outline">Retired</Badge>}</div>
                    </div>
                    {canManage && <ItemMenu item={i} onEdit={() => setEditing(i)} onToggle={() => retire.mutate(i)} />}
                  </Card>
                </li>
              ))}
            </ul>
          </DataState>
        </TabsContent>

        <TabsContent value="reservations">
          <DataState
            query={schedule}
            isEmpty={reservations.length === 0}
            skeleton={<ListSkeleton />}
            empty={<EmptyState icon={<Package />} title="No upcoming reservations" description="Reserve equipment when you create or edit an event's sessions. Cancelled sessions release their gear automatically." />}
          >
            <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface shadow-card">
              {reservations.map((r) => {
                const issue = conflicts.some((c) => (c.kind === 'equipment' && c.equipmentName === r.name && c.events.some((e) => e.id === r.event.id)) || (c.kind === 'equipment_unavailable' && c.equipmentName === r.name && c.event.id === r.event.id))
                return (
                  <li key={r.key} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{r.name}{r.qty > 1 && <span className="text-ink-muted"> × {r.qty}</span>}{r.custom && <Badge tone="outline" className="ml-2">Not in inventory</Badge>}</p>
                      <p className="text-xs text-ink-muted"><Link to={`/events/${r.event.projectId}`} className="hover:underline">{r.event.projectName}</Link> · {r.event.title} · {fmtDate(r.event.startsAt, tz)}, {fmtTimeRange(r.event.startsAt, r.event.endsAt, tz)}</p>
                    </div>
                    <BookingBadge status={r.event.bookingStatus} />
                    {issue && <Badge tone="warning"><AlertTriangle className="size-3" /> Conflict</Badge>}
                  </li>
                )
              })}
            </ul>
          </DataState>
        </TabsContent>
      </Tabs>

      <EquipmentFormDialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} item={editing === 'new' ? null : editing} />
    </>
  )
}

function ItemMenu({ item, onEdit, onToggle }: { item: Equipment; onEdit: () => void; onToggle: () => void }) {
  return (
    <Menu>
      <MenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={`Actions for ${item.name}`}><MoreHorizontal className="size-4" /></Button></MenuTrigger>
      <MenuContent>
        <MenuItem icon={<Pencil />} onSelect={onEdit}>Edit</MenuItem>
        <MenuItem icon={<Power />} onSelect={onToggle}>{item.is_active ? 'Retire' : 'Reactivate'}</MenuItem>
      </MenuContent>
    </Menu>
  )
}

/** Create or edit an item. Also used from the project form so gear can be added mid-booking. */
export function EquipmentFormDialog({ open, onOpenChange, item, onSaved }: {
  open: boolean
  onOpenChange: (o: boolean) => void
  item: Equipment | null
  onSaved?: (e: Equipment) => void
}) {
  const { studio } = useStudio()
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const { register, handleSubmit, reset, watch, formState: { errors, isSubmitting } } = useForm<Values, unknown, z.output<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', category: 'still_camera', brand_model: '', asset_tag: '', quantity_owned: 1, condition: 'good', notes: '', is_active: true },
  })
  const tagged = watch('asset_tag').trim() !== ''

  useEffect(() => {
    if (!open) return
    setError(null)
    reset({
      name: item?.name ?? '', category: item?.category ?? 'still_camera', brand_model: item?.brand_model ?? '', asset_tag: item?.asset_tag ?? '',
      quantity_owned: item?.quantity_owned ?? 1, condition: item?.condition ?? 'good', notes: item?.notes ?? '', is_active: item?.is_active ?? true,
    })
  }, [open, item, reset])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={item ? 'Edit equipment' : 'Add equipment'}
        description="Give a piece of gear an Asset ID to track it individually, or leave it blank and set a quantity for generic items."
        footer={<><Button variant="secondary" onClick={() => onOpenChange(false)} disabled={isSubmitting}>Cancel</Button><Button type="submit" form="equipment-form" loading={isSubmitting}>{item ? 'Save changes' : 'Add equipment'}</Button></>}
      >
        <form
          id="equipment-form"
          noValidate
          className="space-y-4"
          onSubmit={(e) => {
            e.stopPropagation()
            void handleSubmit(async (v) => {
              setError(null)
              try {
                const input: EquipmentInput = { ...v }
                const saved = item ? await updateEquipment(item.id, input) : await createEquipment(studio.id, input)
                toast.success(item ? 'Equipment updated' : `${v.name} added`)
                void qc.invalidateQueries({ queryKey: ['inventory'] })
                onSaved?.(saved)
                onOpenChange(false)
              } catch (err) {
                setError(errorMessage(err))
              }
            })(e)
          }}
        >
          {error && <Notice tone="danger">{error}</Notice>}
          <Field label="Name" error={errors.name?.message} required>{(a) => <Input autoFocus placeholder="e.g. Sony A7 IV" {...a} {...register('name')} />}</Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Category">{(a) => <Select {...a} {...register('category')}>{options(EQUIPMENT_CATEGORY_LABELS).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>}</Field>
            <Field label="Brand / model" error={errors.brand_model?.message}>{(a) => <Input {...a} {...register('brand_model')} />}</Field>
            <Field label="Asset ID" hint="Optional. Unique per studio." error={errors.asset_tag?.message}>{(a) => <Input placeholder="e.g. CAM-001" {...a} {...register('asset_tag')} />}</Field>
            <Field label="Quantity owned" hint={tagged ? 'An item with an Asset ID is a single unit.' : undefined} error={errors.quantity_owned?.message}>
              {(a) => <Input type="number" min={0} step={1} inputMode="numeric" readOnly={tagged} className={tagged ? 'bg-subtle text-ink-muted' : undefined} {...a} {...register('quantity_owned')} />}
            </Field>
            <Field label="Condition">{(a) => <Select {...a} {...register('condition')}>{options(EQUIPMENT_CONDITION_LABELS).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>}</Field>
          </div>
          <Field label="Notes">{(a) => <Textarea rows={2} {...a} {...register('notes')} />}</Field>
          {item && <Checkbox label="Active" description="Retired items can't be reserved but their history is kept." {...register('is_active')} />}
        </form>
      </DialogContent>
    </Dialog>
  )
}
