import { cva, type VariantProps } from 'class-variance-authority'
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, ChevronRight as Sep, Info, Loader2, RefreshCw } from 'lucide-react'
import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react'
import { Link } from 'react-router'
import { PAGE_SIZE } from '@/lib/constants'
import { cn, initials } from '@/lib/utils'
import { Button } from './button'

/* --------------------------------------------------------------------- badge */
const badge = cva('inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium leading-4', {
  variants: {
    tone: {
      neutral: 'border-line bg-subtle text-ink',
      solid: 'border-ink bg-ink text-white',
      outline: 'border-line-strong bg-canvas text-ink-muted',
      success: 'border-success/20 bg-success-soft text-success',
      warning: 'border-warning/25 bg-warning-soft text-warning',
      danger: 'border-danger/25 bg-danger-soft text-danger',
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
      className={cn('inline-flex size-8 shrink-0 select-none items-center justify-center rounded-full border border-line bg-subtle text-xs font-semibold text-ink', className)}
    >
      {initials(name)}
    </span>
  )
}

/* -------------------------------------------------------------------- card */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-lg border border-line bg-canvas', className)} {...props} />
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
        <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">{title}</h2>
            {description && <p className="mt-0.5 text-xs text-ink-muted">{description}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      <div className={cn('p-4', bodyClassName)}>{children}</div>
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
    <div className="mb-6 space-y-3">
      {breadcrumbs && <Breadcrumbs items={breadcrumbs} />}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight md:text-2xl">{title}</h1>
          {description && <p className="mt-1 text-sm text-ink-muted">{description}</p>}
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
      <div className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
      {hint && <div className="mt-1 text-xs text-ink-muted">{hint}</div>}
    </>
  )
  const cls = 'block rounded-lg border border-line bg-canvas p-4'
  return to ? <Link to={to} className={cn(cls, 'transition-colors hover:border-line-strong hover:bg-sidebar')}>{body}</Link> : <div className={cls}>{body}</div>
}

/* ------------------------------------------------------------------ states */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn('animate-pulse rounded-md bg-subtle', className)}
    />
  )
}

export function Spinner({ className, label = 'Loading' }: { className?: string; label?: string }) {
  return <Loader2 role="status" aria-label={label} className={cn('size-5 animate-spin text-ink-muted', className)} />
}

export function EmptyState({ icon, title, description, action, className }: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center rounded-lg border border-dashed border-line-strong px-6 py-12 text-center', className)}>
      {icon && <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-subtle text-ink-muted [&>svg]:size-5" aria-hidden>{icon}</div>}
      <h3 className="text-sm font-semibold">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-ink-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function ErrorState({ error, onRetry, title = 'Could not load this' }: { error?: unknown; onRetry?: () => void; title?: string }) {
  const message = error instanceof Error ? error.message : typeof error === 'object' && error && 'message' in error ? String((error as { message: unknown }).message) : undefined
  return (
    <div role="alert" className="flex flex-col items-center rounded-lg border border-danger/25 bg-danger-soft px-6 py-10 text-center">
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
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-12 w-full" />)}
    </div>
  )
}

const noticeTones = {
  info: { cls: 'border-line bg-subtle text-ink', icon: Info },
  success: { cls: 'border-success/25 bg-success-soft text-success', icon: CheckCircle2 },
  warning: { cls: 'border-warning/30 bg-warning-soft text-warning', icon: AlertTriangle },
  danger: { cls: 'border-danger/30 bg-danger-soft text-danger', icon: AlertCircle },
}

export function Notice({ tone = 'info', title, children, action, className }: { tone?: keyof typeof noticeTones; title?: string; children?: ReactNode; action?: ReactNode; className?: string }) {
  const { cls, icon: Icon } = noticeTones[tone]
  return (
    <div role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'} className={cn('flex gap-3 rounded-lg border px-3.5 py-3 text-sm', cls, className)}>
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
export function TableWrap({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('relative overflow-x-auto rounded-lg border border-line scrollbar-thin', className)}>
      <table className="w-full min-w-max border-collapse text-sm">{children}</table>
    </div>
  )
}
export const THead = ({ children }: { children: ReactNode }) => <thead className="border-b border-line bg-sidebar text-left">{children}</thead>
export const TH = ({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) => (
  <th scope="col" className={cn('whitespace-nowrap px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-ink-muted', className)} {...props} />
)
export const TD = ({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) => <td className={cn('px-4 py-3 align-middle', className)} {...props} />
export const TR = ({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) => (
  <tr className={cn('border-b border-line last:border-0 hover:bg-sidebar', className)} {...props} />
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
    <div role="group" aria-label={label} className="inline-flex rounded-md border border-line-strong bg-canvas p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          aria-label={o.ariaLabel}
          onClick={() => onChange(o.value)}
          className={cn('inline-flex h-8 items-center gap-1.5 rounded px-3 text-[13px] font-medium transition-colors', value === o.value ? 'bg-ink text-white' : 'text-ink-muted hover:text-ink')}
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
