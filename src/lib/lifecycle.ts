import type { ProductionStage, ProjectOverview } from '@/types/entities'

/**
 * Where an event is in its lifecycle right now, and whether it counts. Shared by the dashboard numbers, the
 * pipeline, the Events panel filters and the payment alerts, so they can never disagree. Pure: no React, no network.
 */

export type LifecycleSubject = Pick<ProjectOverview, 'booking_status' | 'production_stage' | 'archived_at'>
  & Partial<Pick<ProjectOverview, 'first_event_at' | 'last_event_at' | 'production_start_applied_at' | 'production_end_applied_at'>>

/** Counts toward the lifecycle: in this studio's list, not archived, not cancelled. */
export const isLive = (e: Pick<ProjectOverview, 'archived_at' | 'booking_status'>) => !e.archived_at && e.booking_status !== 'cancelled'

/**
 * The stage an event is really in right now. The server job (advance_event_lifecycle) moves confirmed
 * events on at their scheduled start and end; this applies the same two rules to the row we have, so a
 * late tick - or the job not being scheduled yet - never leaves an event in the wrong bucket. It respects
 * the job's own "already applied" markers, so a manual step back is honoured here exactly as on the server.
 * Inquiries and cancelled events never advance.
 */
export function effectiveStage(e: LifecycleSubject, now: Date = new Date()): ProductionStage {
  if (e.booking_status !== 'confirmed' || e.archived_at) return e.production_stage
  const t = now.getTime()
  let stage = e.production_stage
  if (stage === 'upcoming' && !e.production_start_applied_at && e.first_event_at && new Date(e.first_event_at).getTime() <= t) stage = 'production'
  if (stage === 'production' && !e.production_end_applied_at && e.last_event_at && new Date(e.last_event_at).getTime() <= t) stage = 'awaiting_approval'
  return stage
}

/**
 * THE definition of an upcoming event, used by the KPI, the pipeline and the Events panel alike:
 * in this studio, not cancelled or archived, and production has not started (so it has not finished either).
 */
export const isUpcoming = (e: LifecycleSubject, now: Date = new Date()) => isLive(e) && effectiveStage(e, now) === 'upcoming'
