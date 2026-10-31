import { cn } from '@/lib/utils'

/** Rounded progress bar. `value` is 0–100; announced to assistive tech as a progressbar. */
export function ProgressBar({ value, label, tone = 'dark', className }: {
  value: number
  label: string
  tone?: 'dark' | 'accent'
  className?: string
}) {
  const v = Math.max(0, Math.min(100, Math.round(value)))
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={v}
      className={cn('h-2 w-full overflow-hidden rounded-full bg-subtle', className)}
    >
      <div className={cn('h-full rounded-full transition-[width] duration-500', tone === 'dark' ? 'bg-brand' : 'bg-accent')} style={{ width: `${v}%` }} />
    </div>
  )
}
