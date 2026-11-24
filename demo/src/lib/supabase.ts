/**
 * Demo replacement for src/lib/supabase.ts. Every module that used the real client is replaced in the demo build, so
 * nothing should ever touch this export - it is a tripwire. If something does, it fails loudly instead of reaching a backend.
 */
export const supabase: Record<string, never> = new Proxy({} as Record<string, never>, {
  get() {
    throw new Error('The interactive demo has no backend: this code path should have been replaced by the demo data layer.')
  },
})

export type SupabaseClient = never
