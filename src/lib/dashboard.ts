import type { ActionItem } from './alerts'
import { countAttentionEvents } from './alerts'
import { PRODUCTION_STAGES, PRODUCTION_STAGE_LABELS, PRODUCTION_STAGE_SHORT_LABELS } from './constants'
import { todayKey, zonedDayKey } from './time'
import type { BookingStatus, ProductionStage, ProjectOverview } from '@/types/entities'

/**
 * Everything the dashboard shows is derived from real rows by the functions below - nothing is
 * hard-coded. They are pure (no React, no network) so they can be tested exhaustively.
 */

export type EventLite = Pick<
  ProjectOverview,
  | 'id' | 'name' | 'project_code' | 'client_name' | 'event_type' | 'booking_status' | 'production_stage' | 'archived_at' | 'next_event_at'
  | 'first_event_at' | 'last_event_at' | 'event_count' | 'assigned_employee_ids' | 'shoot_completed_at' | 'editing_completed_at'
  | 'editing_due_date' | 'delivery_due_date' | 'production_start_applied_at' | 'production_end_applied_at'
>

const DAY = 86_400_000
/** Counts toward the dashboard: in this studio's list, not archived, not cancelled. */
export const isLive = (e: Pick<EventLite, 'archived_at' | 'booking_status'>) => !e.archived_at && e.booking_status !== 'cancelled'

/**
 * The stage an event is really in right now. The server job (advance_event_lifecycle) moves confirmed
 * events on at their scheduled start and end; this applies the same two rules to the row we have, so a
 * late tick - or the job not being scheduled yet - never leaves an event in the wrong bucket. It respects
 * the job's own "already applied" markers, so a manual step back is honoured here exactly as on the server.
 * Inquiries and cancelled events never advance.
 */
export function effectiveStage(e: EventLite, now: Date = new Date()): ProductionStage {
  if (e.booking_status !== 'confirmed' || e.archived_at) return e.production_stage
  const t = now.getTime()
  let stage = e.production_stage
  if (stage === 'upcoming' && !e.production_start_applied_at && e.first_event_at && new Date(e.first_event_at).getTime() <= t) stage = 'production'
  if (stage === 'production' && !e.production_end_applied_at && e.last_event_at && new Date(e.last_event_at).getTime() <= t) stage = 'awaiting_approval'
  return stage
}

/**
 * THE definition of an upcoming event, used by the KPI, the featured card and the pipeline alike:
 * in this studio, not cancelled or archived, and production has not started (so it has not finished either).
 */
export const isUpcoming = (e: EventLite, now: Date = new Date()) => isLive(e) && effectiveStage(e, now) === 'upcoming'

/** Upcoming events, nearest first. Anything whose date has already slipped past (stepped back by hand) goes last. */
export function upcomingEvents(events: EventLite[], now: Date = new Date()): EventLite[] {
  const t = now.getTime()
  const start = (e: EventLite) => (e.first_event_at ? new Date(e.first_event_at).getTime() : Number.MAX_SAFE_INTEGER)
  return events
    .filter((e) => isUpcoming(e, now))
    .sort((a, b) => {
      const aLate = start(a) < t
      const bLate = start(b) < t
      if (aLate !== bLate) return aLate ? 1 : -1
      return start(a) - start(b) || Number(b.booking_status === 'confirmed') - Number(a.booking_status === 'confirmed')
    })
}

/** The event to feature: the nearest upcoming one (confirmed bookings win ties). Null only when there is genuinely none. */
export function pickFeaturedEvent(events: EventLite[], now: Date = new Date()): EventLite | null {
  return upcomingEvents(events, now)[0] ?? null
}

export interface TodaySession {
  starts_at: string
  project: { id: string; booking_status: BookingStatus; archived_at: string | null }
}

/** Events with a session starting today in the studio's time zone, and how many sessions that is. */
export function todaysEvents(sessions: TodaySession[], tz: string, now: Date = new Date()): { events: number; sessions: number } {
  const today = todayKey(tz, now)
  const todays = sessions.filter((s) => isLive(s.project) && zonedDayKey(s.starts_at, tz) === today)
  return { events: new Set(todays.map((s) => s.project.id)).size, sessions: todays.length }
}

export interface EventKpis {
  /** All upcoming events - not limited to the next week. */
  upcoming: number
  /** ...of which start within 7 days. */
  upcomingNext7: number
  /** Events whose current stage is Editing - not Waiting for Client Approval, not Out for Delivery. */
  editing: number
  /** Events at the Out for Delivery stage (the final hand-over step before Delivered). */
  readyForDelivery: number
  needsAttention: number
}

export function computeEventKpis(events: EventLite[], attention: ActionItem[], now: Date = new Date()): EventKpis {
  const t = now.getTime()
  const upcoming = events.filter((e) => isUpcoming(e, now))
  return {
    upcoming: upcoming.length,
    upcomingNext7: upcoming.filter((e) => e.first_event_at && new Date(e.first_event_at).getTime() - t <= 7 * DAY).length,
    editing: events.filter((e) => isLive(e) && e.booking_status === 'confirmed' && effectiveStage(e, now) === 'editing').length,
    readyForDelivery: events.filter((e) => isLive(e) && e.booking_status === 'confirmed' && effectiveStage(e, now) === 'out_for_delivery').length,
    needsAttention: countAttentionEvents(attention),
  }
}

/** Live events per stage - what the pipeline shows, built from the same rows and rules as the KPIs. */
export function pipelineCounts(events: EventLite[], now: Date = new Date()): Record<ProductionStage, number> {
  const counts = Object.fromEntries(PRODUCTION_STAGES.map((s) => [s, 0])) as Record<ProductionStage, number>
  for (const e of events) if (isLive(e)) counts[effectiveStage(e, now)] += 1
  return counts
}

