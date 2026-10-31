import { describe, expect, it } from 'vitest'
import type { ActionItem } from './alerts'
import {
  attentionHeadline, buildInsights, computeEventKpis, defaultPipelineStage, effectiveStage, eventProgress, isUpcoming, pickFeaturedEvent,
  pipelineCounts, pipelineSegments, segmentWeight, todaysEvents, upcomingEvents, type EventLite,
} from './dashboard'

const NOW = new Date('2030-06-01T08:00:00Z')
const at = (days: number) => new Date(NOW.getTime() + days * 86_400_000).toISOString()

/** An event whose single session starts `start` days from NOW and lasts a day. */
function ev(id: string, over: Partial<EventLite> & { start?: number } = {}): EventLite {
  const { start = 10, ...rest } = over
  return {
    id, name: `Event ${id}`, project_code: `FP-${id}`, client_name: 'Client', event_type: 'wedding', booking_status: 'confirmed', production_stage: 'upcoming',
    archived_at: null, next_event_at: at(start), first_event_at: at(start), last_event_at: at(start + 1), event_count: 1, assigned_employee_ids: [],
    shoot_completed_at: null, editing_completed_at: null, editing_due_date: null, delivery_due_date: null,
    production_start_applied_at: null, production_end_applied_at: null, ...rest,
  }
}

function item(kind: ActionItem['kind'], projectId: string, over: Partial<ActionItem> = {}): ActionItem {
  return {
    id: `${kind}:${projectId}`, kind, severity: 'medium', title: kind, detail: '', href: `/events/${projectId}`, projectId, projectName: projectId, clientName: null,
    date: at(3), issue: kind, actionLabel: 'Open', ...over,
  }
}

describe('what an event is really doing right now', () => {
  it('stays upcoming before its first session and moves on at the scheduled times, like the server job', () => {
    expect(effectiveStage(ev('a', { start: 2 }), NOW)).toBe('upcoming')
    expect(effectiveStage(ev('b', { start: -0.5 }), NOW)).toBe('production') // started, still shooting
    expect(effectiveStage(ev('c', { start: -3 }), NOW)).toBe('awaiting_approval') // all sessions are over
  })

  it('never moves inquiries, cancelled or archived events, and never past the approval gate', () => {
    expect(effectiveStage(ev('i', { booking_status: 'inquiry', start: -3 }), NOW)).toBe('upcoming')
    expect(effectiveStage(ev('x', { booking_status: 'cancelled', start: -3 }), NOW)).toBe('upcoming')
    expect(effectiveStage(ev('z', { archived_at: at(-1), start: -3 }), NOW)).toBe('upcoming')
    expect(effectiveStage(ev('w', { production_stage: 'awaiting_approval', start: -300 }), NOW)).toBe('awaiting_approval')
    expect(effectiveStage(ev('e', { production_stage: 'editing', start: -300 }), NOW)).toBe('editing')
  })

  it('respects a manual step back, exactly as the server job does', () => {
    // stepped back to upcoming after the start was applied: the job will not redo it, so neither do we
    expect(effectiveStage(ev('r', { start: -3, production_start_applied_at: at(-2) }), NOW)).toBe('upcoming')
    expect(effectiveStage(ev('p', { production_stage: 'production', start: -3, production_start_applied_at: at(-3), production_end_applied_at: at(-2) }), NOW)).toBe('production')
  })
})

