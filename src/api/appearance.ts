import { supabase } from '@/lib/supabase'
import { normalizeAppearance, type Appearance } from '@/lib/appearance'

/**
 * A person's appearance lives on their own profile row (profiles.appearance, own row only - see migration 10), never on a
 * studio record, so it follows them to any device. Both calls throw when the column is not there yet (the migration has not
 * been applied); the provider treats that as "remote sync unavailable" and keeps working from local storage.
 */
export async function getRemoteAppearance(userId: string): Promise<Appearance | null> {
  const res = await supabase.from('profiles').select('appearance').eq('id', userId).maybeSingle()
  if (res.error) throw res.error
  const raw = (res.data as { appearance?: unknown } | null)?.appearance
  // an empty object is the column default: nothing has been saved yet
  return raw && typeof raw === 'object' && Object.keys(raw).length > 0 ? normalizeAppearance(raw) : null
}

export async function saveRemoteAppearance(userId: string, appearance: Appearance): Promise<void> {
  const res = await supabase.from('profiles').update({ appearance }).eq('id', userId)
  if (res.error) throw res.error
}
