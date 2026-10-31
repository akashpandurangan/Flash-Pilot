import { ArrowUpRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { cn } from '@/lib/utils'

/**
 * Rough width of a figure in em, so it can be sized to fit its card. Digits (and currency symbols) are ~0.62em in
 * Inter's tabular figures, separators are narrow; a little headroom is added so it never touches the edge.
 */
function figureWidthEm(text: string): number {
  let em = 0
  for (const ch of text) em += /[\d₹$€£]/.test(ch) ? 0.66 : /[,.\s]/.test(ch) ? 0.32 : 0.8
  return Math.max(em, 0.66)
}

/**
 * A key number. The first card on a dashboard is `dark` (near-black, white text); the rest are `soft`, and
 * one card can carry the lime `accent` tone (a pale lime wash, not the full lime used for active states).
 * With `to`, the whole card is a link to the list behind the number.
 *
 * The figure is at most 38px but shrinks to fit when it is long (e.g. ₹12,50,000 in a narrow card), so a
 * row of equal cards never overflows and short numbers all keep the same size.
 */
export function MetricCard({ label, value, hint, tone = 'soft', compact, to, onClick, className }: {
  label: string
  value: ReactNode
  hint?: ReactNode
  tone?: 'dark' | 'soft' | 'accent'
  /** Smaller figure, for long values such as amounts of money that would not fit a narrow card. */
  compact?: boolean
  to?: string
  /** Use instead of `to` for an in-page action (e.g. scrolling to a section). */
  onClick?: () => void
  className?: string
}) {
  const dark = tone === 'dark'
  const accent = tone === 'accent'
  const max = compact ? 28 : 38
  const text = typeof value === 'string' || typeof value === 'number' ? String(value) : null
  const body = (
    <>
      <p className={cn('text-[13px] leading-tight', (to || onClick) && 'pr-4', dark ? 'text-white/70' : accent ? 'text-accent-ink' : 'text-ink-muted')}>{label}</p>
      {(to || onClick) && <ArrowUpRight className={cn('absolute right-3 top-4 size-4 shrink-0 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 sm:top-[18px]', dark ? 'text-white/60' : accent ? 'text-accent-ink/70' : 'text-ink-faint')} aria-hidden />}
      {/* leading-none must come after the size: tailwind-merge drops an earlier leading-* when a text-size follows it */}
      <div className="mt-2" style={{ containerType: 'inline-size' }}>
        <p
          className="whitespace-nowrap font-semibold leading-none tracking-tight tabular-nums"
          style={{ fontSize: text ? `min(${max}px, calc(100cqw / ${figureWidthEm(text).toFixed(2)}))` : `${max}px` }}
        >
          {value}
        </p>
      </div>
      {hint && <p className={cn('mt-2 text-xs leading-snug', dark ? 'text-white/70' : accent ? 'text-accent-ink' : 'text-ink-muted')}>{hint}</p>}
    </>
  )
  const cls = cn(
    'group relative block min-w-0 rounded-card p-4 transition-colors sm:p-[18px] xl:p-4 min-[1400px]:p-[18px]',
    dark ? 'on-dark bg-dark text-white' : accent ? 'bg-accent-soft text-ink ring-1 ring-accent/70' : 'bg-subtle text-ink',
    (to || onClick) && (dark ? 'hover:bg-dark-soft' : accent ? 'hover:bg-accent/40' : 'hover:bg-line/70'),
    className,
  )
  if (to) return <Link to={to} className={cls}>{body}</Link>
  if (onClick) return <button type="button" onClick={onClick} className={cn(cls, 'w-full text-left')}>{body}</button>
  return <div className={cls}>{body}</div>
}
