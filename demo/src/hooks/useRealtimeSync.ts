import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { onDataChange } from '../store/access'

export type LiveStatus = 'connecting' | 'live' | 'reconnecting'

/**
 * Demo replacement for src/hooks/useRealtimeSync.ts. There is no realtime channel; instead the local data layer announces
 * every change and this hook refreshes the open screens, which is what the real hook does when the database changes.
 * The connection is always "live", so the "updates paused" banner never appears.
 */
export function useRealtimeSync(_studioId: string, _employeeId: string): LiveStatus {
  const qc = useQueryClient()
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = onDataChange(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'membership' }), 120)
    })
    return () => {
      off()
      if (timer) clearTimeout(timer)
    }
  }, [qc])
  return 'live'
}
