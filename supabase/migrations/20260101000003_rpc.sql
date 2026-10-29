-- =============================================================================
-- Flash Pilot - transactional business operations (RPCs) and activity triggers
-- Every function authorizes the caller itself. They run as SECURITY DEFINER so
-- multi-table writes are atomic, but never trust a studio/role from the client.
-- =============================================================================

-- ------------------------------------------------------------------ onboarding
create function public.create_studio(
  p_name text,
  p_email text default null,
  p_phone text default null,
  p_address text default null,
  p_city text default null,
  p_state text default null,
  p_timezone text default 'Asia/Kolkata',
  p_currency text default 'INR'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_studio uuid;
  v_name text;
  v_email text;
begin
  if v_uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  if exists (select 1 from public.employees where user_id = v_uid and access_role = 'owner') then
    raise exception 'studio_exists: you already own a studio' using errcode = '23505';
  end if;

  select coalesce(nullif(full_name, ''), split_part(email, '@', 1)), email
    into v_name, v_email from public.profiles where id = v_uid;

  insert into public.studios (name, email, phone, address, city, state, timezone, currency, onboarding_step, created_by)
  values (btrim(p_name), nullif(btrim(p_email), ''), nullif(btrim(p_phone), ''), nullif(btrim(p_address), ''),
          nullif(btrim(p_city), ''), nullif(btrim(p_state), ''),
          coalesce(nullif(btrim(p_timezone), ''), 'Asia/Kolkata'), coalesce(nullif(btrim(p_currency), ''), 'INR'), 2, v_uid)
  returning id into v_studio;

  insert into public.employees (studio_id, user_id, full_name, email, job_title, team_role, access_role,
                                can_view_financials, invite_status)
  values (v_studio, v_uid, coalesce(v_name, 'Studio owner'), v_email, 'Studio owner', 'studio_manager', 'owner', true, 'accepted');

  perform public.log_activity(v_studio, null, 'studio', v_studio, 'studio_created', 'Studio created');
  return v_studio;
end $$;

create function public.save_onboarding_step(p_studio uuid, p_step smallint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_studio_owner(p_studio) then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.studios
     set onboarding_step = least(4, greatest(onboarding_step, p_step))
   where id = p_studio and onboarding_completed_at is null;
end $$;

create function public.complete_onboarding(p_studio uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_studio_owner(p_studio) then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.studios
     set onboarding_step = 4, onboarding_completed_at = coalesce(onboarding_completed_at, now())
   where id = p_studio;
end $$;

-- When an invited user first signs in, flip their invitation to "accepted".
create function public.accept_invitation() returns void
language sql security definer set search_path = public as $$
  update public.employees set invite_status = 'accepted'
  where user_id = auth.uid() and invite_status = 'pending';
$$;

-- -------------------------------------------------------------------- payments
create function public.record_payment(
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
  if not found then raise exception 'not_found: project' using errcode = 'P0002'; end if;
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

create function public.void_payment(p_payment_id uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_pay public.payments;
begin
  select * into v_pay from public.payments where id = p_payment_id for update;
  if not found then raise exception 'not_found: payment' using errcode = 'P0002'; end if;
  if not (public.is_studio_staff(v_pay.studio_id) and public.has_finance_access(v_pay.studio_id)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_pay.status = 'void' then return; end if;

  update public.payments
     set status = 'void', voided_at = now(), voided_by = auth.uid(), void_reason = nullif(btrim(p_reason), '')
   where id = p_payment_id;

  perform public.log_activity(v_pay.studio_id, v_pay.project_id, 'payment', v_pay.id, 'payment_voided',
    'Payment voided', 'financial', jsonb_build_object('amount', v_pay.amount, 'reason', p_reason));
end $$;

-- ------------------------------------------------------------ project save
create function public.next_project_code(p_studio uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_seq integer;
begin
  update public.studios set project_seq = project_seq + 1 where id = p_studio returning project_seq into v_seq;
  return 'FP-' || lpad(v_seq::text, 4, '0');
end $$;

-- Creates (p_project_id is null) or updates a project together with its events,
-- team, equipment, finance row and optional advance payment - in ONE transaction.
create function public.save_project(p_project_id uuid, p_payload jsonb) returns uuid
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
    if not found then raise exception 'not_found: project' using errcode = 'P0002'; end if;
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
    raise exception 'events_required: add at least one event' using errcode = '22023';
  end if;

  if v_is_new then
    v_status := coalesce(nullif(v_proj ->> 'booking_status', ''), 'inquiry')::public.booking_status;
    if v_status = 'cancelled' then
      raise exception 'invalid_status: a new project cannot start cancelled' using errcode = '22023';
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
      if not found then raise exception 'invalid_event: event does not belong to this project' using errcode = '22023'; end if;
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

-- --------------------------------------------------------- booking lifecycle
create function public.set_booking_status(p_project_id uuid, p_status public.booking_status, p_reason text default null)
returns public.projects
language plpgsql security definer set search_path = public as $$
declare
  pr public.projects;
begin
  select * into pr from public.projects where id = p_project_id for update;
  if not found then raise exception 'not_found: project' using errcode = 'P0002'; end if;
  if not public.is_studio_staff(pr.studio_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if pr.archived_at is not null then raise exception 'project_archived: unarchive the project first' using errcode = '23514'; end if;
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
    raise exception 'events_required: add an event before confirming' using errcode = '23514';
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

create function public.set_project_archived(p_project_id uuid, p_archived boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_studio uuid;
begin
  select studio_id into v_studio from public.projects where id = p_project_id for update;
  if not found then raise exception 'not_found: project' using errcode = 'P0002'; end if;
  if not public.is_studio_staff(v_studio) then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.projects set archived_at = case when p_archived then now() else null end where id = p_project_id;
  perform public.log_activity(v_studio, p_project_id, 'project', p_project_id,
    case when p_archived then 'project_archived' else 'project_unarchived' end,
    case when p_archived then 'Project archived' else 'Project restored from archive' end);
end $$;

-- ------------------------------------------------------- production workflow
-- Stage machine. Milestones (shoot completed, editing completed) live inside a
-- stage; the stage itself only moves when the preconditions below are met.
create function public.project_workflow_action(p_project_id uuid, p_action text, p_note text default null)
returns public.projects
language plpgsql security definer set search_path = public as $$
declare
  pr public.projects;
  v_role public.access_role;
  v_summary text;
begin
  select * into pr from public.projects where id = p_project_id for update;
  if not found then raise exception 'not_found: project' using errcode = 'P0002'; end if;
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
        raise exception 'invalid_transition: project is not ready for delivery' using errcode = '23514';
      end if;
      if not exists (select 1 from public.project_deliveries where project_id = pr.id and delivered_on is not null) then
        raise exception 'delivery_details_required: record the delivery method and date first' using errcode = '23514';
      end if;
      update public.project_deliveries set confirmed_at = now(), confirmed_by = auth.uid() where project_id = pr.id;
      update public.projects set production_stage = 'delivered', delivered_at = now() where id = pr.id returning * into pr;
      v_summary := 'Project delivered';

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

-- Tick/untick a checklist task, limited to the phases a role owns.
create function public.set_task_done(p_task_id uuid, p_done boolean) returns public.production_tasks
language plpgsql security definer set search_path = public as $$
declare
  t public.production_tasks;
  v_role public.access_role;
begin
  select * into t from public.production_tasks where id = p_task_id for update;
  if not found then raise exception 'not_found: task' using errcode = 'P0002'; end if;
  if not public.can_access_project(t.project_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  v_role := public.my_access_role(t.studio_id);
  if not public.role_can_complete_phase(v_role, t.phase) then
    raise exception 'forbidden: your role cannot update % tasks', t.phase using errcode = '42501';
  end if;
  update public.production_tasks set is_done = p_done where id = p_task_id returning * into t;
  return t;
end $$;

-- ----------------------------------------------------------- notifications API
create function public.mark_notifications_read(p_ids uuid[]) returns void
language sql security definer set search_path = public as $$
  update public.notifications n set read_at = now()
  from public.employees e
  where n.id = any (p_ids) and n.recipient_employee_id = e.id and e.user_id = auth.uid() and n.read_at is null;
$$;

create function public.mark_all_notifications_read(p_studio uuid) returns void
language sql security definer set search_path = public as $$
  update public.notifications n set read_at = now()
  from public.employees e
  where n.studio_id = p_studio and n.recipient_employee_id = e.id and e.user_id = auth.uid()
    and n.show_in_app and n.read_at is null;
$$;

-- --------------------------------------------------------------- dashboard
-- SECURITY INVOKER on purpose: row level security scopes every count to what
-- the caller may see (crew only count their own projects).
create function public.dashboard_kpis(p_studio uuid) returns jsonb
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
    'upcoming_events', (select count(*) from public.project_events e join public.projects p on p.id = e.project_id
      where e.studio_id = p_studio and e.cancelled_at is null and p.archived_at is null and p.booking_status = 'confirmed' and e.ends_at >= now()),
    'today_events', (select count(*) from public.project_events e join public.projects p on p.id = e.project_id
      where e.studio_id = p_studio and e.cancelled_at is null and p.archived_at is null and p.booking_status = 'confirmed'
        and e.starts_at >= v_start and e.starts_at < v_end),
    'in_production', (select count(*) from public.projects p
      where p.studio_id = p_studio and p.archived_at is null and p.booking_status = 'confirmed' and p.production_stage = 'production'),
    'pending_delivery', (select count(*) from public.projects p
      where p.studio_id = p_studio and p.archived_at is null and p.booking_status = 'confirmed'
        and p.production_stage in ('editing', 'ready_for_delivery')),
    'outstanding_amount', case when public.has_finance_access(p_studio) then (
      select coalesce(sum(greatest(f.balance, 0)), 0) from public.project_financials f
      join public.projects p on p.id = f.project_id
      where f.studio_id = p_studio and p.archived_at is null and p.booking_status = 'confirmed') end,
    'stage_counts', (select coalesce(jsonb_object_agg(s.production_stage, s.n), '{}'::jsonb) from (
      select p.production_stage, count(*) as n from public.projects p
      where p.studio_id = p_studio and p.archived_at is null and p.booking_status = 'confirmed'
      group by p.production_stage) s)
  );
end $$;

-- ------------------------------------------------------------ activity triggers
-- Written as SECURITY DEFINER triggers so the log is complete no matter which
-- path (RPC or direct API write) made the change.
create function public.trg_log_client_created() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.log_activity(new.studio_id, null, 'client', new.id, 'client_created', 'Client added: ' || new.full_name);
  return new;
end $$;
create trigger clients_log_created after insert on public.clients
  for each row execute function public.trg_log_client_created();

create function public.trg_log_project() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_activity(new.studio_id, new.id, 'project', new.id, 'project_created', 'Project created: ' || new.name);
  elsif old.editor_id is distinct from new.editor_id and new.editor_id is not null then
    perform public.log_activity(new.studio_id, new.id, 'project', new.id, 'editor_assigned', 'Editor assigned',
      'general', jsonb_build_object('employee', (select full_name from public.employees where id = new.editor_id)));
  end if;
  return new;
end $$;
create trigger projects_log after insert or update on public.projects
  for each row execute function public.trg_log_project();

create function public.trg_log_assignment() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r public.event_assignments;
  v_emp text;
  v_event text;
  v_project uuid;
begin
  if tg_op = 'DELETE' then r := old; else r := new; end if;
  select full_name into v_emp from public.employees where id = r.employee_id;
  select title, project_id into v_event, v_project from public.project_events where id = r.event_id;
  if v_project is null then return r; end if;   -- event is being deleted
  if tg_op = 'INSERT' then
    perform public.log_activity(r.studio_id, v_project, 'assignment', r.id, 'team_assigned',
      v_emp || ' assigned to ' || v_event, 'general', jsonb_build_object('role', r.role));
  elsif tg_op = 'DELETE' then
    perform public.log_activity(r.studio_id, v_project, 'assignment', r.id, 'team_unassigned',
      v_emp || ' removed from ' || v_event, 'general', jsonb_build_object('role', r.role));
  end if;
  return r;
end $$;
create trigger event_assignments_log after insert or delete on public.event_assignments
  for each row execute function public.trg_log_assignment();

create function public.trg_log_event() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.cancelled_at is null and new.cancelled_at is not null then
    perform public.log_activity(new.studio_id, new.project_id, 'event', new.id, 'event_cancelled', 'Event cancelled: ' || new.title);
  elsif new.cancelled_at is null and (old.starts_at is distinct from new.starts_at or old.ends_at is distinct from new.ends_at) then
    perform public.log_activity(new.studio_id, new.project_id, 'event', new.id, 'event_rescheduled',
      'Event rescheduled: ' || new.title, 'general',
      jsonb_build_object('from', old.starts_at, 'to', new.starts_at));
  end if;
  return new;
end $$;
create trigger project_events_log after update on public.project_events
  for each row execute function public.trg_log_event();

create function public.trg_log_delivery() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or old.delivered_on is distinct from new.delivered_on or old.method is distinct from new.method
     or old.link_url is distinct from new.link_url then
    perform public.log_activity(new.studio_id, new.project_id, 'delivery', new.project_id, 'delivery_recorded',
      'Delivery details updated', 'general', jsonb_build_object('method', new.method));
  end if;
  return new;
end $$;
create trigger project_deliveries_log after insert or update on public.project_deliveries
  for each row execute function public.trg_log_delivery();

create function public.trg_log_task() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.is_done is distinct from old.is_done then
    perform public.log_activity(new.studio_id, new.project_id, 'task', new.id,
      case when new.is_done then 'task_completed' else 'task_reopened' end,
      (case when new.is_done then 'Completed: ' else 'Reopened: ' end) || new.title);
  end if;
  return new;
end $$;
create trigger production_tasks_log after update on public.production_tasks
  for each row execute function public.trg_log_task();

-- ----------------------------------------------------------------- privileges
revoke all on function
  public.create_studio(text, text, text, text, text, text, text, text),
  public.save_onboarding_step(uuid, smallint), public.complete_onboarding(uuid), public.accept_invitation(),
  public.record_payment(uuid, numeric, date, public.payment_method, text, text, boolean, boolean),
  public.void_payment(uuid, text), public.next_project_code(uuid), public.save_project(uuid, jsonb),
  public.set_booking_status(uuid, public.booking_status, text), public.set_project_archived(uuid, boolean),
  public.project_workflow_action(uuid, text, text), public.set_task_done(uuid, boolean),
  public.mark_notifications_read(uuid[]), public.mark_all_notifications_read(uuid), public.dashboard_kpis(uuid)
  from public, anon;

grant execute on function
  public.create_studio(text, text, text, text, text, text, text, text),
  public.save_onboarding_step(uuid, smallint), public.complete_onboarding(uuid), public.accept_invitation(),
  public.record_payment(uuid, numeric, date, public.payment_method, text, text, boolean, boolean),
  public.void_payment(uuid, text), public.save_project(uuid, jsonb),
  public.set_booking_status(uuid, public.booking_status, text), public.set_project_archived(uuid, boolean),
  public.project_workflow_action(uuid, text, text), public.set_task_done(uuid, boolean),
  public.mark_notifications_read(uuid[]), public.mark_all_notifications_read(uuid), public.dashboard_kpis(uuid)
  to authenticated;
