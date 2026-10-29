-- =============================================================================
-- Flash Pilot - notifications, reminders and delivery queue
--
-- Flow:
--   1. Triggers keep `event_reminders` in step with confirmed events and their
--      team (schedule on confirm/assign, supersede on reschedule, cancel on
--      cancellation / un-assignment / archive).
--   2. `process_due_notifications()` - run by pg_cron and/or the Edge Function -
--      turns due reminders into in-app notifications and queues e-mail
--      deliveries. It is idempotent: every notification has a unique dedupe_key.
--   3. The `process-notifications` Edge Function claims queued e-mail
--      deliveries, sends them and records the outcome (retry with back-off,
--      failure logged per attempt).
-- =============================================================================

create function public.notification_category(p_type public.notification_type) returns text
language sql immutable as $$
  select case p_type
    when 'event_reminder' then 'reminders'
    when 'new_assignment' then 'assignments'
    when 'assignment_changed' then 'assignments'
    when 'event_rescheduled' then 'schedule'
    when 'event_cancelled' then 'schedule'
    when 'payment_due' then 'payments'
    else 'production'
  end
$$;

-- Creates one notification (idempotent on dedupe_key), honouring the
-- recipient's preferences, and queues an e-mail delivery when appropriate.
-- Returns the notification id, or NULL when suppressed by preferences.
create function public.create_notification(
  p_employee uuid, p_type public.notification_type, p_title text, p_body text, p_link text,
  p_project uuid, p_event uuid, p_payload jsonb, p_dedupe text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  e public.employees;
  pref public.notification_preferences;
  v_id uuid;
  v_in_app boolean;
  v_email boolean;
  v_cat_on boolean := true;
begin
  select * into e from public.employees where id = p_employee and is_active;
  if not found then return null; end if;

  v_in_app := e.user_id is not null;                      -- no account, no in-app inbox
  v_email := coalesce(btrim(e.email), '') <> '';

  if e.user_id is not null then
    select * into pref from public.notification_preferences where user_id = e.user_id and studio_id = e.studio_id;
    if found then
      v_cat_on := case public.notification_category(p_type)
        when 'reminders' then pref.cat_reminders when 'assignments' then pref.cat_assignments
        when 'schedule' then pref.cat_schedule when 'production' then pref.cat_production
        when 'payments' then pref.cat_payments else true end;
      v_in_app := v_in_app and pref.in_app_enabled;
      v_email := v_email and pref.email_enabled;
    end if;
  end if;
  if not v_cat_on or not (v_in_app or v_email) then return null; end if;

  insert into public.notifications (studio_id, recipient_employee_id, type, title, body, link, project_id, event_id,
                                    payload, show_in_app, dedupe_key)
  values (e.studio_id, e.id, p_type, p_title, p_body, p_link, p_project, p_event,
          coalesce(p_payload, '{}'::jsonb), v_in_app, p_dedupe)
  on conflict (dedupe_key) do nothing
  returning id into v_id;

  if v_id is null then                                     -- already created earlier
    select id into v_id from public.notifications where dedupe_key = p_dedupe;
    return v_id;
  end if;

  if v_email then
    insert into public.notification_deliveries (notification_id, studio_id, channel, to_address)
    values (v_id, e.studio_id, 'email', btrim(e.email))
    on conflict (notification_id, channel) do nothing;
  end if;
  return v_id;
end $$;

-- Builds and sends an event-related notification to one employee.
create function public.send_event_notification(
  p_event uuid, p_employee uuid, p_type public.notification_type, p_title text, p_intro text, p_dedupe text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  ev public.project_events;
  pr public.projects;
  st public.studios;
  emp public.employees;
  asg public.event_assignments;
  cl public.clients;
  v_when text;
  v_role text;
  v_phone text;
  v_body text;
begin
  select * into ev from public.project_events where id = p_event;
  if not found then return null; end if;
  select * into pr from public.projects where id = ev.project_id;
  select * into st from public.studios where id = ev.studio_id;
  select * into emp from public.employees where id = p_employee;
  select * into asg from public.event_assignments where event_id = p_event and employee_id = p_employee;
  select * into cl from public.clients where id = pr.client_id;

  v_when := to_char(ev.starts_at at time zone st.timezone, 'Dy DD Mon YYYY, HH12:MI AM');
  v_role := case when asg.id is null then null else initcap(replace(asg.role::text, '_', ' ')) end;
  -- Editors never receive client phone numbers.
  v_phone := case when emp.team_role = 'editor' or emp.access_role = 'editor' then null else cl.phone end;

  v_body := concat_ws(E'\n',
    nullif(p_intro, ''),
    'Project: ' || pr.name || ' (' || pr.project_code || ')',
    'Event: ' || ev.title,
    'Reporting time: ' || v_when || ' ' || st.timezone,
    case when ev.venue_name is not null or ev.venue_address is not null
         then 'Venue: ' || concat_ws(', ', ev.venue_name, ev.venue_address) end,
    case when ev.map_url is not null then 'Map: ' || ev.map_url end,
    case when v_role is not null then 'Your role: ' || v_role end,
    'Client: ' || cl.full_name || case when v_phone is not null then ' (' || v_phone || ')' else '' end,
    case when ev.notes is not null then 'Notes: ' || ev.notes end);

  return public.create_notification(p_employee, p_type, p_title, v_body, '/projects/' || pr.id, pr.id, ev.id,
    jsonb_build_object('project', pr.name, 'project_code', pr.project_code, 'event', ev.title,
      'starts_at', ev.starts_at, 'ends_at', ev.ends_at, 'venue_name', ev.venue_name, 'venue_address', ev.venue_address,
      'map_url', ev.map_url, 'role', asg.role, 'notes', ev.notes, 'timezone', st.timezone,
      'client_name', cl.full_name, 'client_phone', v_phone),
    p_dedupe);
end $$;

-- ------------------------------------------------------------- reminder sync
-- Keeps event_reminders equal to "every active assignee of every confirmed,
-- upcoming, non-cancelled event". Safe to call any number of times.
create function public.sync_event_reminders(p_event uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  ev public.project_events;
  pr public.projects;
  v_lead integer;
  v_active boolean;
begin
  select * into ev from public.project_events where id = p_event;
  if not found then return; end if;
  select * into pr from public.projects where id = ev.project_id;
  select reminder_lead_hours into v_lead from public.studios where id = ev.studio_id;
  v_active := ev.cancelled_at is null and pr.booking_status = 'confirmed' and pr.archived_at is null and ev.starts_at > now();

  -- Retire reminders that no longer apply. A different start time means the
  -- event was rescheduled -> "superseded"; anything else -> "cancelled".
  update public.event_reminders r
     set status = (case when ev.cancelled_at is null and pr.booking_status = 'confirmed' and pr.archived_at is null
                             and r.event_starts_at <> ev.starts_at
                        then 'superseded' else 'cancelled' end)::public.reminder_status
   where r.event_id = p_event and r.status = 'scheduled'
     and (not v_active
          or r.event_starts_at <> ev.starts_at
          or not exists (select 1 from public.event_assignments a join public.employees e on e.id = a.employee_id
                          where a.event_id = p_event and a.employee_id = r.employee_id and e.is_active));

  if not v_active then return; end if;

  -- If the event is already inside the lead window, remind straight away.
  insert into public.event_reminders (studio_id, event_id, employee_id, role, event_starts_at, remind_at)
  select ev.studio_id, ev.id, a.employee_id, a.role, ev.starts_at,
         greatest(ev.starts_at - make_interval(hours => v_lead), now())
    from public.event_assignments a
    join public.employees e on e.id = a.employee_id and e.is_active
   where a.event_id = p_event
  on conflict (event_id, employee_id, event_starts_at) do update
     set role = excluded.role,
         status = case when public.event_reminders.status in ('cancelled', 'superseded', 'skipped')
                       then 'scheduled'::public.reminder_status else public.event_reminders.status end,
         remind_at = case when public.event_reminders.status in ('cancelled', 'superseded', 'skipped')
                          then excluded.remind_at else public.event_reminders.remind_at end;
end $$;

-- -------------------------------------------------------------- change triggers
create function public.trg_assignment_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r public.event_assignments;
  ev public.project_events;
  pr public.projects;
  v_label text;
begin
  if tg_op = 'DELETE' then r := old; else r := new; end if;
  select * into ev from public.project_events where id = r.event_id;
  if not found then return r; end if;                      -- cascade delete in progress
  select * into pr from public.projects where id = ev.project_id;

  perform public.sync_event_reminders(ev.id);

  if pr.booking_status <> 'confirmed' or pr.archived_at is not null or ev.cancelled_at is not null or ev.ends_at < now() then
    return r;
  end if;
  v_label := initcap(replace(r.role::text, '_', ' '));

  if tg_op = 'INSERT' then
    perform public.send_event_notification(ev.id, r.employee_id, 'new_assignment',
      'New assignment: ' || ev.title, 'You have been assigned as ' || v_label || '.', 'assign:' || r.id);
  elsif tg_op = 'UPDATE' and old.role is distinct from new.role then
    perform public.send_event_notification(ev.id, r.employee_id, 'assignment_changed',
      'Assignment changed: ' || ev.title, 'Your role is now ' || v_label || '.',
      'assignchg:' || r.id || ':' || r.role || ':' || extract(epoch from clock_timestamp())::text);
  elsif tg_op = 'DELETE' then
    perform public.create_notification(r.employee_id, 'assignment_changed', 'Removed from: ' || ev.title,
      'You are no longer assigned to ' || ev.title || ' (' || pr.name || ').', '/projects/' || pr.id, pr.id, ev.id,
      jsonb_build_object('project', pr.name, 'event', ev.title), 'unassign:' || r.id);
  end if;
  return r;
end $$;

create trigger event_assignments_notify after insert or update or delete on public.event_assignments
  for each row execute function public.trg_assignment_notify();

create function public.trg_event_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  pr public.projects;
  a record;
begin
  select * into pr from public.projects where id = new.project_id;

  if tg_op = 'UPDATE' and pr.booking_status = 'confirmed' and pr.archived_at is null then
    if old.cancelled_at is null and new.cancelled_at is not null then
      for a in select employee_id from public.event_assignments where event_id = new.id loop
        perform public.send_event_notification(new.id, a.employee_id, 'event_cancelled',
          'Cancelled: ' || new.title, 'This event has been cancelled. No reminder will be sent.',
          'evcancel:' || new.id || ':' || a.employee_id || ':' || extract(epoch from new.cancelled_at)::text);
      end loop;
    elsif new.cancelled_at is null and new.ends_at >= now()
          and (old.starts_at is distinct from new.starts_at or old.ends_at is distinct from new.ends_at
               or old.venue_name is distinct from new.venue_name or old.venue_address is distinct from new.venue_address) then
      for a in select employee_id from public.event_assignments where event_id = new.id loop
        perform public.send_event_notification(new.id, a.employee_id, 'event_rescheduled',
          'Updated: ' || new.title, 'The schedule or venue for this event has changed.',
          'resched:' || new.id || ':' || a.employee_id || ':' || extract(epoch from clock_timestamp())::text);
      end loop;
    end if;
  end if;

  perform public.sync_event_reminders(new.id);
  return new;
end $$;

create trigger project_events_notify after insert or update on public.project_events
  for each row execute function public.trg_event_notify();

create function public.trg_project_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  a record;
  ev record;
begin
  if old.booking_status is distinct from new.booking_status or old.archived_at is distinct from new.archived_at then
    for ev in select id from public.project_events where project_id = new.id loop
      perform public.sync_event_reminders(ev.id);
    end loop;
  end if;

  -- Confirmed (or restored): tell the team about the work they are on.
  if new.booking_status = 'confirmed' and new.archived_at is null
     and (old.booking_status is distinct from new.booking_status) then
    for a in
      select asg.id, asg.event_id, asg.employee_id, asg.role, e.title
        from public.event_assignments asg join public.project_events e on e.id = asg.event_id
       where e.project_id = new.id and e.cancelled_at is null and e.ends_at >= now()
    loop
      perform public.send_event_notification(a.event_id, a.employee_id, 'new_assignment',
        'New assignment: ' || a.title, 'The booking is confirmed and you are assigned as ' ||
        initcap(replace(a.role::text, '_', ' ')) || '.', 'assign:' || a.id);
    end loop;
  end if;

  -- Cancelled: tell everyone who was lined up.
  if new.booking_status = 'cancelled' and old.booking_status = 'confirmed' then
    for a in
      select asg.employee_id, asg.event_id, e.title
        from public.event_assignments asg join public.project_events e on e.id = asg.event_id
       where e.project_id = new.id and e.cancelled_at is null and e.ends_at >= now()
    loop
      perform public.send_event_notification(a.event_id, a.employee_id, 'event_cancelled',
        'Cancelled: ' || a.title, 'The booking for ' || new.name || ' has been cancelled.',
        'projcancel:' || new.id || ':' || a.event_id || ':' || a.employee_id || ':' || extract(epoch from new.cancelled_at)::text);
    end loop;
  end if;

  -- A newly chosen editor hears about it too.
  if new.editor_id is not null and old.editor_id is distinct from new.editor_id
     and new.booking_status = 'confirmed' and new.archived_at is null then
    perform public.create_notification(new.editor_id, 'new_assignment', 'Editing assigned: ' || new.name,
      'You have been assigned as the editor for ' || new.name || ' (' || new.project_code || ').',
      '/projects/' || new.id, new.id, null,
      jsonb_build_object('project', new.name, 'project_code', new.project_code, 'role', 'editor'),
      'editor:' || new.id || ':' || new.editor_id);
  end if;
  return new;
end $$;

create trigger projects_notify after update on public.projects
  for each row execute function public.trg_project_notify();

-- Deactivating someone withdraws their pending reminders (history is kept).
create function public.trg_employee_deactivated() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.is_active and not new.is_active then
    update public.event_reminders set status = 'cancelled' where employee_id = new.id and status = 'scheduled';
  end if;
  return new;
end $$;

create trigger employees_deactivated after update on public.employees
  for each row execute function public.trg_employee_deactivated();

-- ------------------------------------------------------------- the scheduler
-- Idempotent: safe to call every minute from several places at once.
create function public.process_due_notifications() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r record;
  p record;
  rec record;
  v_notif uuid;
  v_sent integer := 0;
  v_dropped integer := 0;
  v_failed integer := 0;
  v_deadline integer := 0;
  v_today date;
  v_title text;
begin
  -- 1. event reminders --------------------------------------------------------
  for r in
    select er.id, er.event_id, er.employee_id, er.event_starts_at, er.attempts,
           ev.starts_at as cur_start, ev.cancelled_at as ev_cancelled, ev.title as event_title,
           pr.name as project_name, pr.booking_status, pr.archived_at as pr_archived,
           (select true from public.employees e where e.id = er.employee_id and e.is_active) as emp_active,
           exists (select 1 from public.event_assignments a where a.event_id = er.event_id and a.employee_id = er.employee_id) as still_assigned
      from public.event_reminders er
      join public.project_events ev on ev.id = er.event_id
      join public.projects pr on pr.id = ev.project_id
     where er.status = 'scheduled' and er.remind_at <= now()
     order by er.remind_at
     limit 500
       for update of er skip locked
  loop
    begin
      if r.ev_cancelled is not null or r.booking_status <> 'confirmed' or r.pr_archived is not null
         or r.emp_active is null or not r.still_assigned or r.cur_start <= now() or r.cur_start <> r.event_starts_at then
        update public.event_reminders
           set status = (case when r.cur_start <> r.event_starts_at then 'superseded' else 'cancelled' end)::public.reminder_status,
               processed_at = now()
         where id = r.id;
        v_dropped := v_dropped + 1;
        continue;
      end if;

      v_notif := public.send_event_notification(r.event_id, r.employee_id, 'event_reminder',
        'Reminder: ' || r.event_title || ' - ' || r.project_name, 'Your shoot is coming up.', 'reminder:' || r.id);

      update public.event_reminders
         set status = case when v_notif is null then 'skipped' else 'sent' end::public.reminder_status,
             notification_id = v_notif, processed_at = now(), attempts = attempts + 1, last_error = null
       where id = r.id;
      v_sent := v_sent + 1;
    exception when others then
      update public.event_reminders
         set attempts = attempts + 1, last_error = sqlerrm,
             status = (case when attempts + 1 >= 5 then 'failed' else 'scheduled' end)::public.reminder_status,
             remind_at = now() + make_interval(mins => 5 * (attempts + 1))
       where id = r.id;
      v_failed := v_failed + 1;
    end;
  end loop;

  -- 2. deadline & payment notices (one per person per milestone/day) -------
  for p in
    select pr.*, st.timezone, (now() at time zone st.timezone)::date as today,
           coalesce(f.balance, 0) as balance, f.payment_due_date
      from public.projects pr
      join public.studios st on st.id = pr.studio_id
      left join public.project_financials f on f.project_id = pr.id
     where pr.booking_status = 'confirmed' and pr.archived_at is null and pr.production_stage <> 'delivered'
  loop
    v_today := p.today;

    if p.editing_due_date is not null and p.editing_completed_at is null then
      for rec in select e.id from public.employees e
                  where e.studio_id = p.studio_id and e.is_active and (e.access_role in ('owner', 'manager') or e.id = p.editor_id) loop
        if p.editing_due_date < v_today then
          perform public.create_notification(rec.id, 'editing_overdue', 'Editing overdue: ' || p.name,
            'Editing was due on ' || to_char(p.editing_due_date, 'DD Mon YYYY') || '.', '/projects/' || p.id, p.id, null,
            jsonb_build_object('project', p.name, 'due', p.editing_due_date), 'editing_overdue:' || p.id || ':' || rec.id || ':' || v_today);
          v_deadline := v_deadline + 1;
        elsif p.editing_due_date <= v_today + 2 then
          perform public.create_notification(rec.id, 'production_deadline', 'Editing due soon: ' || p.name,
            'Editing is due on ' || to_char(p.editing_due_date, 'DD Mon YYYY') || '.', '/projects/' || p.id, p.id, null,
            jsonb_build_object('project', p.name, 'due', p.editing_due_date), 'edit_due:' || p.id || ':' || rec.id || ':' || p.editing_due_date);
          v_deadline := v_deadline + 1;
        end if;
      end loop;
    end if;

    if p.delivery_due_date is not null then
      for rec in select e.id from public.employees e
                  where e.studio_id = p.studio_id and e.is_active and e.access_role in ('owner', 'manager') loop
        if p.delivery_due_date < v_today then
          perform public.create_notification(rec.id, 'delivery_overdue', 'Delivery overdue: ' || p.name,
            'Delivery was due on ' || to_char(p.delivery_due_date, 'DD Mon YYYY') || '.', '/projects/' || p.id, p.id, null,
            jsonb_build_object('project', p.name, 'due', p.delivery_due_date), 'delivery_overdue:' || p.id || ':' || rec.id || ':' || v_today);
          v_deadline := v_deadline + 1;
        elsif p.delivery_due_date <= v_today + 2 then
          perform public.create_notification(rec.id, 'production_deadline', 'Delivery due soon: ' || p.name,
            'Delivery is due on ' || to_char(p.delivery_due_date, 'DD Mon YYYY') || '.', '/projects/' || p.id, p.id, null,
            jsonb_build_object('project', p.name, 'due', p.delivery_due_date), 'deliv_due:' || p.id || ':' || rec.id || ':' || p.delivery_due_date);
          v_deadline := v_deadline + 1;
        end if;
      end loop;
    end if;

    if p.payment_due_date is not null and p.balance > 0 and p.payment_due_date <= v_today + 2 then
      v_title := case when p.payment_due_date < v_today then 'Payment overdue: ' else 'Payment due soon: ' end || p.name;
      for rec in select e.id from public.employees e
                  where e.studio_id = p.studio_id and e.is_active
                    and (e.access_role = 'owner' or (e.access_role = 'manager' and e.can_view_financials)) loop
        perform public.create_notification(rec.id, 'payment_due', v_title,
          'Balance outstanding; payment due ' || to_char(p.payment_due_date, 'DD Mon YYYY') || '.',
          '/projects/' || p.id, p.id, null,
          jsonb_build_object('project', p.name, 'due', p.payment_due_date),
          'pay_due:' || p.id || ':' || rec.id || ':' || case when p.payment_due_date < v_today then v_today::text else p.payment_due_date::text end);
        v_deadline := v_deadline + 1;
      end loop;
    end if;
  end loop;

  return jsonb_build_object('reminders_sent', v_sent, 'reminders_dropped', v_dropped,
                            'reminders_failed', v_failed, 'deadline_notices', v_deadline);
end $$;

-- ------------------------------------------------------- e-mail delivery queue
create function public.claim_pending_deliveries(p_limit integer default 25)
returns table (delivery_id uuid, to_address text, subject text, body text, link text, attempts integer, max_attempts integer)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  return query
  with due as (
    select d.id
      from public.notification_deliveries d
     where (d.status = 'pending' and d.next_attempt_at <= now())
        or (d.status = 'processing' and d.locked_at < now() - interval '10 minutes')
     order by d.next_attempt_at
     limit p_limit
       for update skip locked
  ), upd as (
    update public.notification_deliveries d
       set status = 'processing', locked_at = now(), attempts = d.attempts + 1
      from due where d.id = due.id
    returning d.id, d.to_address, d.attempts, d.max_attempts, d.notification_id
  )
  select u.id, u.to_address, n.title, n.body, n.link, u.attempts, u.max_attempts
    from upd u join public.notifications n on n.id = u.notification_id;
end $$;

-- outcome: 'sent' | 'retry' (temporary failure) | 'failed' (permanent) | 'skipped' (no provider configured)
create function public.record_delivery_result(
  p_delivery_id uuid, p_outcome text, p_error text default null,
  p_provider_message_id text default null, p_provider_response jsonb default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  d public.notification_deliveries;
begin
  select * into d from public.notification_deliveries where id = p_delivery_id for update;
  if not found then raise exception 'not_found: delivery' using errcode = 'P0002'; end if;
  if d.status in ('sent', 'skipped', 'failed') then return; end if;     -- already settled: idempotent

  insert into public.notification_delivery_attempts (delivery_id, success, error, provider_response)
  values (d.id, p_outcome = 'sent', p_error, p_provider_response);

  if p_outcome = 'sent' then
    update public.notification_deliveries
       set status = 'sent', sent_at = now(), provider_message_id = p_provider_message_id, last_error = null, locked_at = null
     where id = d.id;
  elsif p_outcome = 'skipped' then
    update public.notification_deliveries set status = 'skipped', last_error = p_error, locked_at = null where id = d.id;
  elsif p_outcome = 'retry' and d.attempts < d.max_attempts then
    update public.notification_deliveries
       set status = 'pending', last_error = p_error, locked_at = null,
           next_attempt_at = now() + make_interval(mins => power(2, d.attempts)::int)
     where id = d.id;
  else
    update public.notification_deliveries set status = 'failed', last_error = p_error, locked_at = null where id = d.id;
  end if;
end $$;

-- ----------------------------------------------------------------- privileges
revoke all on function
  public.create_notification(uuid, public.notification_type, text, text, text, uuid, uuid, jsonb, text),
  public.send_event_notification(uuid, uuid, public.notification_type, text, text, text),
  public.sync_event_reminders(uuid), public.process_due_notifications(),
  public.claim_pending_deliveries(integer), public.record_delivery_result(uuid, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function
  public.process_due_notifications(), public.claim_pending_deliveries(integer),
  public.record_delivery_result(uuid, text, text, text, jsonb), public.auth_user_id_by_email(text)
  to service_role;