describe('upcoming events - one definition for every widget', () => {
  const events = [
    ev('soon', { start: 2 }),
    ev('later', { start: 20 }),
    ev('inquiry', { booking_status: 'inquiry', start: 4 }),
    ev('cancelled', { booking_status: 'cancelled', start: 1 }),
    ev('archived', { archived_at: at(-1), start: 1 }),
    ev('shooting', { start: -0.5 }),
    ev('shot', { start: -4 }),
    ev('editing', { production_stage: 'editing', start: -10 }),
    ev('delivered', { production_stage: 'delivered', start: -30 }),
  ]

  it('is: not cancelled, not archived, and production has not started', () => {
    expect(events.filter((e) => isUpcoming(e, NOW)).map((e) => e.id).sort()).toEqual(['inquiry', 'later', 'soon'])
  })

  it('shows the same count in the KPI, the pipeline and the featured card', () => {
    const k = computeEventKpis(events, [], NOW)
    const counts = pipelineCounts(events, NOW)
    expect(k.upcoming).toBe(3)
    expect(counts.upcoming).toBe(k.upcoming)
    expect(upcomingEvents(events, NOW)).toHaveLength(k.upcoming)
    expect(pickFeaturedEvent(events, NOW)?.id).toBe('soon')
  })

  it('counts the whole future, and reports the next 7 days separately', () => {
    const k = computeEventKpis(events, [], NOW)
    expect(k.upcoming).toBe(3) // "later" is 20 days away but still counts
    expect(k.upcomingNext7).toBe(2) // soon + inquiry
  })

  it('never contradicts itself: featured exists exactly when the count is above zero', () => {
    const sets: EventLite[][] = [
      [],
      [ev('only', { start: 3 })],
      [ev('past', { start: -5 })], // confirmed, "upcoming" in the database, but long over: the original bug
      [ev('inq', { booking_status: 'inquiry', start: -5 })],
      events,
    ]
    for (const set of sets) {
      const n = computeEventKpis(set, [], NOW).upcoming
      expect(pipelineCounts(set, NOW).upcoming, 'pipeline').toBe(n)
      expect(pickFeaturedEvent(set, NOW) !== null, 'featured').toBe(n > 0)
    }
  })

  it('an event left as "upcoming" in the database after it ended is no longer upcoming - it is waiting for approval', () => {
    const stale = [ev('stale', { start: -5 })]
    expect(computeEventKpis(stale, [], NOW).upcoming).toBe(0)
    expect(pipelineCounts(stale, NOW)).toMatchObject({ upcoming: 0, awaiting_approval: 1 })
    expect(pickFeaturedEvent(stale, NOW)).toBeNull()
  })

  it('features the nearest event, with confirmed bookings winning ties', () => {
    expect(pickFeaturedEvent([ev('far', { start: 30 }), ev('soon', { start: 2 }), ev('mid', { start: 9 })], NOW)?.id).toBe('soon')
    expect(pickFeaturedEvent([ev('inq', { booking_status: 'inquiry', start: 4 }), ev('conf', { start: 4 })], NOW)?.id).toBe('conf')
    expect(pickFeaturedEvent([], NOW)).toBeNull()
  })

  it('puts an event whose date slipped into the past (stepped back by hand) after genuinely future ones', () => {
    const slipped = ev('slipped', { start: -3, production_start_applied_at: at(-2) })
    expect(isUpcoming(slipped, NOW)).toBe(true)
    expect(pickFeaturedEvent([slipped, ev('real', { start: 6 })], NOW)?.id).toBe('real')
  })
})

