import { useCallback } from 'react'
import { useSearchParams } from 'react-router'

/**
 * Filter/sort/page state kept in the URL: it survives refresh, can be bookmarked or
 * shared, and the back button behaves. Changing any filter resets to page 1.
 */
export function useUrlState<T extends Record<string, string>>(defaults: T) {
  const [params, setParams] = useSearchParams()

  const state = { ...defaults } as T
  for (const key of Object.keys(defaults)) {
    const v = params.get(key)
    if (v !== null) (state as Record<string, string>)[key] = v
  }

  const set = useCallback(
    (patch: Partial<T>) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          for (const [k, v] of Object.entries(patch)) {
            if (v === undefined || v === '' || v === defaults[k]) next.delete(k)
            else next.set(k, String(v))
          }
          if (!('page' in patch)) next.delete('page')
          return next
        },
        { replace: true },
      )
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- defaults are static per call site
    [setParams],
  )

  return [state, set] as const
}

export const pageNumber = (s: string) => Math.max(1, Number.parseInt(s, 10) || 1)
