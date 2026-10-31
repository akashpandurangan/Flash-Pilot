-- =============================================================================
-- Flash Pilot - personal appearance (theme and accent colour)
--
-- Each person chooses light / dark / system and an accent colour in Settings. The choice is
-- personal, so it lives on the person's OWN profile row (profiles is already "own row only"
-- for both reading and updating) rather than on any studio record, and it follows them to
-- every device. Stored as a small JSON object:  {"mode": "dark", "accent": "#a78bfa"}.
--
-- Additive and safe to apply on live data: one new column with an empty default (an empty
-- object means "nothing chosen yet", which the app reads as the existing light + lime look).
-- No policy changes: the existing profiles_select / profiles_update policies already restrict
-- every read and write to the signed-in user's own row.
--
-- The app works without this migration (it keeps the choice in the browser and quietly skips
-- the server copy), so it can be applied whenever convenient.
-- =============================================================================

alter table public.profiles
  add column if not exists appearance jsonb not null default '{}'::jsonb;

-- A stray or hostile payload cannot bloat the row or break the app: it must be an object, and a small one.
alter table public.profiles
  drop constraint if exists profiles_appearance_shape;
alter table public.profiles
  add constraint profiles_appearance_shape
  check (jsonb_typeof(appearance) = 'object' and pg_column_size(appearance) <= 512);

comment on column public.profiles.appearance is 'Personal UI preferences: {"mode": "light"|"dark"|"system", "accent": "#rrggbb"}. Own row only (RLS); {} = default look.';
