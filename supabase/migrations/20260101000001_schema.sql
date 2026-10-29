-- =============================================================================
-- Flash Pilot - core schema
-- Studio-scoped relational model. Every business table carries studio_id, and
-- child tables reference their parent through a composite (id, studio_id) key
-- so a row can never point at another studio's data.
-- =============================================================================

-- ---------------------------------------------------------------- enum types
create type public.access_role as enum ('owner', 'manager', 'photographer', 'editor');
create type public.team_role as enum ('photographer', 'videographer', 'editor', 'assistant', 'studio_manager');
create type public.invite_status as enum ('none', 'pending', 'accepted');
create type public.event_type as enum ('wedding', 'engagement', 'reception', 'birthday', 'maternity', 'pre_wedding', 'corporate', 'other');
create type public.booking_status as enum ('inquiry', 'confirmed', 'cancelled');
create type public.production_stage as enum ('upcoming', 'production', 'editing', 'ready_for_delivery', 'delivered');
create type public.assignment_role as enum ('lead_photographer', 'second_photographer', 'videographer', 'assistant', 'editor', 'other');
create type public.equipment_category as enum ('still_camera', 'video_camera', 'lens', 'tripod', 'gimbal', 'lighting', 'flash', 'drone', 'microphone', 'other');
create type public.equipment_condition as enum ('excellent', 'good', 'fair', 'needs_repair', 'out_of_service');
create type public.payment_method as enum ('cash', 'upi', 'bank_transfer', 'other');
create type public.payment_status as enum ('valid', 'void');
create type public.task_phase as enum ('preparation', 'shoot', 'post', 'editing', 'delivery');
create type public.delivery_method as enum ('download_link', 'online_gallery', 'physical_drive', 'printed_album', 'in_person', 'other');
create type public.notification_type as enum (
  'event_reminder', 'new_assignment', 'assignment_changed', 'event_rescheduled', 'event_cancelled',
  'production_deadline', 'editing_overdue', 'delivery_overdue', 'payment_due'
);
create type public.delivery_status as enum ('pending', 'processing', 'sent', 'failed', 'skipped');
create type public.reminder_status as enum ('scheduled', 'sent', 'cancelled', 'superseded', 'skipped', 'failed');

-- --------------------------------------------------------- generic utilities
create function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- True when running outside a direct end-user API call (security-definer RPCs,
-- the service role, migrations). Used by guard triggers.
create function public.is_privileged_context() returns boolean
language sql stable as $$
  select current_user not in ('anon', 'authenticated')
$$;

-- ------------------------------------------------------------------- studios
create table public.studios (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  logo_path text,
  email text,
  phone text,
  address text,
  city text,
  state text,
  timezone text not null default 'Asia/Kolkata',
  currency char(3) not null default 'INR',
  onboarding_step smallint not null default 1 check (onboarding_step between 1 and 4),
  onboarding_completed_at timestamptz,
  project_seq integer not null default 0,
  reminder_lead_hours integer not null default 24 check (reminder_lead_hours between 1 and 168),
  default_checklist jsonb not null default '[
    {"title": "Team confirmed", "phase": "preparation"},
    {"title": "Equipment prepared", "phase": "preparation"},
    {"title": "Shoot completed", "phase": "shoot"},
    {"title": "Photos backed up", "phase": "shoot"},
    {"title": "Photo selection completed", "phase": "post"},
    {"title": "Editing completed", "phase": "editing"},
    {"title": "Client review completed", "phase": "delivery"},
    {"title": "Final files exported", "phase": "editing"},
    {"title": "Album printing completed", "phase": "delivery"},
    {"title": "Delivery completed", "phase": "delivery"}
  ]'::jsonb,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create function public.validate_studio() returns trigger
language plpgsql as $$
begin
  begin
    perform now() at time zone new.timezone;
  exception when others then
    raise exception 'invalid_timezone: %', new.timezone using errcode = '22023';
  end;
  new.currency := upper(new.currency);
  if jsonb_typeof(new.default_checklist) <> 'array' then
    raise exception 'default_checklist must be a JSON array' using errcode = '22023';
  end if;
  return new;
