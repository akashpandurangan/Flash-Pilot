// End-to-end check of the interactive demo in a real browser, against the BUILT demo (demo/dist).
// Run:  npm run demo:build  &&  node demo/tests/e2e.mjs
import { launch, newContext, newPage, reporter, shots, sleep, startServer } from './harness.mjs'

const r = reporter('Flash Pilot interactive demo - end to end')
const server = await startServer({ mode: process.env.MODE || 'preview', port: 4199 })
const browser = await launch()
const out = shots('e2e')
const T = 8000

const { ctx, seen } = await newContext(browser, server.base, { width: 1440, height: 1000 })
const page = await newPage(ctx)
const go = async (path) => { await page.goto(`${server.base}${path}`); await page.locator('h1').first().waitFor({ timeout: 15000 }); await sleep(900) }
const url = () => page.url().replace(server.base, '')
const text = () => page.evaluate(() => document.body.innerText)
const toast = (re) => page.locator('[data-sonner-toast]').filter({ hasText: re }).first().waitFor({ timeout: T }).then(() => true, () => false)
const step = async (name, fn) => {
  try { await fn() } catch (e) {
    r.check(false, `${name} - ${String(e.message).split('\n')[0].slice(0, 160)}`)
    await page.screenshot({ path: `${out}/FAIL_${name.replace(/\W+/g, '_').slice(0, 40)}.png` }).catch(() => {})
    await page.keyboard.press('Escape').catch(() => {})
  }
}
const openEvent = async (name) => {
  await go('/events')
  await page.getByPlaceholder(/Search event/i).fill(name); await sleep(900)
  await page.getByText(name, { exact: true }).first().click()
  await page.getByRole('tab', { name: 'Overview' }).waitFor({ timeout: T }); await sleep(700)
}
const tab = async (name) => { await page.getByRole('tab', { name }).click(); await sleep(700) }

