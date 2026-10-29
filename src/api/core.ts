import type { PostgrestError } from '@supabase/supabase-js'

/** Throws the PostgREST error (a plain object with message/code) or returns the data. */
export function unwrap<T>(res: { data: T | null; error: PostgrestError | null }): T {
  if (res.error) throw res.error
  return res.data as T
}

export function unwrapMaybe<T>(res: { data: T | null; error: PostgrestError | null }): T | null {
  if (res.error) throw res.error
  return res.data
}

/** Empty strings from form inputs become NULL in the database. */
export const nullable = (v: string | null | undefined): string | null => {
  const t = (v ?? '').trim()
  return t === '' ? null : t
}

export interface DateRange {
  from: string
  to: string
}
