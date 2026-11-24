/**
 * Demo replacement for src/lib/env.ts. There are no credentials to read: the demo's data lives in memory, so the app's
 * "is a backend configured?" check is simply true and nothing here points anywhere.
 */
export const env = { supabaseUrl: '', supabasePublishableKey: '', appUrl: '' }

export const isSupabaseConfigured = true

export const appUrl = () => window.location.origin
