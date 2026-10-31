import { cva, type VariantProps } from 'class-variance-authority'
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, ChevronRight as Sep, Info, Loader2, RefreshCw } from 'lucide-react'
import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react'
import { Link } from 'react-router'
import { PAGE_SIZE } from '@/lib/constants'
import { cn, initials } from '@/lib/utils'
import { Button } from './button'

/* --------------------------------------------------------------------- badge */
const badge = cva('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium leading-4', {
  variants: {
    tone: {
      neutral: 'bg-subtle text-ink',
      solid: 'bg-inverse text-on-inverse',
      accent: 'bg-accent text-on-accent',
      outline: 'border border-line-strong bg-surface text-ink-muted',
      success: 'bg-success-soft text-success',
      warning: 'bg-warning-soft text-warning',
      danger: 'bg-danger-soft text-danger',
    },
  },
  defaultVariants: { tone: 'neutral' },
})

export function Badge({ tone, className, ...props }: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badge>) {
  return <span className={cn(badge({ tone }), className)} {...props} />
}

/* ------------------------------------------------------------------ avatar */
export function Avatar({ name, className }: { name: string | null | undefined; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('inline-flex size-8 shrink-0 select-none items-center justify-center rounded-full bg-subtle text-xs font-semibold text-ink ring-1 ring-line', className)}
    >
      {initials(name)}
    </span>
  )
}

/** Overlapping initials for a team; "+N" when there are more than `max`. Names are announced once, not per avatar. */
export function AvatarStack({ names, max = 3, className }: { names: string[]; max?: number; className?: string }) {
  if (names.length === 0) return null
  const shown = names.slice(0, max)
  return (
    <span className={cn('inline-flex items-center', className)} role="img" aria-label={`Team: ${names.join(', ')}`}>
      <span className="flex -space-x-1.5" aria-hidden>
        {shown.map((n, i) => <Avatar key={`${n}-${i}`} name={n} className="size-7 text-[10px] ring-2 ring-surface" />)}
        {names.length > max && (
          <span className="inline-flex size-7 items-center justify-center rounded-full bg-inverse text-[10px] font-semibold text-on-inverse ring-2 ring-surface">+{names.length - max}</span>
        )}
      </span>
    </span>
  )
}

/* -------------------------------------------------------------------- card */
/** White rounded surface (18px). The base for everything that sits on the grey page. */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-card border border-line bg-surface shadow-card', className)} {...props} />
}

export function Panel({ title, description, action, children, className, bodyClassName }: {
  title?: ReactNode
  description?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <Card className={className}>
      {(title || action) && (
        <div className="flex items-start justify-between gap-3 px-4 pb-0.5 pt-4 sm:px-5 sm:pt-5">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
            {description && <p className="mt-0.5 text-xs text-ink-muted">{description}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      <div className={cn('p-4 sm:p-5', (title || action) && 'pt-3 sm:pt-3.5', bodyClassName)}>{children}</div>
    </Card>
  )
}

/* ----------------------------------------------------------------- headers */
export function PageHeader({ title, description, actions, breadcrumbs }: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  breadcrumbs?: { label: string; to?: string }[]
}) {
  return (
    <div className="mb-5 space-y-2 md:mb-6">
      {breadcrumbs && <Breadcrumbs items={breadcrumbs} />}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight md:text-[30px]">{title}</h1>
          {description && <p className="mt-1 text-[13px] text-ink-muted md:text-sm">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  )
}

export function Breadcrumbs({ items }: { items: { label: string; to?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-1 text-[13px] text-ink-muted">
        {items.map((item, i) => (
          <li key={i} className="flex items-center gap-1">
            {i > 0 && <Sep className="size-3.5" aria-hidden />}
            {item.to && i < items.length - 1 ? (
              <Link to={item.to} className="rounded hover:text-ink hover:underline">{item.label}</Link>
            ) : (
              <span aria-current={i === items.length - 1 ? 'page' : undefined} className={cn(i === items.length - 1 && 'font-medium text-ink')}>{item.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}

export function StatCard({ label, value, hint, to, icon }: { label: string; value: ReactNode; hint?: ReactNode; to?: string; icon?: ReactNode }) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2 text-[13px] text-ink-muted">
        <span>{label}</span>
        {icon && <span aria-hidden className="[&>svg]:size-4">{icon}</span>}
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums leading-none tracking-tight">{value}</div>
      {hint && <div className="mt-1.5 text-xs text-ink-muted">{hint}</div>}
    </>
  )
  const cls = 'block rounded-card border border-line bg-surface p-4 shadow-card sm:p-5'
  return to ? <Link to={to} className={cn(cls, 'transition-colors hover:border-line-strong hover:bg-sidebar')}>{body}</Link> : <div className={cls}>{body}</div>
}

/* ------------------------------------------------------------------ states */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse rounded-control bg-subtle', className)} />
}

export function Spinner({ className, label = 'Loading' }: { className?: string; label?: string }) {
  return <Loader2 role="status" aria-label={label} className={cn('size-5 animate-spin text-ink-muted', className)} />
}

/** Block-level loading placeholder: a labelled stack of skeleton rows. */
export function LoadingState({ label = 'Loading', rows = 4, className }: { label?: string; rows?: number; className?: string }) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className={cn('space-y-3', className)}>
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className={cn('h-12 w-full', i === 0 && 'h-16')} />)}
      <span className="sr-only">{label}…</span>
    </div>
  )
}

export function EmptyState({ icon, title, description, action, className }: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center rounded-card border border-dashed border-line-strong bg-surface/60 px-5 py-8 text-center', className)}>
      {icon && <div className="mb-2.5 flex size-9 items-center justify-center rounded-full bg-subtle text-ink-muted [&>svg]:size-[18px]" aria-hidden>{icon}</div>}
      <h3 className="text-sm font-semibold">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-ink-muted">{description}</p>}
      {action && <div className="mt-3.5">{action}</div>}
    </div>
  )
}

export function ErrorState({ error, onRetry, title = 'Could not load this' }: { error?: unknown; onRetry?: () => void; title?: string }) {
  const message = error instanceof Error ? error.message : typeof error === 'object' && error && 'message' in error ? String((error as { message: unknown }).message) : undefined
  return (
    <div role="alert" className="flex flex-col items-center rounded-card border border-danger/25 bg-danger-soft px-5 py-8 text-center">
      <AlertCircle className="mb-2 size-6 text-danger" aria-hidden />
      <h3 className="text-sm font-semibold text-danger">{title}</h3>
      {message && <p className="mt-1 max-w-md text-[13px] text-ink-muted">{message}</p>}
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}><RefreshCw className="size-3.5" /> Try again</Button>
      )}
    </div>
  )
}

