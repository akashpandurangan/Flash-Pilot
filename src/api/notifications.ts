import { supabase } from '@/lib/supabase'
import type { AppNotification, NotificationDelivery, NotificationPreferences } from '@/types/entities'
import { unwrap } from './core'

export async function listNotifications(employeeId: string, opts: { unreadOnly?: boolean; limit?: number } = {}): Promise<AppNotification[]> {
  let q = supabase
    .from('notifications')
    .select('*')
    .eq('recipient_employee_id', employeeId)
    .eq('show_in_app', true)
    .order('created_at', { ascending: false })
    .limit(opts.limit ?? 100)
  if (opts.unreadOnly) q = q.is('read_at', null)
  return unwrap(await q) as AppNotification[]
}

export async function countUnread(employeeId: string): Promise<number> {
  const res = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('recipient_employee_id', employeeId)
    .eq('show_in_app', true)
    .is('read_at', null)
  if (res.error) throw res.error
  return res.count ?? 0
}

export async function markRead(ids: string[]) {
  if (ids.length) unwrap(await supabase.rpc('mark_notifications_read', { p_ids: ids }))
}

export async function markAllRead(studioId: string) {
  unwrap(await supabase.rpc('mark_all_notifications_read', { p_studio: studioId }))
}

export const DEFAULT_PREFERENCES: NotificationPreferences = {
  in_app_enabled: true, email_enabled: true, cat_reminders: true, cat_assignments: true, cat_schedule: true, cat_production: true, cat_payments: true,
}

export async function getPreferences(userId: string, studioId: string): Promise<NotificationPreferences> {
  const row = unwrap(
    await supabase.from('notification_preferences').select('*').eq('user_id', userId).eq('studio_id', studioId).maybeSingle(),
  ) as NotificationPreferences | null
  return row ? { ...DEFAULT_PREFERENCES, ...row } : DEFAULT_PREFERENCES
}

export async function savePreferences(userId: string, studioId: string, prefs: NotificationPreferences) {
  unwrap(await supabase.from('notification_preferences').upsert({ user_id: userId, studio_id: studioId, ...prefs }, { onConflict: 'user_id,studio_id' }))
}

/** Owner-only: recent e-mail delivery outcomes, including failures and skipped sends. */
export async function listDeliveries(studioId: string, limit = 50): Promise<NotificationDelivery[]> {
  return unwrap(
    await supabase
      .from('notification_deliveries')
      .select('*, notification:notifications(title, type)')
      .eq('studio_id', studioId)
      .order('created_at', { ascending: false })
      .limit(limit),
  ) as NotificationDelivery[]
}
