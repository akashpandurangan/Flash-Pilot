-- =============================================================================
-- Flash Pilot - production lifecycle, part 2
--
--   upcoming -> production -> awaiting_approval -> editing -> out_for_delivery -> delivered
--
-- * Production starts, and ends, on its own: advance_event_lifecycle() runs every minute
--   from pg_cron, so it works with nobody logged in and every browser closed.
-- * The client has to approve before editing starts. Approval is recorded (when, who, note);
--   nothing assumes it.
-- * Delivery is two steps: "out for delivery" (with a link) and "delivered".
-- * Booking status and production stage stay independent. Only confirmed, non-archived
--   events ever advance; inquiries and cancelled events are left alone.
--
-- Needs 20260101000008_workflow_stages.sql (the new enum values) to be applied first.
-- =============================================================================

-- ------------------------------------------------------------------ columns
alter table public.projects
  add column client_approved_at timestamptz,
  add column client_approved_by uuid references auth.users (id) on delete set null,
  add column client_approved_by_name text,
  add column client_approval_note text,
  add column production_start_applied_at timestamptz,
  add column production_end_applied_at timestamptz;

comment on column public.projects.ready_for_delivery_at is 'When the event went out for delivery (stage out_for_delivery). Column name kept from the old "ready for delivery" stage.';
comment on column public.projects.shoot_completed_at is 'When production ended: the last session''s end time when the scheduler did it, otherwise the moment a person marked it.';
comment on column public.projects.production_start_applied_at is 'Set once the production-start transition has been applied (by the scheduler or by hand). The scheduler never repeats it, so a manual step back is not undone. Cleared when the schedule changes while the event is still upcoming.';
comment on column public.projects.production_end_applied_at is 'Same, for the production-end transition (production -> awaiting_approval).';

-- ------------------------------------------------------------------- the list view
-- Same view as before (see 20260101000002_security.sql), with the approval and scheduler
-- columns appended so the dashboard can apply exactly the rules the server job applies.
create or replace view public.project_overview as
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
  ), '{}'::uuid[]) as assigned_employee_ids,
  p.client_approved_at, p.client_approved_by_name, p.client_approval_note,
  p.production_start_applied_at, p.production_end_applied_at
from public.projects p
join public.clients c on c.id = p.client_id and c.studio_id = p.studio_id
where public.can_access_project(p.id);

-- ------------------------------------------------- re-arm when the schedule moves
-- If sessions are added, moved or cancelled before the event has started (or while it is in
-- production), the scheduler must look at the new times again.
create or replace function public.trg_rearm_lifecycle() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_project uuid := case when tg_op = 'DELETE' then old.project_id else new.project_id end;
begin
  update public.projects
     set production_start_applied_at = case when production_stage = 'upcoming' then null else production_start_applied_at end,
         production_end_applied_at = case when production_stage in ('upcoming', 'production') then null else production_end_applied_at end
   where id = v_project
     and production_stage in ('upcoming', 'production')
     and (production_start_applied_at is not null or production_end_applied_at is not null);
  return null;
end $$;

create trigger project_events_rearm_lifecycle
  after insert or delete or update of starts_at, ends_at, cancelled_at on public.project_events
  for each row execute function public.trg_rearm_lifecycle();

