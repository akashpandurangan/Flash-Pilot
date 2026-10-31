import { zodResolver } from '@hookform/resolvers/zod'
import { Aperture, MailCheck } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Notice, Spinner } from '@/components/ui/display'
import { Field, Input } from '@/components/ui/form'
import { useAuth } from './AuthProvider'

function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_minmax(420px,520px)]">
      <aside className="relative hidden flex-col justify-between bg-dark p-12 text-white lg:flex">
        <div className="flex items-center gap-2.5 text-lg font-semibold"><Aperture className="size-6" aria-hidden /> Flash Pilot</div>
        <div className="max-w-md">
          <p className="text-3xl font-semibold leading-tight tracking-tight">Every shoot, from first inquiry to final delivery.</p>
          <p className="mt-4 text-sm leading-relaxed text-white/60">
            Bookings, team, equipment, payments and production progress for your photography studio - in one calm workspace.
          </p>
        </div>
        <p className="text-xs text-white/40">Built for photography studios.</p>
      </aside>
      <main className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2 text-lg font-semibold lg:hidden"><Aperture className="size-6" aria-hidden /> Flash Pilot</div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-ink-muted">{subtitle}</p>}
          <div className="mt-6">{children}</div>
          {footer && <div className="mt-6 text-center text-sm text-ink-muted">{footer}</div>}
        </div>
      </main>
    </div>
  )
}

const passwordRule = z.string().min(8, 'Use at least 8 characters').regex(/[A-Za-z]/, 'Include at least one letter').regex(/\d/, 'Include at least one number')

/* ------------------------------------------------------------------ login */
const loginSchema = z.object({ email: z.string().trim().email('Enter a valid email address'), password: z.string().min(1, 'Enter your password') })

export function LoginPage() {
  const { signIn, session, loading } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [error, setError] = useState<string | null>(null)
  const from = (location.state as { from?: string } | null)?.from ?? '/'
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } })

  if (loading) return <FullPageSpinner />
  if (session) return <Navigate to={from} replace />

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to your studio."
      footer={<>New to Flash Pilot? <Link to="/signup" className="font-medium text-ink underline underline-offset-4">Create your studio</Link></>}
    >
      <form
        noValidate
        className="space-y-4"
        onSubmit={handleSubmit(async (v) => {
          setError(null)
          try {
            await signIn(v.email, v.password)
            navigate(from, { replace: true })
          } catch (e) {
            setError((e as Error).message)
          }
        })}
      >
        {error && <Notice tone="danger">{error}</Notice>}
        <Field label="Email" error={errors.email?.message} required>
          {(a) => <Input type="email" autoComplete="email" autoFocus placeholder="you@studio.com" {...a} {...register('email')} />}
        </Field>
        <Field label="Password" error={errors.password?.message} required>
          {(a) => <Input type="password" autoComplete="current-password" {...a} {...register('password')} />}
        </Field>
        <div className="flex justify-end">
          <Link to="/forgot-password" className="text-[13px] text-ink-muted underline-offset-4 hover:text-ink hover:underline">Forgot password?</Link>
        </div>
        <Button type="submit" className="w-full" size="lg" loading={isSubmitting}>{isSubmitting ? 'Signing in…' : 'Sign in'}</Button>
      </form>
    </AuthLayout>
  )
}

