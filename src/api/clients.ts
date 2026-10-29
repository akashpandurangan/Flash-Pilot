import { supabase } from '@/lib/supabase'
import { PAGE_SIZE } from '@/lib/constants'
import { digitsOnly, escapeLike } from '@/lib/utils'
import type { Client, Page, ProjectOverview } from '@/types/entities'
import { nullable, unwrap } from './core'

export interface ClientInput {
  full_name: string
  phone: string
  email?: string
  address?: string
  notes?: string
}

export type ClientSort = 'name' | 'newest' | 'oldest'

export interface ClientFilters {
  studioId: string
  search?: string
  status: 'active' | 'archived' | 'all'
  sort: ClientSort
  page: number
}

export async function listClients(f: ClientFilters): Promise<Page<Client>> {
  let q = supabase.from('clients').select('*', { count: 'exact' }).eq('studio_id', f.studioId)
  if (f.status === 'active') q = q.is('archived_at', null)
  if (f.status === 'archived') q = q.not('archived_at', 'is', null)
  const term = escapeLike(f.search ?? '')
  if (term) {
    const digits = digitsOnly(term)
    const parts = [`full_name.ilike.%${term}%`, `email.ilike.%${term}%`, `phone.ilike.%${term}%`]
    if (digits.length >= 3) parts.push(`phone_digits.ilike.%${digits}%`)
    q = q.or(parts.join(','))
  }
  if (f.sort === 'name') q = q.order('full_name', { ascending: true })
  else q = q.order('created_at', { ascending: f.sort === 'oldest' })
  const from = (f.page - 1) * PAGE_SIZE
  const res = await q.range(from, from + PAGE_SIZE - 1)
  return { rows: unwrap(res) as Client[], total: res.count ?? 0 }
}

export async function listAllClients(studioId: string): Promise<Client[]> {
  return unwrap(await supabase.from('clients').select('*').eq('studio_id', studioId).is('archived_at', null).order('full_name').limit(1000)) as Client[]
}

export async function getClient(id: string): Promise<Client | null> {
  return (unwrap(await supabase.from('clients').select('*').eq('id', id).maybeSingle()) as Client | null) ?? null
}

export async function createClient(studioId: string, input: ClientInput): Promise<Client> {
  return unwrap(
    await supabase
      .from('clients')
      .insert({
        studio_id: studioId,
        full_name: input.full_name.trim(),
        phone: nullable(input.phone),
        email: nullable(input.email)?.toLowerCase() ?? null,
        address: nullable(input.address),
        notes: nullable(input.notes),
      })
      .select()
      .single(),
  ) as Client
}

export async function updateClient(id: string, input: ClientInput): Promise<Client> {
  return unwrap(
    await supabase
      .from('clients')
      .update({
        full_name: input.full_name.trim(),
        phone: nullable(input.phone),
        email: nullable(input.email)?.toLowerCase() ?? null,
        address: nullable(input.address),
        notes: nullable(input.notes),
      })
      .eq('id', id)
      .select()
      .single(),
  ) as Client
}

export async function setClientArchived(id: string, archived: boolean) {
  unwrap(await supabase.from('clients').update({ archived_at: archived ? new Date().toISOString() : null }).eq('id', id))
}

/** Existing clients that share a phone number or e-mail - shown as a warning, never a hard block. */
export async function findDuplicateClients(studioId: string, phone: string, email: string, excludeId?: string): Promise<Client[]> {
  const digits = digitsOnly(phone)
  const mail = email.trim().toLowerCase()
  const parts: string[] = []
  if (digits.length >= 7) parts.push(`phone_digits.eq.${digits}`)
  if (mail) parts.push(`email.ilike.${escapeLike(mail)}`)
  if (parts.length === 0) return []
  let q = supabase.from('clients').select('*').eq('studio_id', studioId).or(parts.join(',')).limit(5)
  if (excludeId) q = q.neq('id', excludeId)
  return unwrap(await q) as Client[]
}

export async function listClientProjects(clientId: string): Promise<ProjectOverview[]> {
  return unwrap(await supabase.from('project_overview').select('*').eq('client_id', clientId).order('first_event_at', { ascending: false, nullsFirst: false })) as ProjectOverview[]
}
