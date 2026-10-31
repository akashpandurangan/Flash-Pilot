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

/** Click / hover where a user would: at the element's centre, whatever is on top of it (a card's stretched link, say). */
async function pointAt(page, locator, action = 'click') {
  await locator.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  const b = await locator.boundingBox()
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
  if (action === 'click') await page.mouse.down().then(() => page.mouse.up())
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
  const kpiLabels = ['Upcoming events', "Today's events", 'Editing in progress', 'Ready for delivery', 'Pending amount']
  const kpiFound = await Promise.all(kpiLabels.map(async (l) => (await page.getByText(l, { exact: true }).count()) > 0))
  check('dashboard shows the four overview cards', kpiFound.every(Boolean), kpiLabels.filter((_, i) => !kpiFound[i]).join(', '))
  // a card is: <div><p>label</p>…</div><p>value</p>
  const cardValue = async (label) => Number(await page.locator('p', { hasText: new RegExp(`^${label}$`) }).first().locator('xpath=following-sibling::div[1]/p').innerText())
  const [upcomingN, editingN] = [await cardValue('Upcoming events'), await cardValue('Editing in progress')]
  check('dashboard overview numbers come from the API (upcoming and editing counts match the records)', upcomingN === 2 && editingN === 1, `upcoming=${upcomingN} editing=${editingN}`)
  // one definition of "upcoming" everywhere: the card, the pipeline and the Events panel must agree
  const pipelineUpcoming = Number(/: (\d+) event/.exec(await page.getByRole('link', { name: /^Upcoming: \d+ events?$/ }).getAttribute('aria-label'))?.[1])
  check('pipeline "Upcoming" matches the Upcoming events card', pipelineUpcoming === upcomingN, `pipeline=${pipelineUpcoming} card=${upcomingN}`)
  check('dashboard shows the Today events and Ready for delivery cards, and no "In production" card', (await page.getByText("Today's events", { exact: true }).count()) === 1 && (await page.getByText('Ready for delivery', { exact: true }).count()) === 1 && (await page.getByText('In production', { exact: true }).count()) === 0)
  check('Upcoming events card links to the filtered Events list', (await page.getByRole('link', { name: /Upcoming events/ }).first().getAttribute('href')) === '/events?stage=upcoming')
  check('Ready for delivery card links to the Out for Delivery list', (await page.getByRole('link', { name: /Ready for delivery/ }).first().getAttribute('href')) === '/events?stage=out_for_delivery')
  const sideNav = (await page.getByRole('navigation', { name: 'Main' }).getByRole('link').allInnerTexts()).map((s) => s.replace(/\s+\d+$/, '').trim())
  check('sidebar has no Production or Deliveries entries, and ends with Reports then Settings', JSON.stringify(sideNav) === JSON.stringify(['Overview', 'Events', 'Calendar', 'Clients', 'Team', 'Equipment', 'Payments', 'Reports', 'Settings']), sideNav.join(', '))
  check('Settings sits directly under Reports in the Workspace group, and is not a separate bottom link', JSON.stringify(sideNav.slice(-2)) === JSON.stringify(['Reports', 'Settings']) && (await page.locator('aside nav[aria-label="Main"] a[href="/settings"]').count()) === 1 && (await page.locator('aside a[href="/settings"]').count()) === 1)
  check('the profile and Sign out stay at the bottom of the sidebar', await page.evaluate(() => {
    const aside = document.querySelector('aside'); const nav = aside.querySelector('nav[aria-label="Main"]')
    const out = aside.querySelector('button[aria-label="Sign out"]'); const profile = aside.querySelector('a[aria-label$="account"]')
    return !!out && !!profile && out.getBoundingClientRect().top >= nav.getBoundingClientRect().bottom - 1 && profile.getBoundingClientRect().top >= nav.getBoundingClientRect().bottom - 1
  }))
  const kbd = await page.evaluate(() => { const k = document.querySelector('kbd'); const s = getComputedStyle(k); return { bg: s.backgroundColor, color: s.color, text: k.textContent } })
  const kbdRgb = (c) => c.match(/\d+/g).slice(0, 3).map(Number)
  check('the Ctrl K badge is neutral grey (not lime) with muted dark text', kbd.text === 'Ctrl K' && Math.max(...kbdRgb(kbd.bg)) - Math.min(...kbdRgb(kbd.bg)) < 14 && kbdRgb(kbd.bg).every((v) => v > 225) && kbdRgb(kbd.color).every((v) => v < 140), `${kbd.bg} on ${kbd.color}`)
  // collapse -> the logo stays, pointing at it reveals the expand chevron, clicking it (or Enter) expands
  await page.getByRole('button', { name: 'Collapse sidebar' }).click()
  await page.waitForTimeout(350)
  const railWidth = await page.evaluate(() => Math.round(document.querySelector('aside').getBoundingClientRect().width))
  const expandBtn = page.getByRole('button', { name: 'Expand sidebar' })
  const chevron = expandBtn.locator('svg').nth(1)
  const before = await expandBtn.boundingBox()
  const opacityOf = (loc) => loc.evaluate((el) => Number(getComputedStyle(el).opacity))
  const idle = { logo: await opacityOf(expandBtn.locator('svg').first()), chevron: await opacityOf(chevron) }
  await expandBtn.hover()
  await page.waitForTimeout(900)
  const hot = { logo: await opacityOf(expandBtn.locator('svg').first()), chevron: await opacityOf(chevron) }
  const after = await expandBtn.boundingBox()
  await shot(page, '47-sidebar-collapsed-hover')
  check('collapsed sidebar is a compact rail showing only the logo until it is pointed at', railWidth <= 80 && idle.logo === 1 && idle.chevron === 0, `rail ${railWidth}px idle logo=${idle.logo} chevron=${idle.chevron}`)
  check('pointing at the logo reveals the expand chevron without moving anything, and the logo stays visible', hot.chevron === 1 && hot.logo > 0 && hot.logo < 0.5 && before.x === after.x && before.y === after.y && before.width === after.width, `chevron=${hot.chevron} logo=${hot.logo}`)
  check('the expand control has a tooltip', (await page.getByRole('tooltip').filter({ hasText: 'Expand sidebar' }).count()) > 0)
  await expandBtn.click()
  await page.waitForTimeout(350)
  check('clicking the logo area expands the sidebar again, with the wordmark and the collapse button', (await page.evaluate(() => Math.round(document.querySelector('aside').getBoundingClientRect().width))) >= 250 && (await page.getByText('Flash Pilot', { exact: true }).count()) > 0 && (await page.getByRole('button', { name: 'Collapse sidebar' }).count()) === 1)
  await page.getByRole('button', { name: 'Collapse sidebar' }).click()
  await page.waitForTimeout(350)
  await page.getByRole('button', { name: 'Expand sidebar' }).focus()
  await page.keyboard.press('Enter')
  await page.waitForTimeout(350)
  check('the expand control works from the keyboard', (await page.getByRole('button', { name: 'Collapse sidebar' }).count()) === 1)
  // ---- the vertical Event pipeline: six stages one below another, real counts, bars that match, cancelled kept apart
  const pipelineBox = page.getByRole('region', { name: 'Event pipeline' })
  const stageNames = ['Upcoming', 'Production', 'Waiting for Client Approval', 'Editing', 'Out for Delivery', 'Delivered']
  const stageRows = await pipelineBox.locator('ol > li a').evaluateAll((els) => els.map((a) => {
    const r = a.getBoundingClientRect()
    const track = [...a.querySelectorAll('span[aria-hidden]')][1]
    return { label: a.getAttribute('aria-label'), href: a.getAttribute('href'), x: Math.round(r.x), y: Math.round(r.y), h: Math.round(r.height), fill: Math.round((track.firstElementChild.getBoundingClientRect().width / track.getBoundingClientRect().width) * 100) }
  }))
  check('the pipeline lists the six stages vertically, in order, aligned, one below another', stageRows.length === 6 && stageRows.every((r, i) => r.label.startsWith(`${stageNames[i]}:`) && (i === 0 || r.y >= stageRows[i - 1].y + stageRows[i - 1].h) && Math.abs(r.x - stageRows[0].x) <= 1), JSON.stringify(stageRows.map((r) => [r.label, r.y])))
  check('pipeline counts match the event records (cancelled and archived events are not in it)', JSON.stringify(stageRows.map((r) => r.label.split(': ')[1])) === JSON.stringify(['2 events', '0 events', '1 event', '1 event', '2 events', '1 event']), stageRows.map((r) => r.label).join(' | '))
  check('each bar is filled in proportion to its stage: 2, 0, 1, 1, 2 and 1 of 7 events', JSON.stringify(stageRows.map((r) => r.fill)) === JSON.stringify([29, 0, 14, 14, 29, 14]), stageRows.map((r) => r.fill).join(', '))
  check('every stage links to the Events page filtered to that stage', JSON.stringify(stageRows.map((r) => r.href)) === JSON.stringify(['upcoming', 'production', 'awaiting_approval', 'editing', 'out_for_delivery', 'delivered'].map((s) => `/events?stage=${s}`)))
  check('Cancelled sits apart from the stages as its own link, with its own count', (await pipelineBox.getByRole('link', { name: 'Cancelled: 1 event' }).getAttribute('href')) === '/events?booking=cancelled' && (await pipelineBox.getByRole('link', { name: 'View all events' }).getAttribute('href')) === '/events')
  const pipelineCounts = Object.fromEntries(stageRows.map((r, i) => [stageNames[i], Number(r.label.split(': ')[1].split(' ')[0])]))

  // ---- the Events panel: eight tabs, same counts as the pipeline, filtered in place
  const panel = page.getByRole('region', { name: 'Events', exact: true })
  const tabNames = ['All Events', 'Upcoming', 'In Production', 'Waiting for Approval', 'Editing', 'Out for Delivery', 'Delivered', 'Cancelled']
  const tabs = panel.getByRole('group', { name: 'Filter dashboard events by status' }).getByRole('button')
  check('the Events panel offers the eight filters in the requested order', JSON.stringify((await tabs.allInnerTexts()).map((t) => t.replace(/\s+\d+$/, '').trim())) === JSON.stringify(tabNames))
  check('All Events is selected by default and the old oversized empty state is gone', (await tabs.first().getAttribute('aria-pressed')) === 'true' && (await page.getByText('Create an event and the next one will be featured here.').count()) === 0)
  const expectedCount = { 'All Events': 8, Upcoming: 2, 'In Production': 0, 'Waiting for Approval': 1, Editing: 1, 'Out for Delivery': 2, Delivered: 1, Cancelled: 1 }
  const emptyText = { 'In Production': 'Nothing in production right now' }
  const tabProblems = []
  for (const name of tabNames) {
    await panel.getByRole('button', { name: new RegExp(`^${name}`) }).click()
    const pressed = await tabs.evaluateAll((els) => els.map((e) => e.getAttribute('aria-pressed') === 'true'))
    const count = Number((await panel.getByRole('button', { name: new RegExp(`^${name}`) }).innerText()).match(/(\d+)\s*$/)?.[1])
    const hrefs = await panel.locator('h3 a[data-card-link]').evaluateAll((els) => els.map((a) => a.getAttribute('href')))
    const wantShown = Math.min(4, expectedCount[name])
    if (count !== expectedCount[name]) tabProblems.push(`${name}: count ${count}`)
    if (hrefs.length !== wantShown || new Set(hrefs).size !== hrefs.length) tabProblems.push(`${name}: shows ${hrefs.length} (${new Set(hrefs).size} unique)`)
    if (pressed.filter(Boolean).length !== 1 || !pressed[tabNames.indexOf(name)]) tabProblems.push(`${name}: wrong active tab`)
    if (expectedCount[name] === 0 && (await panel.getByText(emptyText[name], { exact: true }).count()) !== 1) tabProblems.push(`${name}: no small empty state`)
    if (name === 'All Events' && (await panel.getByText('See all 8 on the Events page').count()) !== 1) tabProblems.push('All Events: no "see all" link')
    if (name !== 'All Events' && name !== 'Cancelled' && name !== 'Upcoming' && count !== (pipelineCounts[{ 'In Production': 'Production', 'Waiting for Approval': 'Waiting for Client Approval', Editing: 'Editing', 'Out for Delivery': 'Out for Delivery', Delivered: 'Delivered' }[name]] ?? -1)) tabProblems.push(`${name}: differs from the pipeline`)
  }
  check('every Events tab shows the right events and count, highlights itself, has no duplicates and a small empty state when empty', tabProblems.length === 0, tabProblems.join('; '))
  await panel.getByRole('button', { name: /^Upcoming/ }).click()
  check('Upcoming matches the pipeline and the Upcoming events card, and includes the inquiry', Number((await panel.getByRole('button', { name: /^Upcoming/ }).innerText()).match(/(\d+)\s*$/)[1]) === pipelineCounts.Upcoming && pipelineCounts.Upcoming === upcomingN && (await panel.getByText('Nair Maternity Shoot').count()) === 1)
  await panel.getByRole('button', { name: /^Cancelled/ }).click()
  check('Cancelled uses the booking status: the cancelled event shows with its Cancelled badge and no production stage', (await panel.getByText('Verma Anniversary Shoot').count()) === 1 && (await panel.getByText('Cancelled', { exact: true }).count()) >= 1)
  await panel.getByRole('button', { name: /^Editing/ }).click()
  const editingCard = panel.locator('h3:has(a[data-card-link])').first().locator('xpath=ancestor::div[contains(@class,"rounded-card")][1]')
  const cardText = await editingCard.innerText()
  check('an event card shows its ID, name, client, type, date and sessions, venue, team, booking status, stage and payment status', ['FP-0001', 'Sharma–Rao Wedding', 'Anita Sharma', 'Wedding', '2 sessions', 'The Leela Palace', 'Confirmed', 'Editing', 'Partially paid'].every((t) => cardText.includes(t)) && (await editingCard.locator('[class*="rounded-full"]').count()) > 3, cardText.replace(/\s+/g, ' '))
  await panel.getByRole('button', { name: /^All Events/ }).click()
  // the five cards, in order, with their supporting text, colours and links
  const kpiCards = await page.evaluate(() => [...document.querySelectorAll('section[aria-label="Key numbers"] :is(a, button)')].map((el) => ({
    text: [...el.querySelectorAll('p')].map((p) => p.textContent.trim()), href: el.getAttribute('href'), bg: getComputedStyle(el).backgroundColor,
  })))
  check('Studio overview has exactly five cards in the requested order', JSON.stringify(kpiCards.map((c) => c.text[0])) === JSON.stringify(['Upcoming events', "Today's events", 'Editing in progress', 'Ready for delivery', 'Pending amount']), kpiCards.map((c) => c.text[0]).join(', '))
  check('Needs attention is no longer a Studio overview card', !kpiCards.some((c) => /Needs attention/i.test(c.text[0])) && (await page.getByText('Assigned this week').count()) === 0)
  check('cards show the requested supporting text', kpiCards[0].text[2] === '1 in the next 7 days' && kpiCards[1].text[2] === '0 sessions scheduled today' && kpiCards[2].text[2] === 'Events currently being edited' && kpiCards[3].text[2] === 'Ready to deliver to clients' && kpiCards[4].text[2] === 'Outstanding across 3 events', kpiCards.map((c) => c.text[2]).join(' | '))
  check('Editing in progress counts only the Editing stage (the event waiting for approval is not included)', kpiCards[2].text[1] === '1', kpiCards[2].text[1])
  check('click-through links are unchanged', kpiCards[0].href === '/events?stage=upcoming' && /^\/events\?from=\d{4}-\d\d-\d\d&to=\d{4}-\d\d-\d\d$/.test(kpiCards[1].href) && kpiCards[2].href === '/events?stage=editing' && kpiCards[3].href === '/events?stage=out_for_delivery' && kpiCards[4].href === '/payments?tab=balances&state=outstanding', kpiCards.map((c) => c.href).join(' '))
  const rgb = (s) => s.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number)
  const [black, grey1, grey2, grey3, lime] = kpiCards.map((c) => rgb(c.bg))
  check('Upcoming is black, Pending amount is pale lime, the other three are the same light grey', black.every((v) => v < 40) && grey1.join() === grey2.join() && grey2.join() === grey3.join() && grey1.every((v) => v > 225) && lime[1] > lime[2] + 20 && lime[1] > 235, kpiCards.map((c) => c.bg).join(' | '))
  const desktopLayout = await page.evaluate(() => [...document.querySelectorAll('section[aria-label="Key numbers"] :is(a, button)')].map((el) => { const r = el.getBoundingClientRect(); return { y: Math.round(r.y), w: Math.round(r.width) } }))
  check('all five cards sit in one equal-width row on desktop', new Set(desktopLayout.map((c) => c.y)).size === 1 && desktopLayout.every((c) => Math.abs(c.w - desktopLayout[0].w) <= 1), JSON.stringify(desktopLayout))
  // Pending amount: real balances of confirmed events (Sharma-Rao 1,50,000 + Kapoor 25,000 + SN Wedding 15,000); the inquiry's quote and cancelled events are not owed
  const pendingCard = page.getByRole('link', { name: /Pending amount/ })
  const pendingText = await pendingCard.innerText()
  check('Pending amount shows the total owed across confirmed events, in the studio currency', pendingText.includes('₹1,90,000') && pendingText.includes('Outstanding across 3 events'), pendingText.replace(/\s+/g, ' '))
  check('Pending amount links to the Payments page filtered to outstanding balances', (await pendingCard.getAttribute('href')) === '/payments?tab=balances&state=outstanding')
  const heights = await page.evaluate(() => [...document.querySelectorAll('section[aria-label="Key numbers"] :is(a, button)')].map((a) => Math.round(a.getBoundingClientRect().height)))
  check('Pending amount card is the same height as the other cards', heights.length === 5 && heights.every((h) => Math.abs(h - heights[0]) <= 2), heights.join(', '))
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
  check('insights panel says it is rule-based, not AI', (await page.getByText(/not AI-generated/).count()) > 0)
  await shot(page, '02-dashboard')
  // the dashboard total equals the Payments page: its Outstanding figure and the sum of the balances it lists
  await pendingCard.click()
  await page.getByText('Event balances').waitFor()
  await page.waitForTimeout(500)
  const rupees = (s) => Number(s.replace(/[^\d.]/g, ''))
  const outstandingCard = rupees(await page.locator('span', { hasText: /^Outstanding$/ }).first().locator('xpath=../following-sibling::div[1]').innerText())
  const balances = (await page.locator('table tbody tr').evaluateAll((rows) => rows.map((r) => r.children[4]?.textContent ?? ''))).map(rupees)
  check('the dashboard total matches the Payments page: its Outstanding figure and the balances it lists', outstandingCard === 190000 && balances.length === 3 && balances.reduce((a, b) => a + b, 0) === 190000, `card=${outstandingCard} rows=${balances.join('+')}`)
  await page.goto(`${BASE}/`)
  await page.getByRole('heading', { level: 1 }).waitFor()
  // ---- the whole event card is one clickable surface (dashboard Events panel)
  const events = page.getByRole('region', { name: 'Events', exact: true })
  const cardOf = (name) => events.locator('h3:has(a[data-card-link])', { hasText: name }).locator('xpath=ancestor::div[contains(@class,"rounded-card")][1]')
  await events.getByRole('button', { name: /^Editing/ }).click()
  const sharma = cardOf('Sharma–Rao Wedding')
  const idleBorder = await sharma.evaluate((el) => getComputedStyle(el).borderColor)
  await pointAt(page, sharma.getByText('The Leela Palace'), 'hover')
  await page.waitForTimeout(250)
  const hotBorder = await sharma.evaluate((el) => getComputedStyle(el).borderColor)
  const cursorOverCard = await page.evaluate(() => { const b = [...document.querySelectorAll('h3 a[data-card-link]')][0].closest('.rounded-card').getBoundingClientRect(); const el = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2); return { tag: el.tagName, cursor: getComputedStyle(el).cursor } })
  check('an event card has a hover state and a pointer cursor over its whole surface', idleBorder !== hotBorder && cursorOverCard.tag === 'A' && cursorOverCard.cursor === 'pointer', `${idleBorder} -> ${hotBorder}; ${cursorOverCard.tag} ${cursorOverCard.cursor}`)
  await pointAt(page, sharma.getByText('The Leela Palace')) // a plain information area, not a button or link
  await page.waitForURL(new RegExp(`/events/${ids.p1}$`))
  check('clicking any non-action area of the card opens that event (the correct ID)', new URL(page.url()).pathname === `/events/${ids.p1}`)
  await page.goBack()
  await events.waitFor()
  check('browser Back returns to the dashboard', new URL(page.url()).pathname === '/')
  await events.getByRole('button', { name: /^Editing/ }).click()
  await events.getByRole('button', { name: 'Actions for Sharma–Rao Wedding' }).click()
  await page.getByRole('menuitem', { name: 'Open' }).waitFor()
  check('the three-dot menu opens without navigating away', new URL(page.url()).pathname === '/')
  await page.getByRole('menuitem', { name: 'Cancel booking…' }).click()
  await page.getByRole('heading', { name: 'Cancel this booking?' }).waitFor()
  check('a menu action runs its own action (cancel opens its dialog) and does not navigate to the event', new URL(page.url()).pathname === '/')
  await page.getByRole('button', { name: 'Keep booking' }).click()
  await events.getByRole('button', { name: 'Actions for Sharma–Rao Wedding' }).click()
  await page.getByRole('menuitem', { name: 'Edit' }).click()
  await page.waitForURL(new RegExp(`/events/${ids.p1}/edit$`))
  check('the Edit action still opens the event editor', new URL(page.url()).pathname === `/events/${ids.p1}/edit`)
  await page.goto(`${BASE}/`)
  await events.waitFor()
  await events.getByRole('button', { name: /^Editing/ }).click()
  await events.getByRole('link', { name: 'Sharma–Rao Wedding' }).focus()
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Tab')
  await page.waitForTimeout(350) // the ring fades in
  const focusRing = await sharma.evaluate((el) => getComputedStyle(el).boxShadow)
  check('keyboard focus puts a visible focus ring on the whole card', /0px 0px 0px 2px/.test(focusRing), focusRing)
  await page.keyboard.press('Enter')
  await page.waitForURL(new RegExp(`/events/${ids.p1}$`))
  check('Enter on the focused card opens the event', new URL(page.url()).pathname === `/events/${ids.p1}`)
  // pipeline rows open the filtered Events page
  await page.goto(`${BASE}/`)
  await pipelineBox.waitFor()
  await pipelineBox.getByRole('link', { name: /^Editing: 1 event$/ }).click()
  await page.waitForURL(/\/events\?stage=editing$/)
  await page.getByText('Sharma–Rao Wedding').first().waitFor()
  check('clicking a pipeline stage opens the Events page filtered to that stage', (await page.getByRole('button', { name: 'Editing', exact: true }).getAttribute('aria-pressed')) === 'true' && new URL(page.url()).searchParams.get('stage') === 'editing')
  await page.goto(`${BASE}/`)
  await page.getByRole('heading', { level: 1 }).waitFor()
  // ---- Out-for-Delivery payment alert: only an out-for-delivery event that still owes money, with the same figures as Payments
  const attention = page.locator('#needs-attention')
  const attentionRow = (name) => attention.locator('tr', { hasText: name })
  check('Needs attention flags SN Wedding (out for delivery, ₹50,000 agreed, ₹35,000 paid) with "Payment pending — ₹15,000 outstanding" and a Record payment action', (await attentionRow('SN Wedding').getByText('Payment pending — ₹15,000 outstanding').count()) === 1 && (await attentionRow('SN Wedding').getByRole('link', { name: 'Record payment' }).getAttribute('href')) === `/events/${ids.p7}?tab=payments`)
  check('it flags nothing else for money: not the fully paid delivery, not Sharma-Rao (editing, partly paid), not the delivered or cancelled events', (await attention.locator('tbody tr', { hasText: /Payment pending/ }).count()) === 1 && (await attentionRow('Rao Reception').count()) === 0 && (await attentionRow('Iyer Birthday').count()) === 0 && (await attentionRow('Verma Anniversary').count()) === 0 && (await attentionRow('Sharma–Rao Wedding').getByText(/Payment pending|Balance payment/).count()) === 0)
  check('the table says how many deliveries are waiting on payment and for how much', (await attention.getByText(/₹15,000 payment pending on 1 delivery/).count()) === 1)
  check('Needs attention is still not a KPI card (the five agreed cards remain)', (await page.locator('section[aria-label="Key numbers"] :is(a, button)').count()) === 5 && (await page.locator('section[aria-label="Key numbers"]').getByText(/Needs attention/i).count()) === 0)
  await events.getByRole('button', { name: /^Out for Delivery/ }).click()
  const sn = cardOf('SN Wedding')
  const rao = cardOf('Rao Reception')
  check('the event card shows a payment warning with the amount for SN Wedding, and a normal Paid badge for the fully paid delivery', (await sn.getByText('Payment pending · ₹15,000').count()) === 1 && (await rao.getByText('Paid', { exact: true }).count()) === 1 && (await rao.getByText(/Payment pending/).count()) === 0)
  const warnBorder = await sn.evaluate((el) => getComputedStyle(el).borderColor)
  const calmBorder = await rao.evaluate((el) => getComputedStyle(el).borderColor)
  check('the card has a warning visual state (amber border) that the fully paid one does not', warnBorder !== calmBorder, `${warnBorder} vs ${calmBorder}`)
  await shot(page, '48-dashboard-payment-alert')
  await events.getByRole('button', { name: /^Editing/ }).click()
  check('an event in Editing with a partial payment shows the ordinary Partially paid badge, not a warning', (await cardOf('Sharma–Rao Wedding').getByText('Partially paid').count()) === 1 && (await cardOf('Sharma–Rao Wedding').getByText(/Payment pending/).count()) === 0)
  await page.goto(`${BASE}/events?stage=out_for_delivery`)
  await page.getByText('SN Wedding').first().waitFor()
  check('the Events page list shows the same warning for the same event', (await page.locator('tbody tr', { hasText: 'SN Wedding' }).getByText('Payment pending · ₹15,000').count()) === 1 && (await page.locator('tbody tr', { hasText: 'Rao Reception' }).getByText('Payment pending').count()) === 0)
  await page.goto(`${BASE}/payments`)
  await page.getByText('Event balances').waitFor()
  const snRow = (await page.locator('tbody tr', { hasText: 'SN Wedding' }).first().innerText()).replace(/\s+/g, ' ')
  check('the amount matches the Payments page balance for that event', /₹50,000/.test(snRow) && /₹35,000/.test(snRow) && /₹15,000/.test(snRow), snRow)
  await page.goto(`${BASE}/`)
  await page.getByRole('heading', { level: 1 }).waitFor()
  await page.waitForTimeout(500)
  await page.waitForTimeout(500)
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
  // ---- Events page: the whole table row / card is clickable, the actions menu keeps its own clicks
  check('Events list rows show the stage and the session count', (await page.getByRole('cell', { name: '2 sessions' }).count()) >= 1 && (await page.locator('tbody tr', { hasText: 'Nair Maternity Shoot' }).getByText('Upcoming', { exact: true }).count()) === 1)
  await page.getByRole('cell', { name: 'Anita Sharma' }).first().click() // far from the title link
  await page.waitForURL(new RegExp(`/events/${ids.p1}$`))
  check('clicking anywhere on an Events table row opens that event', new URL(page.url()).pathname === `/events/${ids.p1}`)
  await page.goBack()
  await page.getByText('Sharma–Rao Wedding').first().waitFor()
  await page.getByRole('button', { name: 'Actions for Sharma–Rao Wedding' }).click()
  await page.getByRole('menuitem', { name: 'Open' }).waitFor()
  check('the row actions menu opens without opening the event', new URL(page.url()).pathname === '/events')
  await page.keyboard.press('Escape')
  await page.getByRole('radio', { name: 'Cards' }).or(page.getByRole('button', { name: 'Cards' })).first().click()
  await page.getByText('The Leela Palace').first().waitFor()
  await pointAt(page, page.getByText('The Leela Palace').first())
  await page.waitForURL(/\/events\/[0-9a-f-]{36}$/)
  check('clicking an event card in the cards view opens its event', /\/events\/a0000000-0000-4000-8000-00000000000\d$/.test(new URL(page.url()).pathname))
  await page.goto(`${BASE}/events`)
  await page.getByRole('button', { name: 'List' }).first().click()
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
  check('mobile drawer lists every section for the owner', (await page.getByRole('navigation', { name: 'Main' }).getByRole('link').count()) === 9)
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
    if (path === '/') {
      await page.locator('section[aria-label="Key numbers"] a').nth(4).waitFor() // the cards, not their loading skeletons
      // the five cards: one equal row from 1280px, three over two on tablets, two columns with a full-width last card on phones
      const cards = await page.evaluate(() => [...document.querySelectorAll('section[aria-label="Key numbers"] :is(a, button)')].map((el) => {
        const r = el.getBoundingClientRect()
        const fig = el.querySelector('p.leading-none')
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), clipped: !!fig && fig.scrollWidth > fig.parentElement.clientWidth + 1, label: el.querySelector('p')?.textContent ?? '' }
      }))
      const rows = new Set(cards.map((c) => c.y)).size
      const equalWidths = cards.every((c) => Math.abs(c.w - cards[0].w) <= 1)
      const expected = width >= 1280 ? 'one equal-width row' : width >= 768 ? 'two rows' : 'three rows'
      const ok = cards.length === 5 && !cards.some((c) => c.clipped)
        && (width >= 1280 ? rows === 1 && equalWidths : width >= 768 ? rows === 2 : rows === 3)
      check(`${width}px: the five Studio overview cards sit in ${expected} and no figure is clipped`, ok, cards.map((c) => `${c.label.trim()} ${c.w}x${c.h}@${c.x},${c.y}${c.clipped ? ' CLIPPED' : ''}`).join(' | '))
      if (width >= 1280) check(`${width}px: the five cards have the same height`, cards.every((c) => Math.abs(c.h - cards[0].h) <= 1), cards.map((c) => c.h).join(', '))
      // Events (about 65%) and the pipeline (about 35%) share one row on laptops and desktops, and stack below that
      const geo = await page.evaluate(() => {
        const box = (n) => { const r = document.querySelector(`[role="region"][aria-label="${n}"]`).getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), b: Math.round(r.bottom) } }
        return { e: box('Events'), p: box('Event pipeline'), truncated: [...document.querySelectorAll('[aria-label="Event pipeline"] ol li a span.truncate')].filter((el) => el.scrollWidth > el.clientWidth + 1).length, chipsScroll: (() => { const g = document.querySelector('[aria-label="Filter dashboard events by status"]'); return g.scrollWidth > g.clientWidth + 1 })() }
      })
      const side = geo.p.x > geo.e.x + geo.e.w - 2
      const ratio = geo.e.w / (geo.e.w + geo.p.w)
      const layoutOk = width >= 1024
        ? side && Math.abs(geo.e.y - geo.p.y) <= 1 && Math.abs(geo.e.b - geo.p.b) <= 1 && (width >= 1280 ? ratio > 0.62 && ratio < 0.68 : ratio > 0.57 && ratio < 0.66)
        : !side && geo.p.y >= geo.e.b - 1 && geo.e.x === geo.p.x && geo.e.w === geo.p.w
      check(`${width}px: the Events panel and the pipeline are ${width >= 1024 ? 'side by side, level at top and bottom, about 65 / 35' : 'stacked'}`, layoutOk, `${JSON.stringify(geo)} ratio ${ratio.toFixed(2)}`)
      check(`${width}px: every pipeline stage name is fully readable`, geo.truncated === 0, `${geo.truncated} truncated`)
      if (width === 390) check('390px: the Events filters scroll horizontally instead of overflowing the page', geo.chipsScroll)
      await shot(page, `46-dashboard-${width}`)
    }
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
  const cardValue = async (label) => Number(await page.locator('p', { hasText: new RegExp(`^${label}$`) }).first().locator('xpath=following-sibling::div[1]/p').innerText())
  const pipeline = async (name) => Number(/: (\d+) event/.exec(await page.getByRole('link', { name: new RegExp(`^${name}: \\d+ events?$`) }).getAttribute('aria-label'))?.[1])
  const upcomingCard = await cardValue('Upcoming events')
  check('a finished event is not counted as upcoming, and the card, the pipeline and the Events panel agree', upcomingCard === 0 && (await pipeline('Upcoming')) === 0 && (await page.getByRole('region', { name: 'Events', exact: true }).getByRole('button', { name: /^Upcoming/ }).innerText()).trim().endsWith('0'), `card=${upcomingCard} pipeline=${await pipeline('Upcoming')}`)
  check('the event shows in the pipeline where it really is: waiting for client approval', (await pipeline('Waiting for Client Approval')) === 1)
  check('nothing owed shows as zero with an "all settled" message', (await page.getByRole('link', { name: /Pending amount/ }).innerText()).includes('₹0') && (await page.getByText('All payments settled').count()) === 1)
  await page.getByRole('region', { name: 'Events', exact: true }).getByRole('button', { name: /^Upcoming/ }).click()
  check('with nothing upcoming the Upcoming tab shows a small empty state with a Create event action', (await page.getByText('No upcoming events', { exact: true }).count()) === 1 && (await page.getByText('Create an event and the next one will be listed here.').count()) === 1 && (await page.getByRole('region', { name: 'Events', exact: true }).getByRole('link', { name: 'Create event' }).first().getAttribute('href')) === '/events/new')
  await shot(page, '02b-dashboard-nothing-upcoming')
}

