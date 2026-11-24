// Responsive pass: every screen at desktop, laptop, tablet and phone widths (light and dark).
// Checks: no horizontal page overflow, no clipped fixed bar, "Interactive demo" always visible, the bar never hides the
// last piece of content, the mobile drawer opens, no console errors. Screenshots go to demo/.screenshots/responsive.
import { launch, newContext, newPage, reporter, shots, sleep, startServer } from './harness.mjs'

const r = reporter('Flash Pilot interactive demo - responsive')
const server = await startServer({ mode: process.env.MODE || 'preview', port: 4199 })
const browser = await launch()
const out = shots('responsive')
const T = 10000
const WIDTHS = (process.env.WIDTHS || '1440x900,1280x800,1024x768,820x1180,768x1024,414x896,390x844,360x740').split(',').map((s) => s.split('x').map(Number))
const ROUTES = ['/', '/events', '/events/new', 'EVENT', '/calendar', '/clients', 'CLIENT', '/team', '/equipment', '/payments', '/notifications', '/reports', '/settings', '/account']

try {
  for (const [W, H] of WIDTHS) {
    const phone = W < 820
    r.section(`${W}x${H}${phone ? ' (touch)' : ''}`)
    const { ctx, seen } = await newContext(browser, server.base, { width: W, height: H, ...(phone ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) })
    const page = await newPage(ctx)
    let eventUrl = '', clientUrl = ''
    for (const route of ROUTES) {
      let path = route
      if (route === 'EVENT') path = eventUrl || '/events'
      if (route === 'CLIENT') path = clientUrl || '/clients'
      await page.goto(`${server.base}${path}`)
      await page.locator('h1').first().waitFor({ state: 'attached', timeout: T }).catch(() => {})
      await sleep(1100)
      if (route === '/events' && !eventUrl) {
        // learn a real event and client id from the app's own links
        eventUrl = await page.evaluate(() => [...document.querySelectorAll('a[href^="/events/"]')].map((a) => a.getAttribute('href')).find((h) => /\/events\/[0-9a-f-]{36}$/.test(h)) || '')
      }
      if (route === '/clients' && !clientUrl) clientUrl = await page.evaluate(() => [...document.querySelectorAll('a[href^="/clients/"]')].map((a) => a.getAttribute('href'))[0] || '')
      const m = await page.evaluate(() => {
        const bar = document.querySelector('[data-testid=demo-bar] > *')
        const b = bar?.getBoundingClientRect()
        const doc = document.documentElement
        return {
          overflow: doc.scrollWidth - doc.clientWidth,
          bar: b ? { l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top), b: Math.round(b.bottom), w: Math.round(b.width) } : null,
          vw: doc.clientWidth, vh: window.innerHeight,
          barText: /Interactive demo/.test(document.querySelector('[data-testid=demo-bar]')?.innerText ?? ''),
          h1: document.querySelector('h1')?.textContent?.trim().slice(0, 30),
        }
      })
      const label = `${route === 'EVENT' ? 'event detail' : route === 'CLIENT' ? 'client detail' : route}`
      const barOk = m.bar && m.bar.l >= 0 && m.bar.r <= m.vw + 1 && m.bar.b <= m.vh
      r.check(m.overflow <= 0 && barOk && m.barText && !!m.h1, `${label.padEnd(14)} overflow=${m.overflow} bar=${m.bar ? `${m.bar.w}px wide, ${m.bar.l}→${m.bar.r} of ${m.vw}` : 'missing'}`)

      // does the fixed bar cover the end of the page? scroll to the bottom and see what is under it
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await sleep(250)
      const cover = await page.evaluate(() => {
        const bar = document.querySelector('[data-testid=demo-bar] > *')
        if (!bar) return { hidden: 0 }
        const b = bar.getBoundingClientRect()
        // interactive controls or text blocks whose centre sits under the bar
        const under = [...document.querySelectorAll('main a, main button, main input, main select, main textarea, main [role=tab], main [role=checkbox]')].filter((el) => {
          const e = el.getBoundingClientRect(); if (e.width === 0 || e.height === 0) return false
          const cx = e.left + e.width / 2, cy = e.top + e.height / 2
          return cx >= b.left && cx <= b.right && cy >= b.top && cy <= b.bottom
        })
        return { hidden: under.length, names: under.slice(0, 3).map((e) => (e.getAttribute('aria-label') || e.textContent || e.tagName).trim().slice(0, 30)) }
      })
      if (cover.hidden) r.check(false, `  ${label}: at the bottom of the page the bar covers ${cover.hidden} control(s): ${cover.names.join(', ')}`)
      if (['/', '/events', 'EVENT', '/payments'].includes(route)) await page.screenshot({ path: `${out}/${W}x${H}_${label.replace(/\W+/g, '_')}.png` })
      await page.evaluate(() => window.scrollTo(0, 0))
    }

    // the mobile drawer / sidebar navigation
    await page.goto(`${server.base}/`); await page.locator('h1').first().waitFor({ state: 'attached', timeout: T }); await sleep(900)
    if (W < 1024) {
      await page.getByRole('button', { name: /menu/i }).first().click(); await sleep(600)
      const drawer = page.getByRole('dialog')
      r.check(await drawer.isVisible(), 'the navigation drawer opens from the menu button')
      await drawer.getByRole('link', { name: /^Team/ }).click(); await page.locator('h1').filter({ hasText: 'Team' }).first().waitFor({ state: 'attached', timeout: T }); await sleep(500)
      r.check(true, 'and navigates (Team)')
      await page.screenshot({ path: `${out}/${W}x${H}_team.png` })
    }
    // the bar's own controls at this width
    const bar = page.getByTestId('demo-bar')
    if ((await bar.getAttribute('data-collapsed')) === 'true') { await bar.getByRole('button').click(); await sleep(300) }
    const box = await bar.locator('> *').first().boundingBox()
    const names = ['Back to the demo dashboard', 'Reset the demo data']
    let reachable = true
    for (const n of names) { const b = await bar.getByRole('button', { name: n }).boundingBox(); if (!b || b.x < 0 || b.x + b.width > W || b.height < 28) reachable = false }
    const exit = await bar.getByRole('link', { name: /Exit demo/ }).boundingBox()
    r.check(reachable && exit && exit.x >= 0 && exit.x + exit.width <= W && exit.height >= 28, `expanded bar: Dashboard, Reset and Exit demo are on screen and at least 28px tall (bar ${Math.round(box.width)}x${Math.round(box.height)})`)
    await page.screenshot({ path: `${out}/${W}x${H}_bar_expanded.png` })
    // (dark theme is covered separately by bar-visual.mjs; this suite runs in the default light theme)
    r.check(page.problems.length === 0, `no console errors (${page.problems.length}${page.problems.length ? ': ' + page.problems.slice(0, 2).join(' | ') : ''})`)
    r.check(seen.blocked.length === 0 && seen.websockets === 0, 'no outside requests, no sockets')
    await ctx.close()
  }
} finally {
  await browser.close()
  server.stop()
}
process.exit(r.done() ? 1 : 0)
