import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { Aperture, ArrowDown, ArrowUp, ImagePlus, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { logoUrl, updateStudio, uploadStudioLogo, validateLogo } from '@/api/studio'
import { Button } from '@/components/ui/button'
import { Notice, PageHeader, Panel } from '@/components/ui/display'
import { Field, Input, Select, Textarea } from '@/components/ui/form'
import { COMMON_CURRENCIES, COMMON_TIMEZONES, TASK_PHASE_LABELS, options } from '@/lib/constants'
import { errorMessage } from '@/lib/errors'
import { isValidEmail, isValidPhone } from '@/lib/utils'
import type { ChecklistTemplateItem, TaskPhase } from '@/types/entities'
import { useStudio } from '@/features/studio/StudioProvider'

const schema = z.object({
  name: z.string().trim().min(2, 'Enter your studio name').max(120),
  email: z.string().trim().refine((v) => v === '' || isValidEmail(v), 'Enter a valid email address'),
  phone: z.string().trim().refine((v) => v === '' || isValidPhone(v), 'Enter a valid phone number'),
  address: z.string().trim().max(300),
  city: z.string().trim().max(80),
  state: z.string().trim().max(80),
  timezone: z.string().min(1),
  currency: z.string().length(3),
  reminder_lead_hours: z.string(),
})
type Values = z.infer<typeof schema>

const DEFAULT_CHECKLIST: ChecklistTemplateItem[] = [
  { title: 'Team confirmed', phase: 'preparation' }, { title: 'Equipment prepared', phase: 'preparation' }, { title: 'Shoot completed', phase: 'shoot' },
  { title: 'Photos backed up', phase: 'shoot' }, { title: 'Photo selection completed', phase: 'post' }, { title: 'Editing completed', phase: 'editing' },
  { title: 'Client review completed', phase: 'delivery' }, { title: 'Final files exported', phase: 'editing' }, { title: 'Album printing completed', phase: 'delivery' },
  { title: 'Delivery completed', phase: 'delivery' },
]

export default function SettingsPage() {
  const { studio } = useStudio()
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: ['membership'] })

  const { register, handleSubmit, watch, reset, formState: { errors, isSubmitting, isDirty } } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: studio.name, email: studio.email ?? '', phone: studio.phone ?? '', address: studio.address ?? '', city: studio.city ?? '', state: studio.state ?? '',
      timezone: studio.timezone, currency: studio.currency, reminder_lead_hours: String(studio.reminder_lead_hours),
    },
  })
  const tzChanged = watch('timezone') !== studio.timezone
  const currencyChanged = watch('currency') !== studio.currency

  return (
    <>
      <PageHeader title="Studio settings" description="Your studio's details, regional settings, reminders and default checklist." />
      <div className="grid max-w-3xl gap-4">
        <form
          noValidate
          className="contents"
          onSubmit={handleSubmit(async (v) => {
            setError(null)
            try {
              await updateStudio(studio.id, { ...v, reminder_lead_hours: Number(v.reminder_lead_hours) })
              await refresh()
              reset(v)
              toast.success('Settings saved')
            } catch (e) {
              setError(errorMessage(e))
            }
          })}
        >
          <Panel title="Studio details">
            <div className="space-y-4">
              {error && <Notice tone="danger">{error}</Notice>}
              <div className="flex items-center gap-4">
                <div className="flex size-16 items-center justify-center overflow-hidden rounded-lg border border-line-strong bg-subtle">
                  {studio.logo_path ? <img src={logoUrl(studio.logo_path)!} alt="Studio logo" className="size-full object-cover" /> : <Aperture className="size-6 text-ink-muted" aria-hidden />}
                </div>
                <div>
                  <input
                    ref={fileInput}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="sr-only"
                    aria-label="Upload studio logo"
                    onChange={async (e) => {
                      const file = e.target.files?.[0]
                      e.target.value = ''
                      if (!file) return
                      const problem = validateLogo(file)
                      if (problem) return void toast.error(problem)
                      setUploading(true)
                      try {
                        await uploadStudioLogo(studio.id, file)
                        await refresh()
                        toast.success('Logo updated')
                      } catch (err) {
                        toast.error(errorMessage(err))
                      } finally {
                        setUploading(false)
                      }
                    }}
                  />
                  <Button variant="secondary" size="sm" loading={uploading} onClick={() => fileInput.current?.click()}><ImagePlus className="size-4" /> {studio.logo_path ? 'Change logo' : 'Upload logo'}</Button>
                  <p className="mt-1.5 text-xs text-ink-muted">PNG, JPG or WebP · up to 2 MB</p>
                </div>
              </div>
              <Field label="Studio name" error={errors.name?.message} required>{(a) => <Input {...a} {...register('name')} />}</Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Email" error={errors.email?.message}>{(a) => <Input type="email" {...a} {...register('email')} />}</Field>
                <Field label="Phone" error={errors.phone?.message}>{(a) => <Input type="tel" {...a} {...register('phone')} />}</Field>
              </div>
              <Field label="Address">{(a) => <Textarea rows={2} {...a} {...register('address')} />}</Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="City">{(a) => <Input {...a} {...register('city')} />}</Field>
                <Field label="State">{(a) => <Input {...a} {...register('state')} />}</Field>
              </div>
            </div>
          </Panel>

          <Panel title="Region & reminders">
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Time zone" hint="Session times are entered and shown in this zone.">
                  {(a) => <Select {...a} {...register('timezone')}>{[...new Set([studio.timezone, ...COMMON_TIMEZONES])].map((z) => <option key={z} value={z}>{z}</option>)}</Select>}
                </Field>
                <Field label="Currency">{(a) => <Select {...a} {...register('currency')}>{[...new Set([studio.currency, ...COMMON_CURRENCIES])].map((c) => <option key={c} value={c}>{c}</option>)}</Select>}</Field>
              </div>
              {tzChanged && <Notice tone="warning">Existing sessions keep their exact moment in time, but will now display in the new zone. Check upcoming sessions after saving.</Notice>}
              {currencyChanged && <Notice tone="warning">Changing currency does not convert existing amounts - they are only relabelled.</Notice>}
              <Field label="Send session reminders" hint="How long before the reporting time assigned team members are reminded. Only sessions of confirmed events send reminders.">
                {(a) => <Select {...a} {...register('reminder_lead_hours')}>{[[12, '12 hours before'], [24, '1 day before (24 hours)'], [48, '2 days before (48 hours)'], [72, '3 days before (72 hours)']].map(([h, l]) => <option key={h} value={String(h)}>{l}</option>)}</Select>}
              </Field>
              <p className="text-xs text-ink-muted">Changing this affects reminders scheduled from now on; reminders already scheduled keep their time until the session changes.</p>
            </div>
          </Panel>
          <div className="flex justify-end"><Button type="submit" loading={isSubmitting} disabled={!isDirty}>Save settings</Button></div>
        </form>

        <ChecklistEditor />
      </div>
    </>
  )
}

