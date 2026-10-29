import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: {
    sourcemap: false,
    rolldownOptions: {
      output: {
        // Keep big third-party libraries in their own long-cacheable chunks.
        codeSplitting: {
          groups: [
            { name: 'vendor-supabase', test: /node_modules[\\/]@supabase/, priority: 30 },
            { name: 'vendor-radix', test: /node_modules[\\/](radix-ui|@radix-ui)/, priority: 20 },
            { name: 'vendor-react', test: /node_modules[\\/](react|react-dom|react-router|scheduler|@tanstack|react-hook-form|zod|@hookform)[\\/]/, priority: 10 },
          ],
        },
      },
    },
  },
  test: {
    globals: true,
    // Bounded parallelism keeps memory predictable (each database suite embeds a Postgres WASM instance).
    maxWorkers: 4,
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // Two projects: fast jsdom unit/component tests, and the PGlite database suites.
    // The database files each boot an in-process Postgres (WASM, ~100 MB), so they run one at
    // a time - running several beside the jsdom workers can exhaust memory and crash a worker.
    projects: [
      {
        extends: true,
        test: { name: 'unit', environment: 'jsdom', setupFiles: ['./src/test/setup.ts'], include: ['src/**/*.test.{ts,tsx}'] },
      },
      {
        extends: true,
        test: { name: 'db', environment: 'node', include: ['tests/**/*.test.ts'], fileParallelism: false },
      },
    ],
  },
})
