import { Search, SlidersHorizontal, X } from 'lucide-react'
import { forwardRef, useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { useDebounced } from '@/hooks/hooks'
import { cn } from '@/lib/utils'

/** Pill-shaped search box that debounces typing and reports the committed value. */
export function SearchInput({ value, onChange, placeholder = 'Search…', label = 'Search', className }: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  label?: string
  className?: string
}) {
  const [local, setLocal] = useState(value)
  const debounced = useDebounced(local, 300)

  useEffect(() => setLocal(value), [value])
  useEffect(() => {
    if (debounced !== value) onChange(debounced)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to the debounced text
  }, [debounced])

  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-faint" aria-hidden />
      <input
        type="search"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="h-10 w-full rounded-full border border-line bg-surface pl-10 pr-9 text-[13px] md:text-sm placeholder:text-ink-faint hover:border-line-strong focus:border-ink [&::-webkit-search-cancel-button]:hidden"
      />
      {local && (
        <button type="button" onClick={() => { setLocal(''); onChange('') }} aria-label="Clear search" className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-ink-muted hover:bg-subtle hover:text-ink">
          <X className="size-3.5" />
        </button>
      )}
    </div>
  )
}

/** Row that holds a search box, filters and view toggles. */
export function FilterBar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mb-4 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center', className)}>{children}</div>
}

/** Round "Filters" button; shows how many filters are active. */
export const FilterButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { active?: number; open?: boolean }>(function FilterButton(
  { active = 0, open, className, children = 'Filters', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-expanded={open}
      className={cn(
        'inline-flex h-10 items-center gap-2 rounded-full border bg-surface px-3.5 text-[13px] font-medium transition-colors hover:bg-sidebar md:text-sm',
        active > 0 || open ? 'border-ink' : 'border-line',
        className,
      )}
      {...props}
    >
      <SlidersHorizontal className="size-4" aria-hidden />
      {children}
      {active > 0 && <span className="flex size-5 items-center justify-center rounded-full bg-accent text-[11px] font-semibold tabular-nums">{active}</span>}
    </button>
  )
})

/** Horizontally scrollable status chips (All / Upcoming / …). The selected chip is lime. */
export function FilterChips<T extends string>({ value, onChange, options, label }: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string; count?: number }[]
  label: string
}) {
  return (
    <div role="group" aria-label={label} className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 scrollbar-thin md:mx-0 md:flex-wrap md:overflow-visible md:px-0">
      {options.map((o) => {
        const selected = value === o.value
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(o.value)}
            className={cn(
              'inline-flex h-9 shrink-0 items-center gap-2 rounded-full px-3.5 text-[13px] font-medium transition-colors',
              selected ? 'bg-accent text-ink' : 'bg-surface text-ink-muted ring-1 ring-line hover:text-ink hover:ring-line-strong',
            )}
          >
            {o.label}
            {o.count !== undefined && (
              <span className={cn('rounded-full px-1.5 text-xs tabular-nums', selected ? 'bg-ink/10' : 'bg-subtle')}>{o.count}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
