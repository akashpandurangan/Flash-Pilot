import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { env, isSupabaseConfigured } from './env'

/**
 * Browser client. It only ever holds the publishable (anon) key; every request
 * is authorised by the signed-in user's JWT + row level security.
 *
 * When credentials are missing we deliberately do NOT fall back to fake or
 * local data - the app shows a configuration screen instead (see ConfigMissing).
 */
export const supabase: SupabaseClient = isSupabaseConfigured
  ? createClient(env.supabaseUrl, env.supabasePublishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      realtime: { params: { eventsPerSecond: 10 } },
    })
  : (new Proxy({} as SupabaseClient, {
      get() {
        throw new Error('Supabase is not configured. Copy .env.example to .env.local and add your project URL and publishable key.')
      },
    }) as SupabaseClient)

export type { SupabaseClient }
