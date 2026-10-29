const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() ?? ''
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)?.trim() ?? ''

export const env = {
  supabaseUrl: url,
  supabasePublishableKey: key,
  appUrl: ((import.meta.env.VITE_APP_URL as string | undefined)?.trim() || '').replace(/\/$/, ''),
}

const looksLikePlaceholder = (v: string) => v === '' || /YOUR-|xxxx/i.test(v)

/** True when real Supabase credentials are present. */
export const isSupabaseConfigured = !looksLikePlaceholder(url) && !looksLikePlaceholder(key)

export const appUrl = () => env.appUrl || window.location.origin
