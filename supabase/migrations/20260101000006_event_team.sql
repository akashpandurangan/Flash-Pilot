-- =============================================================================
-- Flash Pilot - replace an event's team atomically
-- Used by the "Manage team" dialog on the project page so people can be
-- assigned or changed after a project exists, without touching anything else.
-- Notification and reminder triggers on event_assignments handle the rest.
-- =============================================================================

create function public.set_event_team(p_event_id uuid, p_team jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  ev public.project_events;
  t jsonb;
  v_keep uuid[] := '{}';
begin
  select * into ev from public.project_events where id = p_event_id for update;
  if not found then raise exception 'not_found: event' using errcode = 'P0002'; end if;
  if not public.is_studio_staff(ev.studio_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if ev.cancelled_at is not null then
    raise exception 'invalid_transition: this event is cancelled' using errcode = '23514';
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

revoke all on function public.set_event_team(uuid, jsonb) from public, anon;
grant execute on function public.set_event_team(uuid, jsonb) to authenticated;
