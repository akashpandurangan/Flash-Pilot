# Flash Pilot - Interactive Demo

A frontend-only, click-through version of Flash Pilot for a portfolio. It runs the **real screens, layouts and styles** from
`src/` on an **in-memory sample studio** ("Lumen Studio", Mumbai) instead of a backend. Nothing you do in it is saved or sent
anywhere; a page reload (or the **Reset** button in the demo bar) puts the sample data back.

- **Signed in as the studio Owner**, Olivia Mehra (the only role for now).
- **Every screen works:** Dashboard, Events (list, cards, filters, search), event detail (overview, production checklist,
  payments, activity), New/Edit event, Calendar, Clients, Team, Equipment, Payments, Notifications, Reports, Settings, Account.
- **Realistic, fictional data:** 21 events across every stage (inquiry, upcoming, in production, waiting for approval,
  editing, out for delivery, delivered, cancelled, archived), payments with advances/instalments/overdue/credit/void, delivery
  links, a team of ten, equipment with conflicts, notifications and e-mail delivery outcomes. Dates are relative to *today*, so
  the dashboard always looks current. All names, e-mails (`*.example`), phone numbers (`+91 555xx xxxxx`) and venues are invented.
- **"Interactive demo" bar** at the bottom of every screen: *Dashboard* (back to the demo dashboard), *Reset* (restore the
  sample data) and *Exit demo* (to https://akashpandurangan.com/). It collapses to a small chip but never disappears.

The production app is untouched: **every file of this demo is new and lives in `demo/`**. No production source, config,
`package.json`, lockfile or `vercel.json` was edited, and the production build is byte-for-byte identical with or without it.

---

## Run it locally

From the repository root (after `npm ci`):

```bash
npx vite --config demo/vite.config.ts            # dev server  -> http://localhost:5199
```

Build and preview the production-style bundle:

```bash
npx vite build --config demo/vite.config.ts      # writes demo/dist
npx vite preview --config demo/vite.config.ts    # serves it   -> http://localhost:4199
```

No `.env` file and no credentials are needed - the demo never reads one (`envDir` points at `demo/`, which has none).

## Deploy it separately on Vercel (its own project, its own URL)

Create a **new** Vercel project for the demo. Do not change the existing Flash Pilot project.

1. Vercel dashboard -> **Add New... -> Project** -> import the same GitHub repository (`Flash-Pilot`).
2. Give it a distinct name (e.g. `flash-pilot-demo`) - that name becomes the URL (`flash-pilot-demo.vercel.app`).
3. **Production Branch:** the branch that holds `demo/` (`interactive-demo`, or `main` once it is merged).
4. **Framework Preset:** Vite. **Root Directory:** the repository root (leave empty).
5. Override the build settings:
   - **Build Command:** `npx vite build --config demo/vite.config.ts`
   - **Output Directory:** `demo/dist`
   - **Install Command:** leave the default (`npm install` / `npm ci`).
6. **Environment Variables:** add **none**. In particular do not add any `VITE_SUPABASE_*` value - the demo does not use them,
   and leaving them out is what guarantees it cannot reach a database.
7. Deploy. The repository's existing `vercel.json` already does what the demo needs (it rewrites every path to `/index.html` so
   deep links such as `/events/...` work, and caches `/assets`). The existing production project is unaffected because it has its
   own settings (`vite build` -> `dist`).
8. Optional: add your own domain to the *demo* project only, e.g. `flash-pilot-demo.akashpandurangan.com`.

To link to it from the portfolio, point the Flash Pilot card's *View Live Prototype* button at the new URL.

## How the isolation works

`demo/vite.config.ts` is a separate Vite config. A small plugin (`swapBackend`) replaces **15 modules** by the file they resolve
to - so every spelling of an import is caught, including relative ones - with in-memory versions in `demo/src`:

| Real module (`src/...`) | Demo replacement (`demo/src/...`) |
| --- | --- |
| `api/{appearance,clients,core,dashboard,employees,equipment,notifications,payments,projects,schedule,studio}.ts` | `api/*.ts` - same function names, parameters and return shapes, backed by the in-memory store |
| `features/auth/AuthProvider.tsx` | `auth/AuthProvider.tsx` - always signed in as the owner; sign-in/up/password are switched off |
| `hooks/useRealtimeSync.ts` | `hooks/useRealtimeSync.ts` - refreshes open screens when the local data changes |
| `lib/supabase.ts`, `lib/env.ts` | `lib/supabase.ts` (a tripwire that throws if touched), `lib/env.ts` (no credentials) |

