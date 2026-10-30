// Typed mirrors of the database entities (see supabase/migrations). Numeric
// columns arrive from PostgREST as JSON numbers; timestamps as ISO strings.

export type AccessRole = 'owner' | 'manager' | 'photographer' | 'editor'
export type TeamRole = 'photographer' | 'videographer' | 'editor' | 'assistant' | 'studio_manager'
export type InviteStatus = 'none' | 'pending' | 'accepted'
export type EventType = 'wedding' | 'engagement' | 'reception' | 'birthday' | 'maternity' | 'pre_wedding' | 'corporate' | 'other'
export type BookingStatus = 'inquiry' | 'confirmed' | 'cancelled'
export type ProductionStage = 'upcoming' | 'production' | 'awaiting_approval' | 'editing' | 'out_for_delivery' | 'delivered'
export type AssignmentRole = 'lead_photographer' | 'second_photographer' | 'videographer' | 'assistant' | 'editor' | 'other'
export type EquipmentCategory = 'still_camera' | 'video_camera' | 'lens' | 'tripod' | 'gimbal' | 'lighting' | 'flash' | 'drone' | 'microphone' | 'other'
export type EquipmentCondition = 'excellent' | 'good' | 'fair' | 'needs_repair' | 'out_of_service'
export type PaymentMethod = 'cash' | 'upi' | 'bank_transfer' | 'other'
export type PaymentStatus = 'valid' | 'void'
export type TaskPhase = 'preparation' | 'shoot' | 'post' | 'editing' | 'delivery'
export type DeliveryMethod = 'download_link' | 'online_gallery' | 'physical_drive' | 'printed_album' | 'in_person' | 'other'
export type NotificationType =
  | 'event_reminder' | 'new_assignment' | 'assignment_changed' | 'event_rescheduled' | 'event_cancelled'
  | 'production_deadline' | 'editing_overdue' | 'delivery_overdue' | 'payment_due'
export type DeliveryStatus = 'pending' | 'processing' | 'sent' | 'failed' | 'skipped'
export type ReminderStatus = 'scheduled' | 'sent' | 'cancelled' | 'superseded' | 'skipped' | 'failed'

export interface ChecklistTemplateItem {
  title: string
  phase: TaskPhase
}

export interface Studio {
  id: string
  name: string
  logo_path: string | null
  email: string | null
  phone: string | null
  address: string | null
  city: string | null
  state: string | null
  timezone: string
  currency: string
  onboarding_step: number
  onboarding_completed_at: string | null
  reminder_lead_hours: number
  default_checklist: ChecklistTemplateItem[]
  created_at: string
}

export interface Profile {
  id: string
  full_name: string
  email: string | null
  phone: string | null
}

export interface Employee {
  id: string
  studio_id: string
  user_id: string | null
  full_name: string
  email: string | null
  phone: string | null
  job_title: string | null
  team_role: TeamRole
  access_role: AccessRole | null
  can_view_financials: boolean
  invite_status: InviteStatus
  invited_at: string | null
  notes: string | null
  is_active: boolean
  created_at: string
}

export interface Client {
  id: string
  studio_id: string
  full_name: string
  phone: string | null
  email: string | null
  address: string | null
  notes: string | null
  archived_at: string | null
  created_at: string
}

export interface Project {
  id: string
  studio_id: string
  project_code: string
  client_id: string
  name: string
  event_type: EventType
  description: string | null
  internal_notes: string | null
  booking_status: BookingStatus
  production_stage: ProductionStage
  editor_id: string | null
  editing_due_date: string | null
  delivery_due_date: string | null
  confirmed_at: string | null
  cancelled_at: string | null
  cancel_reason: string | null
  production_started_at: string | null
  shoot_completed_at: string | null
  editing_started_at: string | null
  editing_completed_at: string | null
  /** When the event went out for delivery (the column keeps its old name). */
  ready_for_delivery_at: string | null
  delivered_at: string | null
  client_approved_at: string | null
  client_approved_by_name: string | null
  client_approval_note: string | null
  /** Set once the scheduler (or a person) has made the production start / end transition; see advance_event_lifecycle(). */
  production_start_applied_at: string | null
  production_end_applied_at: string | null
  archived_at: string | null
  created_at: string
  updated_at: string
}

/** Row of the `project_overview` view: project + role-appropriate client fields. */
export interface ProjectOverview extends Project {
  client_name: string
  client_phone: string | null
  client_email: string | null
  first_event_at: string | null
  next_event_at: string | null
  last_event_at: string | null
  event_count: number
  assigned_employee_ids: string[]
}

