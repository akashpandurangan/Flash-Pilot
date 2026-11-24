import type { Appearance } from '@/lib/appearance'

/**
 * Demo version: appearance is kept in the browser (the app already does that) and never synced to an account, so there is
 * nothing remote to read or write. Returning null makes the app fall back to local storage, which is its normal behaviour
 * when remote sync is unavailable.
 */
export async function getRemoteAppearance(_userId: string): Promise<Appearance | null> {
  return null
}

export async function saveRemoteAppearance(_userId: string, _appearance: Appearance): Promise<void> {
  /* nothing to sync in the demo */
}
