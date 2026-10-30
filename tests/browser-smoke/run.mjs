// Browser smoke test: drives the real UI in a real browser against a *fake* Supabase
// (network responses are intercepted - see fake-backend.mjs). It proves routing, role gating,
// forms, layout at three widths and a clean console. It does NOT test the real database or
// Supabase Auth/Realtime; those are covered by tests/db and by docs/SETUP.md's live checklist.
//
//   npm run test:browser
//
// Needs a Chromium-based browser: Edge or Chrome is used from the system (no download).
//   BROWSER_CHANNEL=msedge|chrome   (default: msedge on Windows, chrome elsewhere)
//   BROWSER_PATH=/path/to/browser    (overrides the channel)
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { ids, installFakeSupabase } from './fake-backend.mjs'

const PORT = 5199
const BASE = `http://localhost:${PORT}`
const OUT = fileURLToPath(new URL('./.screenshots/', import.meta.url))
mkdirSync(OUT, { recursive: true })

// Start Vite pointed at a fake Supabase URL so the app believes it is configured.
const server = spawn(`npx vite --port ${PORT} --strictPort`, {
  shell: true,
  stdio: 'ignore',
  env: { ...process.env, VITE_CONFIG_NATIVE_IGNORE_WARNING: 'true', VITE_SUPABASE_URL: 'http://127.0.0.1:54321', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fake_for_smoke_test' },
})
const stopServer = () => { try { server.kill() } catch { /* already gone */ } }
process.on('exit', stopServer)
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(BASE)).ok) break } catch { /* not up yet */ }
  await new Promise((r) => setTimeout(r, 500))
}

const launchOptions = process.env.BROWSER_PATH
  ? { executablePath: process.env.BROWSER_PATH, headless: true }
  : { channel: process.env.BROWSER_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : 'chrome'), headless: true }
const browser = await chromium.launch(launchOptions)

const results = []
const problems = []
const NOISE = [/WebSocket/i, /ERR_CONNECTION_REFUSED/i, /realtime/i, /favicon/i, /net::ERR_FAILED/i, /Download the React DevTools/i]

function watch(page, label) {
  page.on('console', (m) => {
    if (!['error', 'warning'].includes(m.type())) return
    const text = m.text()
    if (NOISE.some((r) => r.test(text))) return
    problems.push(`[${label}] console.${m.type()}: ${text.slice(0, 400)}`)
  })
  page.on('pageerror', (e) => problems.push(`[${label}] PAGE ERROR: ${e.message.slice(0, 400)}`))
}

