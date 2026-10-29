import { Search, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useDebounced } from '@/hooks/hooks'
import { cn } from '@/lib/utils'

/** Search box that debounces typing and reports the committed value. */
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
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" aria-hidden />
      <input
        type="search"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="h-10 w-full rounded-md border border-line-strong bg-canvas pl-9 pr-8 text-sm placeholder:text-ink-muted/70 hover:border-ink-muted/60 focus:border-ink md:h-9 [&::-webkit-search-cancel-button]:hidden"
      />
      {local && (
        <button type="button" onClick={() => { setLocal(''); onChange('') }} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-ink-muted hover:text-ink">
          <X className="size-3.5" />
        </button>
      )}
    </div>
  )
}

export function FilterBar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center', className)}>{children}</div>
}
