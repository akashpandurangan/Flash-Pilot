# Flash Pilot - architecture

## Stack

React 19 · TypeScript (strict) · Vite · Tailwind CSS v4 · React Router · TanStack Query · React Hook Form + Zod ·
Radix UI primitives · Lucide icons · date-fns / date-fns-tz · Supabase (Postgres, Auth, Storage, Realtime, Edge
Functions).

```
src/
  api/            one typed module per domain; the only code that talks to Supabase
  lib/            pure business logic (money, time zones, permissions, workflow, conflicts, reminders, alerts, csv)
  features/       screens grouped by domain (projects, clients, team, equipment, payments, calendar, …)
  components/ui   design-system primitives (button, form fields, dialog, menu/tabs, tables, badges, …)
  components/layout   app shell, global search
  hooks/          realtime sync, URL state, misc
supabase/
  migrations/     versioned SQL (schema, RLS, RPCs, notifications, realtime/storage/cron)
  functions/      invite-employee, process-notifications (Deno)
tests/db          database tests (PGlite = real Postgres engine)
tests/browser-smoke   optional browser smoke test against a fake backend
```

UI → `features/*` → `api/*` → Supabase. Business rules that matter for correctness (balances, state
transitions, who may do what, reminders) are enforced **in the database**; the TypeScript in `lib/` mirrors them
only so the UI can preview results and hide unavailable actions.

## Data model

Every business table carries `studio_id`; child tables reference parents through a composite `(id, studio_id)`
foreign key, so a row can never point at another studio's data.

| Table | Notes |
| --- | --- |
| `studios` | Settings, time zone (default `Asia/Kolkata`), currency (default `INR`), onboarding progress, reminder lead time, default checklist |
| `profiles` | One per auth user (created by trigger) |
| `employees` | The person record. `user_id` is NULL until invited - **an employee is not an account**. Holds `access_role`, `can_view_financials`, `invite_status`, `is_active` |
| `clients` | Contact details; archived, never deleted. Generated `phone_digits` powers duplicate warnings |
| `projects` | Booking status and production stage are **separate columns** with milestone timestamps |
| `project_finance` | Agreed amount, due date, notes - split from `projects` so RLS can hide money from crew |
| `project_events` | Multiple dated events per project; times stored as `timestamptz` (UTC) |
| `event_assignments` | People per event with a role |
| `equipment`, `event_equipment` | Inventory (unique asset tag or quantity) and per-event reservations (inventory item or free-text) |
| `payments` | Immutable payment records; voided, never deleted; recorded-by snapshot |
| `production_tasks`, `project_deliveries` | Checklist and delivery details |
| `activity_logs` | Who did what and when; `financial` entries are hidden from non-finance roles |
| `notifications`, `notification_deliveries`, `notification_delivery_attempts`, `event_reminders`, `notification_preferences` | The notification pipeline |
| views | `project_financials` (security-invoker; balances), `project_overview` (list rows + role-safe client fields) |

**Where this differs from the suggested table list** (deliberately):

- `studio_members` is merged into `employees` - every account holder is also an employee, and
  "record vs. account" is the nullable `user_id`. This keeps one source of truth.
- `project_assignments` → `event_assignments` and `project_equipment` → `event_equipment`, because the brief
  requires team and equipment *per event* (an engagement and a wedding need different people and gear).
- Added `project_finance` (column-level secrecy via RLS), and the delivery/reminder tables.

### Money

`numeric(12,2)` in Postgres; integer minor units (paise) in TypeScript. The balance is never stored:

```
balance = agreed_amount − Σ(payments where status = 'valid')      -- view project_financials
```

`record_payment()` locks the finance row, recomputes the balance server-side and **refuses an overpayment unless
`allow_overpayment` is passed**; a confirmed overpayment simply yields a negative balance, shown as *credit*.
Payments are voided (kept, marked, excluded) rather than deleted.

### Time zones

Instants are stored in UTC. All entry and display uses the *studio's* zone (`date-fns-tz`), so "9:00 AM" means
9:00 AM in `Asia/Kolkata` for every viewer. An end time at or before the start is read as after midnight.

## Roles & permissions