export interface PipelineSegment {
  stage: ProductionStage
  /** Short name for the compact bar. */
  label: string
  /** Full stage name, for tooltips and screen readers. */
  fullLabel: string
  count: number
  /** 0–1 share of all events in the pipeline. */
  share: number
}

export function pipelineSegments(counts: Partial<Record<ProductionStage, number>>): PipelineSegment[] {
  const total = PRODUCTION_STAGES.reduce((sum, s) => sum + Number(counts[s] ?? 0), 0)
  return PRODUCTION_STAGES.map((stage) => {
    const count = Number(counts[stage] ?? 0)
    return { stage, label: PRODUCTION_STAGE_SHORT_LABELS[stage], fullLabel: PRODUCTION_STAGE_LABELS[stage], count, share: total === 0 ? 0 : count / total }
  })
}

/** The segment highlighted by default: the busiest stage that is still open work (not "delivered"). */
export function defaultPipelineStage(segments: PipelineSegment[]): ProductionStage | null {
  const open = segments.filter((s) => s.stage !== 'delivered' && s.count > 0)
  if (open.length === 0) return null
  return open.reduce((best, s) => (s.count > best.count ? s : best)).stage
}

/**
 * Flex weight for a segment so tiny stages stay visible and readable: proportional to the count but
 * never thinner than `floor` of the average segment.
 */
export function segmentWeight(segment: PipelineSegment, segments: PipelineSegment[], floor = 0.45): number {
  const total = segments.reduce((s, x) => s + x.count, 0)
  if (total === 0) return 1
  const average = total / segments.length
  return Math.max(segment.count, average * floor)
}

export interface EventProgress {
  percent: number
  label: string
  basis: 'checklist' | 'stage'
}

/** Progress shown on the featured card: the checklist when there is one, otherwise how far the stage has come. */
export function eventProgress(tasks: { done: number; total: number } | null, stage: ProductionStage): EventProgress {
  if (tasks && tasks.total > 0) {
    return { percent: Math.round((tasks.done / tasks.total) * 100), label: `${tasks.done} of ${tasks.total} tasks done`, basis: 'checklist' }
  }
  const index = PRODUCTION_STAGES.indexOf(stage)
  return { percent: Math.round((index / (PRODUCTION_STAGES.length - 1)) * 100), label: PRODUCTION_STAGE_LABELS[stage], basis: 'stage' }
}

export interface Insight {
  id: string
  tone: 'risk' | 'caution' | 'ok'
  text: string
  count: number
  href: string
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/**
 * Plain-language observations computed from the same data as the table. This is rules over your own
 * records, not machine learning - the UI labels it that way.
 */
export function buildInsights(items: ActionItem[], events: EventLite[], now: Date = new Date()): Insight[] {
  const t = now.getTime()
  const distinct = (pred: (i: ActionItem) => boolean) => new Set(items.filter(pred).map((i) => i.projectId)).size
  const out: Insight[] = []

  const needTeam = distinct((i) => i.kind === 'unstaffed' && !!i.date && new Date(i.date).getTime() - t <= 14 * DAY)
  if (needTeam) out.push({ id: 'team', tone: 'risk', count: needTeam, href: '/calendar?view=list', text: `${needTeam} upcoming ${needTeam === 1 ? 'event needs' : 'events need'} team confirmation` })

  const lateEditing = distinct((i) => i.kind === 'overdue_editing')
  if (lateEditing) out.push({ id: 'editing-late', tone: 'risk', count: lateEditing, href: '/events?stage=editing', text: `${plural(lateEditing, 'editing job is', 'editing jobs are')} overdue` })

  const lateDelivery = distinct((i) => i.kind === 'overdue_delivery')
  if (lateDelivery) out.push({ id: 'delivery-late', tone: 'risk', count: lateDelivery, href: '/events?stage=out_for_delivery', text: `${plural(lateDelivery, 'delivery is', 'deliveries are')} overdue` })

  const latePayments = distinct((i) => i.kind === 'unpaid' && i.severity === 'high')
  if (latePayments) out.push({ id: 'payments-late', tone: 'risk', count: latePayments, href: '/payments', text: `${plural(latePayments, 'payment is', 'payments are')} overdue` })

  const live = events.filter((e) => isLive(e) && e.booking_status === 'confirmed')
  const waiting = live.filter((e) => effectiveStage(e, now) === 'awaiting_approval').length
  if (waiting) out.push({ id: 'approval', tone: 'caution', count: waiting, href: '/events?stage=awaiting_approval', text: `${waiting} ${waiting === 1 ? 'event is' : 'events are'} waiting for client approval` })

  const pendingEditing = live.filter((e) => effectiveStage(e, now) === 'editing').length
  if (pendingEditing) out.push({ id: 'editing', tone: 'caution', count: pendingEditing, href: '/events?stage=editing', text: `${pendingEditing} ${pendingEditing === 1 ? 'event has' : 'events have'} pending editing` })

  const conflicts = items.filter((i) => i.kind === 'team_conflict' || i.kind === 'equipment_conflict').length
  if (conflicts) out.push({ id: 'conflicts', tone: 'caution', count: conflicts, href: '/calendar', text: `${conflicts} scheduling ${conflicts === 1 ? 'conflict needs' : 'conflicts need'} review` })

  if (out.length === 0) out.push({ id: 'clear', tone: 'ok', count: 0, href: '/events', text: 'Nothing is overdue and every upcoming event has a team' })
  return out
}

export function attentionHeadline(items: ActionItem[]): string {
  const n = countAttentionEvents(items)
  return n === 0 ? 'Everything is on track' : `${n} ${n === 1 ? 'event needs' : 'events need'} attention`
}
