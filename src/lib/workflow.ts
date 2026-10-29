import type { AccessRole, BookingStatus, ProductionStage } from '@/types/entities'

/**
 * Booking status and production stage are two independent concepts.
 *
 *   booking:    inquiry ⇄ confirmed → cancelled → (reopen) inquiry
 *   production: upcoming → production → editing → ready_for_delivery → delivered
 *
 * Inside "production" the shoot-completed milestone must be reached before
 * editing may start; inside "editing" the editing-completed milestone must be
 * reached before the project can be marked ready. These rules are enforced by
 * public.project_workflow_action(); this module mirrors them so the UI can show
 * only valid actions (and explain why one is unavailable).
 */

export type WorkflowAction =
  | 'start_production'
  | 'complete_shoot'
  | 'start_editing'
  | 'complete_editing'
  | 'mark_ready'
  | 'mark_delivered'
  | 'revert'

export interface WorkflowSubject {
  booking_status: BookingStatus
  production_stage: ProductionStage
  shoot_completed_at: string | null
  editing_completed_at: string | null
  archived_at: string | null
  /** A delivery record with a delivery date exists. */
  hasDeliveryDetails: boolean
}

export const WORKFLOW_LABELS: Record<WorkflowAction, { label: string; done: string }> = {
  start_production: { label: 'Start production', done: 'Production started' },
  complete_shoot: { label: 'Mark shoot completed', done: 'Shoot marked completed' },
  start_editing: { label: 'Move to editing', done: 'Moved into editing' },
  complete_editing: { label: 'Mark editing completed', done: 'Editing marked completed' },
  mark_ready: { label: 'Mark ready for delivery', done: 'Marked ready for delivery' },
  mark_delivered: { label: 'Mark delivered', done: 'Event delivered' },
  revert: { label: 'Step back one stage', done: 'Stage reverted' },
}

const ROLES_FOR: Record<WorkflowAction, AccessRole[]> = {
  start_production: ['owner', 'manager', 'photographer'],
  complete_shoot: ['owner', 'manager', 'photographer'],
  start_editing: ['owner', 'manager'],
  complete_editing: ['owner', 'manager', 'editor'],
  mark_ready: ['owner', 'manager', 'editor'],
  mark_delivered: ['owner', 'manager'],
  revert: ['owner', 'manager'],
}

export type WorkflowCheck = { ok: true } | { ok: false; reason: string }

export function checkWorkflowAction(subject: WorkflowSubject, role: AccessRole, action: WorkflowAction): WorkflowCheck {
  if (!ROLES_FOR[action].includes(role)) return { ok: false, reason: 'Your role cannot perform this step.' }
  if (subject.archived_at) return { ok: false, reason: 'This event is archived.' }
  if (subject.booking_status !== 'confirmed') return { ok: false, reason: 'Confirm the booking before changing production.' }

  const s = subject.production_stage
  switch (action) {
    case 'start_production':
      return s === 'upcoming' ? { ok: true } : { ok: false, reason: 'Production has already started.' }
    case 'complete_shoot':
      if (s !== 'production') return { ok: false, reason: 'Start production first.' }
      return subject.shoot_completed_at ? { ok: false, reason: 'The shoot is already completed.' } : { ok: true }
    case 'start_editing':
      if (s !== 'production') return { ok: false, reason: 'Editing starts after production.' }
      return subject.shoot_completed_at ? { ok: true } : { ok: false, reason: 'Complete the shoot before editing.' }
    case 'complete_editing':
      if (s !== 'editing') return { ok: false, reason: 'Editing is not in progress.' }
      return subject.editing_completed_at ? { ok: false, reason: 'Editing is already completed.' } : { ok: true }
    case 'mark_ready':
      if (s !== 'editing') return { ok: false, reason: 'Editing is not in progress.' }
      return subject.editing_completed_at ? { ok: true } : { ok: false, reason: 'Finish editing first.' }
    case 'mark_delivered':
      if (s !== 'ready_for_delivery') return { ok: false, reason: 'The event is not ready for delivery.' }
      return subject.hasDeliveryDetails ? { ok: true } : { ok: false, reason: 'Record the delivery method and date first.' }
    case 'revert':
      return s === 'upcoming' ? { ok: false, reason: 'Nothing to step back from.' } : { ok: true }
  }
}

/** The one step that naturally comes next, for a prominent button. */
export function nextWorkflowAction(subject: WorkflowSubject): WorkflowAction | null {
  switch (subject.production_stage) {
    case 'upcoming': return 'start_production'
    case 'production': return subject.shoot_completed_at ? 'start_editing' : 'complete_shoot'
    case 'editing': return subject.editing_completed_at ? 'mark_ready' : 'complete_editing'
    case 'ready_for_delivery': return 'mark_delivered'
    case 'delivered': return null
  }
}

export function allowedBookingTransition(from: BookingStatus, to: BookingStatus): boolean {
  if (from === to) return false
  if (from === 'inquiry') return to === 'confirmed' || to === 'cancelled'
  if (from === 'confirmed') return to === 'cancelled' || to === 'inquiry'
  return to === 'inquiry' // cancelled can only be reopened as an inquiry
}

/** Display state combining both axes, e.g. for badges in lists. */
export function projectHealth(p: Pick<WorkflowSubject, 'booking_status' | 'production_stage' | 'archived_at'>): 'archived' | 'cancelled' | 'inquiry' | 'delivered' | 'active' {
  if (p.archived_at) return 'archived'
  if (p.booking_status === 'cancelled') return 'cancelled'
  if (p.booking_status === 'inquiry') return 'inquiry'
  return p.production_stage === 'delivered' ? 'delivered' : 'active'
}