| | Owner | Manager | Photographer / crew | Editor |
| --- | :-: | :-: | :-: | :-: |
| Studio settings, invite people, set access & financial flag | ✔ | | | |
| Team / equipment management | ✔ | ✔ | | |
| Clients, create/edit projects, confirm/cancel bookings | ✔ | ✔ | | |
| Money: amounts, payments, financial reports | ✔ | only with flag | | |
| See projects | all | all | assigned only | assigned (event or editor) only |
| Client contact | full | full | name + phone | name only |
| Start production / mark shoot done | ✔ | ✔ | ✔ (assigned) | |
| Move to editing | ✔ | ✔ | | |
| Mark editing done / ready for delivery | ✔ | ✔ | | ✔ (assigned) |
| Mark delivered, record delivery, step back a stage | ✔ | ✔ | | |
| Tick checklist items | all phases | all phases | preparation, shoot | post, editing |

Enforcement lives in `02_security.sql` (RLS policies, `employees_guard`, helper functions) and the RPCs, which
re-check the caller. `src/lib/permissions.ts` mirrors the matrix for the UI and is unit-tested; `tests/db` proves
the database side (e.g. a photographer cannot read `payments`, `project_finance`, `clients`, or another
photographer's project).

## Workflow

Booking: `inquiry ⇄ confirmed → cancelled → (reopen) inquiry`. Only **confirmed** bookings are scheduled,
notified and reminded; cancelling releases reminders and equipment but keeps history.

Production: `upcoming → production → editing → ready_for_delivery → delivered`, with milestones inside stages:
*shoot completed* must precede editing; *editing completed* must precede ready-for-delivery; delivery needs
recorded delivery details. Owners/managers can step back one stage. Delivering with an outstanding balance is
allowed after an explicit confirmation. Ticking checklist items **never** changes the stage.

## Notifications & reminders

```
 confirm / assign / reschedule / cancel / deactivate
              │  (triggers keep this in sync)
              ▼
        event_reminders  ── scheduled | superseded | cancelled | sent | skipped | failed
              │   unique (event, person, event start)  → a new start time = a new reminder
              ▼
 pg_cron every 5 min → process_due_notifications()        (idempotent: unique dedupe_key)
              │   re-validates each reminder at send time (still confirmed? still assigned? same start?)
              ▼
        notifications (in-app, Realtime)  +  notification_deliveries (e-mail queue)
              │
              ▼
 Edge Function process-notifications → claim (FOR UPDATE SKIP LOCKED) → Resend
              → record_delivery_result: sent | retry (back-off) | failed | skipped (no provider)
              → every attempt logged in notification_delivery_attempts
```

Preferences (`notification_preferences`) are honoured when a notification is created. Reminders default to 24 h
before the reporting time (configurable 12–72 h); an event already inside the window is reminded immediately.

## Realtime

One channel per studio (filtered by `studio_id`) for the tables the UI shows - projects, events, assignments,
tasks, deliveries, payments, activity - and one per person for their notifications. Realtime applies RLS per
subscriber, so crew never receive payments or unrelated rows. Bursts are coalesced into one refetch; after any
dropped connection all cached data is refetched once the channel recovers; toasts are de-duplicated.

## What is verified, and how

| Layer | How | Where |
| --- | --- | --- |
| Migrations, constraints, RLS, role access, money rules, workflow, reminders, e-mail queue, atomic saves | Real Postgres engine (PGlite), impersonating each role | `tests/db` |
| Money, time zones, permissions, workflow rules, conflicts, alerts, reminder rules, CSV, form schema/payload | Unit tests | `src/lib/*.test.ts`, `src/features/**/*.test.ts` |
| Forms and dialogs (validation, double-submit, overpayment confirmation, error boundary) | Component tests (jsdom) | `src/**/*.test.tsx` |
| Routing, role gating, onboarding, layout at 390/820/1366 px, console cleanliness | Real browser, fake network | `tests/browser-smoke` |
| Supabase Auth e-mails, Realtime, `pg_cron`, Edge Functions, real PostgREST embedding | **Not automated** | [SETUP.md §9](SETUP.md#9-live-verification-checklist) |

## Known limits (by design for the MVP)

One studio per user in the UI (the schema is multi-studio-ready); no package templates; no payment gateway; no
WhatsApp/push; no media storage (delivery links point to your own storage); e-mail needs a provider key.