try {
  // ------------------------------------------------------------------ first load
  r.section('Entry, indicator, session')
  await step('dashboard loads', async () => {
    await go('/')
    r.check(/Good (morning|afternoon|evening), Olivia/.test(await page.locator('h1').first().innerText()), 'dashboard greets the demo owner')
    const t = await text()
    r.check(/Lumen Studio/.test(t) && /Studio owner/.test(t), 'studio name and owner role are shown')
    r.check(/Upcoming events/.test(t) && /Today's events/.test(t) && /Pending amount/.test(t), 'KPI cards are present')
    r.check(/₹13,94,000/.test(t), 'pending amount is shown in rupees (₹13,94,000)')
    r.check(await page.title() === 'Flash Pilot — Interactive Demo', 'page title says Interactive Demo')
    r.check(await page.locator('meta[name=robots]').getAttribute('content') === 'noindex, nofollow', 'the demo asks search engines not to index it')
  })
  await step('demo bar', async () => {
    const bar = page.getByTestId('demo-bar')
    r.check(await bar.isVisible() && /Interactive demo/.test(await bar.innerText()), '"Interactive demo" indicator is visible')
    const exit = bar.getByRole('link', { name: /Exit demo/ })
    r.check((await exit.getAttribute('href')) === 'https://akashpandurangan.com/', 'Exit demo points to https://akashpandurangan.com/')
    r.check(await bar.getByRole('button', { name: /demo dashboard/i }).isDisabled(), '"Dashboard" is disabled while already on the dashboard')
  })
  await step('connection banner', async () => {
    r.check(!/Live updates paused|reconnecting/i.test(await text()), 'no "live updates paused" banner (the demo is always live)')
  })

  // ------------------------------------------------------------------ navigation
  r.section('Every screen opens from the sidebar')
  for (const [label, h1] of [['Events', 'Events'], ['Calendar', 'Calendar'], ['Clients', 'Clients'], ['Team', 'Team'], ['Equipment', 'Equipment'], ['Payments', 'Payments'], ['Reports', 'Reports'], ['Settings', 'Settings'], ['Overview', /Good/]]) {
    await step(`nav ${label}`, async () => {
      await page.getByRole('link', { name: new RegExp(`^${label}`) }).first().click()
      await page.locator('h1').filter({ hasText: h1 }).first().waitFor({ timeout: T })
      r.check(true, `sidebar → ${label}`)
      await sleep(400)
      r.check(await page.getByTestId('demo-bar').isVisible(), `  demo bar still visible on ${label}`)
    })
  }
  await step('legacy and auth routes', async () => {
    await go('/login'); r.check(url() === '/', '/login goes straight to the dashboard (no sign-in)')
    await go('/signup'); r.check(url() === '/', '/signup goes straight to the dashboard')
    await go('/projects'); r.check(url().startsWith('/events'), 'old /projects link redirects to /events')
    await page.goto(`${server.base}/onboarding`); await sleep(1800)
    r.check(!/something went wrong|error/i.test(await text()) && (url() === '/' || /onboarding/i.test(url())), '/onboarding does not dead-end (the demo studio is already set up)')
    await page.goto(`${server.base}/forgot-password`); await sleep(1500)
    r.check(url() === '/' || /forgot-password/.test(url()), '/forgot-password does not crash')
    if (/forgot-password/.test(url())) {
      await page.getByLabel('Email').fill('someone@example.com'); await page.getByRole('button', { name: /Send|Reset/ }).first().click(); await sleep(1000)
      r.check(/turned off in the interactive demo|demo/i.test(await text()), 'asking for a password reset explains that it is turned off in the demo')
    }
    await page.goto(`${server.base}/reset-password`); await sleep(1500)
    r.check(!/something went wrong/i.test(await text()), '/reset-password does not crash')
    await page.goto(`${server.base}/nope`); await sleep(1500)
    r.check(/Page not found/.test(await text()), 'unknown route shows "Page not found"')
    await page.getByRole('link', { name: /Go to overview/ }).click(); await sleep(800)
    r.check(url() === '/', '"Go to overview" returns to the dashboard')
  })

  // ------------------------------------------------------------------ events list
  r.section('Events: search, filter, tabs, views')
  await step('events search', async () => {
    await go('/events')
    r.check((await text()).includes('Deshmukh Wedding'), 'events list shows sample events')
    await page.getByPlaceholder(/Search event/i).fill('rahman'); await sleep(900)
    let t = await text()
    r.check(t.includes('Rahman Wedding') && !t.includes('Deshmukh Wedding'), 'search "rahman" narrows the list')
    await page.getByPlaceholder(/Search event/i).fill('FP-0010'); await sleep(900)
    r.check((await text()).includes('Deshmukh Wedding'), 'search by event code works')
    await page.getByPlaceholder(/Search event/i).fill('zzzz'); await sleep(900)
    r.check(/No events|no results|nothing/i.test(await text()), 'a search with no match shows an empty state')
    await page.getByPlaceholder(/Search event/i).fill('')
  })
  await step('events stage tabs', async () => {
    await go('/events')
    await page.getByRole('button', { name: /^Editing/ }).first().click(); await sleep(900)
    let t = await text()
    r.check(t.includes('Rahman Wedding') && t.includes('Menon Engagement') && t.includes('Northwind Labs Offsite') && !t.includes('Deshmukh Wedding'), '"Editing" tab shows exactly the events in editing')
    await page.getByRole('button', { name: /^Cancelled/ }).first().click(); await sleep(900)
    r.check((await text()).includes('Menon Anniversary Portraits'), '"Cancelled" tab shows the cancelled booking')
    await page.getByRole('button', { name: /^Delivered/ }).first().click(); await sleep(900)
    t = await text()
    r.check(t.includes('Nambiar Wedding') && t.includes('Brightleaf Annual Gala'), '"Delivered" tab shows delivered events')
    await page.getByRole('button', { name: /^All Events/ }).first().click(); await sleep(700)
  })
  await step('events views', async () => {
    await go('/events')
    await page.getByRole('button', { name: 'Cards' }).click(); await sleep(700)
    r.check((await text()).includes('Deshmukh Wedding'), 'Cards view shows events')
    await page.getByRole('button', { name: 'List' }).click(); await sleep(500)
    await page.getByRole('button', { name: 'Filters' }).click(); await sleep(600)
    r.check(await page.getByRole('dialog').or(page.getByText(/Event type/i).first()).first().isVisible(), 'Filters panel opens')
    await page.keyboard.press('Escape'); await sleep(300)
  })

  // ------------------------------------------------------------------ event detail
  r.section('Event detail')
  await step('detail overview', async () => {
    await openEvent('Deshmukh Wedding')
    const t = await text()
    r.check(/FP-0010/.test(t) && /Aanya Deshmukh/.test(t) && /Seabreeze Banquets/.test(t), 'detail shows code, client and venue')
    r.check(/Wedding ceremony/.test(t) && /Reception/.test(t) && /Haldi/.test(t) && /Mehendi/.test(t), 'all four sessions are listed')
    r.check(/Olivia Mehra/.test(t) && /Lead photographer/.test(t), 'team with roles is listed')
    r.check(/₹4,80,000/.test(t) && /₹2,50,000/.test(t) && /₹2,30,000/.test(t), 'financial summary: agreed, received, balance')
    r.check(await page.getByRole('link', { name: 'Events' }).first().isVisible(), 'breadcrumb back to Events')
    for (const name of ['Production', 'Payments', 'Activity', 'Overview']) { await tab(name); r.check(true, `  tab "${name}" opens`) }
  })
  await step('detail → deep link and reload', async () => {
    const here = url()
    await page.reload(); await page.locator('h1').first().waitFor({ timeout: 15000 }); await sleep(900)
    r.check(url() === here && /Deshmukh Wedding/.test(await text()), 'reloading an event URL keeps the page (demo data is rebuilt on reload)')
  })
  await step('detail → edit deep link', async () => {
    const eventPage = url().split('?')[0]
    await go(eventPage + '/edit')
    r.check(/Edit event|Deshmukh Wedding/.test(await text()) && (await page.locator('input[name=name]').inputValue()) === 'Deshmukh Wedding', 'an event\'s /edit URL opens the pre-filled edit form')
    await page.goto(`${server.base}/events/not-a-real-id`); await sleep(2000) // this empty state has no <h1>, so don't wait for one
    r.check(/Event not found/i.test(await text()), 'an unknown event id shows "Event not found"')
    await go(eventPage) // back to the event for the next step
  })
  await step('activity tab', async () => {
    await tab('Activity')
    const t = await text()
    r.check(/Event created: Deshmukh Wedding/.test(t) && /Booking confirmed/.test(t) && /Production started automatically/.test(t), 'activity timeline shows the event history')
    await tab('Overview')
  })

  // ------------------------------------------------------------------ payments
  r.section('Payments on an event')
  await step('record payment + overpayment guard', async () => {
    await openEvent('Deshmukh Wedding'); await tab('Payments')
    r.check(/Payment history/.test(await text()), 'payments tab lists payment history')
    await page.getByRole('button', { name: /Record payment/ }).first().click()
    const dlg = page.getByRole('dialog'); await dlg.waitFor({ timeout: T })
    await dlg.getByLabel('Amount received').fill('999999'); await sleep(500)
    r.check(/more than the balance/i.test(await dlg.innerText()) && /Yes, record it anyway/.test(await dlg.innerText()), 'an overpayment is flagged with an explanation (balance ₹2,30,000)')
    r.check(await dlg.getByRole('button', { name: 'Record payment' }).isDisabled(), 'and cannot be recorded until the user confirms it')
    await dlg.getByLabel('Amount received').fill('30000')
    await dlg.getByLabel('Reference').fill('UPI-DEMO-1')
    await dlg.getByRole('button', { name: 'Record payment' }).click()
    r.check(await toast(/recorded/i), 'a valid payment shows a success toast')
    await sleep(1200)
    const t = await text()
    r.check(/₹2,00,000/.test(t), 'balance falls to ₹2,00,000 on the same screen')
    r.check(/UPI-DEMO-1/.test(t), 'the new payment appears in the history')
  })
  await step('void payment', async () => {
    await page.getByRole('button', { name: /Void payment/ }).first().click(); await sleep(500)
    const dlg = page.getByRole('alertdialog').or(page.getByRole('dialog')).first(); await dlg.waitFor({ timeout: T })
    await dlg.getByPlaceholder(/Reason/i).fill('Entered by mistake')
    await dlg.getByRole('button', { name: /Void payment/ }).click()
    r.check(await toast(/voided/i), 'voiding shows a toast')
    await sleep(1200)
    r.check(/Void/i.test(await text()), 'the payment is marked void in the history')
  })

  // ------------------------------------------------------------------ workflow
  r.section('Production workflow')
  await step('client approval → editing', async () => {
    await openEvent('Pillai Wedding')
    r.check(/Waiting for client approval/i.test(await text()), 'Pillai Wedding is waiting for client approval')
    await tab('Production')
    await page.getByRole('button', { name: /Record client approval|Record approval/ }).first().click()
    const dlg = page.getByRole('dialog'); await dlg.waitFor({ timeout: T })
    await dlg.getByRole('button', { name: 'Record approval' }).click()
    r.check(await toast(/approval recorded/i), 'recording approval shows a toast')
    await sleep(1200)
    r.check(/Editing/.test(await text()) && !/Waiting for client approval\s*\n.*Record/.test(await text()), 'the stage moves on to Editing')
  })
  await step('editing → out for delivery → delivered', async () => {
    await page.getByRole('button', { name: /Mark editing completed/ }).first().click(); r.check(await toast(/Editing marked completed/i), 'editing marked completed'); await sleep(1000)
    await page.getByRole('button', { name: /Mark out for delivery/ }).first().click(); await sleep(700)
    const dlg = page.getByRole('dialog')
    if (await dlg.count()) { await dlg.getByRole('button', { name: /Mark out for delivery|Save/ }).first().click() }
    r.check(await toast(/out for delivery/i), 'marked out for delivery'); await sleep(1200)
    r.check(/Out for delivery/i.test(await text()), 'stage shows Out for Delivery')
  })
  await step('checklist toggle', async () => {
    await openEvent('Bhargava Wedding'); await tab('Production')
    const box = page.getByRole('checkbox').first(); await box.waitFor({ timeout: T })
    const before = await box.isChecked()
    await box.click(); await sleep(1000)
    r.check((await page.getByRole('checkbox').first().isChecked()) !== before, 'a checklist task can be ticked and unticked')
    await page.getByRole('checkbox').first().click(); await sleep(700)
  })
  await step('booking: cancel and reopen', async () => {
    await openEvent('Tandon Family Birthday')
    r.check(/Inquiry/.test(await text()), 'inquiry is shown as an inquiry')
    await page.getByRole('button', { name: /Confirm booking/ }).first().click().catch(async () => { await page.getByRole('button', { name: 'More actions' }).click() })
    await sleep(1000)
    r.check(await toast(/confirmed/i) || /Confirmed/.test(await text()), 'an inquiry can be confirmed')
  })

  // ------------------------------------------------------------------ create event
  r.section('Create an event')
  await step('new event form', async () => {
    await go('/events/new')
    r.check(/New event/.test(await text()), 'new event form opens')
    r.check(await page.getByRole('button', { name: /Create event|Save/ }).first().isVisible(), 'form has a save button')
  })

  // ------------------------------------------------------------------ clients
  r.section('Clients')
  await step('clients list/search/detail', async () => {
    await go('/clients')
    r.check((await text()).includes('Aanya Deshmukh') && (await text()).includes('Brightleaf Hospitality'), 'clients list shows sample clients')
    await page.getByPlaceholder(/Search/i).first().fill('menon'); await sleep(900)
    r.check((await text()).includes('Rahul Menon') && !(await text()).includes('Aanya Deshmukh'), 'client search narrows the list')
    await page.locator('a:visible', { hasText: 'Rahul Menon' }).first().click(); await sleep(1200)
    r.check(/\/clients\//.test(url()), 'a client opens its own page')
    const t = await text()
    r.check(/Menon Wedding/.test(t) && /Menon Engagement/.test(t), "the client's events are listed")
  })
  await step('add client', async () => {
    await go('/clients')
    await page.getByRole('button', { name: /New client/ }).first().click()
    const dlg = page.getByRole('dialog'); await dlg.waitFor({ timeout: T })
    await dlg.getByLabel('Full name').fill('Demo Visitor')
    await dlg.getByLabel('Phone').fill('+91 55502 90001')
    await dlg.getByLabel('Email').fill('visitor@example.com')
    await dlg.getByRole('button', { name: /Add client/ }).click()
    r.check(await toast(/Client added/i), 'a new client can be added')
    await sleep(1200)
    await page.getByPlaceholder(/Search/i).first().fill('Demo Visitor'); await sleep(900)
    r.check((await text()).includes('Demo Visitor'), 'the new client shows in the list')
    // moving around inside the app keeps the changes (only a full page reload starts over)
    await page.getByRole('link', { name: /^Team/ }).first().click(); await page.locator('h1').filter({ hasText: 'Team' }).first().waitFor({ timeout: T })
    await page.getByRole('link', { name: /^Clients/ }).first().click(); await page.locator('h1').filter({ hasText: 'Clients' }).first().waitFor({ timeout: T }); await sleep(800)
    await page.getByPlaceholder(/Search/i).first().fill('Demo Visitor'); await sleep(900)
    r.check((await text()).includes('Demo Visitor'), 'changes survive navigating between screens')
  })

  // ------------------------------------------------------------------ team, equipment
  r.section('Team and equipment')
  await step('team', async () => {
    await go('/team')
    const t = await text()
    r.check(/Rohan Iyer/.test(t) && /Naina Rao/.test(t) && /Invited/.test(t) && /No sign-in/.test(t), 'team shows members, an invited member and members without sign-in')
    r.check(!/Isha Verma/.test(t), 'a deactivated member is hidden by the default "Active" filter')
    await page.getByPlaceholder(/Search name/i).fill('naina'); await sleep(800)
    r.check((await text()).includes('Naina Rao') && !(await text()).includes('Rohan Iyer'), 'team search works')
  })
  await step('add team member', async () => {
    await go('/team')
    await page.getByRole('button', { name: /Add team member/ }).first().click()
    const dlg = page.getByRole('dialog'); await dlg.waitFor({ timeout: T })
    await dlg.getByLabel('Full name').fill('Test Crew')
    await dlg.getByRole('button', { name: /^(Add|Save|Add team member)/ }).last().click()
    r.check(await toast(/added|saved/i), 'a team member can be added')
  })
  await step('equipment', async () => {
    await go('/equipment')
    const t = await text()
    r.check(/Sony A7 IV/.test(t) && /LS-LNS-01/.test(t), 'inventory lists gear with asset ids')
    r.check(/equipment issues? on upcoming sessions/i.test(t), 'equipment conflict warning is shown')
    await page.getByRole('tab', { name: /Upcoming reservations/ }).click(); await sleep(800)
    r.check(/Deshmukh Wedding|Bhargava Wedding/.test(await text()), 'upcoming reservations tab lists events')
    await page.getByRole('tab', { name: /Inventory/ }).click(); await sleep(500)
  })

  // ------------------------------------------------------------------ payments page
  r.section('Payments, calendar, reports, notifications')
  await step('payments page', async () => {
    await go('/payments')
    const t = await text()
    r.check(/Agreed \(confirmed events\)/.test(t) && /Received/.test(t) && /Outstanding/.test(t) && /Overdue/.test(t), 'payment summary cards')
    r.check(/Brightleaf Annual Gala/.test(t) && /Overdue/.test(t), 'overdue balance is flagged')
    await page.getByRole('tab', { name: /Payment history/ }).click(); await sleep(900)
    r.check(/UPI-DEMO-1|Advance|Bank transfer|UPI/.test(await text()), 'payment history tab lists payments')
  })
  await step('calendar', async () => {
    await go('/calendar')
    r.check(/Scheduling warnings/.test(await text()), 'calendar shows scheduling warnings (double-booking)')
    for (const v of ['Week', 'Day', 'Upcoming', 'Month']) { await page.getByRole('button', { name: v, exact: true }).click(); await sleep(600); r.check(true, `  "${v}" view opens`) }
    await page.getByRole('button', { name: 'Today' }).click(); await sleep(400)
  })
  await step('reports', async () => {
    await go('/reports')
    const t = await text()
    r.check(/Events in period/.test(t) && /Payments received/.test(t) && /Delivery performance/.test(t), 'report cards and charts render')
  })
  await step('notifications', async () => {
    await go('/notifications')
    r.check(/Today: Deshmukh Wedding/.test(await text()), 'inbox lists notifications')
    await page.getByRole('button', { name: 'Mark read' }).first().click(); await sleep(900)
    await page.getByRole('button', { name: /Mark all read/ }).click(); await sleep(900)
    await page.getByRole('tab', { name: /Email delivery/ }).click(); await sleep(900)
    r.check(/Sent|Failed|Skipped/.test(await text()), 'email delivery tab lists outcomes (nothing is really sent)')
    await page.getByRole('tab', { name: /Preferences/ }).click(); await sleep(600)
    r.check(/Save preferences/.test(await text()), 'preferences tab opens')
  })

  // ------------------------------------------------------------------ search
  r.section('Global search')
  await step('global search', async () => {
    await go('/')
    await page.keyboard.press('Control+k'); await sleep(600)
    const box = page.getByRole('dialog').getByRole('combobox').or(page.getByRole('dialog').locator('input')).first()
    await box.fill('rahman'); await sleep(1200)
    r.check(/Rahman Wedding/.test(await page.getByRole('dialog').innerText()), 'Ctrl+K search finds an event')
    await page.getByRole('dialog').getByRole('link', { name: /Rahman Wedding/ }).first().click(); await sleep(1200)
    r.check(/\/events\//.test(url()) && /Rahman Wedding/.test(await text()), 'choosing a result opens it')
  })

  // ------------------------------------------------------------------ settings and account
  r.section('Settings and account')
  await step('settings', async () => {
    await go('/settings')
    const t = await text()
    r.check(/Studio profile|Studio details|Studio/.test(t) && /Lumen Studio/.test(await page.locator('input').evaluateAll((els) => els.map((e) => e.value).join('|'))), 'studio settings show Lumen Studio')
    r.check(/Appearance/i.test(t), 'appearance settings are available')
  })
  await step('account', async () => {
    await go('/account')
    r.check(/Olivia Mehra/.test(await page.locator('input').evaluateAll((els) => els.map((e) => e.value).join('|'))), 'account shows the demo profile')
  })

  // ------------------------------------------------------------------ demo bar actions
  r.section('Demo bar actions')
  await step('dashboard button', async () => {
    await go('/clients')
    await page.getByTestId('demo-bar').getByRole('button', { name: /demo dashboard/i }).click(); await sleep(900)
    r.check(url() === '/', '"Dashboard" returns to the demo dashboard from any page')
  })
  await step('collapse and expand', async () => {
    await page.getByRole('button', { name: /Minimise the demo controls/ }).click(); await sleep(400)
    const bar = page.getByTestId('demo-bar')
    r.check((await bar.getAttribute('data-collapsed')) === 'true' && /Interactive demo/.test(await bar.innerText()), 'collapsed to a chip that still says "Interactive demo"')
    await bar.getByRole('button').click(); await sleep(400)
    r.check((await page.getByTestId('demo-bar').getAttribute('data-collapsed')) === 'false', 'the chip expands again')
  })
  await step('sign out is a no-op with a hint', async () => {
    await page.getByRole('button', { name: /Sign out|Log out/i }).first().click().catch(async () => { await page.locator('aside button').last().click() })
    r.check(await toast(/Signing out is turned off/i), 'signing out explains it is turned off in the demo')
    await sleep(900)
    r.check(url() === '/', 'and the visitor stays in the demo')
  })
  await step('reset', async () => {
    // a full page load starts from the sample data, so make two fresh changes and then use the in-app Reset
    const nav = async (label, h1) => { await page.getByRole('link', { name: new RegExp(`^${label}`) }).first().click(); await page.locator('h1').filter({ hasText: h1 }).first().waitFor({ timeout: T }); await sleep(700) }
    await go('/clients')
    await page.getByRole('button', { name: /New client/ }).first().click()
    const dlg = page.getByRole('dialog'); await dlg.waitFor({ timeout: T })
    await dlg.getByLabel('Full name').fill('Reset Probe'); await dlg.getByLabel('Phone').fill('+91 55502 90002')
    await dlg.getByRole('button', { name: /Add client/ }).click(); await toast(/Client added/i); await sleep(1000)
    await nav('Payments', 'Payments')
    await page.getByRole('button', { name: /^Payment$|Payment/ }).first().click()
    const pay = page.getByRole('dialog'); await pay.waitFor({ timeout: T })
    await pay.getByLabel('Amount received').fill('20000'); await pay.getByRole('button', { name: 'Record payment' }).click(); await toast(/recorded/i); await sleep(1200)
    r.check(!/₹13,94,000/.test(await text()), 'the payment lowers the outstanding total before reset')
    await nav('Clients', 'Clients')
    await page.getByPlaceholder(/Search/i).first().fill('Reset Probe'); await sleep(900)
    r.check((await text()).includes('Reset Probe'), 'the client created in this session is present before reset')
    await page.getByTestId('demo-bar').getByRole('button', { name: /Reset the demo data/ }).click()
    r.check(await toast(/Demo reset/i), 'reset shows a confirmation')
    await sleep(1500)
    r.check(url() === '/', 'reset returns to the dashboard')
    await nav('Clients', 'Clients')
    await page.getByPlaceholder(/Search/i).first().fill('Reset Probe'); await sleep(900)
    r.check(!(await text()).includes('Reset Probe'), 'after reset the visitor-created client is gone')
    await nav('Payments', 'Payments')
    r.check(/₹13,94,000/.test(await text()), 'after reset the outstanding total is back to the original ₹13,94,000')
  })

  // ------------------------------------------------------------------ safety
  r.section('Safety')
  await step('network guard', async () => {
    const res = await page.evaluate(async () => {
      const results = {}
      try { await fetch('https://example-project.supabase.co/rest/v1/projects'); results.fetch = 'allowed' } catch (e) { results.fetch = `blocked: ${e.message}` }
      try { new WebSocket('wss://example-project.supabase.co/realtime/v1/websocket'); results.ws = 'allowed' } catch (e) { results.ws = 'blocked' }
      try { const x = new XMLHttpRequest(); x.open('GET', 'https://example-project.supabase.co/auth/v1/user'); results.xhr = 'allowed' } catch (e) { results.xhr = 'blocked' }
      results.beacon = navigator.sendBeacon('https://example-project.supabase.co/log', 'x') ? 'allowed' : 'blocked'
      return results
    })
    r.check(/blocked/.test(res.fetch) && res.ws === 'blocked' && res.xhr === 'blocked' && res.beacon === 'blocked', `in-page guard refuses cross-origin fetch, WebSocket, XHR and beacon (${JSON.stringify(res)})`)
  })
  await step('no outside traffic', async () => {
    const blocked = seen.blocked.filter((b) => !/example-project\.supabase\.co/.test(b))
    r.check(blocked.length === 0, `the browser made no request outside the demo's own server (${blocked.length} blocked by the test guard${blocked.length ? ': ' + blocked.slice(0, 3).join(' ; ') : ''})`)
    r.check(seen.blocked.length === 0, 'not even the deliberate probes reached the network (the in-page guard stopped them first)')
    r.check(seen.websockets === 0, 'no WebSocket was opened')
  })
  await step('storage', async () => {
    const keys = await page.evaluate(() => [...Object.keys(localStorage), ...Object.keys(sessionStorage)])
    r.check(!keys.some((k) => /supabase|sb-|auth-token/i.test(k)), `no auth tokens are stored in the browser (keys: ${keys.join(', ') || 'none'})`)
  })
  await step('console', async () => {
    // the in-page guard deliberately logs when it refuses the probes above; those are expected, anything else is not
    const problems = page.problems.filter((p) => !/\[demo\] Blocked .*example-project\.supabase\.co/.test(p))
    r.check(problems.length === 0, `no console errors or page errors during the whole run (${problems.length}${problems.length ? ': ' + problems.slice(0, 3).join(' | ') : ''})`)
  })
} finally {
  await browser.close()
  server.stop()
}
process.exit(r.done() ? 1 : 0)