end $$;

create trigger studios_validate before insert or update on public.studios
  for each row execute function public.validate_studio();
create trigger studios_updated_at before update on public.studios
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------ profiles
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  email text,
  phone text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''), new.email)
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- employees
-- An employee is a person who works for the studio. Having a sign-in account
-- is optional: user_id is NULL until an invitation has been issued.
create table public.employees (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  full_name text not null check (char_length(btrim(full_name)) between 1 and 120),
  email text,
  phone text,
  job_title text,
  team_role public.team_role not null default 'photographer',
  access_role public.access_role,
  can_view_financials boolean not null default false,
  invite_status public.invite_status not null default 'none',
  invited_at timestamptz,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, studio_id),
  unique (studio_id, user_id),
  check (user_id is null or access_role is not null)
);
create unique index employees_studio_email_key on public.employees (studio_id, lower(email)) where email is not null;
create index employees_user_idx on public.employees (user_id) where user_id is not null;
create trigger employees_updated_at before update on public.employees
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------- clients
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios (id) on delete cascade,
  full_name text not null check (char_length(btrim(full_name)) between 1 and 120),
  phone text,
  phone_digits text generated always as (nullif(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), '')) stored,
  email text,
  address text,
  notes text,
  archived_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, studio_id)
);
create index clients_studio_idx on public.clients (studio_id, archived_at);
create index clients_name_idx on public.clients (studio_id, lower(full_name));
create index clients_phone_idx on public.clients (studio_id, phone_digits) where phone_digits is not null;
create index clients_email_idx on public.clients (studio_id, lower(email)) where email is not null;
create trigger clients_updated_at before update on public.clients
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------ projects
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios (id) on delete cascade,
  project_code text not null,
  client_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  event_type public.event_type not null default 'wedding',
  description text,
  internal_notes text,
  booking_status public.booking_status not null default 'inquiry',
  production_stage public.production_stage not null default 'upcoming',
  editor_id uuid,
  editing_due_date date,
  delivery_due_date date,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  production_started_at timestamptz,
  shoot_completed_at timestamptz,
  editing_started_at timestamptz,
  editing_completed_at timestamptz,
  ready_for_delivery_at timestamptz,
  delivered_at timestamptz,
  archived_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, studio_id),
  unique (studio_id, project_code),
  foreign key (client_id, studio_id) references public.clients (id, studio_id) on delete restrict,
  foreign key (editor_id, studio_id) references public.employees (id, studio_id) on delete restrict,
  check (production_stage = 'upcoming' or booking_status <> 'inquiry')
);
create index projects_studio_status_idx on public.projects (studio_id, booking_status, production_stage);
create index projects_client_idx on public.projects (client_id);
create index projects_editor_idx on public.projects (editor_id) where editor_id is not null;
create index projects_archived_idx on public.projects (studio_id, archived_at);
create trigger projects_updated_at before update on public.projects
  for each row execute function public.set_updated_at();

-- Money lives in its own table so it can carry stricter row-level security than
-- the operational project record.
create table public.project_finance (
  project_id uuid primary key,
  studio_id uuid not null,
  agreed_amount numeric(12, 2) not null default 0 check (agreed_amount >= 0),
  payment_due_date date,
  payment_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (project_id, studio_id) references public.projects (id, studio_id) on delete cascade
);
create trigger project_finance_updated_at before update on public.project_finance
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------ project events
create table public.project_events (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null,
  project_id uuid not null,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  event_type public.event_type not null default 'wedding',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  venue_name text,
  venue_address text,
  map_url text,
  notes text,
  sort_order integer not null default 0,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, studio_id),
  foreign key (project_id, studio_id) references public.projects (id, studio_id) on delete cascade,
  check (ends_at > starts_at)
);
create index project_events_studio_start_idx on public.project_events (studio_id, starts_at) where cancelled_at is null;
create index project_events_project_idx on public.project_events (project_id);
create trigger project_events_updated_at before update on public.project_events
  for each row execute function public.set_updated_at();

