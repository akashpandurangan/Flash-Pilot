// Fails (exit 1) if the BUILT demo contains anything that could talk to a backend: the Supabase client, its service URLs,
// credentials, or real-looking contact details. Run after building:  node demo/scripts/check-bundle.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist')
if (!fs.existsSync(path.join(dist, 'index.html'))) {
  console.error('demo/dist/index.html not found - build the demo first (see demo/README.md).')
  process.exit(1)
}

const files = []
const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else files.push(p) } }
walk(dist)

// things that must never be in the demo bundle
const FORBIDDEN = [
  ['the Supabase auth client', /GoTrueClient|gotrue-js/],
  ['the Supabase REST client', /PostgrestClient|postgrest-js/],
  ['the Supabase realtime client', /RealtimeClient|realtime-js|phoenix/i],
  ['a Supabase service URL', /supabase\.(co|in|net)\b/i],
  ['a Supabase endpoint path', /\/(rest|auth|storage|functions|realtime)\/v1\b/],
  ['a Supabase header or key', /x-supabase|sb_publishable|sb_secret|VITE_SUPABASE|SUPABASE_(URL|KEY|SERVICE)/i],
  ['a JWT-looking token', /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\./],
  ['the SDK package name', /@supabase\//],
  ['the app name of the production backend project', /ref=[a-z]{20}\b/],
]
// every http(s) URL in the bundle must be on this allow-list (documentation/standards URLs inside libraries, the portfolio exit link, fictional demo links)
const URL_OK = new RegExp(
  '^https?://(' +
    [
      'akashpandurangan\\.com', // the "Exit demo" link
      'gallery\\.lumenstudio\\.example', // fictional delivery links in the sample data
      '[a-z0-9.-]+\\.example', 'example\\.com', 'localhost',
      // documentation and schema URLs that live inside library code and comments (strings only, never requested)
      'www\\.w3\\.org', 'react\\.dev', 'reactjs\\.org', 'github\\.com', 'tailwindcss\\.com', 'json-schema\\.org', 'developer\\.mozilla\\.org', 'tanstack\\.com', 'reactrouter\\.com',
      // the app's own input-hint text ("https://…", a short-link example) and template fragments
      'maps\\.app\\.goo\\.gl', '…', '\\[',
    ].join('|') +
    ')',
  'i',
)

let bad = 0
const fail = (m) => { bad++; console.error(`  FAIL  ${m}`) }
let scanned = 0
const urls = new Set()
for (const f of files) {
  if (!/\.(js|css|html|map|json|svg|txt)$/.test(f)) continue
  const rel = path.relative(dist, f).replace(/\\/g, '/')
  const body = fs.readFileSync(f, 'utf8')
  scanned++
  for (const [what, re] of FORBIDDEN) if (re.test(body)) fail(`${rel} contains ${what} (${re})`)
  for (const m of body.matchAll(/https?:\/\/[^\s"'`)<>\\]+/g)) urls.add(m[0])
}
const outside = [...urls].filter((u) => !URL_OK.test(u))
for (const u of outside) fail(`unexpected URL in the bundle: ${u}`)

// the page itself
const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8')
if (!/noindex/.test(html)) fail('index.html is missing the noindex robots tag')
if (!/Interactive Demo/.test(html)) fail('index.html title does not say Interactive Demo')
if (files.some((f) => /vendor-supabase/.test(f))) fail('a vendor-supabase chunk was emitted')

// fictional data only
// (the app's own phone input hint, "+91 98765 43210", is a conventional dummy and is ignored)
const bundle = files.filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(f, 'utf8')).join('\n').replaceAll('+91 98765 43210', '')
if (!/Lumen Studio/.test(bundle)) fail('the sample studio (Lumen Studio) is not in the bundle')
for (const realish of [/Jio World/i, /@gmail\.com/i, /@yahoo\./i, /@outlook\./i, /\+91[ -]?[6-9]\d{4}[ -]?\d{5}\b/]) if (realish.test(bundle)) fail(`the bundle contains something that looks like real data: ${realish}`)

console.log(`scanned ${scanned} files in demo/dist, ${urls.size} distinct URLs (all on the allow-list: ${outside.length === 0})`)
console.log(bad ? `\n${bad} problem(s) found` : 'OK - no backend code, no service URLs, no credentials, no real-looking contact data')
process.exit(bad ? 1 : 0)
