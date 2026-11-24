import type { ActivityLog, AppNotification, NotificationType } from '@/types/entities'
import { DEMO_OWNER_ID, DEMO_USER_NAME, newId, now } from './core'
import type { Db } from './db'

export interface ActivityInput {
  projectId: string | null
  entityType: string
  entityId?: string | null
  action: string
  summary: string
  category?: 'general' | 'financial'
  /** Who did it. Defaults to the demo owner; pass null for something the system did on its own. */
  actor?: string | null
  metadata?: Record<string, unknown>
  at?: Date
}

/** Appends to the project's activity timeline (the real system does this from database triggers). */
export function logActivity(db: Db, input: ActivityInput): ActivityLog {
  const row: ActivityLog = {
    id: newId(),
    project_id: input.projectId,
    entity_type: input.entityType,
    action: input.action,
    summary: input.summary,
    category: input.category ?? 'general',
    actor_name: input.actor === undefined ? DEMO_USER_NAME : input.actor,
    metadata: { ...(input.entityId ? { entity_id: input.entityId } : {}), ...input.metadata },
    created_at: (input.at ?? now()).toISOString(),
  }
  db.activity.push(row)
  return row
}

export interface NotifyInput {
  type: NotificationType
  title: string
  body?: string | null
  link?: string | null
  projectId?: string | null
  eventId?: string | null
  recipientId?: string
}

/** Drops a notification into the owner's inbox. */
export function notify(db: Db, input: NotifyInput): AppNotification {
  const row: AppNotification = {
    id: newId(),
    type: input.type,
    title: input.title,
    body: input.body ?? null,
    link: input.link ?? null,
    project_id: input.projectId ?? null,
    event_id: input.eventId ?? null,
    read_at: null,
    created_at: now().toISOString(),
    recipient_employee_id: input.recipientId ?? DEMO_OWNER_ID,
    show_in_app: true,
  }
  db.notifications.push(row)
  return row
}
