import type { ChecklistTemplateItem, Employee, Profile, Studio } from '@/types/entities'
import { read, write } from '../store/access'
import { DEMO_OWNER_ID, pgError } from '../store/core'
import { nullable } from './core'

export interface Membership {
  employee: Employee
  studio: Studio | null
}

/** The demo user is always the owner of Lumen Studio, already onboarded. */
export async function fetchMemberships(_userId: string): Promise<Membership[]> {
  return read((db) => {
    const employee = db.employees.find((e) => e.id === DEMO_OWNER_ID)
    return employee ? [{ employee, studio: db.studio }] : []
  })
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

export async function createStudio(_input: StudioInput): Promise<string> {
  throw pgError('studio_exists: the demo already has a studio', 'P0001')
}

export async function updateStudio(id: string, patch: Partial<StudioInput> & { reminder_lead_hours?: number; default_checklist?: ChecklistTemplateItem[] }) {
  return write((db) => {
    if (db.studio.id !== id) throw pgError('not_found: studio', 'P0002')
    const { email, phone, address, city, state, name, ...rest } = patch
    Object.assign(db.studio, rest)
    if (name !== undefined) db.studio.name = name.trim()
    if (email !== undefined) db.studio.email = nullable(email)
    if (phone !== undefined) db.studio.phone = nullable(phone)
    if (address !== undefined) db.studio.address = nullable(address)
    if (city !== undefined) db.studio.city = nullable(city)
    if (state !== undefined) db.studio.state = nullable(state)
    return db.studio
  })
}

export async function saveOnboardingStep(_studioId: string, step: number) {
  await write((db) => { db.studio.onboarding_step = step })
}

export async function completeOnboarding(_studioId: string) {
  await write((db, at) => { db.studio.onboarding_completed_at ??= at.toISOString() })
}

export async function acceptInvitation() {
  /* the demo owner has no pending invitation */
}

export async function fetchProfile(_userId: string): Promise<Profile | null> {
  return read((db) => db.profile)
}

export async function updateProfile(_userId: string, patch: { full_name: string; phone?: string }) {
  await write((db) => {
    db.profile.full_name = patch.full_name.trim()
    db.profile.phone = nullable(patch.phone)
    const me = db.employees.find((e) => e.id === DEMO_OWNER_ID)
    if (me) {
      me.full_name = db.profile.full_name
      me.phone = db.profile.phone
    }
  })
}

const LOGO_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }
export const LOGO_MAX_BYTES = 2 * 1024 * 1024

export function validateLogo(file: File): string | null {
  if (!LOGO_TYPES[file.type]) return 'Use a PNG, JPG or WebP image.'
  if (file.size > LOGO_MAX_BYTES) return 'The logo must be 2 MB or smaller.'
  return null
}

/** Demo: the chosen image stays in this browser tab (a blob URL); nothing is uploaded anywhere. */
export async function uploadStudioLogo(_studioId: string, file: File): Promise<string> {
  const problem = validateLogo(file)
  if (problem) throw new Error(problem)
  const url = URL.createObjectURL(file)
  await write((db) => { db.studio.logo_path = url })
  return url
}

export function logoUrl(path: string | null | undefined): string | null {
  return path || null
}
