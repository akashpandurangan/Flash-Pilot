-- =============================================================================
-- Flash Pilot - Realtime publication, logo storage, scheduled processing
-- Each block is guarded so the migration also applies on plain Postgres.
-- =============================================================================

-- ------------------------------------------------------------------- Realtime
-- Only the tables the UI actually subscribes to. Realtime evaluates each
-- subscriber's RLS, so crew never receive financial or unrelated rows.
-- REPLICA IDENTITY FULL lets filtered subscriptions (studio_id=eq...) also see DELETEs.
alter table public.projects replica identity full;
alter table public.project_events replica identity full;
alter table public.event_assignments replica identity full;
alter table public.production_tasks replica identity full;
alter table public.project_deliveries replica identity full;
alter table public.payments replica identity full;
alter table public.notifications replica identity full;
alter table public.activity_logs replica identity full;

do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['projects', 'project_events', 'event_assignments', 'production_tasks',
                             'project_deliveries', 'payments', 'notifications', 'activity_logs']
    loop
      if not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- -------------------------------------------------------------- logo storage
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('studio-logos', 'studio-logos', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
    on conflict (id) do nothing;

    -- Objects live under "<studio_id>/..."; only that studio's owner may write.
    execute $p$ drop policy if exists "studio logos: owner insert" on storage.objects $p$;
    execute $p$ create policy "studio logos: owner insert" on storage.objects for insert to authenticated
      with check (bucket_id = 'studio-logos' and public.is_studio_owner(((storage.foldername(name))[1])::uuid)) $p$;
    execute $p$ drop policy if exists "studio logos: owner update" on storage.objects $p$;
    execute $p$ create policy "studio logos: owner update" on storage.objects for update to authenticated
      using (bucket_id = 'studio-logos' and public.is_studio_owner(((storage.foldername(name))[1])::uuid)) $p$;
    execute $p$ drop policy if exists "studio logos: owner delete" on storage.objects $p$;
    execute $p$ create policy "studio logos: owner delete" on storage.objects for delete to authenticated
      using (bucket_id = 'studio-logos' and public.is_studio_owner(((storage.foldername(name))[1])::uuid)) $p$;
    execute $p$ drop policy if exists "studio logos: owner select" on storage.objects $p$;
    execute $p$ create policy "studio logos: owner select" on storage.objects for select to authenticated
      using (bucket_id = 'studio-logos' and public.is_studio_owner(((storage.foldername(name))[1])::uuid)) $p$;
  end if;
exception when others then
  raise notice 'Storage policies were not created (%). Create the studio-logos bucket in the dashboard.', sqlerrm;
end $$;

-- ------------------------------------------------------------------ scheduler
-- Every 5 minutes: turn due reminders into notifications and queue e-mail.
-- (The process-notifications Edge Function calls the same idempotent function
-- and then sends the queued e-mail; see docs/SETUP.md.)
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('flashpilot-process-notifications', '*/5 * * * *', 'select public.process_due_notifications()');
  else
    raise notice 'pg_cron is not available; schedule process_due_notifications() externally (see docs/SETUP.md).';
  end if;
exception when others then
  raise notice 'pg_cron job was not created (%). Enable pg_cron and schedule process_due_notifications() (see docs/SETUP.md).', sqlerrm;
end $$;
