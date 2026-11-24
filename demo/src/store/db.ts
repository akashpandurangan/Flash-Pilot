import type {
  ActivityLog, AppNotification, Client, Employee, Equipment, EventAssignment, EventEquipment, EventReminder, NotificationDelivery,
  NotificationPreferences, Payment, ProductionTask, Profile, Project, ProjectDelivery, ProjectEvent, ProjectFinance, Studio,
} from '@/types/entities'
import { buildSeed } from './seed'

/**
 * The demo's whole "database": plain arrays held in memory. Rows have the same shape as the real tables, so the screens
 * cannot tell the difference. Nothing here is persisted - a refresh (or "Reset demo") rebuilds it from the seed.
 */
export interface Db {
  studio: Studio
  profile: Profile
  employees: Employee[]
  clients: Client[]
  projects: Project[]
  finances: ProjectFinance[]
  events: ProjectEvent[]
  assignments: EventAssignment[]
  equipment: Equipment[]
  eventEquipment: EventEquipment[]
  payments: Payment[]
  tasks: ProductionTask[]
  deliveries: ProjectDelivery[]
  activity: ActivityLog[]
  notifications: AppNotification[]
  emailDeliveries: NotificationDelivery[]
  reminders: EventReminder[]
  prefs: NotificationPreferences
  /** Last number used for a project code (FP-0001, FP-0002 ...). */
  projectSeq: number
}

let current: Db | null = null

export function getDb(): Db {
  current ??= buildSeed()
  return current
}

/** Throws away every change and rebuilds the sample data. */
export function resetDb(): void {
  current = buildSeed()
}

/** For tests: replace the whole database. */
export function setDb(next: Db): void {
  current = next
}