function ChecklistEditor() {
  const { studio } = useStudio()
  const qc = useQueryClient()
  const [items, setItems] = useState<ChecklistTemplateItem[]>(studio.default_checklist)
  const [title, setTitle] = useState('')
  const [phase, setPhase] = useState<TaskPhase>('preparation')
  const [saving, setSaving] = useState(false)
  const dirty = JSON.stringify(items) !== JSON.stringify(studio.default_checklist)

  const move = (i: number, d: -1 | 1) => setItems((xs) => { const next = [...xs]; const j = i + d; if (j < 0 || j >= next.length) return xs; [next[i], next[j]] = [next[j]!, next[i]!]; return next })

  return (
    <Panel title="Default production checklist" description="Copied onto every new event. Existing events are not changed - edit those from their Production tab.">
      <ol className="space-y-2">
        {items.map((it, i) => (
          <li key={i} className="grid grid-cols-[1fr_auto] items-center gap-2 sm:grid-cols-[1fr_160px_auto]">
            <Input aria-label={`Task ${i + 1}`} value={it.title} maxLength={200} onChange={(e) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
            <Select aria-label="Phase" className="hidden sm:block" value={it.phase} onChange={(e) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, phase: e.target.value as TaskPhase } : x)))}>
              {options(TASK_PHASE_LABELS).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
            <div className="flex">
              <Button variant="ghost" size="icon-sm" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="size-4" /></Button>
              <Button variant="ghost" size="icon-sm" aria-label="Move down" disabled={i === items.length - 1} onClick={() => move(i, 1)}><ArrowDown className="size-4" /></Button>
              <Button variant="ghost" size="icon-sm" aria-label="Remove task" onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>
            </div>
          </li>
        ))}
      </ol>
      <form className="mt-4 flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); if (title.trim()) { setItems((xs) => [...xs, { title: title.trim(), phase }]); setTitle('') } }}>
        <Input aria-label="New task" placeholder="Add a task…" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
        <Select aria-label="Phase for new task" className="sm:w-44" value={phase} onChange={(e) => setPhase(e.target.value as TaskPhase)}>{options(TASK_PHASE_LABELS).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
        <Button type="submit" variant="secondary" disabled={!title.trim()}><Plus className="size-4" /> Add</Button>
      </form>
      <div className="mt-5 flex flex-wrap justify-between gap-2 border-t border-line pt-4">
        <Button variant="ghost" onClick={() => setItems(DEFAULT_CHECKLIST)}><RotateCcw className="size-4" /> Restore defaults</Button>
        <Button
          loading={saving}
          disabled={!dirty || items.some((i) => !i.title.trim())}
          onClick={async () => {
            setSaving(true)
            try {
              await updateStudio(studio.id, { default_checklist: items.map((i) => ({ ...i, title: i.title.trim() })) })
              await qc.invalidateQueries({ queryKey: ['membership'] })
              toast.success('Default checklist saved')
            } catch (e) {
              toast.error(errorMessage(e))
            } finally {
              setSaving(false)
            }
          }}
        >
          Save checklist
        </Button>
      </div>
    </Panel>
  )
}
