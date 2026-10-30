import { ArrowUpRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { cn } from '@/lib/utils'

/**
 * A key number. The first card on a dashboard is `dark` (near-black, white text); the rest are `soft`.
 * With `to`, the whole card is a link to the list behind the number.
 */
export function MetricCard({ label, value, hint, tone = 'soft', compact, to, onClick, className }: {
  label: string
  value: ReactNode
  hint?: ReactNode
  tone?: 'dark' | 'soft'
  /** Smaller figure, for long values such as amounts of money that would not fit a narrow card. */
  compact?: boolean
  to?: string
  /** Use instead of `to` for an in-page action (e.g. scrolling to a section). */
  onClick?: () => void
  className?: string
}) {
  const dark = tone === 'dark'
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className={cn('text-[13px]', dark ? 'text-white/70' : 'text-ink-muted')}>{label}</p>
        {(to || onClick) && <ArrowUpRight className={cn('size-4 shrink-0 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5', dark ? 'text-white/60' : 'text-ink-faint')} aria-hidden />}
      </div>
      {/* leading-none must come after the size: tailwind-merge drops an earlier leading-* when a text-size follows it */}
      <p className={cn(compact ? 'text-2xl sm:text-[28px]' : 'text-[34px] sm:text-[38px]', 'mt-2 font-semibold leading-none tracking-tight tabular-nums')}>{value}</p>
      {hint && <p className={cn('mt-2 text-xs leading-snug', dark ? 'text-white/70' : 'text-ink-muted')}>{hint}</p>}
    </>
  )
  const cls = cn(
    'group block min-w-0 rounded-card p-4 transition-colors sm:p-[18px]',
    dark ? 'on-dark bg-dark text-white' : 'bg-subtle text-ink',
    (to || onClick) && (dark ? 'hover:bg-dark-soft' : 'hover:bg-line/70'),
    className,
  )
  if (to) return <Link to={to} className={cls}>{body}</Link>
  if (onClick) return <button type="button" onClick={onClick} className={cn(cls, 'w-full text-left')}>{body}</button>
  return <div className={cls}>{body}</div>
}
