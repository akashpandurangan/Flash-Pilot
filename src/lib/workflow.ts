import type { AccessRole, BookingStatus, ProductionStage } from '@/types/entities'

/**
 * Booking status and production stage are two independent concepts.
 *
 *   booking:    inquiry ⇄ confirmed → cancelled → (reopen) inquiry
 *   production: upcoming → production → awaiting_approval → editing → out_for_delivery → delivered
 *
 * The first two hand-overs are normally automatic (advance_event_lifecycle() starts production at
 * the first session's start and ends it at the last session's end); a person can still do either by
 * hand. Client approval is never assumed: the event waits in `awaiting_approval` until someone
 * records it. These rules are enforced by public.project_workflow_action(); this module mirrors them
 * so the UI can show only valid actions (and explain why one is unavailable).
 */

export type WorkflowAction =
  | 'start_production'
  | 'complete_shoot'
  | 'approve_client'
  | 'complete_editing'
  | 'mark_out_for_delivery'
  | 'mark_delivered'
  | 'revert'

export interface WorkflowSubject {
  booking_status: BookingStatus
  production_stage: ProductionStage
  editing_completed_at: string | null
  archived_at: string | null
}

export const WORKFLOW_LABELS: Record<WorkflowAction, { label: string; done: string }> = {
  start_production: { label: 'Start production now', done: 'Production started' },
  complete_shoot: { label: 'End production now', done: 'Production completed - waiting for client approval' },
  approve_client: { label: 'Record client approval', done: 'Client approval recorded - editing started' },
  complete_editing: { label: 'Mark editing completed', done: 'Editing marked completed' },
  mark_out_for_delivery: { label: 'Mark out for delivery', done: 'Marked out for delivery' },
  mark_delivered: { label: 'Mark delivered', done: 'Event delivered' },
  revert: { label: 'Step back one stage', done: 'Stage reverted' },
}

const ROLES_FOR: Record<WorkflowAction, AccessRole[]> = {
  start_production: ['owner', 'manager', 'photographer'],
  complete_shoot: ['owner', 'manager', 'photographer'],
  approve_client: ['owner', 'manager'],
  complete_editing: ['owner', 'manager', 'editor'],
  mark_out_for_delivery: ['owner', 'manager', 'editor'],
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
      return s === 'production' ? { ok: true } : { ok: false, reason: s === 'upcoming' ? 'Production has not started yet.' : 'Production is already complete.' }
    case 'approve_client':
      return s === 'awaiting_approval' ? { ok: true } : { ok: false, reason: 'The event is not waiting for client approval.' }
    case 'complete_editing':
      if (s !== 'editing') return { ok: false, reason: 'Editing is not in progress.' }
      return subject.editing_completed_at ? { ok: false, reason: 'Editing is already completed.' } : { ok: true }
    case 'mark_out_for_delivery':
      if (s !== 'editing') return { ok: false, reason: 'Editing is not in progress.' }
      return subject.editing_completed_at ? { ok: true } : { ok: false, reason: 'Finish editing first.' }
    case 'mark_delivered':
      return s === 'out_for_delivery' ? { ok: true } : { ok: false, reason: 'The event is not out for delivery.' }
    case 'revert':
      return s === 'upcoming' ? { ok: false, reason: 'Nothing to step back from.' } : { ok: true }
  }
}

/**
 * The one step that naturally comes next, for a prominent button. Production start/end are automatic,
 * so for those two it is the manual "do it now" override - the page labels it that way.
 */
export function nextWorkflowAction(subject: WorkflowSubject): WorkflowAction | null {
  switch (subject.production_stage) {
    case 'upcoming': return 'start_production'
    case 'production': return 'complete_shoot'
    case 'awaiting_approval': return 'approve_client'
    case 'editing': return subject.editing_completed_at ? 'mark_out_for_delivery' : 'complete_editing'
    case 'out_for_delivery': return 'mark_delivered'
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
