import { describe, expect, it } from 'vitest'
import type { ActionItem } from './alerts'
import { attentionHeadline, buildInsights, computeEventKpis, defaultPipelineStage, eventProgress, pickFeaturedEvent, pipelineSegments, segmentWeight, type EventLite } from './dashboard'

const NOW = new Date('2030-06-01T08:00:00Z')
const at = (days: number) => new Date(NOW.getTime() + days * 86_400_000).toISOString()

function ev(id: string, over: Partial<EventLite> = {}): EventLite {
  return {
    id, name: `Event ${id}`, project_code: `FP-${id}`, client_name: 'Client', event_type: 'wedding', booking_status: 'confirmed', production_stage: 'upcoming',
    archived_at: null, next_event_at: at(10), first_event_at: at(10), last_event_at: at(11), event_count: 1, assigned_employee_ids: [],
    shoot_completed_at: null, editing_completed_at: null, editing_due_date: null, delivery_due_date: null, ...over,
  }
}

function item(kind: ActionItem['kind'], projectId: string, over: Partial<ActionItem> = {}): ActionItem {
  return {
    id: `${kind}:${projectId}`, kind, severity: 'medium', title: kind, detail: '', href: `/events/${projectId}`, projectId, projectName: projectId, clientName: null,
    date: at(3), issue: kind, actionLabel: 'Open', ...over,
  }
}

describe('featured event', () => {
  it('is the event whose next session comes soonest', () => {
    const picked = pickFeaturedEvent([ev('far', { next_event_at: at(30) }), ev('soon', { next_event_at: at(2) }), ev('mid', { next_event_at: at(9) })], NOW)
    expect(picked?.id).toBe('soon')
  })

  it('ignores cancelled and archived events and sessions in the past', () => {
    const picked = pickFeaturedEvent([
      ev('cancelled', { next_event_at: at(1), booking_status: 'cancelled' }),
      ev('archived', { next_event_at: at(1), archived_at: at(-1) }),
      ev('past', { next_event_at: at(-3) }),
      ev('ok', { next_event_at: at(5) }),
    ], NOW)
    expect(picked?.id).toBe('ok')
  })

  it('prefers a confirmed booking when two start together', () => {
    const picked = pickFeaturedEvent([ev('inq', { booking_status: 'inquiry', next_event_at: at(4) }), ev('conf', { next_event_at: at(4) })], NOW)
    expect(picked?.id).toBe('conf')
  })

  it('falls back to work still in progress, and to nothing for an empty studio', () => {
    const picked = pickFeaturedEvent([
      ev('editing', { next_event_at: null, production_stage: 'editing', last_event_at: at(-5) }),
      ev('delivered', { next_event_at: null, production_stage: 'delivered', last_event_at: at(-2) }),
    ], NOW)
    expect(picked?.id).toBe('editing')
    expect(pickFeaturedEvent([], NOW)).toBeNull()
  })
})

describe('dashboard numbers', () => {
  const events = [
    ev('a', { next_event_at: at(2) }),
    ev('b', { next_event_at: at(20) }),
    ev('c', { production_stage: 'production', next_event_at: null }),
    ev('d', { production_stage: 'production', next_event_at: null, shoot_completed_at: at(-1) }),
    ev('e', { production_stage: 'editing', next_event_at: null }),
    ev('f', { booking_status: 'inquiry', next_event_at: at(1) }),
    ev('g', { booking_status: 'cancelled', next_event_at: at(1) }),
    ev('h', { production_stage: 'delivered', next_event_at: null }),
  ]

  it('counts only confirmed, live events', () => {
    const k = computeEventKpis(events, [item('unstaffed', 'a'), item('unpaid', 'a'), item('overdue_editing', 'e')], NOW)
    expect(k).toEqual({ upcoming: 2, upcomingNext7: 1, inProduction: 2, editing: 1, awaitingEditing: 1, needsAttention: 2 })
  })

  it('is all zeros for an empty studio', () => {
    expect(computeEventKpis([], [], NOW)).toEqual({ upcoming: 0, upcomingNext7: 0, inProduction: 0, editing: 0, awaitingEditing: 0, needsAttention: 0 })
  })
})

describe('pipeline', () => {
  const segments = pipelineSegments({ upcoming: 32, production: 47, editing: 18, ready_for_delivery: 19, delivered: 12 })

  it('lists the five stages in order with shares that add up', () => {
    expect(segments.map((s) => s.label)).toEqual(['Upcoming', 'Production', 'Editing', 'Ready for delivery', 'Delivered'])
    expect(segments.reduce((sum, s) => sum + s.share, 0)).toBeCloseTo(1)
    expect(segments[1]!.share).toBeCloseTo(47 / 128)
  })

  it('highlights the busiest open stage by default, never "delivered"', () => {
    expect(defaultPipelineStage(segments)).toBe('production')
    expect(defaultPipelineStage(pipelineSegments({ delivered: 9 }))).toBeNull()
    expect(defaultPipelineStage(pipelineSegments({}))).toBeNull()
  })

  it('keeps empty and tiny stages visible', () => {
    const s = pipelineSegments({ upcoming: 50, production: 0, editing: 1 })
    expect(segmentWeight(s[1]!, s)).toBeGreaterThan(0)
    expect(segmentWeight(s[0]!, s)).toBeGreaterThan(segmentWeight(s[2]!, s))
    expect(segmentWeight(pipelineSegments({})[0]!, pipelineSegments({}))).toBe(1)
  })
})

describe('event progress', () => {
  it('uses the checklist when there is one', () => {
    expect(eventProgress({ done: 7, total: 10 }, 'editing')).toEqual({ percent: 70, label: '7 of 10 tasks done', basis: 'checklist' })
  })

  it('falls back to how far the production stage has come', () => {
    expect(eventProgress(null, 'upcoming').percent).toBe(0)
    expect(eventProgress({ done: 0, total: 0 }, 'editing')).toMatchObject({ percent: 50, basis: 'stage' })
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
    const events = [ev('x', { production_stage: 'editing' }), ev('y', { production_stage: 'production', shoot_completed_at: at(-1) })]
    const texts = buildInsights(items, events, NOW).map((i) => i.text)
    expect(texts).toContain('3 upcoming events need team confirmation')
    expect(texts).toContain('1 delivery is overdue')
    expect(texts).toContain('1 payment is overdue')
    expect(texts).toContain('2 events have pending editing')
    expect(texts).toContain('1 scheduling conflict needs review')
  })

  it('only asks for team confirmation for events happening within two weeks', () => {
    const texts = buildInsights([item('unstaffed', 'a', { date: at(30) })], [], NOW).map((i) => i.text)
    expect(texts.some((t) => t.includes('team confirmation'))).toBe(false)
  })

  it('puts the urgent items first and says so when all is well', () => {
    const tones = buildInsights([item('overdue_delivery', 'a')], [ev('x', { production_stage: 'editing' })], NOW).map((i) => i.tone)
    expect(tones).toEqual(['risk', 'caution'])
    expect(buildInsights([], [], NOW)).toEqual([{ id: 'clear', tone: 'ok', count: 0, href: '/events', text: 'Nothing is overdue and every upcoming event has a team' }])
  })

  it('summarises how many events are flagged', () => {
    expect(attentionHeadline([])).toBe('Everything is on track')
    expect(attentionHeadline([item('unstaffed', 'a')])).toBe('1 event needs attention')
    expect(attentionHeadline([item('unstaffed', 'a'), item('unpaid', 'a'), item('unstaffed', 'b')])).toBe('2 events need attention')
  })
})
