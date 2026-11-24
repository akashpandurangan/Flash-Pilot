// Shared helpers for the demo's browser checks. Everything runs against a local server; a request guard aborts ANY request
// that is not to that server (or a data:/blob: URL), and records it, so a check can assert that nothing left the machine.
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
export const EDGE = process.env.DEMO_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Starts `vite preview` (the built demo, demo/dist) or `vite` (dev) and waits until it answers. */
export async function startServer({ mode = 'preview', port = 4199 } = {}) {
  const args = [path.join(REPO, 'node_modules/vite/bin/vite.js')]
  if (mode === 'preview') args.push('preview')
  args.push('--config', 'demo/vite.config.ts', '--port', String(port), '--strictPort', '--host', '127.0.0.1')
  // a clean environment: no credentials of any kind are passed to the server
  const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP, HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE }
  const child = spawn(process.execPath, args, { cwd: REPO, stdio: 'ignore', env })
  const base = `http://127.0.0.1:${port}`
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(base)).ok) return { base, stop: () => child.kill() } } catch { /* not up yet */ }
    await sleep(500)
  }
  child.kill()
  throw new Error(`demo server did not start on ${base}`)
}

export async function launch() {
  return chromium.launch({ executablePath: EDGE, headless: true })
}

/** A browser context whose every request is checked: only the local server is allowed. */
export async function newContext(browser, base, { width = 1440, height = 900, timezone = 'Asia/Kolkata', theme, init, ...rest } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, timezoneId: timezone, locale: 'en-US', ...rest })
  const seen = { blocked: [], local: 0, websockets: 0 }
  await ctx.route('**/*', (route) => {
    const url = route.request().url()
    if (url.startsWith(base) || url.startsWith('data:') || url.startsWith('blob:')) { seen.local++; return route.continue() }
    seen.blocked.push(`${route.request().method()} ${url.slice(0, 140)}`)
    return route.abort()
  })
  ctx.on('websocket', () => { seen.websockets++ })
  if (theme) await ctx.addInitScript((t) => { try { localStorage.setItem('fp.appearance.mode', t) } catch { /* ignore */ } }, theme)
  if (init) await ctx.addInitScript(init)
  return { ctx, seen }
}

/** Opens a page and collects console errors / page errors / failed requests. */
export async function newPage(ctx) {
  const page = await ctx.newPage()
  page.problems = []
  page.on('pageerror', (e) => page.problems.push(`pageerror: ${e.message.slice(0, 200)}`))
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    const text = m.text()
    if (/Failed to load resource.*(ERR_FAILED|net::)/i.test(text)) return // aborted-by-guard requests are reported separately
    page.problems.push(`console: ${text.slice(0, 200)}`)
  })
  return page
}

export function reporter(title) {
  let bad = 0
  let total = 0
  console.log(`\n${title}`)
  return {
    check(ok, msg) { total++; console.log(`  ${ok ? 'ok ' : '!! '} ${msg}`); if (!ok) bad++ },
    section(name) { console.log(`\n== ${name}`) },
    done() { console.log(bad ? `\n${bad} of ${total} FAILED` : `\nALL ${total} CHECKS PASSED`); return bad },
  }
}

export const shots = (name) => { const dir = path.join(REPO, 'demo', '.screenshots', name); fs.mkdirSync(dir, { recursive: true }); return dir }
