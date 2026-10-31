import type { ActionItem } from './alerts'
import { countAttentionEvents } from './alerts'
import { PRODUCTION_STAGES, PRODUCTION_STAGE_LABELS } from './constants'
import { formatMoney } from './money'
import { effectiveStage, isLive, isUpcoming } from './lifecycle'
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

// the rules live in lifecycle.ts so the filters and alerts can use them too
export { effectiveStage, isLive, isUpcoming }

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
  label: string
  count: number
  /** 0–1 share of all events in the pipeline. */
  share: number
}

export function pipelineSegments(counts: Partial<Record<ProductionStage, number>>): PipelineSegment[] {
  const total = PRODUCTION_STAGES.reduce((sum, s) => sum + Number(counts[s] ?? 0), 0)
  return PRODUCTION_STAGES.map((stage) => {
    const count = Number(counts[stage] ?? 0)
    return { stage, label: PRODUCTION_STAGE_LABELS[stage], count, share: total === 0 ? 0 : count / total }
  })
}

/** The segment highlighted by default: the busiest stage that is still open work (not "delivered"). */
export function defaultPipelineStage(segments: PipelineSegment[]): ProductionStage | null {
  const open = segments.filter((s) => s.stage !== 'delivered' && s.count > 0)
  if (open.length === 0) return null
  return open.reduce((best, s) => (s.count > best.count ? s : best)).stage
}

/** How full (in %) a stage's bar is: its share of the pipeline, with a visible sliver for any stage that is not empty. */
export function pipelineBarWidth(segment: PipelineSegment): number {
  return segment.count === 0 ? 0 : Math.max(segment.share * 100, 4)
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
export function buildInsights(items: ActionItem[], events: EventLite[], now: Date = new Date(), currency = 'INR'): Insight[] {
  const t = now.getTime()
  const distinct = (pred: (i: ActionItem) => boolean) => new Set(items.filter(pred).map((i) => i.projectId)).size
  const out: Insight[] = []

  const needTeam = distinct((i) => i.kind === 'unstaffed' && !!i.date && new Date(i.date).getTime() - t <= 14 * DAY)
  if (needTeam) out.push({ id: 'team', tone: 'risk', count: needTeam, href: '/calendar?view=list', text: `${needTeam} upcoming ${needTeam === 1 ? 'event needs' : 'events need'} team confirmation` })

  const lateEditing = distinct((i) => i.kind === 'overdue_editing')
  if (lateEditing) out.push({ id: 'editing-late', tone: 'risk', count: lateEditing, href: '/events?stage=editing', text: `${plural(lateEditing, 'editing job is', 'editing jobs are')} overdue` })

  const lateDelivery = distinct((i) => i.kind === 'overdue_delivery')
  if (lateDelivery) out.push({ id: 'delivery-late', tone: 'risk', count: lateDelivery, href: '/events?stage=out_for_delivery', text: `${plural(lateDelivery, 'delivery is', 'deliveries are')} overdue` })

  const paymentItems = items.filter((i) => i.kind === 'delivery_payment')
  const latePayments = new Set(paymentItems.map((i) => i.projectId)).size
  if (latePayments) {
    const owed = formatMoney(paymentItems.reduce((sum, i) => sum + (i.amount ?? 0), 0), currency)
    out.push({ id: 'payments-late', tone: 'risk', count: latePayments, href: '/events?stage=out_for_delivery', text: `${plural(latePayments, 'delivery has', 'deliveries have')} payment pending (${owed} outstanding)` })
  }

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
