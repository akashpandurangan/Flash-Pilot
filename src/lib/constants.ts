import type {
  AccessRole, AssignmentRole, BookingStatus, DeliveryMethod, EquipmentCategory, EquipmentCondition, EventType,
  NotificationType, PaymentMethod, ProductionStage, TaskPhase, TeamRole,
} from '@/types/entities'

type Labels<K extends string> = Record<K, string>
const keys = <K extends string>(l: Labels<K>) => Object.keys(l) as K[]
export const options = <K extends string>(l: Labels<K>) => keys(l).map((value) => ({ value, label: l[value] }))

export const EVENT_TYPE_LABELS: Labels<EventType> = {
  wedding: 'Wedding', engagement: 'Engagement', reception: 'Reception', birthday: 'Birthday',
  maternity: 'Maternity', pre_wedding: 'Pre-wedding', corporate: 'Corporate', other: 'Other',
}

export const BOOKING_STATUS_LABELS: Labels<BookingStatus> = { inquiry: 'Inquiry', confirmed: 'Confirmed', cancelled: 'Cancelled' }

/** The production lifecycle, in order. */
export const PRODUCTION_STAGES: ProductionStage[] = ['upcoming', 'production', 'awaiting_approval', 'editing', 'out_for_delivery', 'delivered']
export const PRODUCTION_STAGE_LABELS: Labels<ProductionStage> = {
  upcoming: 'Upcoming', production: 'Production', awaiting_approval: 'Waiting for Client Approval', editing: 'Editing',
  out_for_delivery: 'Out for Delivery', delivered: 'Delivered',
}

export const ASSIGNMENT_ROLE_LABELS: Labels<AssignmentRole> = {
  lead_photographer: 'Lead photographer', second_photographer: 'Second photographer', videographer: 'Videographer',
  assistant: 'Assistant', editor: 'Editor', other: 'Other',
}

export const TEAM_ROLE_LABELS: Labels<TeamRole> = {
  photographer: 'Photographer', videographer: 'Videographer', editor: 'Editor', assistant: 'Assistant', studio_manager: 'Studio manager',
}

export const ACCESS_ROLE_LABELS: Labels<AccessRole> = {
  owner: 'Studio owner', manager: 'Studio manager', photographer: 'Photographer / crew', editor: 'Editor',
}

export const ACCESS_ROLE_DESCRIPTIONS: Labels<AccessRole> = {
  owner: 'Full access to the studio, team, payments and settings.',
  manager: 'Runs bookings, scheduling and workflow. Financial access is a separate permission.',
  photographer: 'Sees only the sessions they are assigned to. No clients or payments.',
  editor: 'Sees only their editing jobs and delivery details. No payments.',
}

/** Sensible default sign-in access level for a team role. */
export const DEFAULT_ACCESS_FOR_TEAM_ROLE: Record<TeamRole, AccessRole> = {
  photographer: 'photographer', videographer: 'photographer', assistant: 'photographer', editor: 'editor', studio_manager: 'manager',
}

/** Sensible default event role for a team role. */
export const DEFAULT_ASSIGNMENT_FOR_TEAM_ROLE: Record<TeamRole, AssignmentRole> = {
  photographer: 'lead_photographer', videographer: 'videographer', editor: 'editor', assistant: 'assistant', studio_manager: 'other',
}

export const EQUIPMENT_CATEGORY_LABELS: Labels<EquipmentCategory> = {
  still_camera: 'Still camera', video_camera: 'Video camera', lens: 'Lens', tripod: 'Tripod', gimbal: 'Gimbal',
  lighting: 'Lighting', flash: 'Flash', drone: 'Drone', microphone: 'Microphone', other: 'Other',
}

export const EQUIPMENT_CONDITION_LABELS: Labels<EquipmentCondition> = {
  excellent: 'Excellent', good: 'Good', fair: 'Fair', needs_repair: 'Needs repair', out_of_service: 'Out of service',
}

export const PAYMENT_METHOD_LABELS: Labels<PaymentMethod> = { cash: 'Cash', upi: 'UPI', bank_transfer: 'Bank transfer', other: 'Other' }

export const TASK_PHASE_LABELS: Labels<TaskPhase> = {
  preparation: 'Preparation', shoot: 'Shoot', post: 'Post-shoot', editing: 'Editing', delivery: 'Delivery',
}

export const DELIVERY_METHOD_LABELS: Labels<DeliveryMethod> = {
  download_link: 'Download link', online_gallery: 'Online gallery', physical_drive: 'Physical drive',
  printed_album: 'Printed album', in_person: 'In person', other: 'Other',
}

export const NOTIFICATION_TYPE_LABELS: Labels<NotificationType> = {
  event_reminder: 'Session reminder', new_assignment: 'New assignment', assignment_changed: 'Assignment changed',
  event_rescheduled: 'Session updated', event_cancelled: 'Session cancelled', production_deadline: 'Deadline approaching',
  editing_overdue: 'Editing overdue', delivery_overdue: 'Delivery overdue', payment_due: 'Payment due',
}

export const COMMON_TIMEZONES = [
  'Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Asia/Dhaka', 'Asia/Kathmandu', 'Asia/Colombo', 'Europe/London',
  'Europe/Paris', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Australia/Sydney', 'UTC',
]

export const COMMON_CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'AUD']

/** Roles that count as "photographers" for staffing warnings. */
export const PHOTOGRAPHER_ROLES: AssignmentRole[] = ['lead_photographer', 'second_photographer']

export const PAGE_SIZE = 20
