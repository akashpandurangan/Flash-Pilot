import { supabase } from '@/lib/supabase'
import type { ChecklistTemplateItem, Employee, Profile, Studio } from '@/types/entities'
import { nullable, unwrap, unwrapMaybe } from './core'

export interface Membership {
  employee: Employee
  /** null when row level security hides the studio - which is exactly what happens once a person is deactivated. */
  studio: Studio | null
}

/**
 * Every employee record linked to this sign-in. A deactivated person can still read
 * their own employee row (so the UI can explain why they are locked out) but no
 * longer the studio itself, hence `studio` may be null. Callers check is_active.
 */
export async function fetchMemberships(userId: string): Promise<Membership[]> {
  const rows = unwrap(
    await supabase.from('employees').select('*, studio:studios(*)').eq('user_id', userId).order('created_at', { ascending: true }),
  ) as (Employee & { studio: Studio | null })[]
  return rows.map(({ studio, ...employee }) => ({ employee: employee as Employee, studio: studio ?? null }))
}

export interface StudioInput {
  name: string
  email?: string
  phone?: string
  address?: string
  city?: string
  state?: string
  timezone: string
  currency: string
}

export async function createStudio(input: StudioInput): Promise<string> {
  return unwrap(
    await supabase.rpc('create_studio', {
      p_name: input.name.trim(),
      p_email: nullable(input.email),
      p_phone: nullable(input.phone),
      p_address: nullable(input.address),
      p_city: nullable(input.city),
      p_state: nullable(input.state),
      p_timezone: input.timezone,
      p_currency: input.currency,
    }),
  ) as string
}

export async function updateStudio(id: string, patch: Partial<StudioInput> & { reminder_lead_hours?: number; default_checklist?: ChecklistTemplateItem[] }) {
  const { email, phone, address, city, state, ...rest } = patch
  const row: Record<string, unknown> = { ...rest }
  if (email !== undefined) row.email = nullable(email)
  if (phone !== undefined) row.phone = nullable(phone)
  if (address !== undefined) row.address = nullable(address)
  if (city !== undefined) row.city = nullable(city)
  if (state !== undefined) row.state = nullable(state)
  if (typeof row.name === 'string') row.name = row.name.trim()
  return unwrap(await supabase.from('studios').update(row).eq('id', id).select().single()) as Studio
}

export async function saveOnboardingStep(studioId: string, step: number) {
  unwrap(await supabase.rpc('save_onboarding_step', { p_studio: studioId, p_step: step }))
}

export async function completeOnboarding(studioId: string) {
  unwrap(await supabase.rpc('complete_onboarding', { p_studio: studioId }))
}

export async function acceptInvitation() {
  unwrap(await supabase.rpc('accept_invitation'))
}

export async function fetchProfile(userId: string): Promise<Profile | null> {
  return unwrapMaybe(await supabase.from('profiles').select('id, full_name, email, phone').eq('id', userId).maybeSingle()) as Profile | null
}

export async function updateProfile(userId: string, patch: { full_name: string; phone?: string }) {
  unwrap(await supabase.from('profiles').update({ full_name: patch.full_name.trim(), phone: nullable(patch.phone) }).eq('id', userId))
}

const LOGO_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }
export const LOGO_MAX_BYTES = 2 * 1024 * 1024

export function validateLogo(file: File): string | null {
  if (!LOGO_TYPES[file.type]) return 'Use a PNG, JPG or WebP image.'
  if (file.size > LOGO_MAX_BYTES) return 'The logo must be 2 MB or smaller.'
  return null
}

/** Uploads to studio-logos/<studio_id>/… (storage policy: only that studio's owner may write). */
export async function uploadStudioLogo(studioId: string, file: File): Promise<string> {
  const problem = validateLogo(file)
  if (problem) throw new Error(problem)
  const path = `${studioId}/logo-${Date.now()}.${LOGO_TYPES[file.type]}`
  const { error } = await supabase.storage.from('studio-logos').upload(path, file, { contentType: file.type, cacheControl: '3600' })
  if (error) throw error
  unwrap(await supabase.from('studios').update({ logo_path: path }).eq('id', studioId))
  return path
}

export function logoUrl(path: string | null | undefined): string | null {
  if (!path) return null
  return supabase.storage.from('studio-logos').getPublicUrl(path).data.publicUrl
}
