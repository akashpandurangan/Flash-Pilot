import type { AccessRole, Employee, TeamRole } from '@/types/entities'
import { read, write } from '../store/access'
import { lower, newId, notFound, pgError } from '../store/core'
import { nullable } from './core'

export interface EmployeeInput {
  full_name: string
  email?: string
  phone?: string
  job_title?: string
  team_role: TeamRole
  notes?: string
  is_active?: boolean
}

export async function listEmployees(_studioId: string): Promise<Employee[]> {
  return read((db) => [...db.employees].sort((a, b) => a.full_name.localeCompare(b.full_name)))
}

const emailTaken = (all: Employee[], email: string | null, exceptId?: string) =>
  email !== null && all.some((e) => e.id !== exceptId && lower(e.email) === email)

export async function createEmployee(studioId: string, input: EmployeeInput): Promise<Employee> {
  return write((db, at) => {
    const email = nullable(input.email)?.toLowerCase() ?? null
    if (emailTaken(db.employees, email)) throw pgError('duplicate key value violates unique constraint "employees_studio_email_key" (email)', '23505')
    const row: Employee = {
      id: newId(),
      studio_id: studioId,
      user_id: null,
      full_name: input.full_name.trim(),
      email,
      phone: nullable(input.phone),
      job_title: nullable(input.job_title),
      team_role: input.team_role,
      access_role: null,
      can_view_financials: false,
      invite_status: 'none',
      invited_at: null,
      notes: nullable(input.notes),
      is_active: true,
      created_at: at.toISOString(),
    }
    db.employees.push(row)
    return row
  })
}

export async function updateEmployee(id: string, input: Partial<EmployeeInput>): Promise<Employee> {
  return write((db) => {
    const row = db.employees.find((e) => e.id === id)
    if (!row) throw notFound('team member')
    if (input.is_active === false && row.access_role === 'owner') throw pgError('owner_protected: the studio owner cannot be deactivated', 'P0001')
    if (input.email !== undefined) {
      const email = nullable(input.email)?.toLowerCase() ?? null
      if (emailTaken(db.employees, email, id)) throw pgError('duplicate key value violates unique constraint "employees_studio_email_key" (email)', '23505')
      row.email = email
    }
    if (input.full_name !== undefined) row.full_name = input.full_name.trim()
    if (input.phone !== undefined) row.phone = nullable(input.phone)
    if (input.job_title !== undefined) row.job_title = nullable(input.job_title)
    if (input.team_role !== undefined) row.team_role = input.team_role
    if (input.notes !== undefined) row.notes = nullable(input.notes)
    if (input.is_active !== undefined) row.is_active = input.is_active
    return row
  })
}

/** Changes what an already-invited person may do. The owner's own access cannot be lowered. */
export async function updateAccess(id: string, patch: { access_role?: AccessRole; can_view_financials?: boolean }) {
  return write((db) => {
    const row = db.employees.find((e) => e.id === id)
    if (!row) throw notFound('team member')
    if (row.access_role === 'owner' && patch.access_role && patch.access_role !== 'owner') {
      throw pgError('owner_protected: the studio owner cannot be demoted', 'P0001')
    }
    if (patch.access_role !== undefined) row.access_role = patch.access_role
    if (patch.can_view_financials !== undefined) row.can_view_financials = patch.can_view_financials
    return row
  })
}

/** Removes sign-in access but keeps the person and their history. */
export async function revokeAccess(id: string) {
  return write((db) => {
    const row = db.employees.find((e) => e.id === id)
    if (!row) throw notFound('team member')
    if (row.access_role === 'owner') throw pgError('owner_protected: the studio owner keeps access', 'P0001')
    row.user_id = null
    row.access_role = null
    row.can_view_financials = false
    row.invite_status = 'none'
    return row
  })
}

export interface InviteInput {
  employeeId: string
  accessRole: Exclude<AccessRole, 'owner'>
  canViewFinancials: boolean
}

export interface InviteResult {
  status: 'invited' | 'linked'
  message: string
}

/** Demo: records the invitation locally. No e-mail is sent and no account is created. */
export async function inviteEmployee(input: InviteInput): Promise<InviteResult> {
  return write((db, at) => {
    const row = db.employees.find((e) => e.id === input.employeeId)
    if (!row) throw notFound('team member')
    if (!row.is_active) throw pgError('employee_inactive: reactivate this person before inviting them', 'P0001')
    if (!row.email) throw new Error('Add an email address for this person before inviting them.')
    row.access_role = input.accessRole
    row.can_view_financials = input.canViewFinancials
    row.invite_status = 'pending'
    row.invited_at = at.toISOString()
    return { status: 'invited' as const, message: `Invitation recorded for ${row.email}. This is a demo, so no email was sent.` }
  })
}
