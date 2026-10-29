import { describe, expect, it } from 'vitest'
import { allowedBookingTransition, checkWorkflowAction, nextWorkflowAction, projectHealth, type WorkflowSubject } from './workflow'

const base: WorkflowSubject = {
  booking_status: 'confirmed', production_stage: 'upcoming', shoot_completed_at: null, editing_completed_at: null,
  archived_at: null, hasDeliveryDetails: false,
}
const at = (over: Partial<WorkflowSubject>): WorkflowSubject => ({ ...base, ...over })

describe('production workflow', () => {
  it('follows upcoming → production → editing → ready → delivered', () => {
    expect(nextWorkflowAction(base)).toBe('start_production')
    expect(nextWorkflowAction(at({ production_stage: 'production' }))).toBe('complete_shoot')
    expect(nextWorkflowAction(at({ production_stage: 'production', shoot_completed_at: 'x' }))).toBe('start_editing')
    expect(nextWorkflowAction(at({ production_stage: 'editing' }))).toBe('complete_editing')
    expect(nextWorkflowAction(at({ production_stage: 'editing', editing_completed_at: 'x' }))).toBe('mark_ready')
    expect(nextWorkflowAction(at({ production_stage: 'ready_for_delivery' }))).toBe('mark_delivered')
    expect(nextWorkflowAction(at({ production_stage: 'delivered' }))).toBeNull()
  })

  it('requires milestones before moving on', () => {
    expect(checkWorkflowAction(at({ production_stage: 'production' }), 'owner', 'start_editing')).toMatchObject({ ok: false })
    expect(checkWorkflowAction(at({ production_stage: 'production', shoot_completed_at: 'x' }), 'owner', 'start_editing')).toEqual({ ok: true })
    expect(checkWorkflowAction(at({ production_stage: 'editing' }), 'editor', 'mark_ready')).toMatchObject({ ok: false })
    expect(checkWorkflowAction(at({ production_stage: 'editing', editing_completed_at: 'x' }), 'editor', 'mark_ready')).toEqual({ ok: true })
  })

  it('needs delivery details before marking delivered', () => {
    const s = at({ production_stage: 'ready_for_delivery' })
    expect(checkWorkflowAction(s, 'owner', 'mark_delivered')).toMatchObject({ ok: false })
    expect(checkWorkflowAction({ ...s, hasDeliveryDetails: true }, 'owner', 'mark_delivered')).toEqual({ ok: true })
  })

  it('assigns steps to the right roles', () => {
    expect(checkWorkflowAction(base, 'photographer', 'start_production')).toEqual({ ok: true })
    expect(checkWorkflowAction(at({ production_stage: 'production', shoot_completed_at: 'x' }), 'photographer', 'start_editing')).toMatchObject({ ok: false })
    expect(checkWorkflowAction(at({ production_stage: 'editing' }), 'editor', 'complete_editing')).toEqual({ ok: true })
    expect(checkWorkflowAction(at({ production_stage: 'ready_for_delivery', hasDeliveryDetails: true }), 'editor', 'mark_delivered')).toMatchObject({ ok: false })
    expect(checkWorkflowAction(at({ production_stage: 'editing' }), 'editor', 'revert')).toMatchObject({ ok: false })
  })

  it('blocks production changes unless the booking is confirmed and the project is not archived', () => {
    expect(checkWorkflowAction(at({ booking_status: 'inquiry' }), 'owner', 'start_production')).toMatchObject({ ok: false })
    expect(checkWorkflowAction(at({ booking_status: 'cancelled' }), 'owner', 'start_production')).toMatchObject({ ok: false })
    expect(checkWorkflowAction(at({ archived_at: 'x' }), 'owner', 'start_production')).toMatchObject({ ok: false })
  })

  it('does not allow stepping back from the first stage', () => {
    expect(checkWorkflowAction(base, 'owner', 'revert')).toMatchObject({ ok: false })
    expect(checkWorkflowAction(at({ production_stage: 'delivered' }), 'owner', 'revert')).toEqual({ ok: true })
  })
})

describe('booking status', () => {
  it('allows only sensible transitions', () => {
    expect(allowedBookingTransition('inquiry', 'confirmed')).toBe(true)
    expect(allowedBookingTransition('confirmed', 'cancelled')).toBe(true)
    expect(allowedBookingTransition('cancelled', 'inquiry')).toBe(true)
    expect(allowedBookingTransition('cancelled', 'confirmed')).toBe(false)
    expect(allowedBookingTransition('confirmed', 'confirmed')).toBe(false)
  })

  it('summarises project health across both axes', () => {
    expect(projectHealth({ booking_status: 'confirmed', production_stage: 'editing', archived_at: null })).toBe('active')
    expect(projectHealth({ booking_status: 'confirmed', production_stage: 'delivered', archived_at: null })).toBe('delivered')
    expect(projectHealth({ booking_status: 'cancelled', production_stage: 'upcoming', archived_at: null })).toBe('cancelled')
    expect(projectHealth({ booking_status: 'confirmed', production_stage: 'upcoming', archived_at: 'x' })).toBe('archived')
  })
})
