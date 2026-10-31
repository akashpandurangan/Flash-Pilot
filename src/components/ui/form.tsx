import { Check, ChevronDown } from 'lucide-react'
import { Switch as RadixSwitch } from 'radix-ui'
import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

const control =
  'block w-full rounded-md border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-ink-muted/70 transition-colors hover:border-ink-muted/60 focus:border-ink disabled:cursor-not-allowed disabled:bg-subtle disabled:text-ink-muted aria-[invalid=true]:border-danger aria-[invalid=true]:focus:border-danger'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cn(control, 'h-10 md:h-9', className)} {...props} />
})

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, rows = 3, ...props }, ref) {
  return <textarea ref={ref} rows={rows} className={cn(control, 'py-2 leading-relaxed', className)} {...props} />
})

/** Native <select>: best accessibility and mobile behaviour, styled to match. */
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...props }, ref) {
  return (
    <div className="relative">
      <select ref={ref} className={cn(control, 'h-10 appearance-none pr-9 md:h-9', className)} {...props}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-muted" aria-hidden />
    </div>
  )
})

/** Amount input with a currency prefix. Keeps the value as the text the user typed. */
export const MoneyInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { symbol?: string }>(function MoneyInput(
  { className, symbol = '₹', ...props },
  ref,
) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-muted" aria-hidden>{symbol}</span>
      <Input ref={ref} inputMode="decimal" autoComplete="off" className={cn('pl-7 tabular-nums', className)} {...props} />
    </div>
  )
})

export interface FieldProps {
  label: string
  error?: string
  hint?: ReactNode
  required?: boolean
  className?: string
  /** Receives ids to wire the control to its label, hint and error text. */
  children: (a11y: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean; 'aria-required'?: boolean }) => ReactNode
}

/** Label + control + hint + error, with the ARIA wiring done once. */
export function Field({ label, error, hint, required, className, children }: FieldProps) {
  const id = useId()
  const hintId = `${id}-hint`
  const errId = `${id}-err`
  const describedBy = [hint ? hintId : null, error ? errId : null].filter(Boolean).join(' ') || undefined
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={id} className="block text-[13px] font-medium text-ink">
        {label}
        {required && <span className="ml-0.5 text-danger" aria-hidden>*</span>}
      </label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined, 'aria-required': required || undefined })}
      {hint && !error && <p id={hintId} className="text-xs text-ink-muted">{hint}</p>}
      {error && <p id={errId} role="alert" className="text-xs font-medium text-danger">{error}</p>}
    </div>
  )
}

export function Checkbox({ label, description, className, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; description?: ReactNode }) {
  const id = useId()
  return (
    <div className={cn('flex items-start gap-2.5', className)}>
      <span className="relative mt-0.5 flex size-4 shrink-0 items-center justify-center">
        <input id={id} type="checkbox" className="peer size-4 cursor-pointer appearance-none rounded-[4px] border border-line-strong bg-surface checked:border-brand checked:bg-brand disabled:cursor-not-allowed disabled:opacity-50" {...props} />
        <Check className="pointer-events-none absolute size-3 text-on-brand opacity-0 peer-checked:opacity-100" strokeWidth={3} aria-hidden />
      </span>
      <label htmlFor={id} className="cursor-pointer text-sm leading-5">
        {label}
        {description && <span className="mt-0.5 block text-xs text-ink-muted">{description}</span>}
      </label>
    </div>
  )
}

export function Switch({ checked, onCheckedChange, label, description, disabled, id }: {
  checked: boolean
  onCheckedChange: (v: boolean) => void
  label: string
  description?: string
  disabled?: boolean
  id?: string
}) {
  const auto = useId()
  const sid = id ?? auto
  return (
    <div className="flex items-start justify-between gap-4">
      <label htmlFor={sid} className="cursor-pointer text-sm">
        <span className="font-medium">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-ink-muted">{description}</span>}
      </label>
      <RadixSwitch.Root
        id={sid}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
        className="relative h-5 w-9 shrink-0 cursor-pointer rounded-full bg-line-strong transition-colors data-[state=checked]:bg-brand disabled:cursor-not-allowed disabled:opacity-50"
      >
        <RadixSwitch.Thumb className="block size-4 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[18px]" />
      </RadixSwitch.Root>
    </div>
  )
}

export function FormSection({ title, description, children, className }: { title: string; description?: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn('grid gap-4 py-6 md:grid-cols-[220px_1fr] md:gap-8', className)}>
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {description && <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">{description}</p>}
      </div>
      <div className="min-w-0 space-y-4">{children}</div>
    </section>
  )
}
