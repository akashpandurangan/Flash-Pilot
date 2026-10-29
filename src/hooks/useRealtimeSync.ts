import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'

export type LiveStatus = 'connecting' | 'live' | 'reconnecting'

/**
 * Which cached queries to refresh when a table changes. Only tables the UI actually
 * shows are subscribed, each filtered to the studio; Realtime also applies row
 * level security per subscriber, so crew never receive financial or unrelated rows.
 */
const TABLES: { table: string; keys: string[] }[] = [
  { table: 'projects', keys: ['projects', 'project', 'project-overview', 'schedule', 'dashboard', 'activity', 'financials'] },
  { table: 'project_events', keys: ['project', 'schedule', 'projects', 'dashboard', 'event-reminders'] },
  { table: 'event_assignments', keys: ['project', 'schedule', 'projects', 'dashboard', 'event-reminders'] },
  { table: 'production_tasks', keys: ['project-tasks'] },
  { table: 'project_deliveries', keys: ['project-delivery'] },
  { table: 'payments', keys: ['project-payments', 'project-financials', 'financials', 'payments', 'dashboard'] },
  { table: 'activity_logs', keys: ['project-activity', 'activity'] },
]

/**
 * Keeps open screens in step with the database.
 *  - one channel per studio for shared data, one per person for notifications
 *  - bursts of changes are coalesced into a single refetch
 *  - after any dropped connection, everything is refetched once it recovers so
 *    nothing stale survives
 */
export function useRealtimeSync(studioId: string, employeeId: string): LiveStatus {
  const qc = useQueryClient()
  const [status, setStatus] = useState<LiveStatus>('connecting')
  const seenNotifications = useRef(new Set<string>())

  useEffect(() => {
    let disposed = false
    let hadProblem = false
    const pending = new Set<string>()
    let timer: ReturnType<typeof setTimeout> | undefined

    const flush = () => {
      timer = undefined
      for (const key of pending) void qc.invalidateQueries({ queryKey: [key] })
      pending.clear()
    }
    const schedule = (keys: string[]) => {
      keys.forEach((k) => pending.add(k))
      timer ??= setTimeout(flush, 250)
    }

    const onStatus = (s: string) => {
      if (disposed) return
      if (s === 'SUBSCRIBED') {
        setStatus('live')
        if (hadProblem) {
          hadProblem = false
          void qc.invalidateQueries() // reconcile anything missed while disconnected
        }
      } else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED') {
        hadProblem = true
        setStatus('reconnecting')
      }
    }

    const data = supabase.channel(`studio-data:${studioId}`)
    for (const { table, keys } of TABLES) {
      data.on('postgres_changes', { event: '*', schema: 'public', table, filter: `studio_id=eq.${studioId}` }, () => schedule(keys))
    }
    data.subscribe(onStatus)

    const inbox = supabase.channel(`notifications:${employeeId}`)
    inbox.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'notifications', filter: `recipient_employee_id=eq.${employeeId}` },
      (payload) => {
        schedule(['notifications', 'notification-count'])
        const row = payload.new as { id?: string; title?: string; show_in_app?: boolean } | undefined
        // Realtime can redeliver after a reconnect - show each toast once.
        if (payload.eventType === 'INSERT' && row?.id && row.show_in_app && !seenNotifications.current.has(row.id)) {
          seenNotifications.current.add(row.id)
          toast(row.title ?? 'New notification')
        }
      },
    )
    inbox.subscribe(onStatus)

    return () => {
      disposed = true
      if (timer) clearTimeout(timer)
      void supabase.removeChannel(data)
      void supabase.removeChannel(inbox)
    }
  }, [studioId, employeeId, qc])

  return status
}