export interface ProjectFinance {
  project_id: string
  agreed_amount: number
  payment_due_date: string | null
  payment_notes: string | null
}

/** Row of the `project_financials` view. balance < 0 means client credit. */
export interface ProjectFinancials {
  project_id: string
  studio_id: string
  agreed_amount: number
  payment_due_date: string | null
  paid_amount: number
  balance: number
}

export interface EmployeeBrief {
  id: string
  full_name: string
  team_role: TeamRole
  is_active: boolean
  phone?: string | null
}

export interface EventAssignment {
  id: string
  event_id: string
  employee_id: string
  role: AssignmentRole
  notes: string | null
  employee?: EmployeeBrief | null
}

export interface Equipment {
  id: string
  studio_id: string
  name: string
  category: EquipmentCategory
  brand_model: string | null
  asset_tag: string | null
  quantity_owned: number
  condition: EquipmentCondition
  notes: string | null
  is_active: boolean
  created_at: string
}

export interface EventEquipment {
  id: string
  event_id: string
  equipment_id: string | null
  custom_name: string | null
  quantity: number
  notes: string | null
  equipment?: Pick<Equipment, 'id' | 'name' | 'category' | 'asset_tag' | 'quantity_owned' | 'is_active' | 'condition'> | null
}

export interface ProjectEvent {
  id: string
  studio_id: string
  project_id: string
  title: string
  event_type: EventType
  starts_at: string
  ends_at: string
  venue_name: string | null
  venue_address: string | null
  map_url: string | null
  notes: string | null
  sort_order: number
  cancelled_at: string | null
  event_assignments?: EventAssignment[]
  event_equipment?: EventEquipment[]
}

/** Event joined with its project, used by the calendar, dashboard and conflict checks. */
export interface ScheduleEvent extends ProjectEvent {
  project: Pick<Project, 'id' | 'name' | 'project_code' | 'booking_status' | 'production_stage' | 'archived_at'> & {
    client_name?: string | null
  }
}

export interface Payment {
  id: string
  project_id: string
  amount: number
  paid_on: string
  method: PaymentMethod
  reference: string | null
  notes: string | null
  is_advance: boolean
  status: PaymentStatus
  voided_at: string | null
  void_reason: string | null
  recorded_by_name: string | null
  created_at: string
}

export interface ProductionTask {
  id: string
  project_id: string
  title: string
  phase: TaskPhase
  sort_order: number
  assignee_id: string | null
  is_done: boolean
  done_at: string | null
  done_by_name: string | null
}

export interface ProjectDelivery {
  project_id: string
  method: DeliveryMethod
  delivered_on: string | null
  link_url: string | null
  notes: string | null
  confirmed_at: string | null
}

export interface ActivityLog {
  id: string
  project_id: string | null
  entity_type: string
  action: string
  summary: string
  category: 'general' | 'financial'
  actor_name: string | null
  metadata: Record<string, unknown>
  created_at: string
}

export interface AppNotification {
  id: string
  type: NotificationType
  title: string
  body: string | null
  link: string | null
  project_id: string | null
  event_id: string | null
  read_at: string | null
  created_at: string
  recipient_employee_id: string
  show_in_app: boolean
}

export interface NotificationPreferences {
  in_app_enabled: boolean
  email_enabled: boolean
  cat_reminders: boolean
  cat_assignments: boolean
  cat_schedule: boolean
  cat_production: boolean
  cat_payments: boolean
}

export interface NotificationDelivery {
  id: string
  notification_id: string
  channel: 'email'
  to_address: string
  status: DeliveryStatus
  attempts: number
  max_attempts: number
  last_error: string | null
  sent_at: string | null
  created_at: string
  notification?: { title: string; type: NotificationType } | null
}

export interface EventReminder {
  id: string
  event_id: string
  employee_id: string
  role: AssignmentRole
  event_starts_at: string
  remind_at: string
  status: ReminderStatus
  last_error: string | null
}

export interface DashboardKpis {
  active_projects: number
  inquiries: number
  upcoming_events: number
  upcoming_next_7_days: number
  today_events: number
  in_production: number
  ready_for_delivery: number
  pending_delivery: number
  outstanding_amount: number | null
  stage_counts: Partial<Record<ProductionStage, number>>
}

export interface Page<T> {
  rows: T[]
  total: number
}