/* ---------------------------------------------------------------- themes: light, dark, system, accents, persistence */
/** In-page audit: every visible piece of text against the colour actually behind it (alpha-blended through its ancestors). */
const AUDIT = () => {
  // any CSS colour (including the color(srgb ...) form Chrome reports for colour-mix) through a 1px canvas
  const cx = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true })
  const parse = (c) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 } }
  const over = (top, bottom) => { const a = top.a + bottom.a * (1 - top.a); return a === 0 ? { r: 0, g: 0, b: 0, a: 0 } : { r: (top.r * top.a + bottom.r * bottom.a * (1 - top.a)) / a, g: (top.g * top.a + bottom.g * bottom.a * (1 - top.a)) / a, b: (top.b * top.a + bottom.b * bottom.a * (1 - top.a)) / a, a } }
  const lum = ({ r, g, b }) => { const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
  const backdrop = (el) => {
    let layer = { r: 0, g: 0, b: 0, a: 0 }
    for (let n = el; n; n = n.parentElement) {
      const cs = getComputedStyle(n)
      if (cs.backgroundImage !== 'none') return null // a gradient or picture: cannot be judged by a single colour
      layer = over(layer, parse(cs.backgroundColor))
      if (layer.a >= 0.999) return layer
    }
    return over(layer, parse(getComputedStyle(document.body).backgroundColor))
  }
  const out = { checked: 0, low: [], weak: 0 }
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  const seen = new Set()
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const el = node.parentElement
    if (!el || seen.has(el) || !node.textContent.trim() || ['SCRIPT', 'STYLE', 'OPTION'].includes(el.tagName)) continue
    seen.add(el)
    const cs = getComputedStyle(el)
    const box = el.getBoundingClientRect()
    if (cs.visibility === 'hidden' || cs.display === 'none' || box.width < 2 || box.height < 2 || el.closest('.sr-only, [aria-hidden="true"]') || el.disabled || el.closest('[disabled], [aria-disabled="true"]')) continue
    const bg = backdrop(el)
    if (!bg) continue
    const fg = over(parse(cs.color), bg)
    const r = ratio(fg, bg)
    out.checked += 1
    const large = parseFloat(cs.fontSize) >= 24 || (parseFloat(cs.fontSize) >= 18.66 && Number(cs.fontWeight) >= 700)
    if (r < (large ? 3 : 4.5) - 0.01) { out.weak += 1; if (r < 3) out.low.push(`${node.textContent.trim().slice(0, 28)} (${r.toFixed(2)})`) }
  }
  return out
}
const audit = async (page) => { await page.waitForTimeout(350); return page.evaluate(AUDIT) } // colours animate for ~150ms after a switch
const rootVar = (page, name) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name)
const bgOf = (page, selector) => page.locator(selector).first().evaluate((el) => getComputedStyle(el).backgroundColor)
const rgbOf = (hex) => { const n = hex.replace('#', ''); return `rgb(${parseInt(n.slice(0, 2), 16)}, ${parseInt(n.slice(2, 4), 16)}, ${parseInt(n.slice(4, 6), 16)})` }

