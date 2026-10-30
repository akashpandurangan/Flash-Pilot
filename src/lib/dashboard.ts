import type { ActionItem } from './alerts'
import { countAttentionEvents } from './alerts'
import { PRODUCTION_STAGES, PRODUCTION_STAGE_LABELS } from './constants'
import type { ProductionStage, ProjectOverview } from '@/types/entities'

/**
 * Everything the dashboard shows is derived from real rows by the functions below - nothing is
 * hard-coded. They are pure (no React, no network) so they can be tested exhaustively.
 */

export type EventLite = Pick<
  ProjectOverview,
  | 'id' | 'name' | 'project_code' | 'client_name' | 'event_type' | 'booking_status' | 'production_stage' | 'archived_at' | 'next_event_at'
  | 'first_event_at' | 'last_event_at' | 'event_count' | 'assigned_employee_ids' | 'shoot_completed_at' | 'editing_completed_at'
  | 'editing_due_date' | 'delivery_due_date'
>

const DAY = 86_400_000
const live = (e: EventLite) => !e.archived_at && e.booking_status !== 'cancelled'

/**
 * The event to feature: the one whose next session comes soonest (confirmed bookings win ties).
 * With nothing upcoming it falls back to the most recently scheduled event that is still in production.
 */
export function pickFeaturedEvent(events: EventLite[], now: Date = new Date()): EventLite | null {
  const t = now.getTime()
  const upcoming = events
    .filter((e) => live(e) && e.next_event_at && new Date(e.next_event_at).getTime() >= t)
    .sort((a, b) =>
      new Date(a.next_event_at!).getTime() - new Date(b.next_event_at!).getTime() ||
      Number(b.booking_status === 'confirmed') - Number(a.booking_status === 'confirmed'))
  if (upcoming[0]) return upcoming[0]

  const inFlight = events
    .filter((e) => live(e) && e.booking_status === 'confirmed' && e.production_stage !== 'delivered' && e.production_stage !== 'upcoming')
    .sort((a, b) => new Date(b.last_event_at ?? 0).getTime() - new Date(a.last_event_at ?? 0).getTime())
  return inFlight[0] ?? null
}

export interface EventKpis {
  /** Confirmed events with a session still to come. */
  upcoming: number
  /** ...of which the next session is within 7 days. */
  upcomingNext7: number
  inProduction: number
  editing: number
  /** Shoot finished, editing not started yet. */
  awaitingEditing: number
  needsAttention: number
}

export function computeEventKpis(events: EventLite[], attention: ActionItem[], now: Date = new Date()): EventKpis {
  const t = now.getTime()
  const confirmed = events.filter((e) => live(e) && e.booking_status === 'confirmed')
  const upcoming = confirmed.filter((e) => e.next_event_at && new Date(e.next_event_at).getTime() >= t)
  return {
    upcoming: upcoming.length,
    upcomingNext7: upcoming.filter((e) => new Date(e.next_event_at!).getTime() - t <= 7 * DAY).length,
    inProduction: confirmed.filter((e) => e.production_stage === 'production').length,
    editing: confirmed.filter((e) => e.production_stage === 'editing').length,
    awaitingEditing: confirmed.filter((e) => e.production_stage === 'production' && !!e.shoot_completed_at).length,
    needsAttention: countAttentionEvents(attention),
  }
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
  if (lateDelivery) out.push({ id: 'delivery-late', tone: 'risk', count: lateDelivery, href: '/events?stage=ready_for_delivery', text: `${plural(lateDelivery, 'delivery is', 'deliveries are')} overdue` })

  const latePayments = distinct((i) => i.kind === 'unpaid' && i.severity === 'high')
  if (latePayments) out.push({ id: 'payments-late', tone: 'risk', count: latePayments, href: '/payments', text: `${plural(latePayments, 'payment is', 'payments are')} overdue` })

  const pendingEditing = events.filter((e) => live(e) && e.booking_status === 'confirmed' && (e.production_stage === 'editing' || (e.production_stage === 'production' && !!e.shoot_completed_at))).length
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
