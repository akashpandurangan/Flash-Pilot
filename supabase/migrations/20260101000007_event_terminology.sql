-- =============================================================================
-- Flash Pilot - terminology: "projects" are now called "events", the dated parts of an
-- event are "sessions"
--
-- The screens were renamed (Projects -> Events, old inner "events" -> Sessions). This
-- migration brings the wording the DATABASE writes in line with that: notification text,
-- activity-log summaries, error messages and the in-app links stored on notifications.
--
-- Nothing structural changes: table, column, function and enum names are untouched, so
-- there is no data migration risk. Functions are replaced in place (privileges kept) and
-- the data statements at the end are idempotent.
-- =============================================================================


-- record_payment
create or replace function public.record_payment(
  p_project_id uuid,
  p_amount numeric,
  p_paid_on date default current_date,
  p_method public.payment_method default 'cash',
  p_reference text default null,
  p_notes text default null,
  p_is_advance boolean default false,
  p_allow_overpayment boolean default false
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_studio uuid;
  v_agreed numeric;
  v_paid numeric;
  v_remaining numeric;
  v_id uuid;
begin
  select studio_id into v_studio from public.projects where id = p_project_id;
  if not found then raise exception 'not_found: event' using errcode = 'P0002'; end if;
  if not (public.is_studio_staff(v_studio) and public.has_finance_access(v_studio)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then
    raise exception 'invalid_amount: enter an amount greater than zero with at most two decimals' using errcode = '22023';
  end if;

  -- Serialise concurrent payments on the same project, then derive the balance
  -- from stored rows (never from a client-supplied figure).
  select agreed_amount into v_agreed from public.project_finance where project_id = p_project_id for update;
  select coalesce(sum(amount), 0) into v_paid from public.payments where project_id = p_project_id and status = 'valid';
  v_remaining := v_agreed - v_paid;

  if p_amount > v_remaining and not p_allow_overpayment then
    raise exception 'overpayment: this payment exceeds the outstanding balance of %', greatest(v_remaining, 0)
      using errcode = 'P0001';
  end if;

  insert into public.payments (studio_id, project_id, amount, paid_on, method, reference, notes, is_advance,
                               recorded_by, recorded_by_name)
  values (v_studio, p_project_id, p_amount, coalesce(p_paid_on, current_date), p_method,
          nullif(btrim(p_reference), ''), nullif(btrim(p_notes), ''), coalesce(p_is_advance, false), auth.uid(),
          coalesce((select full_name from public.profiles where id = auth.uid()), 'System'))
  returning id into v_id;

  perform public.log_activity(v_studio, p_project_id, 'payment', v_id,
    case when p_is_advance then 'advance_recorded' else 'payment_recorded' end,
    case when p_is_advance then 'Advance payment recorded' else 'Payment recorded' end,
    'financial',
    jsonb_build_object('amount', p_amount, 'method', p_method, 'credit', greatest(p_amount - v_remaining, 0)));
  return v_id;
end $$;

-- save_project
create or replace function public.save_project(p_project_id uuid, p_payload jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_proj jsonb := p_payload -> 'project';
  v_fin jsonb := p_payload -> 'finance';
  v_pay jsonb := p_payload -> 'initial_payment';
  v_is_new boolean := p_project_id is null;
  v_studio uuid;
  v_project uuid := p_project_id;
  v_has_fin boolean;
  v_client uuid;
  v_status public.booking_status;
  v_ev jsonb;
  v_asg jsonb;
  v_eq jsonb;
  v_event uuid;
  v_row uuid;
  v_keep uuid[];
  v_removed text;
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  if v_proj is null then raise exception 'invalid_payload: project is required' using errcode = '22023'; end if;

  if v_is_new then
    v_studio := (v_proj ->> 'studio_id')::uuid;
  else
    select studio_id into v_studio from public.projects where id = p_project_id for update;
    if not found then raise exception 'not_found: event' using errcode = 'P0002'; end if;
  end if;

  if v_studio is null or not public.is_studio_staff(v_studio) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_has_fin := public.has_finance_access(v_studio);

  v_client := (v_proj ->> 'client_id')::uuid;
  if not exists (select 1 from public.clients where id = v_client and studio_id = v_studio) then
    raise exception 'invalid_client: choose a client from this studio' using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(p_payload -> 'events', '[]'::jsonb)) = 0 then
    raise exception 'events_required: add at least one session' using errcode = '22023';
  end if;

  if v_is_new then
    v_status := coalesce(nullif(v_proj ->> 'booking_status', ''), 'inquiry')::public.booking_status;
    if v_status = 'cancelled' then
      raise exception 'invalid_status: a new event cannot start cancelled' using errcode = '22023';
    end if;
    insert into public.projects (studio_id, project_code, client_id, name, event_type, description, internal_notes,
                                 booking_status, confirmed_at, editor_id, editing_due_date, delivery_due_date, created_by)
    values (v_studio, public.next_project_code(v_studio), v_client, btrim(v_proj ->> 'name'),
            coalesce(nullif(v_proj ->> 'event_type', ''), 'wedding')::public.event_type,
            nullif(btrim(v_proj ->> 'description'), ''), nullif(btrim(v_proj ->> 'internal_notes'), ''),
            v_status, case when v_status = 'confirmed' then now() end,
            nullif(v_proj ->> 'editor_id', '')::uuid,
            nullif(v_proj ->> 'editing_due_date', '')::date, nullif(v_proj ->> 'delivery_due_date', '')::date,
            auth.uid())
    returning id into v_project;
  else
    update public.projects
       set client_id = v_client,
           name = btrim(v_proj ->> 'name'),
           event_type = coalesce(nullif(v_proj ->> 'event_type', ''), 'wedding')::public.event_type,
           description = nullif(btrim(v_proj ->> 'description'), ''),
           internal_notes = nullif(btrim(v_proj ->> 'internal_notes'), ''),
           editor_id = nullif(v_proj ->> 'editor_id', '')::uuid,
           editing_due_date = nullif(v_proj ->> 'editing_due_date', '')::date,
           delivery_due_date = nullif(v_proj ->> 'delivery_due_date', '')::date
     where id = v_project;
  end if;

  -- Finance: only people with explicit financial access may touch money.
  if v_has_fin and v_fin is not null then
    update public.project_finance
       set agreed_amount = coalesce(nullif(v_fin ->> 'agreed_amount', '')::numeric, 0),
           payment_due_date = nullif(v_fin ->> 'payment_due_date', '')::date,
           payment_notes = nullif(btrim(v_fin ->> 'payment_notes'), '')
     where project_id = v_project;
  end if;

  if v_is_new and v_has_fin and v_pay is not null and coalesce(nullif(v_pay ->> 'amount', '')::numeric, 0) > 0 then
    perform public.record_payment(
      v_project, (v_pay ->> 'amount')::numeric, coalesce(nullif(v_pay ->> 'paid_on', '')::date, current_date),
      coalesce(nullif(v_pay ->> 'method', ''), 'cash')::public.payment_method,
      v_pay ->> 'reference', v_pay ->> 'notes', true, coalesce((v_pay ->> 'allow_overpayment')::boolean, false));
  end if;

  -- Events the owner removed are cancelled (kept for history), never deleted.
  for v_removed in select jsonb_array_elements_text(coalesce(p_payload -> 'removed_event_ids', '[]'::jsonb)) loop
    update public.project_events set cancelled_at = now()
     where id = v_removed::uuid and project_id = v_project and cancelled_at is null;
  end loop;

  for v_ev in select * from jsonb_array_elements(p_payload -> 'events') loop
    if nullif(v_ev ->> 'id', '') is not null then
      v_event := (v_ev ->> 'id')::uuid;
      update public.project_events
         set title = btrim(v_ev ->> 'title'),
             event_type = coalesce(nullif(v_ev ->> 'event_type', ''), 'wedding')::public.event_type,
             starts_at = (v_ev ->> 'starts_at')::timestamptz,
             ends_at = (v_ev ->> 'ends_at')::timestamptz,
             venue_name = nullif(btrim(v_ev ->> 'venue_name'), ''),
             venue_address = nullif(btrim(v_ev ->> 'venue_address'), ''),
             map_url = nullif(btrim(v_ev ->> 'map_url'), ''),
             notes = nullif(btrim(v_ev ->> 'notes'), ''),
             sort_order = coalesce(nullif(v_ev ->> 'sort_order', '')::int, 0)
       where id = v_event and project_id = v_project;
      if not found then raise exception 'invalid_event: session does not belong to this event' using errcode = '22023'; end if;
    else
      insert into public.project_events (studio_id, project_id, title, event_type, starts_at, ends_at, venue_name,
                                         venue_address, map_url, notes, sort_order)
      values (v_studio, v_project, btrim(v_ev ->> 'title'),
              coalesce(nullif(v_ev ->> 'event_type', ''), 'wedding')::public.event_type,
              (v_ev ->> 'starts_at')::timestamptz, (v_ev ->> 'ends_at')::timestamptz,
              nullif(btrim(v_ev ->> 'venue_name'), ''), nullif(btrim(v_ev ->> 'venue_address'), ''),
              nullif(btrim(v_ev ->> 'map_url'), ''), nullif(btrim(v_ev ->> 'notes'), ''),
              coalesce(nullif(v_ev ->> 'sort_order', '')::int, 0))
      returning id into v_event;
    end if;

    -- team
    v_keep := '{}';
    for v_asg in select * from jsonb_array_elements(coalesce(v_ev -> 'assignments', '[]'::jsonb)) loop
      insert into public.event_assignments (studio_id, event_id, employee_id, role, notes, created_by)
      values (v_studio, v_event, (v_asg ->> 'employee_id')::uuid,
              coalesce(nullif(v_asg ->> 'role', ''), 'lead_photographer')::public.assignment_role,
              nullif(btrim(v_asg ->> 'notes'), ''), auth.uid())
      on conflict (event_id, employee_id) do update
        set role = excluded.role, notes = excluded.notes
        where (event_assignments.role, event_assignments.notes) is distinct from (excluded.role, excluded.notes);
      v_keep := v_keep || (v_asg ->> 'employee_id')::uuid;
    end loop;
    delete from public.event_assignments where event_id = v_event and not (employee_id = any (v_keep));

    -- equipment
    v_keep := '{}';
    for v_eq in select * from jsonb_array_elements(coalesce(v_ev -> 'equipment', '[]'::jsonb)) loop
      if nullif(v_eq ->> 'id', '') is not null then
        update public.event_equipment
           set equipment_id = nullif(v_eq ->> 'equipment_id', '')::uuid,
               custom_name = nullif(btrim(v_eq ->> 'custom_name'), ''),
               quantity = coalesce(nullif(v_eq ->> 'quantity', '')::int, 1),
               notes = nullif(btrim(v_eq ->> 'notes'), '')
         where id = (v_eq ->> 'id')::uuid and event_id = v_event
         returning id into v_row;
        if v_row is null then raise exception 'invalid_equipment_row' using errcode = '22023'; end if;
      else
        insert into public.event_equipment (studio_id, event_id, equipment_id, custom_name, quantity, notes)
        values (v_studio, v_event, nullif(v_eq ->> 'equipment_id', '')::uuid, nullif(btrim(v_eq ->> 'custom_name'), ''),
                coalesce(nullif(v_eq ->> 'quantity', '')::int, 1), nullif(btrim(v_eq ->> 'notes'), ''))
        returning id into v_row;
      end if;
      v_keep := v_keep || v_row;
    end loop;
    delete from public.event_equipment where event_id = v_event and not (id = any (v_keep));
  end loop;

  return v_project;
end $$;

-- set_booking_status
create or replace function public.set_booking_status(p_project_id uuid, p_status public.booking_status, p_reason text default null)
returns public.projects
language plpgsql security definer set search_path = public as $$
declare
  pr public.projects;
begin
  select * into pr from public.projects where id = p_project_id for update;
  if not found then raise exception 'not_found: event' using errcode = 'P0002'; end if;
  if not public.is_studio_staff(pr.studio_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if pr.archived_at is not null then raise exception 'project_archived: restore the event from the archive first' using errcode = '23514'; end if;
  if pr.booking_status = p_status then return pr; end if;

  if not (
    (pr.booking_status = 'inquiry' and p_status in ('confirmed', 'cancelled'))
    or (pr.booking_status = 'confirmed' and p_status in ('cancelled', 'inquiry'))
    or (pr.booking_status = 'cancelled' and p_status = 'inquiry')
  ) then
    raise exception 'invalid_transition: cannot move a booking from % to %', pr.booking_status, p_status using errcode = '23514';
  end if;

  if p_status = 'confirmed' and not exists (
    select 1 from public.project_events where project_id = p_project_id and cancelled_at is null
  ) then
    raise exception 'events_required: add a session before confirming' using errcode = '23514';
  end if;
  if p_status = 'inquiry' and pr.production_stage <> 'upcoming' then
    raise exception 'invalid_transition: production has already started' using errcode = '23514';
  end if;

  update public.projects
     set booking_status = p_status,
         confirmed_at = case when p_status = 'confirmed' then now() when p_status = 'inquiry' then null else confirmed_at end,
         cancelled_at = case when p_status = 'cancelled' then now() else null end,
         cancel_reason = case when p_status = 'cancelled' then nullif(btrim(p_reason), '') else null end
   where id = p_project_id
   returning * into pr;

  perform public.log_activity(pr.studio_id, pr.id, 'project', pr.id, 'booking_' || p_status::text,
    case p_status when 'confirmed' then 'Booking confirmed' when 'cancelled' then 'Booking cancelled' else 'Booking moved back to inquiry' end,
    'general', jsonb_build_object('reason', p_reason));
  return pr;
end $$;

-- set_project_archived
create or replace function public.set_project_archived(p_project_id uuid, p_archived boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_studio uuid;
begin
  select studio_id into v_studio from public.projects where id = p_project_id for update;
  if not found then raise exception 'not_found: event' using errcode = 'P0002'; end if;
  if not public.is_studio_staff(v_studio) then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.projects set archived_at = case when p_archived then now() else null end where id = p_project_id;
  perform public.log_activity(v_studio, p_project_id, 'project', p_project_id,
    case when p_archived then 'project_archived' else 'project_unarchived' end,
    case when p_archived then 'Event archived' else 'Event restored from archive' end);
end $$;

-- project_workflow_action
create or replace function public.project_workflow_action(p_project_id uuid, p_action text, p_note text default null)
returns public.projects
language plpgsql security definer set search_path = public as $$
declare
  pr public.projects;
  v_role public.access_role;
  v_summary text;
begin
  select * into pr from public.projects where id = p_project_id for update;
  if not found then raise exception 'not_found: event' using errcode = 'P0002'; end if;
  if not public.can_access_project(p_project_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  v_role := public.my_access_role(pr.studio_id);

  if pr.archived_at is not null then raise exception 'project_archived' using errcode = '23514'; end if;
  if pr.booking_status <> 'confirmed' then
    raise exception 'booking_not_confirmed: confirm the booking before changing production' using errcode = '23514';
  end if;

  case p_action
    when 'start_production' then
      if v_role not in ('owner', 'manager', 'photographer') then raise exception 'forbidden' using errcode = '42501'; end if;
      if pr.production_stage <> 'upcoming' then raise exception 'invalid_transition: production already started' using errcode = '23514'; end if;
      update public.projects set production_stage = 'production', production_started_at = now() where id = pr.id returning * into pr;
      v_summary := 'Production started';

    when 'complete_shoot' then
      if v_role not in ('owner', 'manager', 'photographer') then raise exception 'forbidden' using errcode = '42501'; end if;
      if pr.production_stage <> 'production' or pr.shoot_completed_at is not null then
        raise exception 'invalid_transition: shoot can only be completed while in production' using errcode = '23514';
      end if;
      update public.projects set shoot_completed_at = now() where id = pr.id returning * into pr;
      v_summary := 'Shoot marked completed';

    when 'start_editing' then
      if v_role not in ('owner', 'manager') then raise exception 'forbidden' using errcode = '42501'; end if;
      if pr.production_stage <> 'production' or pr.shoot_completed_at is null then
        raise exception 'invalid_transition: complete the shoot before editing' using errcode = '23514';
      end if;
      update public.projects set production_stage = 'editing', editing_started_at = now() where id = pr.id returning * into pr;
      v_summary := 'Moved into editing';

    when 'complete_editing' then
      if v_role not in ('owner', 'manager', 'editor') then raise exception 'forbidden' using errcode = '42501'; end if;
      if pr.production_stage <> 'editing' or pr.editing_completed_at is not null then
        raise exception 'invalid_transition: editing is not in progress' using errcode = '23514';
      end if;
      update public.projects set editing_completed_at = now() where id = pr.id returning * into pr;
      v_summary := 'Editing marked completed';

    when 'mark_ready' then
      if v_role not in ('owner', 'manager', 'editor') then raise exception 'forbidden' using errcode = '42501'; end if;
      if pr.production_stage <> 'editing' or pr.editing_completed_at is null then
        raise exception 'invalid_transition: finish editing first' using errcode = '23514';
      end if;
      update public.projects set production_stage = 'ready_for_delivery', ready_for_delivery_at = now() where id = pr.id returning * into pr;
      v_summary := 'Marked ready for delivery';

    when 'mark_delivered' then
      if v_role not in ('owner', 'manager') then raise exception 'forbidden' using errcode = '42501'; end if;
      if pr.production_stage <> 'ready_for_delivery' then
        raise exception 'invalid_transition: event is not ready for delivery' using errcode = '23514';
      end if;
      if not exists (select 1 from public.project_deliveries where project_id = pr.id and delivered_on is not null) then
        raise exception 'delivery_details_required: record the delivery method and date first' using errcode = '23514';
      end if;
      update public.project_deliveries set confirmed_at = now(), confirmed_by = auth.uid() where project_id = pr.id;
      update public.projects set production_stage = 'delivered', delivered_at = now() where id = pr.id returning * into pr;
      v_summary := 'Event delivered';

    when 'revert' then
      if v_role not in ('owner', 'manager') then raise exception 'forbidden' using errcode = '42501'; end if;
      case pr.production_stage
        when 'delivered' then
          update public.project_deliveries set confirmed_at = null, confirmed_by = null where project_id = pr.id;
          update public.projects set production_stage = 'ready_for_delivery', delivered_at = null where id = pr.id returning * into pr;
        when 'ready_for_delivery' then
          update public.projects set production_stage = 'editing', ready_for_delivery_at = null, editing_completed_at = null
           where id = pr.id returning * into pr;
        when 'editing' then
          update public.projects set production_stage = 'production', editing_started_at = null, editing_completed_at = null
           where id = pr.id returning * into pr;
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

-- trg_log_project
create or replace function public.trg_log_project() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_activity(new.studio_id, new.id, 'project', new.id, 'project_created', 'Event created: ' || new.name);
  elsif old.editor_id is distinct from new.editor_id and new.editor_id is not null then
    perform public.log_activity(new.studio_id, new.id, 'project', new.id, 'editor_assigned', 'Editor assigned',
      'general', jsonb_build_object('employee', (select full_name from public.employees where id = new.editor_id)));
  end if;
  return new;
end $$;

-- trg_log_event
create or replace function public.trg_log_event() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.cancelled_at is null and new.cancelled_at is not null then
    perform public.log_activity(new.studio_id, new.project_id, 'event', new.id, 'event_cancelled', 'Session cancelled: ' || new.title);
  elsif new.cancelled_at is null and (old.starts_at is distinct from new.starts_at or old.ends_at is distinct from new.ends_at) then
    perform public.log_activity(new.studio_id, new.project_id, 'event', new.id, 'event_rescheduled',
      'Session rescheduled: ' || new.title, 'general',
      jsonb_build_object('from', old.starts_at, 'to', new.starts_at));
  end if;
  return new;
end $$;

-- send_event_notification
create or replace function public.send_event_notification(
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
    'Event: ' || pr.name || ' (' || pr.project_code || ')',
    'Session: ' || ev.title,
    'Reporting time: ' || v_when || ' ' || st.timezone,
    case when ev.venue_name is not null or ev.venue_address is not null
         then 'Venue: ' || concat_ws(', ', ev.venue_name, ev.venue_address) end,
    case when ev.map_url is not null then 'Map: ' || ev.map_url end,
    case when v_role is not null then 'Your role: ' || v_role end,
    'Client: ' || cl.full_name || case when v_phone is not null then ' (' || v_phone || ')' else '' end,
    case when ev.notes is not null then 'Notes: ' || ev.notes end);

  return public.create_notification(p_employee, p_type, p_title, v_body, '/events/' || pr.id, pr.id, ev.id,
    jsonb_build_object('project', pr.name, 'project_code', pr.project_code, 'event', ev.title,
      'starts_at', ev.starts_at, 'ends_at', ev.ends_at, 'venue_name', ev.venue_name, 'venue_address', ev.venue_address,
      'map_url', ev.map_url, 'role', asg.role, 'notes', ev.notes, 'timezone', st.timezone,
      'client_name', cl.full_name, 'client_phone', v_phone),
    p_dedupe);
end $$;

-- trg_assignment_notify
create or replace function public.trg_assignment_notify() returns trigger
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
      'You are no longer assigned to ' || ev.title || ' (' || pr.name || ').', '/events/' || pr.id, pr.id, ev.id,
      jsonb_build_object('project', pr.name, 'event', ev.title), 'unassign:' || r.id);
  end if;
  return r;
end $$;

-- trg_event_notify
create or replace function public.trg_event_notify() returns trigger
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
          'Cancelled: ' || new.title, 'This session has been cancelled. No reminder will be sent.',
          'evcancel:' || new.id || ':' || a.employee_id || ':' || extract(epoch from new.cancelled_at)::text);
      end loop;
    elsif new.cancelled_at is null and new.ends_at >= now()
          and (old.starts_at is distinct from new.starts_at or old.ends_at is distinct from new.ends_at
               or old.venue_name is distinct from new.venue_name or old.venue_address is distinct from new.venue_address) then
      for a in select employee_id from public.event_assignments where event_id = new.id loop
        perform public.send_event_notification(new.id, a.employee_id, 'event_rescheduled',
          'Updated: ' || new.title, 'The schedule or venue for this session has changed.',
          'resched:' || new.id || ':' || a.employee_id || ':' || extract(epoch from clock_timestamp())::text);
      end loop;
    end if;
  end if;

  perform public.sync_event_reminders(new.id);
  return new;
end $$;

-- trg_project_notify
create or replace function public.trg_project_notify() returns trigger
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
      '/events/' || new.id, new.id, null,
      jsonb_build_object('project', new.name, 'project_code', new.project_code, 'role', 'editor'),
      'editor:' || new.id || ':' || new.editor_id);
  end if;
  return new;
end $$;

-- process_due_notifications
create or replace function public.process_due_notifications() returns jsonb
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
            'Editing was due on ' || to_char(p.editing_due_date, 'DD Mon YYYY') || '.', '/events/' || p.id, p.id, null,
            jsonb_build_object('project', p.name, 'due', p.editing_due_date), 'editing_overdue:' || p.id || ':' || rec.id || ':' || v_today);
          v_deadline := v_deadline + 1;
        elsif p.editing_due_date <= v_today + 2 then
          perform public.create_notification(rec.id, 'production_deadline', 'Editing due soon: ' || p.name,
            'Editing is due on ' || to_char(p.editing_due_date, 'DD Mon YYYY') || '.', '/events/' || p.id, p.id, null,
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
            'Delivery was due on ' || to_char(p.delivery_due_date, 'DD Mon YYYY') || '.', '/events/' || p.id, p.id, null,
            jsonb_build_object('project', p.name, 'due', p.delivery_due_date), 'delivery_overdue:' || p.id || ':' || rec.id || ':' || v_today);
          v_deadline := v_deadline + 1;
        elsif p.delivery_due_date <= v_today + 2 then
          perform public.create_notification(rec.id, 'production_deadline', 'Delivery due soon: ' || p.name,
            'Delivery is due on ' || to_char(p.delivery_due_date, 'DD Mon YYYY') || '.', '/events/' || p.id, p.id, null,
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
          '/events/' || p.id, p.id, null,
          jsonb_build_object('project', p.name, 'due', p.payment_due_date),
          'pay_due:' || p.id || ':' || rec.id || ':' || case when p.payment_due_date < v_today then v_today::text else p.payment_due_date::text end);
        v_deadline := v_deadline + 1;
      end loop;
    end if;
  end loop;

  return jsonb_build_object('reminders_sent', v_sent, 'reminders_dropped', v_dropped,
                            'reminders_failed', v_failed, 'deadline_notices', v_deadline);
end $$;

-- set_event_team
create or replace function public.set_event_team(p_event_id uuid, p_team jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  ev public.project_events;
  t jsonb;
  v_keep uuid[] := '{}';
begin
  select * into ev from public.project_events where id = p_event_id for update;
  if not found then raise exception 'not_found: session' using errcode = 'P0002'; end if;
  if not public.is_studio_staff(ev.studio_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if ev.cancelled_at is not null then
    raise exception 'invalid_transition: this session is cancelled' using errcode = '23514';
  end if;

  for t in select * from jsonb_array_elements(coalesce(p_team, '[]'::jsonb)) loop
    insert into public.event_assignments (studio_id, event_id, employee_id, role, created_by)
    values (ev.studio_id, ev.id, (t ->> 'employee_id')::uuid,
            coalesce(nullif(t ->> 'role', ''), 'lead_photographer')::public.assignment_role, auth.uid())
    on conflict (event_id, employee_id) do update
      set role = excluded.role
      where public.event_assignments.role is distinct from excluded.role;
    v_keep := v_keep || (t ->> 'employee_id')::uuid;
  end loop;

  delete from public.event_assignments where event_id = ev.id and not (employee_id = any (v_keep));
end $$;

-- ------------------------------------------------------------------ existing data
-- Links stored on notifications created before the rename. (The app also forwards
-- /projects/... to /events/..., so old links keep working either way.)
update public.notifications
   set link = '/events/' || substr(link, length('/projects/') + 1)
 where link like '/projects/%';

-- Activity-log wording, so the feed reads consistently. The facts (who / when / what) are unchanged.
update public.activity_logs set summary = 'Event created: ' || substr(summary, length('Project created: ') + 1)
 where summary like 'Project created: %';
update public.activity_logs set summary = 'Event archived' where summary = 'Project archived';
update public.activity_logs set summary = 'Event restored from archive' where summary = 'Project restored from archive';
update public.activity_logs set summary = 'Event delivered' where summary = 'Project delivered';
update public.activity_logs set summary = 'Session cancelled: ' || substr(summary, length('Event cancelled: ') + 1)
 where summary like 'Event cancelled: %';
update public.activity_logs set summary = 'Session rescheduled: ' || substr(summary, length('Event rescheduled: ') + 1)
 where summary like 'Event rescheduled: %';
