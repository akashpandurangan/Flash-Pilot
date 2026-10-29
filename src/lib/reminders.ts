import type { ReminderStatus } from '@/types/entities'

/**
 * Client-side mirror of sync_event_reminders(): used only to *explain* to the
 * user what the server will do. The server is authoritative - it computes and
 * stores reminders; nothing here sends anything.
 */

export const DEFAULT_REMINDER_LEAD_HOURS = 24

export interface ReminderInput {
  startsAt: string
  bookingStatus: 'inquiry' | 'confirmed' | 'cancelled'
  eventCancelled?: boolean
  archived?: boolean
}

/**
 * When the reminder for an event is due, or null when none will be sent.
 * - only confirmed, non-archived, non-cancelled events remind
 * - normally `lead` hours before the reporting time
 * - an event already inside that window reminds immediately
 * - an event that has already started never reminds
 */
export function reminderDueAt(input: ReminderInput, now: Date = new Date(), leadHours = DEFAULT_REMINDER_LEAD_HOURS): Date | null {
  if (input.bookingStatus !== 'confirmed' || input.eventCancelled || input.archived) return null
  const start = new Date(input.startsAt).getTime()
  if (start <= now.getTime()) return null
  return new Date(Math.max(start - leadHours * 3_600_000, now.getTime()))
}

export function reminderExplanation(input: ReminderInput, now: Date = new Date(), leadHours = DEFAULT_REMINDER_LEAD_HOURS): string {
  if (input.bookingStatus === 'inquiry') return 'No reminders are sent for inquiries. Confirm the booking to schedule them.'
  if (input.bookingStatus === 'cancelled' || input.eventCancelled) return 'This event is cancelled - no reminders will be sent.'
  if (input.archived) return 'This project is archived - no reminders will be sent.'
  const due = reminderDueAt(input, now, leadHours)
  if (!due) return 'This event has already started.'
  return due.getTime() <= now.getTime() + 60_000
    ? 'The event is inside the reminder window, so reminders go out within a few minutes.'
    : `Assigned team members are reminded ${leadHours} hours before the reporting time.`
}

export const REMINDER_STATUS_LABELS: Record<ReminderStatus, string> = {
  scheduled: 'Scheduled',
  sent: 'Sent',
  cancelled: 'Cancelled',
  superseded: 'Superseded (rescheduled)',
  skipped: 'Skipped (preferences)',
  failed: 'Failed',
}