const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}`) }

async function newSession(role, viewport) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, timezoneId: 'America/New_York' }) // browser tz deliberately != studio tz
  const api = []
  const db = await installFakeSupabase(context, role, api)
  const page = await context.newPage()
  watch(page, `${role}@${viewport.width}`)
  return { context, page, api, db }
}

async function login(page) {
  await page.goto(`${BASE}/login`)
  await page.getByLabel('Email').fill('owner@lumen.studio')
  await page.getByLabel('Password').fill('Password123')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15000 })
}

const shot = (page, name) => page.screenshot({ path: `${OUT}${name}.png`, fullPage: false })

/* ---------------------------------------------------------------- owner / desktop */
{
  const { page } = await newSession('owner', { width: 1366, height: 860 })

  // login validation
  await page.goto(`${BASE}/login`)
  await page.getByRole('button', { name: 'Sign in' }).click()
  check('login shows validation errors', (await page.getByText('Enter a valid email address').count()) > 0 && (await page.getByText('Enter your password').count()) > 0)
  await shot(page, '01-login')

  // protected route redirects to login
  await page.goto(`${BASE}/events`)
  await page.waitForURL(/\/login/)
  check('anonymous visit to /events redirects to /login', true)

  await login(page)
  check('after login the user returns to the page they were heading to', new URL(page.url()).pathname === '/events')
  await page.goto(`${BASE}/projects/${ids.p1}?tab=payments`)
  await page.waitForURL(/\/events\//)
  check('an old /projects link is forwarded to /events (id and query kept)', new URL(page.url()).pathname === `/events/${ids.p1}` && new URL(page.url()).search === '?tab=payments')
  await page.goto(`${BASE}/`)
  await page.getByRole('heading', { level: 1 }).waitFor()
  check('dashboard greets the user', /Good (morning|afternoon|evening), Olivia/.test(await page.getByRole('heading', { level: 1 }).innerText()))
  await page.waitForTimeout(600)
  const kpiLabels = ['Upcoming events', "Today's events", 'Ready for delivery', 'Needs attention']
  const kpiFound = await Promise.all(kpiLabels.map(async (l) => (await page.getByText(l, { exact: true }).count()) > 0))
  check('dashboard shows the four overview cards', kpiFound.every(Boolean), kpiLabels.filter((_, i) => !kpiFound[i]).join(', '))
  // a card is: <div><p>label</p>…</div><p>value</p>
  const cardValue = async (label) => Number(await page.locator('p', { hasText: new RegExp(`^${label}$`) }).first().locator('xpath=../following-sibling::p[1]').innerText())
  const [upcomingN, attentionN] = [await cardValue('Upcoming events'), await cardValue('Needs attention')]
  check('dashboard overview numbers come from the API (upcoming and attention counts are non-zero)', upcomingN > 0 && attentionN > 0, `upcoming=${upcomingN} attention=${attentionN}`)
  // one definition of "upcoming" everywhere: the card, the pipeline and the featured event must agree
  const pipelineUpcoming = Number(/: (\d+) event/.exec(await page.getByRole('link', { name: /^Upcoming: \d+ events?$/ }).getAttribute('aria-label'))?.[1])
  check('pipeline "Upcoming" matches the Upcoming events card', pipelineUpcoming === upcomingN, `pipeline=${pipelineUpcoming} card=${upcomingN}`)
  const featuredCard = page.getByRole('article', { name: 'Featured event' })
  check('featured event shows the nearest upcoming event with client, venue, status and team', (await featuredCard.getByText('Mehta Corporate Launch').count()) > 0 && (await featuredCard.getByText(/Rohan Mehta/).count()) > 0 && (await featuredCard.getByText(/Jio World Centre/).count()) > 0 && (await featuredCard.getByText('Confirmed', { exact: true }).count()) > 0 && (await featuredCard.getByText('Upcoming', { exact: true }).count()) > 0 && (await featuredCard.getByText(/photographer/).count()) > 0)
  check('no empty "No upcoming events" state while an upcoming event exists', (await page.getByText('No upcoming events').count()) === 0)
  check('dashboard shows the Today events and Ready for delivery cards, and no "In production" card', (await page.getByText("Today's events", { exact: true }).count()) === 1 && (await page.getByText('Ready for delivery', { exact: true }).count()) === 1 && (await page.getByText('In production', { exact: true }).count()) === 0)
  check('Upcoming events card links to the filtered Events list', (await page.getByRole('link', { name: /Upcoming events/ }).first().getAttribute('href')) === '/events?stage=upcoming')
  check('Ready for delivery card links to the Out for Delivery list', (await page.getByRole('link', { name: /Ready for delivery/ }).first().getAttribute('href')) === '/events?stage=out_for_delivery')
  const sideNav = (await page.getByRole('navigation', { name: 'Main' }).getByRole('link').allInnerTexts()).map((s) => s.replace(/\s+\d+$/, '').trim())
  check('sidebar has no Production or Deliveries entries', JSON.stringify(sideNav) === JSON.stringify(['Overview', 'Events', 'Calendar', 'Clients', 'Team', 'Equipment', 'Payments', 'Reports']), sideNav.join(', '))
  check('dashboard shows the sidebar section labels', (await page.getByText('Studio management', { exact: false }).count()) > 0 && (await page.getByText('Workspace', { exact: false }).count()) > 0)
  // compact sizing (viewport is 1366x860, so the sidebar is in its normal, not short-screen, form)
  const sizes = await page.evaluate(() => {
    const px = (el) => Math.round(el?.getBoundingClientRect().height ?? 0)
    return {
      sidebarWidth: Math.round(document.querySelector('aside')?.getBoundingClientRect().width ?? 0),
      navRow: px(document.querySelector('nav[aria-label="Main"] a')),
      newEvent: px(document.querySelector('a[aria-label="New event"]')),
      search: px(document.querySelector('button[aria-label="Search"]')),
      title: parseFloat(getComputedStyle(document.querySelector('h1')).fontSize),
      metricValue: parseFloat(getComputedStyle(document.querySelector('p.leading-none')).fontSize),
    }
  })
  check('sidebar is 250-265px wide', sizes.sidebarWidth >= 250 && sizes.sidebarWidth <= 265, `${sizes.sidebarWidth}px`)
  check('navigation rows are 40-44px', sizes.navRow >= 40 && sizes.navRow <= 44, `${sizes.navRow}px`)
  check('header search and "New Event" are 42px', sizes.newEvent === 42 && sizes.search === 42, `new event ${sizes.newEvent}px, search ${sizes.search}px`)
  check('dashboard title is 28-32px and metric numbers are at most 40px', sizes.title >= 28 && sizes.title <= 32 && sizes.metricValue <= 40, `title ${sizes.title}px, metric ${sizes.metricValue}px`)
  check('dashboard lists upcoming events', (await page.getByText('Mehta Corporate Launch').count()) > 0)
  check('dashboard flags the double-booked photographer in Needs attention', (await page.getByText('Photographer double-booked').count()) > 0)
  check('dashboard flags overdue editing', (await page.getByText(/Editing overdue/).count()) > 0)
  check('dashboard shows the unpaid balance as an issue with a clear action', (await page.getByText('Balance payment pending').count()) > 0 && (await page.getByRole('link', { name: /Record payment/ }).count()) > 0)
  check('insights panel says it is rule-based, not AI', (await page.getByText(/not AI-generated/).count()) > 0)
  await shot(page, '02-dashboard')
  await featuredCard.click({ position: { x: 40, y: 40 } })
  await page.waitForURL(new RegExp(`/events/${ids.p2}$`))
  check('clicking the featured event opens that event', new URL(page.url()).pathname === `/events/${ids.p2}`)
  await page.goto(`${BASE}/`)
  await page.getByRole('heading', { level: 1 }).waitFor()

  const owner = [
    ['/events', '03-projects', 'Sharma–Rao Wedding'],
    ['/events/new', '04-project-new', 'Event details'],
    [`/events/${ids.p1}`, '05-project-detail', 'Wedding ceremony'],
    [`/events/${ids.p1}/edit`, '06-project-edit', 'Event details'],
    ['/calendar', '07-calendar-month', 'Scheduling warnings'],
    ['/clients', '08-clients', 'Anita Sharma'],
    [`/clients/${ids.c1}`, '09-client-detail', 'Contact'],
    ['/team', '10-team', 'Riya Kapoor'],
    ['/equipment', '11-equipment', 'Sony A7 IV'],
    ['/payments', '12-payments', 'Event balances'],
    ['/notifications', '13-notifications', 'Reminder: Product launch'],
    ['/reports', '14-reports', 'Reports'],
    ['/settings', '15-settings', 'Studio details'],
    ['/account', '16-account', 'Change password'],
  ]
  for (const [path, name, expectText] of owner) {
    await page.goto(`${BASE}${path}`)
    let ok = true
    try { await page.getByText(expectText, { exact: false }).first().waitFor({ timeout: 8000 }) } catch { ok = false }
    await page.waitForTimeout(250)
    check(`direct URL ${path} renders after a full page load`, ok, ok ? '' : `missing "${expectText}"`)
    await shot(page, name)
  }

  // calendar views
  for (const v of ['week', 'day', 'list']) {
    await page.goto(`${BASE}/calendar?view=${v}`)
    await page.waitForTimeout(500)
    await shot(page, `07-calendar-${v}`)
  }
  await page.goto(`${BASE}/calendar?view=list`)
  await page.getByText('Mehta Corporate Launch').first().waitFor()
  check('calendar agenda lists events', true)

  // global search + shortcut
  await page.goto(`${BASE}/`)
  await page.getByRole('heading', { level: 1 }).waitFor()
  await page.waitForTimeout(500)
  await page.keyboard.press('Control+k')
  await page.getByPlaceholder('Search events, clients, team…').fill('sharma')
  await page.waitForTimeout(700)
  await shot(page, '17-search')
  check('Ctrl+K opens global search', (await page.getByPlaceholder('Search events, clients, team…').count()) === 1)
  await page.keyboard.press('Escape')

  // redesigned list pages
  await page.goto(`${BASE}/team`)
  await page.getByText('Riya Kapoor').first().waitFor()
  check('team page shows member cards with upcoming sessions and invitation actions', (await page.getByText(/upcoming sessions?/).count()) >= 3 && (await page.getByRole('button', { name: /Invite|Resend invite/ }).count()) > 0)
  await page.goto(`${BASE}/clients`)
  await page.getByText('Anita Sharma').first().waitFor()
  await page.waitForTimeout(500)
  check('clients list shows each client\'s event count and outstanding balance', (await page.getByRole('columnheader', { name: 'Outstanding' }).count()) === 1 && (await page.getByText('₹1,50,000').count()) > 0)
  await page.goto(`${BASE}/reports`)
  await page.getByRole('heading', { name: 'Events per month' }).waitFor()
  check('reports overview shows charts for events, payments, pipeline and delivery', (await page.getByRole('heading', { name: 'Payments received' }).count()) > 0 && (await page.getByRole('heading', { name: 'Production pipeline' }).count()) > 0 && (await page.getByRole('heading', { name: 'Delivery performance' }).count()) > 0)
  check('reports charts have a text alternative', (await page.locator('figure figcaption').first().innerText()).startsWith('Events per month:'))
  await page.goto(`${BASE}/equipment`)
  await page.getByText('Equipment items').waitFor()
  check('equipment page summarises availability and shows reservations per item', (await page.getByText('Available now', { exact: true }).count()) > 0 && (await page.getByText(/\d+ upcoming/).count()) > 0)
  await page.goto(`${BASE}/settings`)
  await page.getByText('Team access').waitFor()
  check('settings links to team access, account and notification preferences', (await page.getByRole('navigation', { name: 'Related settings' }).getByRole('link').count()) === 3)
  await page.goto(`${BASE}/events`)
  await page.getByText('Sharma–Rao Wedding').first().waitFor()
  for (const chip of ['All Events', 'Upcoming', 'In Production', 'Waiting for Approval', 'Editing', 'Out for Delivery', 'Delivered', 'Cancelled']) {
    if ((await page.getByRole('button', { name: chip, exact: true }).count()) + (await page.getByRole('radio', { name: chip, exact: true }).count()) === 0) check(`events page has the "${chip}" filter`, false)
  }
  check('events page has no "Projects" wording', !/\bProjects?\b/.test(await page.locator('main').innerText()))
  await page.goto(`${BASE}/`)

  // notification bell
  await page.getByRole('button', { name: /Notifications, 1 unread/ }).click()
  await page.waitForTimeout(300)
  check('bell shows unread count and the latest items', (await page.getByText('Reminder: Product launch').count()) > 0)
  await shot(page, '18-bell')
  await page.keyboard.press('Escape')

  // project form validation
  await page.goto(`${BASE}/events/new`)
  await page.getByRole('button', { name: 'Create event' }).click()
  await page.waitForTimeout(400)
  check('empty project form shows inline errors', (await page.getByText('Choose a client').count()) > 0 && (await page.getByText('Give the event a name').count()) > 0 && (await page.getByText('Choose the session date').count()) > 0)
  await shot(page, '19-project-form-errors')

  // client dialog + duplicate warning
  await page.goto(`${BASE}/clients`)
  await page.getByRole('button', { name: 'New client' }).first().click()
  await page.getByLabel('Full name').fill('Anita S')
  await page.getByLabel(/^Phone/).fill('+91 99999 11111')
  await page.waitForTimeout(900)
  check('new-client dialog warns about a matching phone number', (await page.getByText('This looks like an existing client').count()) > 0)
  await shot(page, '20-client-dialog')
  await page.keyboard.press('Escape')

  // project detail tabs
  await page.goto(`${BASE}/events/${ids.p1}?tab=production`)
  await page.getByText('Production checklist').waitFor()
  await shot(page, '21-project-production')
  check('production tab shows the whole lifecycle and when it advances', (await page.getByRole('list', { name: 'Production progress' }).getByText('Waiting for Client Approval').count()) > 0 && (await page.getByText('Out for Delivery', { exact: true }).count()) > 0)

  // an event waiting for client approval: shown clearly, never advances on its own, and approval is an explicit, recorded action
  await page.goto(`${BASE}/events/${ids.p4}`)
  await page.getByRole('heading', { level: 1, name: 'Kapoor Engagement Shoot' }).waitFor()
  check('event details say the event is waiting for client approval', (await page.getByRole('status').filter({ hasText: 'Waiting for client approval' }).count()) > 0)
  await page.goto(`${BASE}/events/${ids.p4}?tab=production`)
  await page.getByText('Production checklist').waitFor()
  check('production tab shows the approval is pending, with a Record client approval action', (await page.getByText('Client approval - pending').count()) > 0 && (await page.getByRole('button', { name: 'Record client approval' }).count()) === 1)
  check('no editing or delivery actions are offered before approval', (await page.getByRole('button', { name: /Mark editing completed|Mark out for delivery|Mark delivered/ }).count()) === 0)
  await page.getByRole('button', { name: 'Record client approval' }).click()
  await page.getByLabel('How did they approve?').fill('Approved by phone')
  await shot(page, '21b-approval-dialog')
  await page.getByRole('button', { name: 'Record approval' }).click()
  await page.getByRole('button', { name: 'Mark editing completed' }).waitFor()
  check('recording approval moves the event into editing and keeps who and how', (await page.getByText('Client approved', { exact: true }).count()) > 0 && (await page.getByText(/Recorded by Olivia Mehra/).count()) > 0)
  await shot(page, '21c-after-approval')
  await page.goto(`${BASE}/events/${ids.p1}?tab=payments`)
  await page.getByText('Payment history').waitFor()
  await shot(page, '22-project-payments')
  await page.getByRole('button', { name: /Record payment/ }).first().click()
  await page.getByLabel(/Amount received/).fill('200000')
  await page.waitForTimeout(300)
  check('payment dialog warns when the amount exceeds the balance', (await page.getByText(/more than the balance/).count()) > 0)
  await shot(page, '23-payment-overpay')
  await page.keyboard.press('Escape')
  await page.goto(`${BASE}/events/${ids.p1}?tab=activity`)
  await page.getByText('Client approval recorded - editing started').waitFor()
  check('activity timeline shows who/when', (await page.getByText(/Olivia Mehra ·/).count()) > 0)

  // 404
  await page.goto(`${BASE}/definitely-not-a-page`)
  await page.waitForTimeout(400)
  check('unknown URL shows a not-found page inside the app', (await page.getByText('Page not found').count()) > 0)
  await shot(page, '24-404')

  // sign out
  await page.goto(`${BASE}/`)
  await page.getByRole('button', { name: 'Sign out' }).click()
  await page.waitForURL(/\/login/)
  check('sign out returns to /login', true)
}

/* ------------------------------------------------------------------ owner / mobile */
{
  const { page } = await newSession('owner', { width: 390, height: 844 })
  await login(page)
  await page.getByRole('heading', { level: 1 }).waitFor()
  await page.waitForTimeout(600)
  await shot(page, '30-mobile-dashboard')
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
  check('mobile dashboard has no horizontal page scroll', !overflow)
  await page.getByRole('button', { name: 'Open menu' }).click()
  await page.waitForTimeout(300)
  await shot(page, '31-mobile-nav')
  check('mobile drawer lists every section for the owner', (await page.getByRole('navigation', { name: 'Main' }).getByRole('link').count()) === 8)
  await page.keyboard.press('Escape')
  for (const [path, name] of [['/events', '32-mobile-projects'], ['/events/new', '33-mobile-project-form'], [`/events/${ids.p1}`, '34-mobile-project-detail'], ['/clients', '35-mobile-clients'], ['/calendar', '36-mobile-calendar'], ['/team', '37-mobile-team'], ['/payments', '38-mobile-payments']]) {
    await page.goto(`${BASE}${path}`)
    await page.waitForTimeout(700)
    const o = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
    check(`mobile ${path} fits the screen width`, !o)
    await shot(page, name)
  }
}

/* ------------------------------------------------------- responsive matrix */
for (const width of [390, 768, 1024, 1280, 1440]) {
  const { page } = await newSession('owner', { width, height: width < 800 ? 844 : 900 })
  await login(page)
  await page.getByRole('heading', { level: 1 }).waitFor()
  for (const path of ['/', '/events', `/events/${ids.p1}`, '/calendar', '/clients', '/team', '/equipment', '/reports', '/settings']) {
    await page.goto(`${BASE}${path}`)
    await page.waitForTimeout(600)
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    check(`${width}px: ${path === '/' ? 'dashboard' : path.replace(ids.p1, ':id')} has no horizontal page scroll`, over <= 1, `overflow ${over}px`)
  }
  if (width === 1440) await shot(page, '45-wide-reports')
  await page.close()
}

/* ------------------------------------------------------------------ tablet */
{
  const { page } = await newSession('owner', { width: 820, height: 1100 })
  await login(page)
  await page.waitForTimeout(700)
  await shot(page, '40-tablet-dashboard')
  await page.goto(`${BASE}/events`)
  await page.waitForTimeout(700)
  const o = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
  check('tablet projects list fits the screen width', !o)
  await shot(page, '41-tablet-projects')
}

/* ------------------------------------------- the reported bug: "upcoming" in the database, but already over */
{
  const { page, db } = await newSession('owner', { width: 1366, height: 860 })
  // One confirmed event that is still stored as "upcoming" although all its sessions finished three days ago
  // (what a studio looks like before the scheduler runs). The dashboard used to say 0 / 1 / "No upcoming events".
  const H = 3_600_000
  const base = db.overview.find((p) => p.id === ids.p2)
  const stale = { ...base, production_stage: 'upcoming', first_event_at: new Date(Date.now() - 72 * H).toISOString(), next_event_at: null, last_event_at: new Date(Date.now() - 66 * H).toISOString() }
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': 'content-range' }
  await page.route('**/rest/v1/project_overview*', (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json', 'content-range': '0-0/1' }, body: JSON.stringify([stale]) })
  })
  await login(page)
  await page.getByRole('heading', { level: 1 }).waitFor()
  await page.waitForTimeout(700)
  const cardValue = async (label) => Number(await page.locator('p', { hasText: new RegExp(`^${label}$`) }).first().locator('xpath=../following-sibling::p[1]').innerText())
  const pipeline = async (name) => Number(/: (\d+) event/.exec(await page.getByRole('link', { name: new RegExp(`^${name}: \\d+ events?$`) }).getAttribute('aria-label'))?.[1])
  const upcomingCard = await cardValue('Upcoming events')
  check('a finished event is not counted as upcoming, and the card, pipeline and featured card agree', upcomingCard === 0 && (await pipeline('Upcoming')) === 0 && (await page.getByRole('article', { name: 'Featured event' }).count()) === 0, `card=${upcomingCard} pipeline=${await pipeline('Upcoming')}`)
  check('the event shows in the pipeline where it really is: waiting for client approval', (await pipeline('Waiting for Client Approval')) === 1)
  check('with nothing upcoming the featured area is a compact empty state with a Create event action', (await page.getByText('No upcoming events', { exact: true }).count()) === 1 && (await page.getByText('Create an event and the next one will be featured here.').count()) === 1 && (await page.getByRole('link', { name: 'Create event' }).getAttribute('href')) === '/events/new')
  await shot(page, '02b-dashboard-nothing-upcoming')
}

/* ------------------------------------------------------------- photographer role */
{
  const { page, api } = await newSession('photographer', { width: 1366, height: 860 })
  await login(page)
  await page.getByRole('heading', { level: 1 }).waitFor()
  await page.waitForTimeout(600)
  const nav = await page.getByRole('navigation', { name: 'Main' }).getByRole('link').allInnerTexts()
  check('photographer sees only Overview, Events, Calendar', JSON.stringify(nav.map((s) => s.replace(/\s+\d+$/, '').trim())) === JSON.stringify(['Overview', 'Events', 'Calendar']), nav.join(', '))
  check('photographer dashboard hides money', (await page.getByText('Outstanding').count()) === 0)
  check('photographer dashboard has no "Needs attention" table or insights', (await page.getByText('Needs attention').count()) === 0 && (await page.getByText(/not AI-generated/).count()) === 0)
  await shot(page, '50-photographer-dashboard')
  for (const path of ['/payments', '/clients', '/team', '/reports', '/settings', '/equipment', '/events/new']) {
    await page.goto(`${BASE}${path}`)
    await page.waitForTimeout(400)
    check(`photographer is blocked from ${path}`, (await page.getByText("You don't have access to this page").count()) > 0)
  }
  await shot(page, '51-photographer-blocked')
  await page.goto(`${BASE}/events/${ids.p1}`)
  await page.getByText('Wedding ceremony').first().waitFor()
  const tabs = await page.getByRole('tab').allInnerTexts()
  check('photographer project page has no Payments tab', !tabs.includes('Payments'), tabs.join(', '))
  check('photographer cannot edit the project', (await page.getByRole('link', { name: 'Edit' }).count()) === 0)
  check('photographer never requests money tables', !api.some((l) => /payments|project_financials|project_finance/.test(l)), api.filter((l) => /payments|financ/.test(l)).join(', '))
  await shot(page, '52-photographer-project')
}

/* ------------------------------------------------------------- deactivated employee */
{
  const { page } = await newSession('inactive', { width: 1100, height: 760 })
  await login(page)
  await page.getByText('Your access has been deactivated').waitFor({ timeout: 8000 })
  check('a deactivated employee is told their access was removed (not sent to onboarding)', true)
  await shot(page, '60-deactivated')
}

/* ------------------------------------------------------------------ onboarding wizard */
{
  const { page } = await newSession('new', { width: 1100, height: 900 })
  await login(page)
  await page.waitForURL(/\/onboarding/)
  check('a new owner without a studio is sent to onboarding', true)
  await page.getByRole('button', { name: 'Continue' }).click()
  check('step 1 validates the studio name', (await page.getByText('Enter your studio name').count()) > 0)
  await page.getByLabel(/Studio name/).fill('Aperture & Co')
  await page.getByLabel('City').fill('Pune')
  await shot(page, '61-onboarding-1')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByText('About you').waitFor({ timeout: 8000 })
  check('step 1 creates the studio and advances to step 2', true)
  await shot(page, '62-onboarding-2')
  await page.getByLabel(/Full name/).fill('Olivia Mehra')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByText('Add your team').waitFor({ timeout: 8000 })
  check('step 2 saves owner details and advances to team setup', true)
  await shot(page, '63-onboarding-3')
  await page.reload()
  await page.getByText('Add your team').waitFor({ timeout: 8000 })
  check('onboarding progress persists across a refresh (resumes at step 3)', true)
  await page.getByRole('button', { name: /Skip for now|Continue/ }).click()
  await page.getByText('is ready').waitFor({ timeout: 8000 })
  await shot(page, '64-onboarding-4')
  await page.getByRole('button', { name: 'Go to dashboard' }).click()
  await page.waitForURL(`${BASE}/`, { timeout: 8000 })
  check('finishing onboarding lands on the dashboard and it is not shown again', true)
  await page.goto(`${BASE}/onboarding`)
  await page.waitForURL(`${BASE}/`, { timeout: 8000 })
  check('revisiting /onboarding after completion redirects away', true)
}

await browser.close()
stopServer()

console.log('\n==== SUMMARY ====')
const failed = results.filter((r) => !r.ok)
console.log(`${results.length - failed.length}/${results.length} checks passed`)
failed.forEach((f) => console.log(`  FAILED: ${f.name} ${f.detail}`))
console.log(`\nConsole problems (${problems.length}):`)
const uniq = [...new Set(problems)]
uniq.slice(0, 40).forEach((p) => console.log('  ' + p))
process.exit(failed.length ? 1 : 0)
