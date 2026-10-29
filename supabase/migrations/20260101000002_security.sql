-- =============================================================================
-- Flash Pilot - access helpers, guard triggers, row level security
-- Authorization is enforced here, in the database. The UI hides what a role
-- cannot use, but that is a convenience, not the security boundary.
-- =============================================================================

-- ------------------------------------------------------------ access helpers
-- SECURITY DEFINER so policies can consult `employees` without recursing into
-- that table's own RLS. All are STABLE and read-only.

create function public.my_access_role(p_studio uuid) returns public.access_role
language sql stable security definer set search_path = public as $$
  select e.access_role
  from public.employees e
  where e.studio_id = p_studio and e.user_id = auth.uid() and e.is_active and e.access_role is not null
  limit 1
$$;

create function public.my_employee_id(p_studio uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select e.id
  from public.employees e
  where e.studio_id = p_studio and e.user_id = auth.uid() and e.is_active
  limit 1
$$;

create function public.is_studio_member(p_studio uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.my_access_role(p_studio) is not null
$$;

create function public.is_studio_owner(p_studio uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.my_access_role(p_studio) = 'owner'
$$;

-- owner or manager: day-to-day operations
create function public.is_studio_staff(p_studio uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_access_role(p_studio) in ('owner', 'manager'), false)
$$;

-- Financial access is explicit: owners always, managers only with the flag.
create function public.has_finance_access(p_studio uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.employees e
    where e.studio_id = p_studio and e.user_id = auth.uid() and e.is_active
      and (e.access_role = 'owner' or (e.access_role = 'manager' and e.can_view_financials))
  )
$$;

-- Owners/managers see every project; photographers and editors only the
-- projects they are assigned to (on an event, or as the editor).
create function public.can_access_project(p_project uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.projects p
    where p.id = p_project
      and (
        public.is_studio_staff(p.studio_id)
        or (
          public.is_studio_member(p.studio_id)
          and (
            p.editor_id = public.my_employee_id(p.studio_id)
            or exists (
              select 1
              from public.project_events ev
              join public.event_assignments a on a.event_id = ev.id
              where ev.project_id = p.id and a.employee_id = public.my_employee_id(p.studio_id)
            )
          )
        )
      )
  )
$$;

create function public.can_access_event(p_event uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.project_events ev
    where ev.id = p_event and public.can_access_project(ev.project_id)
  )
$$;

-- Phases of the production checklist each role may tick off.
create function public.role_can_complete_phase(p_role public.access_role, p_phase public.task_phase) returns boolean
language sql immutable as $$
  select case p_role
    when 'owner' then true
    when 'manager' then true
    when 'photographer' then p_phase in ('preparation', 'shoot')
    when 'editor' then p_phase in ('post', 'editing')
    else false
  end
$$;

-- Service-role helper used by the invite Edge Function.
create function public.auth_user_id_by_email(p_email text) returns uuid
language sql stable security definer set search_path = public as $$
  select u.id from auth.users u where lower(u.email) = lower(p_email) limit 1
$$;

-- ------------------------------------------------------------- guard triggers
-- Employees: only the owner may change access levels, financial permission or
-- the account link; the owner row cannot be demoted or deactivated via the API.
-- NOTE: deliberately SECURITY INVOKER - is_privileged_context() inspects
-- current_user, which a SECURITY DEFINER function would always see as its owner.
create function public.employees_guard() returns trigger
language plpgsql set search_path = public as $$
declare
  v_owner boolean := public.is_studio_owner(coalesce(new.studio_id, old.studio_id));
begin
  if public.is_privileged_context() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.user_id is not null or new.access_role is not null or new.can_view_financials
       or new.invite_status <> 'none' or new.invited_at is not null then
      raise exception 'forbidden: account fields can only be set through an invitation' using errcode = '42501';
    end if;
    return new;
  end if;

  -- UPDATE
  if old.access_role = 'owner' and (new.access_role is distinct from 'owner' or new.is_active = false
                                    or new.user_id is distinct from old.user_id) then
    raise exception 'owner_protected: the studio owner cannot be demoted or deactivated' using errcode = '42501';
  end if;

  if (new.access_role is distinct from old.access_role
      or new.can_view_financials is distinct from old.can_view_financials
      or new.invite_status is distinct from old.invite_status
      or new.user_id is distinct from old.user_id) and not v_owner then
    raise exception 'forbidden: only the studio owner can change access settings' using errcode = '42501';
  end if;

  -- The owner may revoke access (clear the link) but never attach arbitrary accounts.
  if new.user_id is distinct from old.user_id and new.user_id is not null then
    raise exception 'forbidden: accounts are linked through invitations only' using errcode = '42501';
  end if;
  if new.access_role = 'owner' and old.access_role is distinct from 'owner' then
    raise exception 'forbidden: cannot grant the owner role' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger employees_guard before insert or update on public.employees
  for each row execute function public.employees_guard();

-- Never assign someone who has been deactivated to new work.
create function public.assignments_require_active_employee() returns trigger
language plpgsql as $$
begin
  if not exists (select 1 from public.employees where id = new.employee_id and is_active) then
    raise exception 'employee_inactive: deactivated employees cannot be assigned' using errcode = '23514';
  end if;
  return new;
end $$;

create trigger event_assignments_active_employee before insert on public.event_assignments
  for each row execute function public.assignments_require_active_employee();

-- Stamp who completed a checklist task, and when.
create function public.production_tasks_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.is_done and not coalesce(old.is_done, false) then
    new.done_at := now();
    new.done_by := auth.uid();
    new.done_by_name := coalesce((select full_name from public.profiles where id = auth.uid()), 'System');
  elsif not new.is_done and coalesce(old.is_done, false) then
    new.done_at := null;
    new.done_by := null;
    new.done_by_name := null;
  end if;
  return new;
end $$;

create trigger production_tasks_stamp before update on public.production_tasks
  for each row execute function public.production_tasks_stamp();

-- Every project gets a finance row and its checklist, atomically with creation.
create function public.projects_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.project_finance (project_id, studio_id) values (new.id, new.studio_id);

  insert into public.production_tasks (studio_id, project_id, title, phase, sort_order)
  select new.studio_id, new.id,
         btrim(item ->> 'title'),
         coalesce(nullif(item ->> 'phase', ''), 'preparation')::public.task_phase,
         (ord - 1) * 10
  from public.studios s,
       jsonb_array_elements(s.default_checklist) with ordinality as t(item, ord)
  where s.id = new.studio_id and nullif(btrim(item ->> 'title'), '') is not null;

  return new;
end $$;

create trigger projects_after_insert after insert on public.projects
  for each row execute function public.projects_after_insert();

-- ------------------------------------------------------------ activity logger
create function public.log_activity(
  p_studio uuid, p_project uuid, p_entity_type text, p_entity_id uuid,
  p_action text, p_summary text, p_category text default 'general', p_metadata jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.activity_logs (studio_id, project_id, entity_type, entity_id, action, summary, category,
                                    actor_user_id, actor_name, metadata)
  values (p_studio, p_project, p_entity_type, p_entity_id, p_action, p_summary, p_category,
          auth.uid(),
          coalesce((select full_name from public.profiles where id = auth.uid()), 'System'),
          coalesce(p_metadata, '{}'::jsonb));
end $$;

-- ------------------------------------------------------------- crew-safe views
-- Photographers and editors must not read the clients table, but they need the
-- client's name (and, for photographers, a phone number) for events they work.
-- These views deliberately run with the owner's rights and apply the access
-- rule themselves (can_access_project); they expose a fixed, minimal column set.
create view public.project_overview as
select
  p.id, p.studio_id, p.project_code, p.client_id, p.name, p.event_type, p.description, p.internal_notes,
  p.booking_status, p.production_stage, p.editor_id, p.editing_due_date, p.delivery_due_date,
  p.confirmed_at, p.cancelled_at, p.cancel_reason, p.production_started_at, p.shoot_completed_at,
  p.editing_started_at, p.editing_completed_at, p.ready_for_delivery_at, p.delivered_at, p.archived_at,
  p.created_at, p.updated_at,
  c.full_name as client_name,
  case when public.my_access_role(p.studio_id) in ('owner', 'manager', 'photographer') then c.phone end as client_phone,
  case when public.my_access_role(p.studio_id) in ('owner', 'manager') then c.email end as client_email,
  (select min(e.starts_at) from public.project_events e where e.project_id = p.id and e.cancelled_at is null) as first_event_at,
  (select min(e.starts_at) from public.project_events e where e.project_id = p.id and e.cancelled_at is null and e.ends_at >= now()) as next_event_at,
  (select max(e.ends_at) from public.project_events e where e.project_id = p.id and e.cancelled_at is null) as last_event_at,
  (select count(*) from public.project_events e where e.project_id = p.id and e.cancelled_at is null)::int as event_count,
  coalesce((
    select array_agg(distinct a.employee_id)
    from public.event_assignments a
    join public.project_events e on e.id = a.event_id
    where e.project_id = p.id and e.cancelled_at is null
  ), '{}'::uuid[]) as assigned_employee_ids
from public.projects p
join public.clients c on c.id = p.client_id and c.studio_id = p.studio_id
where public.can_access_project(p.id);

-- ------------------------------------------------------------------------ RLS
alter table public.studios enable row level security;
alter table public.profiles enable row level security;
alter table public.employees enable row level security;
alter table public.clients enable row level security;
alter table public.projects enable row level security;
alter table public.project_finance enable row level security;
alter table public.project_events enable row level security;
alter table public.event_assignments enable row level security;
alter table public.equipment enable row level security;
alter table public.event_equipment enable row level security;
alter table public.payments enable row level security;
alter table public.production_tasks enable row level security;
alter table public.project_deliveries enable row level security;
alter table public.activity_logs enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_deliveries enable row level security;
alter table public.notification_delivery_attempts enable row level security;
alter table public.event_reminders enable row level security;
alter table public.notification_preferences enable row level security;

-- studios
create policy studios_select on public.studios for select to authenticated
  using (public.is_studio_member(id));
create policy studios_update on public.studios for update to authenticated
  using (public.is_studio_owner(id)) with check (public.is_studio_owner(id));

-- profiles: own row only
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid());
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- employees: every member sees the team directory; staff edit (field-level rules
-- are enforced by employees_guard); only owners may delete.
create policy employees_select on public.employees for select to authenticated
  using (public.is_studio_member(studio_id) or user_id = auth.uid());
create policy employees_insert on public.employees for insert to authenticated
  with check (public.is_studio_staff(studio_id));
create policy employees_update on public.employees for update to authenticated
  using (public.is_studio_staff(studio_id)) with check (public.is_studio_staff(studio_id));
create policy employees_delete on public.employees for delete to authenticated
  using (public.is_studio_owner(studio_id) and access_role is null);

-- clients: staff only (crew see a minimal projection through project_overview)
create policy clients_select on public.clients for select to authenticated
  using (public.is_studio_staff(studio_id));
create policy clients_insert on public.clients for insert to authenticated
  with check (public.is_studio_staff(studio_id));
create policy clients_update on public.clients for update to authenticated
  using (public.is_studio_staff(studio_id)) with check (public.is_studio_staff(studio_id));

-- projects & scheduling
create policy projects_select on public.projects for select to authenticated
  using (public.can_access_project(id));
create policy projects_update on public.projects for update to authenticated
  using (public.is_studio_staff(studio_id)) with check (public.is_studio_staff(studio_id));

create policy project_events_select on public.project_events for select to authenticated
  using (public.can_access_project(project_id));
create policy project_events_insert on public.project_events for insert to authenticated
  with check (public.is_studio_staff(studio_id));
create policy project_events_update on public.project_events for update to authenticated
  using (public.is_studio_staff(studio_id)) with check (public.is_studio_staff(studio_id));

create policy event_assignments_select on public.event_assignments for select to authenticated
  using (public.can_access_event(event_id));
create policy event_assignments_insert on public.event_assignments for insert to authenticated
  with check (public.is_studio_staff(studio_id));
create policy event_assignments_update on public.event_assignments for update to authenticated
  using (public.is_studio_staff(studio_id)) with check (public.is_studio_staff(studio_id));
create policy event_assignments_delete on public.event_assignments for delete to authenticated
  using (public.is_studio_staff(studio_id));

-- equipment
create policy equipment_select on public.equipment for select to authenticated
  using (public.is_studio_member(studio_id));
create policy equipment_insert on public.equipment for insert to authenticated
  with check (public.is_studio_staff(studio_id));
create policy equipment_update on public.equipment for update to authenticated
  using (public.is_studio_staff(studio_id)) with check (public.is_studio_staff(studio_id));

create policy event_equipment_select on public.event_equipment for select to authenticated
  using (public.can_access_event(event_id));
create policy event_equipment_insert on public.event_equipment for insert to authenticated
  with check (public.is_studio_staff(studio_id));
create policy event_equipment_update on public.event_equipment for update to authenticated
  using (public.is_studio_staff(studio_id)) with check (public.is_studio_staff(studio_id));
create policy event_equipment_delete on public.event_equipment for delete to authenticated
  using (public.is_studio_staff(studio_id));

-- money: finance permission only. Payments are written exclusively by RPCs.
create policy project_finance_select on public.project_finance for select to authenticated
  using (public.has_finance_access(studio_id));
create policy project_finance_update on public.project_finance for update to authenticated
  using (public.has_finance_access(studio_id) and public.is_studio_staff(studio_id))
  with check (public.has_finance_access(studio_id) and public.is_studio_staff(studio_id));
create policy payments_select on public.payments for select to authenticated
  using (public.has_finance_access(studio_id));

-- production
create policy production_tasks_select on public.production_tasks for select to authenticated
  using (public.can_access_project(project_id));
create policy production_tasks_insert on public.production_tasks for insert to authenticated
  with check (public.is_studio_staff(studio_id));
create policy production_tasks_update on public.production_tasks for update to authenticated
  using (public.is_studio_staff(studio_id)) with check (public.is_studio_staff(studio_id));
create policy production_tasks_delete on public.production_tasks for delete to authenticated
  using (public.is_studio_staff(studio_id));

create policy project_deliveries_select on public.project_deliveries for select to authenticated
  using (public.can_access_project(project_id));
create policy project_deliveries_insert on public.project_deliveries for insert to authenticated
  with check (public.is_studio_staff(studio_id));
create policy project_deliveries_update on public.project_deliveries for update to authenticated
  using (public.is_studio_staff(studio_id)) with check (public.is_studio_staff(studio_id));

-- activity: financial entries only for finance users; crew see their own projects
create policy activity_logs_select on public.activity_logs for select to authenticated
  using (
    (public.is_studio_staff(studio_id) and (category <> 'financial' or public.has_finance_access(studio_id)))
    or (
      public.my_access_role(studio_id) in ('photographer', 'editor')
      and project_id is not null and category <> 'financial'
      and public.can_access_project(project_id)
    )
  );

-- notifications: private to the recipient (plus the owner as administrator)
create policy notifications_select on public.notifications for select to authenticated
  using (
    (show_in_app and exists (
      select 1 from public.employees e
      where e.id = notifications.recipient_employee_id and e.user_id = auth.uid()
    ))
    or public.is_studio_owner(studio_id)
  );
create policy notification_deliveries_select on public.notification_deliveries for select to authenticated
  using (public.is_studio_owner(studio_id));
create policy notification_delivery_attempts_select on public.notification_delivery_attempts for select to authenticated
  using (exists (
    select 1 from public.notification_deliveries d
    where d.id = notification_delivery_attempts.delivery_id and public.is_studio_owner(d.studio_id)
  ));
create policy event_reminders_select on public.event_reminders for select to authenticated
  using (public.is_studio_staff(studio_id));

create policy notification_preferences_all on public.notification_preferences for all to authenticated
  using (user_id = auth.uid() and public.is_studio_member(studio_id))
  with check (user_id = auth.uid() and public.is_studio_member(studio_id));

-- ----------------------------------------------------------------- privileges
-- Table privileges are the first gate (RLS the second). Anonymous visitors get
-- nothing; signed-in users get DML only where a policy can ever allow it.
revoke all on all tables in schema public from anon;
revoke all on all tables in schema public from authenticated;

grant select, update on public.studios to authenticated;        -- created via create_studio()
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.employees to authenticated;
grant select, insert, update on public.clients to authenticated;
grant select, update on public.projects to authenticated;       -- created via save_project()
grant select, insert, update on public.project_events to authenticated;
grant select, insert, update, delete on public.event_assignments to authenticated;
grant select, insert, update on public.equipment to authenticated;
grant select, insert, update, delete on public.event_equipment to authenticated;
grant select, update on public.project_finance to authenticated;
grant select on public.payments to authenticated;               -- written via record_payment()/void_payment()
grant select, insert, update, delete on public.production_tasks to authenticated;
grant select, insert, update on public.project_deliveries to authenticated;
grant select on public.activity_logs to authenticated;
grant select on public.notifications to authenticated;          -- read state via mark_notifications_read()
grant select on public.notification_deliveries to authenticated;
grant select on public.notification_delivery_attempts to authenticated;
grant select on public.event_reminders to authenticated;
grant select, insert, update, delete on public.notification_preferences to authenticated;
grant select on public.project_financials to authenticated;
grant select on public.project_overview to authenticated;

-- Helper functions: callable by signed-in users (RLS evaluates them as the caller).
revoke all on function public.auth_user_id_by_email(text) from public, anon, authenticated;
revoke all on function public.log_activity(uuid, uuid, text, uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.my_access_role(uuid), public.my_employee_id(uuid), public.is_studio_member(uuid),
  public.is_studio_owner(uuid), public.is_studio_staff(uuid), public.has_finance_access(uuid),
  public.can_access_project(uuid), public.can_access_event(uuid) from public, anon;
grant execute on function public.my_access_role(uuid), public.my_employee_id(uuid), public.is_studio_member(uuid),
  public.is_studio_owner(uuid), public.is_studio_staff(uuid), public.has_finance_access(uuid),
  public.can_access_project(uuid), public.can_access_event(uuid) to authenticated;
