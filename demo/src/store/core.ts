/**
 * Small shared pieces of the demo data layer: ids, the clock, simulated latency, deep copies and the error shape the app's
 * own error translator (src/lib/errors.ts) understands ("token: explanation" plus an optional Postgres-style code).
 */

export const DEMO_USER_ID = 'a1000000-0000-4000-8000-000000000001'
export const DEMO_STUDIO_ID = 'b1000000-0000-4000-8000-000000000001'
export const DEMO_OWNER_ID = 'c1000000-0000-4000-8000-000000000001'
export const DEMO_USER_EMAIL = 'olivia@lumenstudio.example'
export const DEMO_USER_NAME = 'Olivia Mehra'
export const EXIT_URL = 'https://akashpandurangan.com/'

/** Stable, readable ids for seed rows (uuid-shaped so any code that expects one is happy). */
export const seedId = (kind: number, n: number): string => `${kind.toString(16).padStart(8, '0')}-0000-4000-8000-${String(n).padStart(12, '0')}`

export const newId = (): string => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : seedId(0xee, Math.floor(Math.random() * 1e9)))

// ------------------------------------------------------------------ clock
let fixedNow: Date | null = null
/** The demo's "now". Tests pin it; in the browser it is the real clock, so the data always looks current. */
export const now = (): Date => (fixedNow ? new Date(fixedNow) : new Date())
export const nowIso = (): string => now().toISOString()
export function setNow(date: Date | null): void {
  fixedNow = date
}

// ---------------------------------------------------------------- latency
let latencyMs = 140
export function setLatency(ms: number): void {
  latencyMs = ms
}
/** A short pause so loading states and optimistic UI behave like a real round trip. */
export const delay = (): Promise<void> =>
  latencyMs <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, latencyMs * (0.6 + Math.random() * 0.8)))

export const clone = <T>(value: T): T => structuredClone(value)

// ----------------------------------------------------------------- errors
export interface DemoError extends Error {
  code?: string
}

export function pgError(message: string, code?: string): DemoError {
  const err = new Error(message) as DemoError
  err.name = 'DemoError'
  if (code) err.code = code
  return err
}

export const notFound = (what: string): DemoError => pgError(`not_found: ${what}`, 'P0002')
export const forbidden = (why = 'not allowed in the demo'): DemoError => pgError(`forbidden: ${why}`, '42501')
export const raise = (message: string, code = 'P0001'): DemoError => pgError(message, code)

// --------------------------------------------------------------- helpers
export const lower = (s: string | null | undefined): string => (s ?? '').toLowerCase()
export const includesText = (haystack: (string | null | undefined)[], term: string): boolean => {
  const t = term.trim().toLowerCase()
  return t === '' || haystack.some((h) => lower(h).includes(t))
}

/** Compare strings that may be null; nulls sort last in ascending order, like Postgres' default. */
export const cmpNullsLast = (a: string | null, b: string | null): number => {
  if (a === b) return 0
  if (a === null) return 1
  if (b === null) return -1
  return a < b ? -1 : 1
}

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100
