# Flash Pilot

Studio operations for photography businesses: bookings, clients, team, equipment, payments, production and
delivery - in one place. A black-and-white, no-nonsense workspace backed by your own Supabase project.

**What it does**

- **Projects & events** - multi-day bookings (engagement → wedding → reception), each with its own time, venue,
  team and equipment; booking status (inquiry / confirmed / cancelled) kept separate from production stage.
- **Production workflow** - upcoming → production → editing → ready → delivered, with a role-aware checklist,
  editor assignment, deadlines and delivery details.
- **Money, done safely** - you enter the amount (no packages); advances and installments are recorded payments;
  the balance is always *calculated* from valid payments, overpayments need explicit confirmation.
- **Team & permissions** - owner, manager, photographer, editor. Crew see only what they're assigned to and never
  see money. Enforced by the database, not just the UI. Employees are invited securely - no shared passwords.
- **Calendar & conflicts** - month/week/day/agenda views, warnings for double-booked people, over-committed gear
  and unstaffed events.
- **Reminders** - server-side, duplicate-safe reminders ~24 h before confirmed events; reschedules and
  cancellations withdraw stale ones; in-app now, e-mail when you add a provider key.
- **Live updates** - Supabase Realtime keeps open screens current.
- **Reports** - bookings, stages, upcoming events, workload, outstanding & received payments, pending/overdue
  delivery, all exportable to CSV.

## Quick start

```bash
npm install
cp .env.example .env.local      # then fill in your Supabase URL + publishable key
npm run dev
```

Without those two values the app shows a "Connect your Supabase project" screen - it never fakes data.
You must also apply the database migrations and configure auth; see **[docs/SETUP.md](docs/SETUP.md)** for the
full guide (migrations, auth, storage, Edge Functions, scheduling reminders, e-mail, deployment).

## Scripts

| | |
| --- | --- |
| `npm run dev` / `build` / `preview` | develop, production build, preview the build |
| `npm run typecheck` / `lint` | strict TypeScript / ESLint |
| `npm test` | unit + component tests **and** the database suites |
| `npm run test:db` | database suites only (migrations, RLS, workflow, reminders) |
| `npm run test:browser` | optional: real-browser smoke test against a fake backend |

## Documentation

- [docs/SETUP.md](docs/SETUP.md) - environment variables, migrations, Supabase configuration, deployment, live checklist
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) - data model, permissions matrix, workflow, notification pipeline, what is tested

## Status

All features above are implemented end to end. The database layer is tested against a real Postgres engine; the UI
is tested in jsdom and in a real browser against a fake network. Supabase-hosted pieces (Auth e-mails, Realtime,
`pg_cron`, Edge Functions) must be verified once on your project using the checklist in SETUP.md §9.
