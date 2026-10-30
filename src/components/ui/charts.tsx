import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface ChartDatum {
  key: string
  label: string
  value: number
}

/** Rounds up to 1, 2, 5 x 10^n so the top gridline is a clean number. */
export function niceMax(max: number): number {
  if (max <= 4) return Math.max(4, Math.ceil(max))
  const pow = 10 ** Math.floor(Math.log10(max))
  const unit = max / pow
  return (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10) * pow
}

/** 1,200 -> 1.2K, so axis labels stay short. */
const compact = (n: number) => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n)

/**
 * Vertical bars over time. One series, so no legend: the card title says what it is.
 * Only the tallest bar and the highlighted one carry a printed value; the rest answer to hover or focus.
 */
export function ColumnChart({ data, label, unit, format = (n) => String(n), highlight, axisFormat = compact, className }: {
  data: ChartDatum[]
  /** What the chart shows, for assistive tech ("Events per month"). */
  label: string
  /** Noun used in tooltips ("events"). */
  unit: string
  format?: (n: number) => string
  /** Key of the bar to emphasise (usually the current month); when omitted every bar is dark. */
  highlight?: string
  axisFormat?: (n: number) => string
  className?: string
}) {
  const max = Math.max(0, ...data.map((d) => d.value))
  const top = niceMax(max)
  const ticks = [top, top / 2, 0]
  const tallest = max > 0 ? data.find((d) => d.value === max)?.key : undefined
  const summary = `${label}: ${data.map((d) => `${d.label} ${format(d.value)}`).join(', ')}`

  return (
    <figure className={cn('min-w-0', className)}>
      <div className="flex gap-2">
        <div className="flex h-44 flex-col justify-between pb-6 pt-5 text-right text-[11px] tabular-nums text-ink-muted" aria-hidden>
          {ticks.map((t) => <span key={t} className="leading-none">{axisFormat(t)}</span>)}
        </div>
        <div className="relative min-w-0 flex-1 overflow-x-auto">
          <div className="relative h-44" style={{ minWidth: data.length * 28 }}>
            <div className="pointer-events-none absolute inset-x-0 top-5 bottom-6 flex flex-col justify-between" aria-hidden>
              {ticks.map((t) => <div key={t} className="border-t border-line" />)}
            </div>
            <ul aria-hidden className="absolute inset-x-0 bottom-0 top-5 flex items-stretch">
              {data.map((d) => {
                const pct = top === 0 ? 0 : (d.value / top) * 100
                const dim = highlight !== undefined && d.key !== highlight
                const showValue = d.value > 0 && (d.key === tallest || d.key === highlight)
                return (
                  <li key={d.key} className="group relative flex min-w-0 flex-1 flex-col items-center">
                    <div className="relative flex w-full flex-1 items-end justify-center">
                      {showValue && <span className="absolute left-1/2 -translate-x-1/2 text-[11px] font-semibold tabular-nums text-ink" style={{ bottom: `calc(${pct}% + 4px)` }}>{format(d.value)}</span>}
                      <div
                        className={cn('w-full max-w-6 rounded-t-[4px] transition-colors', d.value === 0 ? 'h-px bg-line-strong' : cn('group-hover:bg-dark', dim ? 'bg-ink-faint' : 'bg-dark'))}
                        style={d.value === 0 ? undefined : { height: `${Math.max(pct, 2)}%` }}
                      />
                      <span className="pointer-events-none absolute left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-dark px-2.5 py-1.5 text-xs font-medium text-white shadow-pop group-hover:block" style={{ bottom: `calc(${pct}% + 22px)` }}>
                        {d.label} · {format(d.value)} {unit}
                      </span>
                    </div>
                    <span className="flex h-6 items-end text-[11px] text-ink-muted">{d.label}</span>
                  </li>
                )
              })}
            </ul>
          </div>
        </div>
      </div>
      <figcaption className="sr-only">{summary}</figcaption>
    </figure>
  )
}

export type BarTone = 'dark' | 'ok' | 'caution' | 'risk' | 'muted'

const FILL: Record<BarTone, string> = { dark: 'bg-dark', ok: 'bg-ok', caution: 'bg-caution', risk: 'bg-risk', muted: 'bg-ink-faint' }

export interface BarListItem {
  key: string
  label: ReactNode
  value: number
  /** What to print at the end of the row; defaults to the value. */
  display?: ReactNode
  tone?: BarTone
}

/**
 * Horizontal bars ranked or grouped by name. The label and number are always printed, so colour is never the only
 * thing telling rows apart; `max` lets several lists share one scale.
 */
export function BarList({ items, max, label, className }: { items: BarListItem[]; max?: number; label: string; className?: string }) {
  const scale = max ?? Math.max(1, ...items.map((i) => i.value))
  return (
    <ul aria-label={label} className={cn('space-y-3.5', className)}>
      {items.map((i) => (
        <li key={i.key}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-ink">{i.label}</span>
            <span className="shrink-0 font-semibold tabular-nums">{i.display ?? i.value}</span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-subtle" role="presentation">
            <div className={cn('h-full rounded-full', FILL[i.tone ?? 'dark'])} style={{ width: `${i.value <= 0 ? 0 : Math.max(2, (i.value / scale) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  )
}