create table public.event_assignments (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null,
  event_id uuid not null,
  employee_id uuid not null,
  role public.assignment_role not null default 'lead_photographer',
  notes text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, employee_id),
  foreign key (event_id, studio_id) references public.project_events (id, studio_id) on delete cascade,
  foreign key (employee_id, studio_id) references public.employees (id, studio_id) on delete restrict
);
create index event_assignments_employee_idx on public.event_assignments (employee_id);
create trigger event_assignments_updated_at before update on public.event_assignments
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- equipment
create table public.equipment (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  category public.equipment_category not null default 'other',
  brand_model text,
  asset_tag text,
  quantity_owned integer not null default 1 check (quantity_owned >= 0),
  condition public.equipment_condition not null default 'good',
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, studio_id),
  -- individually tracked assets are, by definition, a single unit
  check (asset_tag is null or quantity_owned <= 1)
);
create unique index equipment_asset_tag_key on public.equipment (studio_id, lower(asset_tag)) where asset_tag is not null;
create index equipment_studio_idx on public.equipment (studio_id, is_active);
create trigger equipment_updated_at before update on public.equipment
  for each row execute function public.set_updated_at();

create table public.event_equipment (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null,
  event_id uuid not null,
  equipment_id uuid,
  custom_name text,
  quantity integer not null default 1 check (quantity > 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (event_id, studio_id) references public.project_events (id, studio_id) on delete cascade,
  foreign key (equipment_id, studio_id) references public.equipment (id, studio_id) on delete restrict,
  check (equipment_id is not null or nullif(btrim(custom_name), '') is not null)
);
create unique index event_equipment_item_key on public.event_equipment (event_id, equipment_id) where equipment_id is not null;
create index event_equipment_equipment_idx on public.event_equipment (equipment_id) where equipment_id is not null;
create trigger event_equipment_updated_at before update on public.event_equipment
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------- payments
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null,
  project_id uuid not null,
  amount numeric(12, 2) not null check (amount > 0),
  paid_on date not null default current_date,
  method public.payment_method not null default 'cash',
  reference text,
  notes text,
  is_advance boolean not null default false,
  status public.payment_status not null default 'valid',
  voided_at timestamptz,
  voided_by uuid references auth.users (id) on delete set null,
  void_reason text,
  recorded_by uuid references auth.users (id) on delete set null,
  recorded_by_name text,
  created_at timestamptz not null default now(),
  foreign key (project_id, studio_id) references public.projects (id, studio_id) on delete restrict,
  check ((status = 'void') = (voided_at is not null))
);
create index payments_project_idx on public.payments (project_id);
create index payments_studio_date_idx on public.payments (studio_id, paid_on);

-- Totals are always derived from stored, valid payments - never from the browser.
-- balance < 0 means the client has overpaid (credit).
create view public.project_financials with (security_invoker = true) as
select
  f.project_id,
  f.studio_id,
  f.agreed_amount,
  f.payment_due_date,
  coalesce(sum(p.amount) filter (where p.status = 'valid'), 0)::numeric(12, 2) as paid_amount,
  (f.agreed_amount - coalesce(sum(p.amount) filter (where p.status = 'valid'), 0))::numeric(12, 2) as balance
from public.project_finance f
left join public.payments p on p.project_id = f.project_id
group by f.project_id, f.studio_id, f.agreed_amount, f.payment_due_date;

-- -------------------------------------------------------- production tracking
create table public.production_tasks (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null,
  project_id uuid not null,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  phase public.task_phase not null default 'preparation',
  sort_order integer not null default 0,
  assignee_id uuid,
  is_done boolean not null default false,
  done_at timestamptz,
  done_by uuid references auth.users (id) on delete set null,
  done_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (project_id, studio_id) references public.projects (id, studio_id) on delete cascade,
  foreign key (assignee_id, studio_id) references public.employees (id, studio_id) on delete restrict
);
create index production_tasks_project_idx on public.production_tasks (project_id, sort_order);
create trigger production_tasks_updated_at before update on public.production_tasks
  for each row execute function public.set_updated_at();