{
  const { page, context, api } = await newSession('owner', { width: 1366, height: 900 })
  await login(page)
  await page.getByRole('heading', { level: 1 }).waitFor()
  await page.goto(`${BASE}/settings`)
  await page.getByRole('heading', { name: 'Appearance' }).waitFor()
  const mode = (name) => page.getByRole("radio", { name: new RegExp("^" + name) })
  const accent = (name) => page.getByRole('radio', { name, exact: true })

  // ---- the default look is untouched
  const base = { theme: await page.evaluate(() => document.documentElement.dataset.theme), bg: await bgOf(page, 'body'), brand: await rootVar(page, '--color-brand'), accent: await rootVar(page, '--color-accent'), success: await rootVar(page, '--color-success'), danger: await rootVar(page, '--color-danger'), warning: await rootVar(page, '--color-warning'), dangerSolid: await rootVar(page, '--color-danger-solid') }
  check('existing users keep their current look: Light and Lime Green are selected by default', base.theme === 'light' && base.bg === 'rgb(243, 243, 246)' && base.accent === '#c7f34a' && base.brand === '#17171b' && (await mode('Light').getAttribute('aria-checked')) === 'true' && (await accent('Lime Green').getAttribute('aria-checked')) === 'true', JSON.stringify(base))
  check('Settings has an Appearance section with Light, Dark and System, six accent presets and a custom colour', (await page.getByRole('radiogroup', { name: 'Theme' }).getByRole('radio').count()) === 3 && (await page.getByRole('radiogroup', { name: 'Accent colour' }).getByRole('radio').count()) === 6 && (await page.getByLabel('Custom accent colour').count()) === 1 && (await page.getByRole('img', { name: /Preview of the selected theme/ }).count()) === 1)
  const lightAudit = await audit(page)
  check('light theme: all text is readable', lightAudit.low.length === 0, lightAudit.low.join(', '))
  await shot(page, '60-settings-light')

  // ---- dark
  await mode('Dark').click()
  await page.waitForTimeout(250)
  const dark = { theme: await page.evaluate(() => document.documentElement.dataset.theme), bg: await bgOf(page, 'body'), scheme: await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme) }
  check('Dark applies across the page: dark background, dark colour scheme for native controls', dark.theme === 'dark' && dark.bg === 'rgb(14, 14, 17)' && dark.scheme === 'dark', JSON.stringify(dark))
  const darkAudit = await audit(page)
  check('dark theme (Settings): every piece of text is readable', darkAudit.low.length === 0 && darkAudit.checked > 40, `${darkAudit.checked} checked; ${darkAudit.low.join(', ')}`)
  const inputDark = await page.getByLabel('Studio name').evaluate((el) => { const cs = getComputedStyle(el); return { bg: cs.backgroundColor, fg: cs.color } })
  check('dark theme: form inputs are dark with light text (not white boxes)', inputDark.bg !== 'rgb(255, 255, 255)' && inputDark.fg !== 'rgb(23, 23, 27)', JSON.stringify(inputDark))
  await shot(page, '61-settings-dark')

  // ---- every page in dark
  const pages = [['/', 'dashboard'], ['/events', 'events'], [`/events/${ids.p1}?tab=production`, 'event details'], ['/calendar', 'calendar'], ['/clients', 'clients'], ['/team', 'team'], ['/equipment', 'equipment'], ['/payments', 'payments'], ['/reports', 'reports'], ['/notifications', 'notifications']]
  const darkProblems = []
  for (const [path, name] of pages) {
    await page.goto(`${BASE}${path}`)
    await page.waitForTimeout(700)
    const a = await audit(page)
    if (a.low.length) darkProblems.push(`${name}: ${a.low.slice(0, 4).join(', ')}`)
    if (path === '/') await shot(page, '62-dashboard-dark')
    if (path === '/events') await shot(page, '63-events-dark')
    if (path.startsWith('/events/')) await shot(page, '64-event-details-dark')
    if (path === '/reports') await shot(page, '65-reports-dark')
    if (path === '/calendar') await shot(page, '66-calendar-dark')
  }
  check('dark theme: all text is readable on every page', darkProblems.length === 0, darkProblems.join(' | '))

  // dialogs, menus and charts in dark
  await page.goto(`${BASE}/events`)
  await page.getByText('Sharma–Rao Wedding').first().waitFor()
  await page.getByRole('button', { name: 'Actions for Sharma–Rao Wedding' }).click()
  const menuAudit = await audit(page)
  await page.getByRole('menuitem', { name: 'Cancel booking…' }).click()
  await page.getByRole('heading', { name: 'Cancel this booking?' }).waitFor()
  const dialogAudit = await audit(page)
  const dialogBg = await page.getByRole('dialog').evaluate((el) => getComputedStyle(el).backgroundColor)
  await shot(page, '67-dialog-dark')
  check('dark theme: menus and modals are readable and use dark surfaces', menuAudit.low.length === 0 && dialogAudit.low.length === 0 && dialogBg !== 'rgb(255, 255, 255)', `${menuAudit.low.join(',')} ${dialogAudit.low.join(',')} ${dialogBg}`)
  await page.keyboard.press('Escape')
  await page.goto(`${BASE}/reports`)
  await page.getByRole('heading', { name: 'Payments received' }).waitFor()
  await page.waitForTimeout(500)
  const chartContrast = await page.evaluate(() => {
    const parse = (c) => c.match(/[\d.]+/g).map(Number)
    const lum = ([r, g, b]) => { const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
    const card = parse(getComputedStyle(document.querySelector('main [class*="rounded-card"]')).backgroundColor)
    const bars = [...document.querySelectorAll('main [class*="rounded-t-"]')].filter((b) => b.getBoundingClientRect().height > 3)
    const fills = [...document.querySelectorAll('main [class*="rounded-full"][class*="h-2"] > *, main [role="progressbar"] > div')].filter((b) => b.getBoundingClientRect().width > 3)
    return { bars: bars.length, minBar: Math.min(...bars.map((b) => ratio(parse(getComputedStyle(b).backgroundColor), card))), fills: fills.length, minFill: Math.min(...fills.map((b) => ratio(parse(getComputedStyle(b).backgroundColor), card))) }
  })
  check('dark theme: chart bars and progress fills are clearly visible against their cards', chartContrast.bars > 0 && chartContrast.minBar >= 3 && (chartContrast.fills === 0 || chartContrast.minFill >= 3), JSON.stringify(chartContrast))

  // ---- status colours stay meaningful in dark, and are distinct from each other
  const status = await page.evaluate(() => Object.fromEntries(['--color-success', '--color-warning', '--color-danger', '--color-success-soft', '--color-warning-soft', '--color-danger-soft'].map((n) => [n, getComputedStyle(document.documentElement).getPropertyValue(n).trim()])))
  check('dark theme: success, warning and danger colours are three clearly different hues', new Set([status['--color-success'], status['--color-warning'], status['--color-danger']]).size === 3 && new Set([status['--color-success-soft'], status['--color-warning-soft'], status['--color-danger-soft']]).size === 3, JSON.stringify(status))

  // ---- accents, in both themes: they restyle buttons, nav, tabs, filters, highlights and focus; statuses are untouched
  const accents = [['Violet', '#a78bfa'], ['Blue', '#60a5fa'], ['Teal', '#2dd4bf'], ['Orange', '#fb923c'], ['Rose', '#fb7185']]
  const accentProblems = []
  for (const theme of ['Light', 'Dark']) {
    await page.goto(`${BASE}/settings`)
    await page.getByRole('heading', { name: 'Appearance' }).waitFor()
    await mode(theme).click()
    for (const [name, hex] of accents) {
      await accent(name).click()
      await page.waitForTimeout(150)
      const v = { accent: await rootVar(page, '--color-accent'), brand: await rootVar(page, '--color-brand'), focus: await rootVar(page, '--color-focus'), danger: await rootVar(page, '--color-danger-solid'), success: await rootVar(page, '--color-success-soft') }
      const navBg = await page.locator('aside nav a[aria-current="page"]').first().evaluate((el) => getComputedStyle(el).backgroundColor).catch(() => null)
      if (v.accent !== hex) accentProblems.push(`${theme} ${name}: accent var ${v.accent}`)
      if (v.brand === base.brand && theme === 'Light') accentProblems.push(`${theme} ${name}: brand did not change`)
      if (v.danger !== base.dangerSolid) accentProblems.push(`${theme} ${name}: danger changed`)
      if (theme === 'Light' && v.success !== '#eaf8c8') accentProblems.push(`${theme} ${name}: success tint changed`)
      if (navBg !== rgbOf(v.brand.startsWith('#') ? v.brand : '#000000')) accentProblems.push(`${theme} ${name}: selected nav ${navBg} != brand ${v.brand}`)
      const a = await audit(page)
      if (a.low.length) accentProblems.push(`${theme} ${name}: unreadable ${a.low.slice(0, 3).join(', ')}`)
      if ((await accent(name).getAttribute('aria-checked')) !== 'true') accentProblems.push(`${theme} ${name}: not marked selected`)
    }
  }
  check('each accent (violet, blue, teal, orange, rose) in light and dark: the accent and brand variables change, the selected menu item follows, text stays readable, danger and success are untouched', accentProblems.length === 0, accentProblems.join(' | '))

  // what the accent actually restyles, checked on real pages (violet, light)
  await mode('Light').click()
  await accent('Violet').click()
  const violet = { accent: await rootVar(page, '--color-accent'), brand: await rootVar(page, '--color-brand') }
  await page.goto(`${BASE}/events`)
  await page.getByText('Sharma–Rao Wedding').first().waitFor()
  const restyled = {
    primaryButton: await page.getByRole('link', { name: 'New event' }).evaluate((el) => getComputedStyle(el).backgroundColor),
    selectedChip: await page.getByRole('button', { name: 'All Events', exact: true }).evaluate((el) => getComputedStyle(el).backgroundColor),
  }
  await page.goto(`${BASE}/events/${ids.p1}`)
  await page.getByRole('tab', { name: 'Production' }).waitFor()
  const activeTab = await page.locator('[role="tab"][data-state="active"]').first().evaluate((el) => getComputedStyle(el).backgroundColor)
  await page.getByRole('tab', { name: 'Production' }).click()
  await page.getByText('Production checklist').waitFor()
  const stepper = await page.locator('ol[aria-label="Production progress"] li span.bg-accent').first().evaluate((el) => getComputedStyle(el).backgroundColor)
  await page.getByRole('tab', { name: 'Overview' }).focus()
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Tab')
  await page.waitForTimeout(350)
  const focusOutline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineColor)
  check('the accent restyles primary buttons, the selected menu item, active tabs, selected filter chips, progress highlights and focus rings', restyled.primaryButton === rgbOf(violet.brand) && restyled.selectedChip === rgbOf(violet.accent) && activeTab === rgbOf(violet.brand) && stepper === rgbOf(violet.accent) && focusOutline === rgbOf(violet.brand), JSON.stringify({ restyled, activeTab, stepper, focusOutline, violet }))
  await shot(page, '68-event-details-violet')

  // ---- custom colour: hex field and colour picker, invalid input refused
  await page.goto(`${BASE}/settings`)
  await page.getByRole('heading', { name: 'Appearance' }).waitFor()
  await page.getByLabel('Colour code').fill('#e11d48')
  await page.waitForTimeout(150)
  const custom = { accent: await rootVar(page, '--color-accent'), selected: await page.getByRole('radiogroup', { name: 'Accent colour' }).locator('[aria-checked="true"]').count(), badge: await page.getByText('Custom', { exact: true }).count() }
  check('a custom accent colour typed as a code is applied immediately', custom.accent === '#e11d48' && custom.badge > 0, JSON.stringify(custom))
  await page.getByLabel('Custom accent colour').fill('#0f766e')
  await page.waitForTimeout(150)
  check('a colour picked with the colour picker is applied too', (await rootVar(page, '--color-accent')) === '#0f766e')
  await page.getByLabel('Colour code').fill('#12')
  check('an invalid colour code is refused with a message and does not change the page', (await page.getByRole('alert').filter({ hasText: 'Enter a colour like' }).count()) === 1 && (await rootVar(page, '--color-accent')) === '#0f766e')
  const customAudit = await audit(page)
  check('a custom accent keeps text readable', customAudit.low.length === 0, customAudit.low.join(', '))
  // extreme custom colours still produce readable controls
  const extremes = []
  for (const c of ['#000000', '#ffffff', '#ff0000', '#808080']) {
    await page.getByLabel('Colour code').fill(c)
    await page.waitForTimeout(100)
    for (const m of ['Light', 'Dark']) { await mode(m).click(); const a = await audit(page); if (a.low.length) extremes.push(`${c} ${m}: ${a.low.slice(0, 2).join(', ')}`) }
  }
  check('extreme custom colours (black, white, pure red, grey) stay readable in both themes', extremes.length === 0, extremes.join(' | '))

  // ---- persistence: refresh, sign out and back in, "browser restart" (a new browser context with the saved storage)
  await mode('Dark').click()
  await page.getByLabel('Colour code').fill('#a78bfa')
  await page.waitForTimeout(900) // the (debounced) save to the person's own profile
  check('the choice is saved to the person\'s own profile in the background', api.some((l) => /^PATCH profiles/.test(l)), api.filter((l) => /profiles/.test(l)).join(', '))
  await page.reload()
  await page.getByRole('heading', { name: 'Appearance' }).waitFor()
  const afterReload = { theme: await page.evaluate(() => document.documentElement.dataset.theme), accent: await rootVar(page, '--color-accent') }
  check('the theme and accent survive a page refresh', afterReload.theme === 'dark' && afterReload.accent === '#a78bfa', JSON.stringify(afterReload))
  await page.getByRole('button', { name: 'Sign out' }).click()
  await page.waitForURL(/\/login/)
  await page.getByLabel('Email').waitFor()
  const onLogin = { theme: await page.evaluate(() => document.documentElement.dataset.theme), bg: await bgOf(page, 'body'), accent: await rootVar(page, '--color-accent') }
  check('the sign-in screen keeps the last look used on this device', onLogin.theme === 'dark' && onLogin.accent === '#a78bfa', JSON.stringify(onLogin))
  await shot(page, '69-login-dark')
  await login(page)
  await page.goto(`${BASE}/settings`)
  await page.getByRole('heading', { name: 'Appearance' }).waitFor()
  check('after signing out and back in the choice is still there', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark' && (await rootVar(page, '--color-accent')) === '#a78bfa' && (await mode('Dark').getAttribute('aria-checked')) === 'true')
  const state = await context.storageState()
  const restarted = await browser.newContext({ storageState: state, viewport: { width: 1366, height: 900 } })
  await installFakeSupabase(restarted, 'owner', [])
  const page2 = await restarted.newPage()
  watch(page2, 'restarted-browser')
  await page2.goto(`${BASE}/`)
  const earlyTheme = await page2.evaluate(() => document.documentElement.dataset.theme) // before the app has even rendered anything
  await page2.getByRole('heading', { level: 1 }).waitFor()
  check('after a browser restart (saved storage in a brand-new browser) the saved look is applied immediately, with no flash of the wrong theme', earlyTheme === 'dark' && (await page2.evaluate(() => document.documentElement.dataset.theme)) === 'dark' && (await rootVar(page2, '--color-accent')) === '#a78bfa')
  await restarted.close()

  // ---- System follows the device, live
  await mode('System').click()
  await page.emulateMedia({ colorScheme: 'light' })
  await page.waitForTimeout(200)
  const sysLight = await page.evaluate(() => document.documentElement.dataset.theme)
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.waitForTimeout(200)
  const sysDark = await page.evaluate(() => document.documentElement.dataset.theme)
  check('System follows the device preference, live', sysLight === 'light' && sysDark === 'dark', `${sysLight} / ${sysDark}`)

  // ---- reset returns to the original look
  await page.getByRole('button', { name: 'Reset' }).click()
  await page.waitForTimeout(200)
  const reset = { theme: await page.evaluate(() => document.documentElement.dataset.theme), accent: await rootVar(page, '--color-accent'), brand: await rootVar(page, '--color-brand'), bg: await bgOf(page, 'body') }
  check('Reset returns to the original light + lime look', reset.theme === 'light' && reset.accent === '#c7f34a' && reset.brand === '#17171b' && reset.bg === 'rgb(243, 243, 246)', JSON.stringify(reset))
  await context.close()
}

