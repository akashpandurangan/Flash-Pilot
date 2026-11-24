import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'

/**
 * Build config for the interactive demo. It is a SEPARATE build: the production app (vite.config.ts) is untouched.
 *
 * The demo reuses the real screens, layouts and styles from src/. The only things it replaces are the modules that talk to
 * a backend - the 11 files in src/api, the sign-in provider, the realtime hook and the Supabase client/env modules - which
 * are swapped for in-memory versions living in demo/src. The swap happens at build time (see swapBackend below), so the
 * demo bundle never contains the Supabase client and nothing in it can make a network call to a backend.
 */

const REPO = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const SRC = path.join(REPO, 'src')
const DEMO = path.join(REPO, 'demo')
const DEMO_SRC = path.join(DEMO, 'src')
const posix = (p: string) => p.replace(/\\/g, '/')

/** production module (path under src/, no extension) → demo replacement (path under demo/src/). */
const SWAPS: Record<string, string> = {
  'api/appearance': 'api/appearance.ts',
  'api/clients': 'api/clients.ts',
  'api/core': 'api/core.ts',
  'api/dashboard': 'api/dashboard.ts',
  'api/employees': 'api/employees.ts',
  'api/equipment': 'api/equipment.ts',
  'api/notifications': 'api/notifications.ts',
  'api/payments': 'api/payments.ts',
  'api/projects': 'api/projects.ts',
  'api/schedule': 'api/schedule.ts',
  'api/studio': 'api/studio.ts',
  'features/auth/AuthProvider': 'auth/AuthProvider.tsx',
  'hooks/useRealtimeSync': 'hooks/useRealtimeSync.ts',
  'lib/supabase': 'lib/supabase.ts',
  'lib/env': 'lib/env.ts',
}

/**
 * Replaces backend modules by what they RESOLVE to, not by how they are spelled, so `@/api/projects`, a relative
 * `./AuthProvider` and any future spelling are all caught.
 */
function swapBackend(): Plugin {
  const srcPosix = posix(SRC)
  return {
    name: 'flash-pilot-demo:swap-backend',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!importer || source.startsWith('\0')) return null
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true })
      if (!resolved || resolved.external) return null
      const file = posix(resolved.id.split('?')[0]!)
      if (!file.startsWith(`${srcPosix}/`)) return null
      const key = file.slice(srcPosix.length + 1).replace(/\.(tsx?|jsx?)$/, '')
      const replacement = SWAPS[key]
      // Vite module ids use forward slashes on every platform; a backslash id would become a second copy of the module.
      return replacement ? posix(path.join(DEMO_SRC, replacement)) : null
    },
  }
}

/**
 * The repo root also holds the production index.html, so the dev server's SPA fallback would serve that. Send every
 * page navigation to the demo's own entry instead.
 */
function demoDevEntry(): Plugin {
  const passthrough = /^\/(@|src\/|demo\/|node_modules\/|public\/)/
  const rewrite = (req: { method?: string; url?: string; headers: Record<string, string | string[] | undefined> }) => {
    const url = req.url ?? '/'
    const pathname = url.split('?')[0]!
    const wantsHtml = String(req.headers.accept ?? '').includes('text/html')
    if (req.method === 'GET' && wantsHtml && !passthrough.test(pathname) && !/\.[a-z0-9]+$/i.test(pathname)) req.url = '/demo/index.html'
  }
  return {
    name: 'flash-pilot-demo:dev-entry',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => { rewrite(req); next() })
    },
  }
}

/** The page is built from demo/index.html but must be served as /index.html (Vercel's SPA rewrite points there). */
function flattenHtml(): Plugin {
  let outDir = ''
  return {
    name: 'flash-pilot-demo:flatten-html',
    apply: 'build',
    enforce: 'post',
    configResolved(config) { outDir = path.resolve(config.root, config.build.outDir) },
    closeBundle() {
      const nested = path.join(outDir, 'demo', 'index.html')
      if (!fs.existsSync(nested)) return
      fs.renameSync(nested, path.join(outDir, 'index.html'))
      fs.rmSync(path.join(outDir, 'demo'), { recursive: true, force: true })
    },
  }
}

export default defineConfig({
  root: REPO,
  // Never read the repository's .env files: the demo has no use for credentials, so nothing can leak into the bundle.
  envDir: DEMO,
  plugins: [swapBackend(), demoDevEntry(), react(), tailwindcss(), flattenHtml()],
  resolve: {
    alias: {
      // A second tripwire: if anything ever imported the Supabase SDK by value, it would get a stub that throws.
      '@supabase/supabase-js': path.join(DEMO_SRC, 'blocked/backend-sdk.ts'),
      '@': SRC,
    },
  },
  server: { port: 5199, strictPort: false },
  preview: { port: 4199, strictPort: false },
  build: {
    outDir: path.join(DEMO, 'dist'),
    emptyOutDir: true,
    sourcemap: false,
    rolldownOptions: {
      input: path.join(DEMO, 'index.html'),
      output: {
        codeSplitting: {
          groups: [
            { name: 'vendor-radix', test: /node_modules[\\/](radix-ui|@radix-ui)/, priority: 20 },
            { name: 'vendor-react', test: /node_modules[\\/](react|react-dom|react-router|scheduler|@tanstack|react-hook-form|zod|@hookform)[\\/]/, priority: 10 },
          ],
        },
      },
    },
  },
})