describe('dashboard numbers', () => {
  it('counts events out for delivery for "Ready for delivery", and distinct events needing attention', () => {
    const events = [
      ev('a', { production_stage: 'out_for_delivery', start: -20 }),
      ev('b', { production_stage: 'out_for_delivery', start: -20 }),
      ev('c', { production_stage: 'out_for_delivery', start: -20, booking_status: 'cancelled' }),
      ev('d', { production_stage: 'delivered', start: -20 }),
      ev('e', { production_stage: 'editing', start: -20 }),
    ]
    const k = computeEventKpis(events, [item('unstaffed', 'a'), item('unpaid', 'a'), item('overdue_editing', 'e')], NOW)
    expect(k.readyForDelivery).toBe(2)
    expect(k.needsAttention).toBe(2)
  })

  it('counts Editing in progress by the current stage only: not waiting for approval, not out for delivery, not cancelled', () => {
    const events = [
      ev('e1', { production_stage: 'editing', start: -20 }),
      ev('e2', { production_stage: 'editing', start: -20 }),
      ev('wait', { production_stage: 'awaiting_approval', start: -20 }),
      ev('out', { production_stage: 'out_for_delivery', start: -20 }),
      ev('done', { production_stage: 'delivered', start: -20 }),
      ev('shot', { start: -4 }), // stored as upcoming but over: waiting for approval, not editing
      ev('prod', { production_stage: 'production', start: -0.5 }),
      ev('cancelled', { production_stage: 'editing', start: -20, booking_status: 'cancelled' }),
      ev('archived', { production_stage: 'editing', start: -20, archived_at: at(-1) }),
    ]
    const k = computeEventKpis(events, [], NOW)
    expect(k.editing).toBe(2)
    expect(k.readyForDelivery).toBe(1)
    expect(pipelineCounts(events, NOW)).toMatchObject({ editing: 2, out_for_delivery: 1, awaiting_approval: 2 }) // the pipeline agrees with the card
  })

  it('is all zeros for an empty studio', () => {
    expect(computeEventKpis([], [], NOW)).toEqual({ upcoming: 0, upcomingNext7: 0, editing: 0, readyForDelivery: 0, needsAttention: 0 })
    expect(pipelineCounts([], NOW)).toEqual({ upcoming: 0, production: 0, awaiting_approval: 0, editing: 0, out_for_delivery: 0, delivered: 0 })
  })

  it('leaves cancelled and archived events out of the pipeline, and includes inquiries', () => {
    const counts = pipelineCounts([
      ev('a', { start: 3 }), ev('b', { booking_status: 'inquiry', start: 3 }), ev('c', { booking_status: 'cancelled' }), ev('d', { archived_at: at(-1) }),
      ev('e', { production_stage: 'delivered', start: -40 }),
    ], NOW)
    expect(counts).toMatchObject({ upcoming: 2, delivered: 1 })
  })
})

describe("today's events", () => {
  const TZ = 'Asia/Kolkata' // UTC+5:30 - NOW is 13:30 on 1 June there
  const session = (id: string, startsAt: string, over: Partial<{ booking_status: 'confirmed' | 'cancelled'; archived_at: string | null }> = {}) => ({
    starts_at: startsAt, project: { id, booking_status: 'confirmed' as const, archived_at: null, ...over },
  })

  it('counts events with a session starting today in the studio time zone, not the browser zone', () => {
    const sessions = [
      session('a', '2030-06-01T03:30:00Z'), // 09:00 today, already begun
      session('a', '2030-06-01T12:00:00Z'), // second session, same event
      session('b', '2030-06-01T18:00:00Z'), // 23:30 today in Kolkata
      session('c', '2030-06-01T19:00:00Z'), // 00:30 TOMORROW in Kolkata
      session('d', '2030-05-31T17:00:00Z'), // 22:30 yesterday in Kolkata
    ]
    expect(todaysEvents(sessions, TZ, NOW)).toEqual({ events: 2, sessions: 3 })
  })

  it('ignores cancelled and archived events, and is zero on a quiet day', () => {
    expect(todaysEvents([session('a', '2030-06-01T05:00:00Z', { booking_status: 'cancelled' }), session('b', '2030-06-01T05:00:00Z', { archived_at: at(-1) })], TZ, NOW)).toEqual({ events: 0, sessions: 0 })
    expect(todaysEvents([], TZ, NOW)).toEqual({ events: 0, sessions: 0 })
  })
})

