import type { AppNotification, NotificationDelivery, NotificationPreferences } from '@/types/entities'
import { read, write } from '../store/access'
import { newestFirst } from '../store/views'

const inbox = (rows: AppNotification[], employeeId: string) => rows.filter((n) => n.recipient_employee_id === employeeId && n.show_in_app)

export async function listNotifications(employeeId: string, opts: { unreadOnly?: boolean; limit?: number } = {}): Promise<AppNotification[]> {
  return read((db) => {
    const rows = inbox(db.notifications, employeeId).filter((n) => !opts.unreadOnly || n.read_at === null)
    return newestFirst(rows).slice(0, opts.limit ?? 100)
  })
}

export async function countUnread(employeeId: string): Promise<number> {
  return read((db) => inbox(db.notifications, employeeId).filter((n) => n.read_at === null).length)
}

export async function markRead(ids: string[]) {
  if (ids.length === 0) return
  await write((db, at) => {
    const set = new Set(ids)
    for (const n of db.notifications) if (set.has(n.id) && n.read_at === null) n.read_at = at.toISOString()
  })
}

export async function markAllRead(_studioId: string) {
  await write((db, at) => {
    for (const n of db.notifications) if (n.read_at === null) n.read_at = at.toISOString()
  })
}

export const DEFAULT_PREFERENCES: NotificationPreferences = {
  in_app_enabled: true, email_enabled: true, cat_reminders: true, cat_assignments: true, cat_schedule: true, cat_production: true, cat_payments: true,
}

export async function getPreferences(_userId: string, _studioId: string): Promise<NotificationPreferences> {
  return read((db) => ({ ...DEFAULT_PREFERENCES, ...db.prefs }))
}

export async function savePreferences(_userId: string, _studioId: string, prefs: NotificationPreferences) {
  await write((db) => { db.prefs = { ...prefs } })
}

/** Owner-only: recent e-mail delivery outcomes (sample data in the demo; nothing is ever sent). */
export async function listDeliveries(_studioId: string, limit = 50): Promise<NotificationDelivery[]> {
  return read((db) =>
    newestFirst(db.emailDeliveries).slice(0, limit).map((d) => {
      const n = db.notifications.find((x) => x.id === d.notification_id)
      return { ...d, notification: n ? { title: n.title, type: n.type } : null }
    }),
  )
}
