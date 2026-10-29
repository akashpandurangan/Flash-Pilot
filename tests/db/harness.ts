import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'

/**
 * Boots an in-process Postgres, installs a minimal stand-in for the parts of
 * Supabase the migrations rely on (auth schema, roles), then applies every real
 * migration in order. Tests then impersonate users with `as()`, which switches to
 * the non-privileged `authenticated` role exactly like PostgREST does.
 */
export async function createDb() {
  const db = new PGlite()

  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin;
    create schema auth;
    create table auth.users (
      id uuid primary key default gen_random_uuid(),
      email text,
      raw_user_meta_data jsonb not null default '{}'::jsonb,
      email_confirmed_at timestamptz default now()
    );
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated, service_role;
    grant usage on schema public to anon, authenticated, service_role;
  `)

  const dir = path.resolve(import.meta.dirname, '../../supabase/migrations')
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    try {
      await db.exec(readFileSync(path.join(dir, file), 'utf8'))
    } catch (err) {
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`, { cause: err })
    }
  }

  async function reset() {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`)
  }

  /** Run `fn` as the given signed-in user (RLS applies). */
  async function as<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false);`)
    try {
      return await fn()
    } finally {
      await reset()
    }
  }

  /** Run as the anonymous role (no JWT). */
  async function asAnon<T>(fn: () => Promise<T>): Promise<T> {
    await db.exec(`set role anon; select set_config('request.jwt.claim.sub', '', false);`)
    try {
      return await fn()
    } finally {
      await reset()
    }
  }

  async function newUser(email: string, fullName: string): Promise<string> {
    const res = await db.query<{ id: string }>(
      `insert into auth.users (email, raw_user_meta_data) values ($1, $2::jsonb) returning id`,
      [email, JSON.stringify({ full_name: fullName })],
    )
    return res.rows[0]!.id
  }

  async function rows<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await db.query<T>(sql, params)).rows
  }

  async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
    const r = await rows<T>(sql, params)
    if (r.length !== 1) throw new Error(`Expected one row, got ${r.length}: ${sql}`)
    return r[0]!
  }

  /** Expect a statement to fail; returns the error message. */
  async function fails(sql: string, params: unknown[] = []): Promise<string> {
    try {
      await db.query(sql, params)
    } catch (err) {
      return (err as Error).message
    }
    throw new Error(`Expected statement to fail but it succeeded: ${sql}`)
  }

  return { db, as, asAnon, newUser, rows, one, fails, reset }
}

export type TestDb = Awaited<ReturnType<typeof createDb>>
