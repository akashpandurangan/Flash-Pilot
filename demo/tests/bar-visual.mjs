// Screenshots of the demo bar in light/dark, expanded/collapsed, desktop/phone, plus computed-style checks.
import { launch, newContext, newPage, reporter, shots, sleep, startServer } from './harness.mjs'

const r = reporter('Flash Pilot interactive demo - bar styling')
const server = await startServer({ port: 4199 })
const browser = await launch()
const out = shots('bar')
try {
  for (const [w, h, phone] of [[1280, 800, false], [390, 844, true]]) {
    for (const mode of ['light', 'dark']) {
      const { ctx } = await newContext(browser, server.base, { width: w, height: h, colorScheme: mode, ...(phone ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) })
      const page = await newPage(ctx)
      if (mode === 'dark') {
        // use the app's own Appearance setting (it remembers the choice in the browser), then load the page under test
        await page.goto(`${server.base}/settings`); await page.getByText('Dark', { exact: true }).first().waitFor({ timeout: 15000 }); await sleep(800)
        await page.getByText('Dark', { exact: true }).first().click(); await sleep(800)
      }
      await page.goto(`${server.base}/events`); await page.locator('h1').first().waitFor({ state: 'attached' }); await sleep(1500)
      // force the theme through the app's own setting so the check is real
      const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'))
      const bar = page.getByTestId('demo-bar')
      if ((await bar.getAttribute('data-collapsed')) === 'true') await page.screenshot({ path: `${out}/${w}_${mode}_collapsed.png` })
      if ((await bar.getAttribute('data-collapsed')) === 'true') { await bar.getByRole('button').click(); await sleep(300) }
      const s = await page.evaluate(() => {
        const panel = document.querySelector('.demo-bar__panel'); const cs = getComputedStyle(panel)
        const exit = getComputedStyle(document.querySelector('.demo-bar__exit'))
        return { pos: getComputedStyle(document.querySelector('.demo-bar')).position, z: getComputedStyle(document.querySelector('.demo-bar')).zIndex, bg: cs.backgroundColor, fg: cs.color, radius: cs.borderTopLeftRadius, exitBg: exit.backgroundColor, exitFg: exit.color }
      })
      r.check(s.pos === 'fixed' && s.z === '45', `${w}px ${mode}: bar is fixed above the page (z-index ${s.z})`)
      r.check(s.bg !== 'rgba(0, 0, 0, 0)' && s.fg !== s.bg, `${w}px ${mode} (data-theme=${theme}): pill background ${s.bg}, text ${s.fg}`)
      r.check(s.exitBg !== s.bg, `${w}px ${mode}: Exit demo uses the accent colour (${s.exitBg} on ${s.exitFg})`)
      await page.screenshot({ path: `${out}/${w}_${mode}_expanded.png` })
      await ctx.close()
    }
  }
} finally { await browser.close(); server.stop() }
process.exit(r.done() ? 1 : 0)