interface QueryLike {
  isLoading: boolean
  isError: boolean
  error: unknown
  refetch: () => unknown
}

/** One place for the loading / error / empty / populated states every list needs. */
export function DataState({ query, isEmpty, skeleton, empty, children }: {
  query: QueryLike
  isEmpty?: boolean
  skeleton?: ReactNode
  empty?: ReactNode
  children: ReactNode
}) {
  if (query.isLoading) return <>{skeleton ?? <ListSkeleton />}</>
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />
  if (isEmpty) return <>{empty}</>
  return <>{children}</>
}

export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-12 w-full rounded-card" />)}
    </div>
  )
}

const noticeTones = {
  info: { cls: 'border-line bg-subtle text-ink', icon: Info },
  success: { cls: 'border-success/20 bg-success-soft text-success', icon: CheckCircle2 },
  warning: { cls: 'border-warning/25 bg-warning-soft text-warning', icon: AlertTriangle },
  danger: { cls: 'border-danger/25 bg-danger-soft text-danger', icon: AlertCircle },
}

export function Notice({ tone = 'info', title, children, action, className }: { tone?: keyof typeof noticeTones; title?: string; children?: ReactNode; action?: ReactNode; className?: string }) {
  const { cls, icon: Icon } = noticeTones[tone]
  return (
    <div role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'} className={cn('flex gap-3 rounded-2xl border px-4 py-3 text-sm', cls, className)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={cn('text-[13px] leading-relaxed', title && 'mt-0.5', tone === 'info' ? 'text-ink-muted' : 'text-ink/80')}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

/* ------------------------------------------------------------------- table */
/** A white card holding a table whose header is a soft grey pill. */
export function TableWrap({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('relative overflow-x-auto rounded-card border border-line bg-surface p-1.5 shadow-card scrollbar-thin', className)}>
      <table className="w-full min-w-max border-separate border-spacing-0 text-[13px]">{children}</table>
    </div>
  )
}
export const THead = ({ children }: { children: ReactNode }) => <thead className="text-left">{children}</thead>
export const TH = ({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) => (
  <th
    scope="col"
    className={cn('whitespace-nowrap bg-subtle px-3 py-2.5 text-xs font-medium text-ink-muted first:rounded-l-full first:pl-4 last:rounded-r-full', className)}
    {...props}
  />
)
export const TD = ({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) => <td className={cn('px-3 py-3 align-middle first:pl-4', className)} {...props} />
export const TR = ({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) => (
  <tr className={cn('[&>td]:border-b [&>td]:border-line last:[&>td]:border-b-0 hover:bg-sidebar', className)} {...props} />
)

/* -------------------------------------------------------------- pagination */
export function Pagination({ page, total, onPage, pageSize = PAGE_SIZE }: { page: number; total: number; onPage: (p: number) => void; pageSize?: number }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (total <= pageSize) return total > 0 ? <p className="mt-3 text-xs text-ink-muted">{total} {total === 1 ? 'result' : 'results'}</p> : null
  const from = (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)
  return (
    <nav aria-label="Pagination" className="mt-4 flex items-center justify-between gap-3">
      <p className="text-xs text-ink-muted" aria-live="polite">Showing {from}–{to} of {total}</p>
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Previous page"><ChevronLeft className="size-4" /> Prev</Button>
        <span className="text-xs tabular-nums text-ink-muted">Page {page} of {pages}</span>
        <Button variant="secondary" size="sm" onClick={() => onPage(page + 1)} disabled={page >= pages} aria-label="Next page">Next <ChevronRight className="size-4" /></Button>
      </div>
    </nav>
  )
}

/* --------------------------------------------------------------- segmented */
export function Segmented<T extends string>({ value, onChange, options, label }: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: ReactNode; ariaLabel?: string }[]
  label: string
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-full bg-subtle p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          aria-label={o.ariaLabel}
          onClick={() => onChange(o.value)}
          className={cn('inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium transition-colors', value === o.value ? 'bg-brand text-on-brand shadow-card' : 'text-ink-muted hover:text-ink')}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Definition list row used across detail pages. */
export function Detail({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-sm">{children || <span className="text-ink-muted">—</span>}</dd>
    </div>
  )
}