create table public.project_deliveries (
  project_id uuid primary key,
  studio_id uuid not null,
  method public.delivery_method not null default 'online_gallery',
  delivered_on date,
  link_url text,
  notes text,
  confirmed_at timestamptz,
  confirmed_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (project_id, studio_id) references public.projects (id, studio_id) on delete cascade
);
create trigger project_deliveries_updated_at before update on public.project_deliveries
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------- activity logging
create table public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios (id) on delete cascade,
  project_id uuid references public.projects (id) on delete cascade,
  entity_type text not null,
  entity_id uuid,
  action text not null,
  summary text not null,
  category text not null default 'general' check (category in ('general', 'financial')),
  actor_user_id uuid references auth.users (id) on delete set null,
  actor_name text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index activity_logs_studio_idx on public.activity_logs (studio_id, created_at desc);
create index activity_logs_project_idx on public.activity_logs (project_id, created_at desc) where project_id is not null;

-- ------------------------------------------------------------ notifications
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios (id) on delete cascade,
  recipient_employee_id uuid not null,
  type public.notification_type not null,
  title text not null,
  body text,
  link text,
  project_id uuid references public.projects (id) on delete cascade,
  event_id uuid references public.project_events (id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  show_in_app boolean not null default true,
  dedupe_key text not null unique,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (recipient_employee_id, studio_id) references public.employees (id, studio_id) on delete cascade
);
create index notifications_recipient_idx on public.notifications (recipient_employee_id, created_at desc);
create index notifications_studio_idx on public.notifications (studio_id, created_at desc);

create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications (id) on delete cascade,
  studio_id uuid not null references public.studios (id) on delete cascade,
  channel text not null default 'email' check (channel in ('email')),
  to_address text not null,
  status public.delivery_status not null default 'pending',
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  sent_at timestamptz,
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (notification_id, channel)
);
create index notification_deliveries_due_idx on public.notification_deliveries (status, next_attempt_at);
create trigger notification_deliveries_updated_at before update on public.notification_deliveries
  for each row execute function public.set_updated_at();

create table public.notification_delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.notification_deliveries (id) on delete cascade,
  attempted_at timestamptz not null default now(),
  success boolean not null,
  error text,
  provider_response jsonb
);
create index notification_delivery_attempts_idx on public.notification_delivery_attempts (delivery_id, attempted_at desc);

-- One row per (event, person, event start). Rescheduling creates a new row and
-- supersedes the old one, so a stale reminder can never fire.
create table public.event_reminders (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios (id) on delete cascade,
  event_id uuid not null references public.project_events (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,
  role public.assignment_role not null,
  event_starts_at timestamptz not null,
  remind_at timestamptz not null,
  status public.reminder_status not null default 'scheduled',
  attempts integer not null default 0,
  last_error text,
  notification_id uuid references public.notifications (id) on delete set null,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, employee_id, event_starts_at)
);
create index event_reminders_due_idx on public.event_reminders (status, remind_at);
create index event_reminders_event_idx on public.event_reminders (event_id);
create trigger event_reminders_updated_at before update on public.event_reminders
  for each row execute function public.set_updated_at();

create table public.notification_preferences (
  user_id uuid not null references auth.users (id) on delete cascade,
  studio_id uuid not null references public.studios (id) on delete cascade,
  in_app_enabled boolean not null default true,
  email_enabled boolean not null default true,
  cat_reminders boolean not null default true,
  cat_assignments boolean not null default true,
  cat_schedule boolean not null default true,
  cat_production boolean not null default true,
  cat_payments boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, studio_id)
);
create trigger notification_preferences_updated_at before update on public.notification_preferences
  for each row execute function public.set_updated_at();