/* ------------------------------------------------ appearance for other roles, and on a phone */
{
  const { page } = await newSession('photographer', { width: 390, height: 844 })
  await login(page)
  await page.getByRole('heading', { level: 1 }).waitFor()
  await page.goto(`${BASE}/account`)
  await page.getByRole('heading', { name: 'Appearance' }).waitFor()
  check('photographers (and every other role) can choose their appearance from their Account page', (await page.getByRole('radiogroup', { name: 'Theme' }).count()) === 1)
  await page.getByRole('radio', { name: /^Dark/ }).click()
  await page.getByRole('radio', { name: 'Teal', exact: true }).click()
  await page.waitForTimeout(250)
  const phone = await page.evaluate(() => ({ over: document.documentElement.scrollWidth - window.innerWidth, theme: document.documentElement.dataset.theme }))
  const a = await audit(page)
  const swatch = await page.getByRole('radio', { name: 'Teal', exact: true }).boundingBox()
  check('390px: the theme settings fit the screen, stay readable in dark and the swatches are comfortable touch targets', phone.over <= 1 && phone.theme === 'dark' && a.low.length === 0 && swatch.width >= 40 && swatch.height >= 40, `${JSON.stringify(phone)} ${a.low.join(',')} ${swatch.width}x${swatch.height}`)
  await shot(page, '70-account-appearance-mobile-dark')
  await page.goto(`${BASE}/`)
  await page.getByRole('heading', { level: 1 }).waitFor()
  await page.waitForTimeout(500)
  const dash = await audit(page)
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  check('390px: the dashboard in dark with a teal accent has no overflow and readable text', over <= 1 && dash.low.length === 0, `${over}px ${dash.low.join(',')}`)
  await shot(page, '71-dashboard-mobile-dark-teal')
}

/* ------------------------------------------------------------- photographer role */
{
  const { page, api } = await newSession('photographer', { width: 1366, height: 860 })
  await login(page)
  await page.getByRole('heading', { level: 1 }).waitFor()
  await page.waitForTimeout(600)
  const nav = await page.getByRole('navigation', { name: 'Main' }).getByRole('link').allInnerTexts()
  check('photographer sees only Overview, Events, Calendar and their Account page', JSON.stringify(nav.map((s) => s.replace(/\s+\d+$/, '').trim())) === JSON.stringify(['Overview', 'Events', 'Calendar', 'Account']), nav.join(', '))
  check('photographer dashboard hides money, including payment alerts', (await page.getByText('Outstanding').count()) === 0 && (await page.getByText('Pending amount').count()) === 0 && (await page.getByText(/Payment pending/).count()) === 0)
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