Everything else - all pages, the app shell, UI components, forms, validation, money/date/workflow/alert/conflict logic - is
the real code, unchanged. The data layer re-implements the database's rules in `demo/src/store` and `demo/src/api`
(payment/overpayment checks, booking and production state machines, the per-minute lifecycle job, project codes, default
checklists, dashboard KPIs, activity wording), and every write is all-or-nothing, like a database transaction.

Defence in depth, so the demo cannot reach a backend even by mistake:

1. The Supabase SDK is never bundled (its package name is aliased to a stub that throws), so the build contains no client code.
2. `lib/supabase` is a tripwire that throws on any access.
3. A runtime guard (`demo/src/guard.ts`) refuses `fetch`, XHR, WebSocket, EventSource and `sendBeacon` to any other origin.
4. No environment variables are read.

### Type parity

`demo/src/parity.ts` asserts, at type level, that each demo module exports everything the real module does with compatible
types. If the app's API changes shape, `tsc -p demo/tsconfig.json` fails there, so the demo cannot drift silently.

### Why `demo/.ignore` exists

Tailwind scans the whole repository for class names. Without it, the production build would also scan `demo/` and pick up a few
extra utility classes, changing the production CSS (and so every chunk hash). `demo/.ignore` hides this folder from that scan,
and the demo styles its own bar with plain CSS. Side effect: editor search built on ripgrep skips `demo/` unless you turn off
"use ignore files".

## Checks

Run from the repository root. The browser suites need a Chromium-based browser; set `DEMO_BROWSER` to its path if it is not
Microsoft Edge in the default Windows location. Build the demo first (`demo/dist`).

```bash
node node_modules/typescript/bin/tsc -p demo/tsconfig.json              # demo typecheck + parity with the real API
node node_modules/vitest/vitest.mjs run --config demo/vitest.config.ts  # 65 data-layer tests
node demo/scripts/check-bundle.mjs       # built demo has no backend code, URLs, credentials or real-looking contact data
node demo/scripts/check-additive.mjs     # git: only NEW files under demo/ exist - nothing else was touched
node demo/tests/e2e.mjs                  # 126 browser checks: every route, search, filters, tabs, details, payments, workflow, demo bar
node demo/tests/e2e-mutations.mjs        # 51 browser checks: create/edit/cancel/archive events, team, equipment, settings, account
node demo/tests/responsive.mjs           # 146 checks at 1440, 1280, 1024, 820, 768, 414, 390 and 360 px
node demo/tests/dev-server.mjs           # the dev server serves the demo (not the production index.html)
```

The browser suites run against a local server with a request guard that **aborts any request that is not to that server** and
reports it; they assert that none were made and that no WebSocket was opened.

The app's own checks are unaffected by the demo: `npm run lint` (which also lints `demo/`), `npm run typecheck` and
`npm test` do not touch demo code (`tsc`/`vitest` only include `src` and `tests`).

## What differs from the real app

| Area | In the demo |
| --- | --- |
| Data | In memory, fictional, rebuilt on reload / Reset |
| Sign-in, sign-up, forgot/reset password, change password | Turned off (you are always the owner); the app explains this |
| Sign out | Shows "turned off in the demo" with an *Exit demo* action |
| Team invitations | Recorded locally ("no email was sent") |
| E-mail notifications | Never sent; the *Email delivery* tab shows sample outcomes |
| Studio logo upload | Stays in the browser tab (not uploaded anywhere) |
| Realtime | Replaced by local change notifications |
| Roles | Owner only. Other roles can be added later by returning a different employee from `fetchMemberships` (`demo/src/api/studio.ts`) |

## Layout of `demo/`

```
demo/
  index.html, vite.config.ts, tsconfig.json, vitest.config.ts, .gitignore, .ignore, README.md
  src/
    main.tsx            entry: same providers as src/main.tsx + the demo bar
    DemoBar.tsx, demo-bar.css, entry.css, guard.ts
    auth/AuthProvider.tsx, hooks/useRealtimeSync.ts, lib/{supabase,env}.ts, blocked/backend-sdk.ts
    api/*.ts            the 11 data-layer modules (same shape as src/api)
    store/              core, db, seed (the sample studio), views (computed views, KPIs, lifecycle), log, access
    parity.ts           type-level check against the real modules
  scripts/              check-bundle.mjs, check-additive.mjs
  tests/                api.test.ts (vitest) + browser suites (Playwright)
```
