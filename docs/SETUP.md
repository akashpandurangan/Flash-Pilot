# Flash Pilot - setup & deployment

Flash Pilot is a React single-page app backed by **your own Supabase project** (Postgres + Auth + Storage +
Realtime + Edge Functions). Nothing runs without it: if the two `VITE_SUPABASE_*` variables are missing the
app shows a "Connect your Supabase project" screen rather than faking data.

> **What has and has not been verified.** The SQL migrations, row-level security, business rules and the whole
> reminder pipeline are tested against a real Postgres engine (PGlite). The UI is tested in a real browser
> against a *fake* network layer. The two Edge Functions, Supabase Auth e-mails, Realtime delivery and
> `pg_cron` have **not** been exercised against a live Supabase project from this repository. Work through the
> [live verification checklist](#9-live-verification-checklist) once after you configure a project.

---

## 1. Prerequisites

- Node.js 20 or newer (developed on Node 24) and npm
- A Supabase project (free tier is fine to start): <https://supabase.com/dashboard>
- Optional: the [Supabase CLI](https://supabase.com/docs/guides/cli) (`npm i -g supabase` or use `npx supabase`)
- Optional, for e-mail notifications: a [Resend](https://resend.com) account and a verified sending domain

## 2. Configure the frontend

```bash
npm install
cp .env.example .env.local      # PowerShell: Copy-Item .env.example .env.local
```

Edit `.env.local` with values from **Project Settings → API**:

| Variable | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | The **publishable / anon** key. Never the `service_role` / secret key. |
| `VITE_APP_URL` | *(optional)* The public URL of the deployed app. Defaults to the current origin. |

Anything prefixed `VITE_` is embedded in the browser bundle, so only ever put public values there.

## 3. Apply the database migrations

The schema lives in `supabase/migrations/` and is applied in file-name order. They are additive and contain no
destructive statements.

| File | Contents |
| --- | --- |
| `…01_schema.sql` | enums, tables, constraints, indexes, the `project_financials` view |
| `…02_security.sql` | role helpers, guard triggers, **all RLS policies**, the `project_overview` view, privileges |
| `…03_rpc.sql` | transactional operations (`create_studio`, `save_project`, `record_payment`, workflow, …) and activity triggers |
| `…04_notifications.sql` | reminder sync triggers, `process_due_notifications()`, the e-mail delivery queue |
| `…05_realtime_storage_cron.sql` | Realtime publication, `studio-logos` bucket policies, the 5-minute `pg_cron` job |
| `…06_event_team.sql` | `set_event_team()` for changing a team after creation |
| `…07_event_terminology.sql` | Re-words what the database writes (notifications, activity log, errors, stored links) to the *Events / Sessions* terms. Function replacements only - no schema change |

**With the CLI (recommended)**

```bash
supabase login
supabase link --project-ref <project-ref>
supabase db push
```

**Without the CLI:** open **SQL Editor** and run each file, in order, one at a time.

> Before running file 05, enable **pg_cron** (Database → Extensions → `pg_cron`). If it is not enabled the
> migration still succeeds, prints a notice and skips the job - you can enable the extension later and run the
> `cron.schedule(...)` statement from that file by hand.

## 4. Authentication settings

In **Authentication → URL Configuration**:

- **Site URL**: your app's public URL (e.g. `https://app.example.com`; `http://localhost:5173` for local dev).
- **Redirect URLs**: add `<app-url>/login` and `<app-url>/reset-password` (and the `http://localhost:5173/...`
  equivalents for development). Employee invitations and password resets send people to `/reset-password`.

In **Authentication → Providers → Email**:

- **Confirm email: ON** (required). Owner sign-up and the invitation flow assume addresses are verified.
- **Minimum password length: 8**.

In **Authentication → Email Templates** you can restyle the *Confirm signup*, *Invite user* and *Reset password*
messages. Keep the `{{ .ConfirmationURL }}` link.

> **Production e-mail:** Supabase's built-in mailer is heavily rate-limited and meant for testing. Before real
> use, set **Authentication → SMTP Settings** to your provider (Resend, Postmark, SES, …) or sign-up, invite and
> reset e-mails will be throttled.

## 5. Storage

File 05 creates a public bucket `studio-logos` (2 MB limit, PNG/JPEG/WebP) and policies that allow only the
studio's **owner** to write under `<studio_id>/…`. If your role could not create the policies you will see a
notice in the migration output - create the bucket in the dashboard and re-run the storage block.

## 6. Edge Functions

Two functions live in `supabase/functions/`:

| Function | Purpose | JWT |
| --- | --- | --- |
| `invite-employee` | Creates the sign-in account for an employee and sends the secure invitation. Re-checks on the server that the caller is the studio owner. | required |
| `process-notifications` | Turns due reminders/deadlines into notifications, then sends queued e-mail with retries. | not required - protected by `CRON_SECRET` |

```bash
supabase functions deploy invite-employee
supabase functions deploy process-notifications --no-verify-jwt

# Pick your own long random value for CRON_SECRET
supabase secrets set \
  CRON_SECRET="$(openssl rand -hex 32)" \
  APP_URL="https://app.example.com" \
  RESEND_API_KEY="re_xxx" \
  EMAIL_FROM="Flash Pilot <notifications@yourdomain.com>"
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically; never put the
service-role key in the frontend or in any `VITE_` variable.

| Secret | Required | Meaning |
| --- | --- | --- |
| `CRON_SECRET` | yes (process-notifications) | Shared secret the scheduler sends in the `x-cron-secret` header |
| `APP_URL` | recommended | Used for invite redirects and the "Open in Flash Pilot" link in e-mails |
| `RESEND_API_KEY`, `EMAIL_FROM` | optional | Enable e-mail delivery. **Without them nothing is sent** and deliveries are recorded as *skipped* with that reason; in-app notifications still work. |

## 7. Scheduling reminders (important)

Flash Pilot has two server-side jobs; both are safe to run repeatedly and from several places at once because
every notification has a unique de-duplication key and deliveries are claimed with row locks.

1. **In-app reminders & deadlines - already scheduled.** Migration 05 registers a `pg_cron` job
   (`flashpilot-process-notifications`, every 5 minutes) that calls `select public.process_due_notifications()`.
   Check it with `select * from cron.job;`. Reminders therefore fire within ~5 minutes of their due time
   ("about a day before").
2. **E-mail delivery - needs the Edge Function on a schedule.** The queue is filled by job 1; the function sends it.
   Store the secret once, then schedule an HTTP call:

   ```sql
   -- once: keep the secret in Vault (same value you gave `supabase secrets set CRON_SECRET`)
   select vault.create_secret('<your CRON_SECRET>', 'flashpilot_cron_secret');

   -- every 5 minutes
   select cron.schedule(
     'flashpilot-send-notifications',
     '*/5 * * * *',
     $$
     select net.http_post(
       url     := 'https://<project-ref>.supabase.co/functions/v1/process-notifications',
       headers := jsonb_build_object(
         'Content-Type', 'application/json',
         'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'flashpilot_cron_secret')
       ),
       body    := '{}'::jsonb
     );
     $$
   );
   ```

   (Enable the `pg_net` and `supabase_vault` extensions first. Alternatively use **Integrations → Cron → New job →
   Supabase Edge Function** and add the `x-cron-secret` header there.)

The function also calls `process_due_notifications()` itself, so on a project without `pg_cron` you can drive
everything from an external scheduler that `POST`s to the function every few minutes.

**Where to see what happened:** *Notifications → Email delivery* (owner only) lists every queued e-mail with its
status (*Queued / Sent / Failed / Not sent*), attempt count and last error. Failed attempts are also stored in
`notification_delivery_attempts`.

## 8. Local development

```bash
npm run dev            # http://localhost:5173
```

Against a hosted project, just use its URL/key in `.env.local`. For a fully local stack (needs Docker):

```bash
supabase start         # prints the local API URL and anon key
supabase db reset      # applies supabase/migrations
# put the printed URL/anon key into .env.local
```

Local auth e-mails are caught by Inbucket at <http://localhost:54324>. The local `config.toml` already enables
e-mail confirmation and registers the redirect URLs.

### Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | Type-check + production build into `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run typecheck` | `tsc` only |
| `npm run lint` | ESLint |
| `npm test` | All tests: unit + component (jsdom) and database suites (PGlite) |
| `npm run test:db` | Only the database suites (migrations, RLS, workflow, reminders) |
| `npm run test:browser` | Optional browser smoke test with a fake backend (needs Edge/Chrome) |

## 9. Live verification checklist

After configuring a real project, run through this once. It covers what the automated tests cannot.

1. Open the app → **Create your studio** → confirm the e-mail → sign in → complete the onboarding wizard.
2. Refresh in the middle of onboarding: you should resume where you left off.
3. Add a client, then **New event** with a session ~10 hours from now, assign yourself as lead photographer,
   set the booking to **Confirmed**, enter an amount and an advance.
4. Within ~5 minutes the bell shows a *New assignment* and an *Session reminder* (the session is already inside the
   24-hour window). `select status, remind_at from event_reminders;` should show `sent`.
5. Reschedule the session: the old reminder becomes `superseded`, a new one is scheduled, and the team gets an
   *updated* notice. Cancel the booking: reminders become `cancelled`.
6. **Team → Invite to sign in** for a second person (use another address you control). Open the e-mail link,
   set a password, and confirm they only see *Overview, Events, Calendar, Notifications* and cannot open
   `/payments`, `/clients` or `/team` by URL.
7. In two browsers (owner + photographer) change the event's stage and confirm the other window updates without
   a refresh (Realtime).
8. Record a payment bigger than the balance: you must be asked to confirm the overpayment.
9. *Notifications → Email delivery* (owner): with Resend configured the row is *Sent*; without it, *Not sent*
   with the reason - never a false "sent".

## 10. Deploying the frontend

```bash
npm run build          # outputs dist/
```

Any static host works. Because it is a single-page app, **every path must fall back to `index.html`** so deep
links and refreshes work. Ready-made configs are included: `public/_redirects` (Netlify, Cloudflare Pages) and
`vercel.json`. For other hosts add an equivalent rewrite. Set `VITE_SUPABASE_URL`,
`VITE_SUPABASE_PUBLISHABLE_KEY` (and optionally `VITE_APP_URL`) as **build-time** environment variables.

## 11. Security notes

- All authorization is enforced in Postgres (row-level security + checked RPCs). The UI only hides what a role
  cannot use. See [ARCHITECTURE.md](ARCHITECTURE.md#roles--permissions).
- The browser only ever holds the publishable key. The service-role key exists only inside Edge Functions.
- Only the studio **owner** can invite people, change access levels or grant financial permission. A manager can
  never grant themselves anything (enforced by a trigger, not the UI).
- Money lives in separate tables (`project_finance`, `payments`) readable only by people with financial access.
- Keep **Confirm email** on and rotate `CRON_SECRET` if it is ever exposed.
- Back up your database (Supabase → Database → Backups; point-in-time recovery on paid plans).

## 12. Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| "Connect your Supabase project" screen | `.env.local` missing/placeholder values, or the dev server was not restarted |
| Sign-up never sends an e-mail | Built-in mailer throttled - configure SMTP (§4) |
| Invite e-mail link says expired / loops to login | Redirect URL not in the allow-list (§4); resend the invitation |
| "Only the studio owner can invite people" | The signed-in user is not the owner of that studio |
| No reminders arrive | `select * from cron.job;` - is the job there? Is the booking **Confirmed**, the session in the future, with an active person assigned? Check `event_reminders` and `notifications`. |
| E-mails show *Not sent* | `RESEND_API_KEY` / `EMAIL_FROM` not set on the function, or the e-mail cron job (§7.2) is missing |
| `permission denied` / empty lists for a role | Expected for roles without access; confirm the person's access level under Team |
| Logo upload fails | Bucket/policies missing (§5), file > 2 MB, or not PNG/JPEG/WebP |