describe('pipeline', () => {
  const segments = pipelineSegments({ upcoming: 32, production: 47, awaiting_approval: 6, editing: 18, out_for_delivery: 19, delivered: 12 })

  it('lists the six stages in lifecycle order with shares that add up', () => {
    expect(segments.map((s) => s.fullLabel)).toEqual(['Upcoming', 'Production', 'Waiting for Client Approval', 'Editing', 'Out for Delivery', 'Delivered'])
    expect(segments.map((s) => s.label)).toContain('Client approval') // the compact name used in the bar
    expect(segments.reduce((sum, s) => sum + s.share, 0)).toBeCloseTo(1)
    expect(segments[1]!.share).toBeCloseTo(47 / 134)
  })

  it('highlights the busiest open stage by default, never "delivered"', () => {
    expect(defaultPipelineStage(segments)).toBe('production')
    expect(defaultPipelineStage(pipelineSegments({ delivered: 9 }))).toBeNull()
    expect(defaultPipelineStage(pipelineSegments({}))).toBeNull()
  })

  it('keeps empty and tiny stages visible', () => {
    const s = pipelineSegments({ upcoming: 50, production: 0, editing: 1 })
    expect(segmentWeight(s[1]!, s)).toBeGreaterThan(0)
    expect(segmentWeight(s[0]!, s)).toBeGreaterThan(segmentWeight(s[3]!, s))
    expect(segmentWeight(pipelineSegments({})[0]!, pipelineSegments({}))).toBe(1)
  })
})

describe('event progress', () => {
  it('uses the checklist when there is one', () => {
    expect(eventProgress({ done: 7, total: 10 }, 'editing')).toEqual({ percent: 70, label: '7 of 10 tasks done', basis: 'checklist' })
  })

  it('falls back to how far the production stage has come', () => {
    expect(eventProgress(null, 'upcoming').percent).toBe(0)
    expect(eventProgress({ done: 0, total: 0 }, 'editing')).toMatchObject({ percent: 60, basis: 'stage' })
    expect(eventProgress(null, 'delivered').percent).toBe(100)
  })
})

describe('studio insights', () => {
  it('turns open issues into plain sentences with correct plurals', () => {
    const items = [
      item('unstaffed', 'a'), item('unstaffed', 'b'), item('unstaffed', 'c'),
      item('overdue_delivery', 'd'), item('unpaid', 'e', { severity: 'high' }), item('unpaid', 'f', { severity: 'low' }),
      item('team_conflict', 'a'),
    ]
    const events = [
      ev('x', { production_stage: 'editing', start: -20 }), ev('y', { production_stage: 'editing', start: -20 }),
      ev('w', { production_stage: 'awaiting_approval', start: -20 }),
    ]
    const texts = buildInsights(items, events, NOW).map((i) => i.text)
    expect(texts).toContain('3 upcoming events need team confirmation')
    expect(texts).toContain('1 delivery is overdue')
    expect(texts).toContain('1 payment is overdue')
    expect(texts).toContain('2 events have pending editing')
    expect(texts).toContain('1 event is waiting for client approval')
    expect(texts).toContain('1 scheduling conflict needs review')
  })

  it('only asks for team confirmation for events happening within two weeks', () => {
    const texts = buildInsights([item('unstaffed', 'a', { date: at(30) })], [], NOW).map((i) => i.text)
    expect(texts.some((t) => t.includes('team confirmation'))).toBe(false)
  })

  it('puts the urgent items first and says so when all is well', () => {
    const tones = buildInsights([item('overdue_delivery', 'a')], [ev('x', { production_stage: 'editing', start: -20 })], NOW).map((i) => i.tone)
    expect(tones).toEqual(['risk', 'caution'])
    expect(buildInsights([], [], NOW)).toEqual([{ id: 'clear', tone: 'ok', count: 0, href: '/events', text: 'Nothing is overdue and every upcoming event has a team' }])
  })

  it('summarises how many events are flagged', () => {
    expect(attentionHeadline([])).toBe('Everything is on track')
    expect(attentionHeadline([item('unstaffed', 'a')])).toBe('1 event needs attention')
    expect(attentionHeadline([item('unstaffed', 'a'), item('unpaid', 'a'), item('unpaid', 'b')])).toBe('2 events need attention')
  })
})
