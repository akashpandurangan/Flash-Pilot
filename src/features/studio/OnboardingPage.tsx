import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Aperture, Check, ImagePlus, PartyPopper, UserPlus } from 'lucide-react'
import { useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Navigate, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { z } from 'zod'
import { createEmployee, inviteEmployee, listEmployees } from '@/api/employees'
import { completeOnboarding, createStudio, logoUrl, saveOnboardingStep, updateProfile, updateStudio, uploadStudioLogo, validateLogo } from '@/api/studio'
import { updateEmployee } from '@/api/employees'
import { Button } from '@/components/ui/button'
import { Avatar, Notice } from '@/components/ui/display'
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form'
import { ACCESS_ROLE_LABELS, COMMON_CURRENCIES, COMMON_TIMEZONES, DEFAULT_ACCESS_FOR_TEAM_ROLE, TEAM_ROLE_LABELS, options } from '@/lib/constants'
import { errorMessage } from '@/lib/errors'
import { DEFAULT_TIMEZONE, isValidTimeZone } from '@/lib/time'
import { cn, isValidEmail, isValidPhone } from '@/lib/utils'
import type { AccessRole, TeamRole } from '@/types/entities'
import { useAuth } from '@/features/auth/AuthProvider'
import { FullPageSpinner } from '@/features/auth/AuthPages'
import { useMembership } from './StudioProvider'

const STEPS = ['Studio', 'You', 'Team', 'Done']

const studioSchema = z.object({
  name: z.string().trim().min(2, 'Enter your studio name').max(120),
  email: z.string().trim().refine((v) => v === '' || isValidEmail(v), 'Enter a valid email address'),
  phone: z.string().trim().refine((v) => v === '' || isValidPhone(v), 'Enter a valid phone number'),
  address: z.string().trim().max(300),
  city: z.string().trim().max(80),
  state: z.string().trim().max(80),
  timezone: z.string().refine(isValidTimeZone, 'Choose a valid time zone'),
  currency: z.string().length(3),
})
type StudioValues = z.infer<typeof studioSchema>

export default function OnboardingPage() {
  const { status, membership, refetch } = useMembership()
  const { user } = useAuth()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const persisted = membership?.studio.onboarding_step ?? 1
  const [step, setStep] = useState<number | null>(null)
  const current = step ?? (membership ? Math.min(persisted, 4) : 1)

  if (status === 'loading') return <FullPageSpinner />
  if (status === 'inactive') return <Navigate to="/" replace /> // the gate explains that access was deactivated
  if (membership && membership.studio.onboarding_completed_at) return <Navigate to="/" replace />
  if (membership && membership.employee.access_role !== 'owner') return <Navigate to="/" replace />

  const goto = async (n: number) => {
    if (membership) await saveOnboardingStep(membership.studio.id, n).catch(() => undefined)
    await refetch()
    setStep(n)
  }

  return (
    <div className="min-h-dvh bg-sidebar">
      <header className="flex h-14 items-center border-b border-line bg-surface px-4 md:px-8">
        <div className="flex items-center gap-2 font-semibold"><Aperture className="size-5" aria-hidden /> Flash Pilot</div>
      </header>
      <div className="mx-auto max-w-2xl px-4 py-8 md:py-12">
        <ol className="mb-8 flex items-center gap-2" aria-label="Setup progress">
          {STEPS.map((label, i) => {
            const n = i + 1
            const done = n < current
            return (
              <li key={label} className="flex flex-1 items-center gap-2" aria-current={n === current ? 'step' : undefined}>
                <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold', done ? 'border-brand bg-brand text-on-brand' : n === current ? 'border-ink bg-surface' : 'border-line-strong text-ink-muted')}>
                  {done ? <Check className="size-3.5" strokeWidth={3} aria-hidden /> : n}
                </span>
                <span className={cn('hidden text-sm sm:inline', n === current ? 'font-medium' : 'text-ink-muted')}>{label}</span>
                {i < STEPS.length - 1 && <span className="h-px flex-1 bg-line-strong" aria-hidden />}
              </li>
            )
          })}
        </ol>

        <div className="rounded-lg border border-line bg-surface p-5 md:p-8">
          {current === 1 && <StudioStep onDone={async () => { await refetch(); setStep(2) }} />}
          {current === 2 && membership && (
            <OwnerStep
              defaults={{ fullName: membership.employee.full_name, phone: membership.employee.phone ?? '' }}
              email={user?.email ?? membership.employee.email ?? ''}
              onBack={() => setStep(1)}
              onDone={async (fullName, phone) => {
                await updateProfile(membership.employee.user_id!, { full_name: fullName, phone })
                await updateEmployee(membership.employee.id, { full_name: fullName, phone })
                await goto(3)
              }}
            />
          )}
          {current === 3 && membership && <TeamStep studioId={membership.studio.id} onBack={() => setStep(2)} onDone={() => goto(4)} />}
          {current >= 4 && membership && (
            <DoneStep
              name={membership.studio.name}
              onFinish={async () => {
                await completeOnboarding(membership.studio.id)
                await qc.invalidateQueries({ queryKey: ['membership'] })
                navigate('/', { replace: true })
              }}
            />
          )}
        </div>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------- step 1 */
function StudioStep({ onDone }: { onDone: () => Promise<void> }) {
  const { membership } = useMembership()
  const studio = membership?.studio
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(logoUrl(studio?.logo_path))
  const [fileError, setFileError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<StudioValues>({
    resolver: zodResolver(studioSchema),
    defaultValues: {
      name: studio?.name ?? '', email: studio?.email ?? '', phone: studio?.phone ?? '', address: studio?.address ?? '',
      city: studio?.city ?? '', state: studio?.state ?? '', timezone: studio?.timezone ?? DEFAULT_TIMEZONE, currency: studio?.currency ?? 'INR',
    },
  })

  return (
    <form
      noValidate
      className="space-y-5"
      onSubmit={handleSubmit(async (v) => {
        setError(null)
        try {
          let id = studio?.id
          if (id) await updateStudio(id, v)
          else id = await createStudio(v)
          if (file && id) {
            try {
              await uploadStudioLogo(id, file)
            } catch (e) {
              toast.warning(`Studio saved, but the logo could not be uploaded: ${errorMessage(e)} You can add it later in settings.`)
            }
          }
          await onDone()
        } catch (e) {
          setError(errorMessage(e))
        }
      })}
    >
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Tell us about your studio</h1>
        <p className="mt-1 text-sm text-ink-muted">This appears on your workspace and in notifications. You can change it later.</p>
      </div>
      {error && <Notice tone="danger">{error}</Notice>}

      <div className="flex items-center gap-4">
        <div className="flex size-16 items-center justify-center overflow-hidden rounded-lg border border-line-strong bg-subtle">
          {preview ? <img src={preview} alt="Logo preview" className="size-full object-cover" /> : <Aperture className="size-6 text-ink-muted" aria-hidden />}
        </div>
        <div>
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            aria-label="Studio logo"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (!f) return
              const problem = validateLogo(f)
              setFileError(problem)
              if (problem) return
              setFile(f)
              setPreview(URL.createObjectURL(f))
            }}
          />
          <Button variant="secondary" size="sm" onClick={() => fileInput.current?.click()}><ImagePlus className="size-4" /> {preview ? 'Change logo' : 'Upload logo'}</Button>
          <p className="mt-1.5 text-xs text-ink-muted">Optional · PNG, JPG or WebP · up to 2 MB</p>
          {fileError && <p role="alert" className="mt-1 text-xs font-medium text-danger">{fileError}</p>}
        </div>
      </div>

      <Field label="Studio name" error={errors.name?.message} required>
        {(a) => <Input autoFocus {...a} {...register('name')} />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Studio email" error={errors.email?.message}>{(a) => <Input type="email" autoComplete="off" {...a} {...register('email')} />}</Field>
        <Field label="Studio phone" error={errors.phone?.message}>{(a) => <Input type="tel" autoComplete="off" {...a} {...register('phone')} />}</Field>
      </div>
      <Field label="Address" error={errors.address?.message}>{(a) => <Textarea rows={2} {...a} {...register('address')} />}</Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="City" error={errors.city?.message}>{(a) => <Input {...a} {...register('city')} />}</Field>
        <Field label="State" error={errors.state?.message}>{(a) => <Input {...a} {...register('state')} />}</Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Time zone" hint="Session times are shown in this zone." error={errors.timezone?.message}>
          {(a) => (
            <Select {...a} {...register('timezone')}>
              {COMMON_TIMEZONES.map((z) => <option key={z} value={z}>{z}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Currency" error={errors.currency?.message}>
          {(a) => <Select {...a} {...register('currency')}>{COMMON_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}</Select>}
        </Field>
      </div>
      <div className="flex justify-end pt-2">
        <Button type="submit" loading={isSubmitting}>Continue</Button>
      </div>
    </form>
  )
}

/* -------------------------------------------------------------- step 2 */
const ownerSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter your full name'),
  phone: z.string().trim().refine((v) => v === '' || isValidPhone(v), 'Enter a valid phone number'),
})

function OwnerStep({ defaults, email, onBack, onDone }: {
  defaults: { fullName: string; phone: string }
  email: string
  onBack: () => void
  onDone: (fullName: string, phone: string) => Promise<void>
}) {
  const [error, setError] = useState<string | null>(null)
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(ownerSchema), defaultValues: defaults })
  return (
    <form
      noValidate
      className="space-y-5"
      onSubmit={handleSubmit(async (v) => {
        setError(null)
        try {
          await onDone(v.fullName, v.phone)
        } catch (e) {
          setError(errorMessage(e))
        }
      })}
    >
      <div>
        <h1 className="text-xl font-semibold tracking-tight">About you</h1>
        <p className="mt-1 text-sm text-ink-muted">You'll be the studio owner with full access.</p>
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
      <Field label="Full name" error={errors.fullName?.message} required>{(a) => <Input autoFocus autoComplete="name" {...a} {...register('fullName')} />}</Field>
      <Field label="Email" hint="This is your sign-in email.">{(a) => <Input value={email} readOnly disabled {...a} />}</Field>
      <Field label="Phone" error={errors.phone?.message}>{(a) => <Input type="tel" autoComplete="tel" {...a} {...register('phone')} />}</Field>
      <div className="flex justify-between pt-2">
        <Button variant="ghost" onClick={onBack}>Back</Button>
        <Button type="submit" loading={isSubmitting}>Continue</Button>
      </div>
    </form>
  )
}

/* -------------------------------------------------------------- step 3 */
const memberSchema = z.object({
  full_name: z.string().trim().min(2, 'Enter a name'),
  email: z.string().trim().refine((v) => v === '' || isValidEmail(v), 'Enter a valid email address'),
  phone: z.string().trim().refine((v) => v === '' || isValidPhone(v), 'Enter a valid phone number'),
  team_role: z.enum(['photographer', 'videographer', 'editor', 'assistant', 'studio_manager']),
  invite: z.boolean(),
  access_role: z.enum(['manager', 'photographer', 'editor']),
})
type MemberValues = z.infer<typeof memberSchema>

function TeamStep({ studioId, onBack, onDone }: { studioId: string; onBack: () => void; onDone: () => Promise<void> }) {
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const team = useQuery({ queryKey: ['employees', studioId], queryFn: () => listEmployees(studioId) })
  const { register, handleSubmit, reset, watch, setValue, formState: { errors, isSubmitting } } = useForm<MemberValues>({
    resolver: zodResolver(memberSchema),
    defaultValues: { full_name: '', email: '', phone: '', team_role: 'photographer', invite: false, access_role: 'photographer' },
  })
  const invite = watch('invite')
  const email = watch('email')

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Add your team</h1>
        <p className="mt-1 text-sm text-ink-muted">Add photographers, videographers and editors so you can assign them to sessions. You can skip this and do it later.</p>
      </div>

      {team.data && team.data.length > 0 && (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {team.data.map((e) => (
            <li key={e.id} className="flex items-center gap-3 px-3 py-2.5">
              <Avatar name={e.full_name} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{e.full_name}</p>
                <p className="truncate text-xs text-ink-muted">{TEAM_ROLE_LABELS[e.team_role]}{e.access_role === 'owner' ? ' · you' : ''}{e.invite_status === 'pending' ? ' · invited' : ''}</p>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form
        noValidate
        className="space-y-4 rounded-lg border border-line p-4"
        onSubmit={handleSubmit(async (v) => {
          try {
            const created = await createEmployee(studioId, { full_name: v.full_name, email: v.email, phone: v.phone, team_role: v.team_role })
            if (v.invite && v.email) {
              try {
                await inviteEmployee({ employeeId: created.id, accessRole: v.access_role, canViewFinancials: false })
                toast.success(`Invitation sent to ${v.email}`)
              } catch (e) {
                toast.warning(`${v.full_name} was added, but the invitation failed: ${errorMessage(e)} You can resend it from the Team page.`)
              }
            } else {
              toast.success(`${v.full_name} added`)
            }
            reset({ full_name: '', email: '', phone: '', team_role: v.team_role, invite: false, access_role: 'photographer' })
            await qc.invalidateQueries({ queryKey: ['employees', studioId] })
          } catch (e) {
            toast.error(errorMessage(e))
          }
        })}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" error={errors.full_name?.message} required>{(a) => <Input {...a} {...register('full_name')} />}</Field>
          <Field label="Role" error={errors.team_role?.message}>
            {(a) => (
              <Select
                {...a}
                {...register('team_role', {
                  onChange: (e) => setValue('access_role', DEFAULT_ACCESS_FOR_TEAM_ROLE[e.target.value as TeamRole] as Exclude<AccessRole, 'owner'>),
                })}
              >
                {options(TEAM_ROLE_LABELS).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Email" error={errors.email?.message}>{(a) => <Input type="email" {...a} {...register('email')} />}</Field>
          <Field label="Phone" error={errors.phone?.message}>{(a) => <Input type="tel" {...a} {...register('phone')} />}</Field>
        </div>
        <Checkbox label="Invite to sign in" description="They'll get an email to set their own password. Requires an email address." disabled={!email} {...register('invite')} />
        {invite && email && (
          <Field label="Access level">
            {(a) => (
              <Select {...a} {...register('access_role')}>
                {(['manager', 'photographer', 'editor'] as const).map((r) => <option key={r} value={r}>{ACCESS_ROLE_LABELS[r]}</option>)}
              </Select>
            )}
          </Field>
        )}
        <Button type="submit" variant="secondary" loading={isSubmitting}><UserPlus className="size-4" /> Add team member</Button>
      </form>

      <div className="flex justify-between pt-2">
        <Button variant="ghost" onClick={onBack}>Back</Button>
        <Button loading={busy} onClick={async () => { setBusy(true); try { await onDone() } finally { setBusy(false) } }}>
          {team.data && team.data.length > 1 ? 'Continue' : 'Skip for now'}
        </Button>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------- step 4 */
function DoneStep({ name, onFinish }: { name: string; onFinish: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="flex flex-col items-center py-6 text-center">
      <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-brand text-on-brand"><PartyPopper className="size-6" aria-hidden /></div>
      <h1 className="text-xl font-semibold tracking-tight">{name} is ready</h1>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-ink-muted">
        Your workspace is set up. Add your first client and create an event - bookings, payments and production tracking all start there.
      </p>
      {error && <Notice tone="danger" className="mt-4 w-full text-left">{error}</Notice>}
      <Button
        size="lg"
        className="mt-6"
        loading={busy}
        onClick={async () => {
          setBusy(true)
          setError(null)
          try {
            await onFinish()
          } catch (e) {
            setError(errorMessage(e))
            setBusy(false)
          }
        }}
      >
        Go to dashboard
      </Button>
    </div>
  )
}