-- ------------------------------------------------------------------ scheduler
-- Moves confirmed events through the time-driven part of the lifecycle:
--   upcoming   -> production          at the first session's start time
--   production -> awaiting_approval   at the last session's end time
-- Comparisons are between instants (timestamptz), so the studio's time zone is already
-- baked into the stored session times; no conversion is needed here.
-- Safe to run as often as you like: every update is guarded by the stage it expects, a
-- transition is applied once (production_*_applied_at), and an advisory lock stops two
-- overlapping runs from working on the same rows. `p_now` exists for tests.
create or replace function public.advance_event_lifecycle(p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_started integer := 0;
  v_ended integer := 0;
begin
  if not pg_try_advisory_xact_lock(hashtext('flashpilot.advance_event_lifecycle')) then
    return jsonb_build_object('skipped', true);
  end if;

  for r in
    select p.id, p.studio_id, s.first_start
      from public.projects p
      cross join lateral (
        select min(e.starts_at) as first_start
          from public.project_events e where e.project_id = p.id and e.cancelled_at is null
      ) s
     where p.booking_status = 'confirmed' and p.archived_at is null
       and p.production_stage = 'upcoming' and p.production_start_applied_at is null
       and s.first_start is not null and s.first_start <= p_now
     order by s.first_start
  loop
    begin
      update public.projects
         set production_stage = 'production', production_started_at = r.first_start, production_start_applied_at = p_now
       where id = r.id and production_stage = 'upcoming' and production_start_applied_at is null;
      if found then
        v_started := v_started + 1;
        perform public.log_activity(r.studio_id, r.id, 'project', r.id, 'workflow_start_production',
          'Production started automatically at the scheduled start', 'general',
          jsonb_build_object('stage', 'production', 'automatic', true, 'scheduled_for', r.first_start));
      end if;
    exception when others then
      raise warning 'advance_event_lifecycle: could not start production for %: %', r.id, sqlerrm;
    end;
  end loop;

  -- Runs after the loop above, so an event whose sessions have all passed is caught up in one go.
  for r in
    select p.id, p.studio_id, s.last_end
      from public.projects p
      cross join lateral (
        select max(e.ends_at) as last_end
          from public.project_events e where e.project_id = p.id and e.cancelled_at is null
      ) s
     where p.booking_status = 'confirmed' and p.archived_at is null
       and p.production_stage = 'production' and p.production_end_applied_at is null
       and s.last_end is not null and s.last_end <= p_now
     order by s.last_end
  loop
    begin
      update public.projects
         set production_stage = 'awaiting_approval', shoot_completed_at = coalesce(shoot_completed_at, r.last_end),
             production_start_applied_at = coalesce(production_start_applied_at, p_now), production_end_applied_at = p_now
       where id = r.id and production_stage = 'production' and production_end_applied_at is null;
      if found then
        v_ended := v_ended + 1;
        perform public.log_activity(r.studio_id, r.id, 'project', r.id, 'workflow_complete_shoot',
          'Production completed automatically at the scheduled end - waiting for client approval', 'general',
          jsonb_build_object('stage', 'awaiting_approval', 'automatic', true, 'scheduled_for', r.last_end));
      end if;
    exception when others then
      raise warning 'advance_event_lifecycle: could not complete production for %: %', r.id, sqlerrm;
    end;
  end loop;

  return jsonb_build_object('production_started', v_started, 'moved_to_approval', v_ended);
end $$;

revoke all on function public.advance_event_lifecycle(timestamptz) from public, anon, authenticated;
grant execute on function public.advance_event_lifecycle(timestamptz) to service_role;

-- ------------------------------------------------------------- workflow actions
create or replace function public.project_workflow_action(p_project_id uuid, p_action text, p_note text default null)
returns public.projects
language plpgsql security definer set search_path = public as $$
declare
  pr public.projects;
  v_role public.access_role;
  v_summary text;
  v_name text;
  v_tz text;
begin
  select * into pr from public.projects where id = p_project_id for update;
  if not found then raise exception 'not_found: event' using errcode = 'P0002'; end if;
  if not public.can_access_project(p_project_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  v_role := public.my_access_role(pr.studio_id);
  v_name := coalesce((select full_name from public.profiles where id = auth.uid()), 'System');

  if pr.archived_at is not null then raise exception 'project_archived' using errcode = '23514'; end if;
  if pr.booking_status <> 'confirmed' then
    raise exception 'booking_not_confirmed: confirm the booking before changing production' using errcode = '23514';
  end if;

  case p_action
    when 'start_production' then
      if v_role not in ('owner', 'manager', 'photographer') then raise exception 'forbidden' using errcode = '42501'; end if;
      if pr.production_stage <> 'upcoming' then raise exception 'invalid_transition: production already started' using errcode = '23514'; end if;
      update public.projects
         set production_stage = 'production', production_started_at = now(),
             production_start_applied_at = coalesce(production_start_applied_at, now())
       where id = pr.id returning * into pr;
      v_summary := 'Production started';

    when 'complete_shoot' then
      if v_role not in ('owner', 'manager', 'photographer') then raise exception 'forbidden' using errcode = '42501'; end if;
      if pr.production_stage <> 'production' then
        raise exception 'invalid_transition: production is not in progress' using errcode = '23514';
      end if;
      update public.projects
         set production_stage = 'awaiting_approval', shoot_completed_at = now(),
             production_start_applied_at = coalesce(production_start_applied_at, now()), production_end_applied_at = now()
       where id = pr.id returning * into pr;
      v_summary := 'Production completed - waiting for client approval';

    when 'approve_client' then
      if v_role not in ('owner', 'manager') then raise exception 'forbidden' using errcode = '42501'; end if;
      if pr.production_stage <> 'awaiting_approval' then
        raise exception 'invalid_transition: the event is not waiting for client approval' using errcode = '23514';
      end if;
      update public.projects
         set production_stage = 'editing', editing_started_at = now(), client_approved_at = now(),
             client_approved_by = auth.uid(), client_approved_by_name = v_name, client_approval_note = nullif(btrim(p_note), '')
       where id = pr.id returning * into pr;
      v_summary := 'Client approval recorded - editing started';

    when 'complete_editing' then
      if v_role not in ('owner', 'manager', 'editor') then raise exception 'forbidden' using errcode = '42501'; end if;
      if pr.production_stage <> 'editing' or pr.editing_completed_at is not null then
        raise exception 'invalid_transition: editing is not in progress' using errcode = '23514';
      end if;
      update public.projects set editing_completed_at = now() where id = pr.id returning * into pr;
      v_summary := 'Editing marked completed';

    when 'mark_out_for_delivery' then
      if v_role not in ('owner', 'manager', 'editor') then raise exception 'forbidden' using errcode = '42501'; end if;
      if pr.production_stage <> 'editing' or pr.editing_completed_at is null then
        raise exception 'invalid_transition: finish editing first' using errcode = '23514';
      end if;
      update public.projects set production_stage = 'out_for_delivery', ready_for_delivery_at = now() where id = pr.id returning * into pr;
      v_summary := 'Out for delivery';

    when 'mark_delivered' then
      if v_role not in ('owner', 'manager') then raise exception 'forbidden' using errcode = '42501'; end if;
      if pr.production_stage <> 'out_for_delivery' then
        raise exception 'invalid_transition: the event is not out for delivery' using errcode = '23514';
      end if;
      select timezone into v_tz from public.studios where id = pr.studio_id;
      insert into public.project_deliveries (project_id, studio_id, delivered_on, confirmed_at, confirmed_by)
      values (pr.id, pr.studio_id, (now() at time zone coalesce(v_tz, 'UTC'))::date, now(), auth.uid())
      on conflict (project_id) do update
        set delivered_on = excluded.delivered_on, confirmed_at = excluded.confirmed_at, confirmed_by = excluded.confirmed_by;
      update public.projects set production_stage = 'delivered', delivered_at = now() where id = pr.id returning * into pr;
      v_summary := 'Event delivered';

    -- A manual correction. The scheduler's markers are deliberately left in place so stepping
    -- back is never silently undone a minute later.
    when 'revert' then
      if v_role not in ('owner', 'manager') then raise exception 'forbidden' using errcode = '42501'; end if;
      case pr.production_stage
        when 'delivered' then
          update public.project_deliveries set confirmed_at = null, confirmed_by = null where project_id = pr.id;
          update public.projects set production_stage = 'out_for_delivery', delivered_at = null where id = pr.id returning * into pr;
        when 'out_for_delivery' then
          update public.projects set production_stage = 'editing', ready_for_delivery_at = null, editing_completed_at = null
           where id = pr.id returning * into pr;
        when 'editing' then
          update public.projects
             set production_stage = 'awaiting_approval', editing_started_at = null, editing_completed_at = null,
                 client_approved_at = null, client_approved_by = null, client_approved_by_name = null, client_approval_note = null
           where id = pr.id returning * into pr;
        when 'awaiting_approval' then
          update public.projects set production_stage = 'production', shoot_completed_at = null where id = pr.id returning * into pr;
        when 'production' then
          update public.projects set production_stage = 'upcoming', production_started_at = null, shoot_completed_at = null
           where id = pr.id returning * into pr;
        else
          raise exception 'invalid_transition: nothing to revert' using errcode = '23514';
      end case;
      v_summary := 'Production stage reverted to ' || replace(pr.production_stage::text, '_', ' ');

    else
      raise exception 'unknown_action: %', p_action using errcode = '22023';
  end case;

  perform public.log_activity(pr.studio_id, pr.id, 'project', pr.id, 'workflow_' || p_action, v_summary, 'general',
    jsonb_build_object('stage', pr.production_stage, 'note', p_note));
  return pr;
end $$;

-- ----------------------------------------------------------------- dashboard
-- SECURITY INVOKER on purpose (row level security scopes every count to what the caller may
-- see). One definition of "upcoming" everywhere - src/lib/dashboard.ts mirrors it:
--   not cancelled, not archived, production not started yet, and a session still to begin.
create or replace function public.dashboard_kpis(p_studio uuid) returns jsonb
language plpgsql stable set search_path = public as $$
declare
  v_tz text;
  v_start timestamptz;
  v_end timestamptz;
begin
  select timezone into v_tz from public.studios where id = p_studio;
  if v_tz is null then raise exception 'forbidden' using errcode = '42501'; end if;
  v_start := date_trunc('day', now() at time zone v_tz) at time zone v_tz;
  v_end := (date_trunc('day', now() at time zone v_tz) + interval '1 day') at time zone v_tz;

  return jsonb_build_object(
    'active_projects', (select count(*) from public.projects p
      where p.studio_id = p_studio and p.archived_at is null and p.booking_status = 'confirmed' and p.production_stage <> 'delivered'),
    'inquiries', (select count(*) from public.projects p
      where p.studio_id = p_studio and p.archived_at is null and p.booking_status = 'inquiry'),
    'upcoming_events', (select count(*) from public.projects p
      where p.studio_id = p_studio and p.archived_at is null and p.booking_status <> 'cancelled' and p.production_stage = 'upcoming'
        and exists (select 1 from public.project_events e where e.project_id = p.id and e.cancelled_at is null and e.starts_at > now())),
    'upcoming_next_7_days', (select count(*) from public.projects p
      where p.studio_id = p_studio and p.archived_at is null and p.booking_status <> 'cancelled' and p.production_stage = 'upcoming'
        and (select min(e.starts_at) from public.project_events e where e.project_id = p.id and e.cancelled_at is null) between now() and now() + interval '7 days'),
    'today_events', (select count(distinct p.id) from public.project_events e join public.projects p on p.id = e.project_id
      where e.studio_id = p_studio and e.cancelled_at is null and p.archived_at is null and p.booking_status <> 'cancelled'
        and e.starts_at >= v_start and e.starts_at < v_end),
    'in_production', (select count(*) from public.projects p
      where p.studio_id = p_studio and p.archived_at is null and p.booking_status = 'confirmed' and p.production_stage = 'production'),
    'ready_for_delivery', (select count(*) from public.projects p
      where p.studio_id = p_studio and p.archived_at is null and p.booking_status = 'confirmed' and p.production_stage = 'out_for_delivery'),
    'pending_delivery', (select count(*) from public.projects p
      where p.studio_id = p_studio and p.archived_at is null and p.booking_status = 'confirmed'
        and p.production_stage in ('editing', 'out_for_delivery')),
    'outstanding_amount', case when public.has_finance_access(p_studio) then (
      select coalesce(sum(greatest(f.balance, 0)), 0) from public.project_financials f
      join public.projects p on p.id = f.project_id
      where f.studio_id = p_studio and p.archived_at is null and p.booking_status = 'confirmed') end,
    'stage_counts', (select coalesce(jsonb_object_agg(s.production_stage, s.n), '{}'::jsonb) from (
      select p.production_stage, count(*) as n from public.projects p
      where p.studio_id = p_studio and p.archived_at is null and p.booking_status <> 'cancelled'
      group by p.production_stage) s)
  );
end $$;

-- --------------------------------------------------- existing events, new lifecycle
-- 1. Shoots already marked completed that were waiting to move into editing are, in the
--    new flow, waiting for the client's approval.
update public.projects set production_stage = 'awaiting_approval'
 where production_stage = 'production' and shoot_completed_at is not null;

-- 2. Tell the scheduler which transitions have already happened, so history is not replayed.
update public.projects set production_start_applied_at = coalesce(production_started_at, created_at)
 where production_stage <> 'upcoming' and production_start_applied_at is null;
update public.projects set production_end_applied_at = coalesce(shoot_completed_at, created_at)
 where production_stage not in ('upcoming', 'production') and production_end_applied_at is null;

-- 3. Catch up anything whose sessions have already started or finished.
select public.advance_event_lifecycle();

-- ------------------------------------------------------------------- schedule
-- Every minute. Independent of the 5-minute notification job.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('flashpilot-advance-lifecycle', '* * * * *', 'select public.advance_event_lifecycle()');
  else
    raise notice 'pg_cron is not available; schedule advance_event_lifecycle() externally every minute (see docs/SETUP.md).';
  end if;
exception when others then
  raise notice 'pg_cron job was not created (%). Enable pg_cron and schedule advance_event_lifecycle() every minute (see docs/SETUP.md).', sqlerrm;
end $$;