/* ----------------------------------------------------------------- signup */
const signupSchema = z
  .object({
    fullName: z.string().trim().min(2, 'Enter your full name'),
    email: z.string().trim().email('Enter a valid email address'),
    password: passwordRule,
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match' })

export function SignupPage() {
  const { signUp, session, loading } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(signupSchema),
    defaultValues: { fullName: '', email: '', password: '', confirm: '' },
  })

  if (loading) return <FullPageSpinner />
  if (session) return <Navigate to="/" replace />

  if (sentTo) {
    return (
      <AuthLayout title="Check your email" footer={<Link to="/login" className="font-medium text-ink underline underline-offset-4">Back to sign in</Link>}>
        <div className="flex flex-col items-start gap-4">
          <div className="flex size-11 items-center justify-center rounded-full bg-subtle"><MailCheck className="size-5" aria-hidden /></div>
          <p className="text-sm leading-relaxed text-ink-muted">
            We sent a confirmation link to <span className="font-medium text-ink">{sentTo}</span>. Open it to activate your account, then sign in to set up your studio.
          </p>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title="Create your studio"
      subtitle="Start managing bookings, team and deliveries in minutes."
      footer={<>Already have an account? <Link to="/login" className="font-medium text-ink underline underline-offset-4">Sign in</Link></>}
    >
      <form
        noValidate
        className="space-y-4"
        onSubmit={handleSubmit(async (v) => {
          setError(null)
          try {
            const { needsConfirmation } = await signUp({ email: v.email, password: v.password, fullName: v.fullName })
            if (needsConfirmation) setSentTo(v.email)
            else toast.success('Account created')
          } catch (e) {
            setError((e as Error).message)
          }
        })}
      >
        {error && <Notice tone="danger">{error}</Notice>}
        <Field label="Your full name" error={errors.fullName?.message} required>
          {(a) => <Input autoComplete="name" autoFocus {...a} {...register('fullName')} />}
        </Field>
        <Field label="Email" error={errors.email?.message} required>
          {(a) => <Input type="email" autoComplete="email" {...a} {...register('email')} />}
        </Field>
        <Field label="Password" error={errors.password?.message} hint="At least 8 characters, with a letter and a number." required>
          {(a) => <Input type="password" autoComplete="new-password" {...a} {...register('password')} />}
        </Field>
        <Field label="Confirm password" error={errors.confirm?.message} required>
          {(a) => <Input type="password" autoComplete="new-password" {...a} {...register('confirm')} />}
        </Field>
        <Button type="submit" className="w-full" size="lg" loading={isSubmitting}>{isSubmitting ? 'Creating account…' : 'Create account'}</Button>
      </form>
    </AuthLayout>
  )
}

/* ---------------------------------------------------------- forgot password */
const emailSchema = z.object({ email: z.string().trim().email('Enter a valid email address') })

export function ForgotPasswordPage() {
  const { sendPasswordReset } = useAuth()
  const [sent, setSent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(emailSchema), defaultValues: { email: '' } })

  return (
    <AuthLayout title="Reset your password" subtitle="We'll email you a link to choose a new one." footer={<Link to="/login" className="font-medium text-ink underline underline-offset-4">Back to sign in</Link>}>
      {sent ? (
        <Notice tone="success" title="Check your inbox">If an account exists for {sent}, a reset link is on its way. It may take a minute to arrive.</Notice>
      ) : (
        <form
          noValidate
          className="space-y-4"
          onSubmit={handleSubmit(async (v) => {
            setError(null)
            try {
              await sendPasswordReset(v.email)
              setSent(v.email)
            } catch (e) {
              setError((e as Error).message)
            }
          })}
        >
          {error && <Notice tone="danger">{error}</Notice>}
          <Field label="Email" error={errors.email?.message} required>
            {(a) => <Input type="email" autoComplete="email" autoFocus {...a} {...register('email')} />}
          </Field>
          <Button type="submit" className="w-full" size="lg" loading={isSubmitting}>Send reset link</Button>
        </form>
      )}
    </AuthLayout>
  )
}

/* ---------------------------------------------------------- reset / set password */
const resetSchema = z
  .object({ password: passwordRule, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match' })

/** Used for password recovery links and for accepting an employee invitation (?invited=1). */
export function ResetPasswordPage() {
  const { session, loading, updatePassword } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const invited = params.get('invited') === '1'
  const [error, setError] = useState<string | null>(null)
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(resetSchema), defaultValues: { password: '', confirm: '' } })

  if (loading) return <FullPageSpinner />
  if (!session) {
    return (
      <AuthLayout title="Link expired" subtitle="This link is invalid or has already been used." footer={<Link to="/login" className="font-medium text-ink underline underline-offset-4">Back to sign in</Link>}>
        <Notice tone="warning">Request a new password reset link, or ask your studio owner to resend your invitation.</Notice>
        <Link to="/forgot-password" className="mt-4 inline-block text-sm font-medium underline underline-offset-4">Send me a new link</Link>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title={invited ? 'Welcome to the team' : 'Choose a new password'} subtitle={invited ? 'Set a password to finish creating your account.' : 'Pick something you have not used elsewhere.'}>
      <form
        noValidate
        className="space-y-4"
        onSubmit={handleSubmit(async (v) => {
          setError(null)
          try {
            await updatePassword(v.password)
            toast.success(invited ? 'Password set. Welcome aboard!' : 'Password updated')
            navigate('/', { replace: true })
          } catch (e) {
            setError((e as Error).message)
          }
        })}
      >
        {error && <Notice tone="danger">{error}</Notice>}
        <Field label="New password" error={errors.password?.message} hint="At least 8 characters, with a letter and a number." required>
          {(a) => <Input type="password" autoComplete="new-password" autoFocus {...a} {...register('password')} />}
        </Field>
        <Field label="Confirm password" error={errors.confirm?.message} required>
          {(a) => <Input type="password" autoComplete="new-password" {...a} {...register('confirm')} />}
        </Field>
        <Button type="submit" className="w-full" size="lg" loading={isSubmitting}>{invited ? 'Set password' : 'Update password'}</Button>
      </form>
    </AuthLayout>
  )
}

export function FullPageSpinner() {
  return (
    <div className="flex min-h-dvh items-center justify-center" role="status" aria-label="Loading">
      <Spinner className="size-6" />
    </div>
  )
}
