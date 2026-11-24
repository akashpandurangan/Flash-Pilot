import { PAGE_SIZE } from '@/lib/constants'
import { digitsOnly } from '@/lib/utils'
import type { Client, Page, ProjectOverview } from '@/types/entities'
import { read, write } from '../store/access'
import { cmpNullsLast, includesText, lower, newId, notFound } from '../store/core'
import { logActivity } from '../store/log'
import { overviewOf } from '../store/views'
import { nullable } from './core'

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
  return read((db) => {
    const term = (f.search ?? '').trim()
    const digits = digitsOnly(term)
    let rows = db.clients.filter((c) => c.studio_id === f.studioId)
    if (f.status === 'active') rows = rows.filter((c) => !c.archived_at)
    if (f.status === 'archived') rows = rows.filter((c) => c.archived_at)
    if (term) {
      rows = rows.filter((c) => includesText([c.full_name, c.email, c.phone], term) || (digits.length >= 3 && digitsOnly(c.phone).includes(digits)))
    }
    if (f.sort === 'name') rows = [...rows].sort((a, b) => a.full_name.localeCompare(b.full_name))
    else rows = [...rows].sort((a, b) => (f.sort === 'oldest' ? 1 : -1) * cmpNullsLast(a.created_at, b.created_at))
    const from = (f.page - 1) * PAGE_SIZE
    return { rows: rows.slice(from, from + PAGE_SIZE), total: rows.length }
  })
}

export async function listAllClients(studioId: string): Promise<Client[]> {
  return read((db) => db.clients.filter((c) => c.studio_id === studioId && !c.archived_at).sort((a, b) => a.full_name.localeCompare(b.full_name)).slice(0, 1000))
}

export async function getClient(id: string): Promise<Client | null> {
  return read((db) => db.clients.find((c) => c.id === id) ?? null)
}

export async function createClient(studioId: string, input: ClientInput): Promise<Client> {
  return write((db, at) => {
    const row: Client = {
      id: newId(),
      studio_id: studioId,
      full_name: input.full_name.trim(),
      phone: nullable(input.phone),
      email: nullable(input.email)?.toLowerCase() ?? null,
      address: nullable(input.address),
      notes: nullable(input.notes),
      archived_at: null,
      created_at: at.toISOString(),
    }
    db.clients.push(row)
    logActivity(db, { projectId: null, entityType: 'client', entityId: row.id, action: 'client_created', summary: `Client added: ${row.full_name}`, at })
    return row
  })
}

export async function updateClient(id: string, input: ClientInput): Promise<Client> {
  return write((db) => {
    const row = db.clients.find((c) => c.id === id)
    if (!row) throw notFound('client')
    row.full_name = input.full_name.trim()
    row.phone = nullable(input.phone)
    row.email = nullable(input.email)?.toLowerCase() ?? null
    row.address = nullable(input.address)
    row.notes = nullable(input.notes)
    return row
  })
}

export async function setClientArchived(id: string, archived: boolean) {
  await write((db, at) => {
    const row = db.clients.find((c) => c.id === id)
    if (!row) throw notFound('client')
    row.archived_at = archived ? at.toISOString() : null
  })
}

/** Existing clients that share a phone number or e-mail - shown as a warning, never a hard block. */
export async function findDuplicateClients(studioId: string, phone: string, email: string, excludeId?: string): Promise<Client[]> {
  return read((db) => {
    const digits = digitsOnly(phone)
    const mail = email.trim().toLowerCase()
    if (digits.length < 7 && !mail) return []
    return db.clients
      .filter((c) => c.studio_id === studioId && c.id !== excludeId)
      .filter((c) => (digits.length >= 7 && digitsOnly(c.phone) === digits) || (mail !== '' && lower(c.email) === mail))
      .slice(0, 5)
  })
}

export async function listClientProjects(clientId: string): Promise<ProjectOverview[]> {
  return read((db, at) =>
    db.projects
      .filter((p) => p.client_id === clientId)
      .map((p) => overviewOf(db, p, at))
      // latest first, events without sessions last
      .sort((a, b) => (a.first_event_at === null ? 1 : b.first_event_at === null ? -1 : b.first_event_at.localeCompare(a.first_event_at))),
  )
}
