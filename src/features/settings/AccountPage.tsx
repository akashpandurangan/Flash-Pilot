import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { z } from 'zod'
import { updateProfile } from '@/api/studio'
import { updateEmployee } from '@/api/employees'
import { Button } from '@/components/ui/button'
import { Badge, Notice, PageHeader, Panel } from '@/components/ui/display'
import { Field, Input } from '@/components/ui/form'
import { ACCESS_ROLE_LABELS } from '@/lib/constants'
import { errorMessage } from '@/lib/errors'
import { isValidPhone } from '@/lib/utils'
import { useAuth } from '@/features/auth/AuthProvider'
import { useStudio } from '@/features/studio/StudioProvider'

const profileSchema = z.object({
  full_name: z.string().trim().min(2, 'Enter your full name'),
  phone: z.string().trim().refine((v) => v === '' || isValidPhone(v), 'Enter a valid phone number'),
})
const passwordSchema = z
  .object({ password: z.string().min(8, 'Use at least 8 characters').regex(/[A-Za-z]/, 'Include a letter').regex(/\d/, 'Include a number'), confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match' })

export default function AccountPage() {
  const { user, updatePassword } = useAuth()
  const { me, role, studio, can } = useStudio()
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [pwError, setPwError] = useState<string | null>(null)

  const profile = useForm({ resolver: zodResolver(profileSchema), defaultValues: { full_name: me.full_name, phone: me.phone ?? '' } })
  const password = useForm({ resolver: zodResolver(passwordSchema), defaultValues: { password: '', confirm: '' } })

  return (
    <>
      <PageHeader title="Account" description="Your personal details and sign-in." />
      <div className="grid max-w-2xl gap-4">
        <form
          noValidate
          className="contents"
          onSubmit={profile.handleSubmit(async (v) => {
            setError(null)
            try {
              await updateProfile(user!.id, v)
              // Owners and managers can edit their own employee record; crew's name is changed by the studio.
              if (can('team.manage')) await updateEmployee(me.id, { full_name: v.full_name, phone: v.phone })
              await qc.invalidateQueries({ queryKey: ['membership'] })
              profile.reset(v)
              toast.success('Profile updated')
            } catch (e) {
              setError(errorMessage(e))
            }
          })}
        >
          <Panel title="Profile" description={`${studio.name} · ${ACCESS_ROLE_LABELS[role]}`}>
            <div className="space-y-4">
              {error && <Notice tone="danger">{error}</Notice>}
              <Field label="Full name" error={profile.formState.errors.full_name?.message} required>{(a) => <Input autoComplete="name" {...a} {...profile.register('full_name')} />}</Field>
              <Field label="Email" hint="Your sign-in email. Contact the studio owner to change it.">{(a) => <Input value={user?.email ?? ''} readOnly disabled {...a} />}</Field>
              <Field label="Phone" error={profile.formState.errors.phone?.message}>{(a) => <Input type="tel" autoComplete="tel" {...a} {...profile.register('phone')} />}</Field>
              <Button type="submit" loading={profile.formState.isSubmitting} disabled={!profile.formState.isDirty}>Save profile</Button>
            </div>
          </Panel>
        </form>

        <form
          noValidate
          className="contents"
          onSubmit={password.handleSubmit(async (v) => {
            setPwError(null)
            try {
              await updatePassword(v.password)
              password.reset()
              toast.success('Password changed')
            } catch (e) {
              setPwError((e as Error).message)
            }
          })}
        >
          <Panel title="Change password">
            <div className="space-y-4">
              {pwError && <Notice tone="danger">{pwError}</Notice>}
              <Field label="New password" error={password.formState.errors.password?.message} hint="At least 8 characters, with a letter and a number.">{(a) => <Input type="password" autoComplete="new-password" {...a} {...password.register('password')} />}</Field>
              <Field label="Confirm new password" error={password.formState.errors.confirm?.message}>{(a) => <Input type="password" autoComplete="new-password" {...a} {...password.register('confirm')} />}</Field>
              <Button type="submit" variant="secondary" loading={password.formState.isSubmitting}>Update password</Button>
            </div>
          </Panel>
        </form>

        <Panel title="Notifications">
          <p className="text-sm text-ink-muted">Choose which reminders and updates you receive, and where.</p>
          <Button variant="secondary" className="mt-3" asChild><Link to="/notifications?tab=preferences">Notification preferences</Link></Button>
          <p className="mt-3 flex items-center gap-2 text-xs text-ink-muted">Signed in as <Badge tone="outline">{user?.email}</Badge></p>
        </Panel>
      </div>
    </>
  )
}
