import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const REPO = path.resolve(fileURLToPath(new URL('..', import.meta.url)))

/** Tests for the demo's in-memory data layer only (the app's own tests are configured in the repository's vite.config.ts). */
export default defineConfig({
  root: REPO,
  resolve: { alias: { '@': path.join(REPO, 'src') } },
  test: {
    environment: 'node',
    include: ['demo/tests/**/*.test.ts'],
    testTimeout: 20_000,
  },
})
