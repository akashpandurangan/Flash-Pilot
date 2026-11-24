// The dev server (what `vite --config demo/vite.config.ts` runs) must serve the DEMO - not the production index.html that also
// sits at the repository root - on / and on deep links, and make no outside requests.
import { launch, newContext, newPage, reporter, sleep, startServer } from './harness.mjs'

const r = reporter('Flash Pilot interactive demo - dev server')
const server = await startServer({ mode: 'dev', port: 4198 })
const browser = await launch()
try {
  const { ctx, seen } = await newContext(browser, server.base, { width: 1280, height: 800 })
  const page = await newPage(ctx)
  for (const [path, h1, title] of [['/', /Good/, 'Flash Pilot — Interactive Demo'], ['/events', /^Events/, 'Flash Pilot — Interactive Demo'], ['/calendar', /Calendar/, 'Flash Pilot — Interactive Demo']]) {
    await page.goto(`${server.base}${path}`)
    await page.locator('h1').filter({ hasText: h1 }).first().waitFor({ state: 'attached', timeout: 60000 }).catch(() => {})
    await sleep(1200)
    r.check((await page.title()) === title, `${path} serves the demo page (title: ${await page.title()})`)
    r.check((await page.locator('h1').first().innerText().catch(() => '')).match(h1) !== null, `${path} renders its screen`)
    r.check(await page.getByTestId('demo-bar').isVisible(), `${path} shows the Interactive demo bar`)
  }
  const t = await page.evaluate(() => document.body.innerText)
  r.check(!/Supabase is not configured|configuration|Missing/i.test(t), 'no "backend not configured" screen')
  r.check(seen.blocked.length === 0, `no request left the dev server (${seen.blocked.length}${seen.blocked.length ? ': ' + seen.blocked.slice(0, 3).join(' ; ') : ''})`)
  const problems = page.problems.filter((p) => !/\[vite\]/.test(p))
  r.check(problems.length === 0, `no console errors (${problems.length}${problems.length ? ': ' + problems.slice(0, 3).join(' | ') : ''})`)
} finally {
  await browser.close()
  server.stop()
}
process.exit(r.done() ? 1 : 0)
