import { supabase } from '@/lib/supabase'
import type { AccessRole, Employee, TeamRole } from '@/types/entities'
import { nullable, unwrap } from './core'

export interface EmployeeInput {
  full_name: string
  email?: string
  phone?: string
  job_title?: string
  team_role: TeamRole
  notes?: string
  is_active?: boolean
}

export async function listEmployees(studioId: string): Promise<Employee[]> {
  return unwrap(await supabase.from('employees').select('*').eq('studio_id', studioId).order('full_name')) as Employee[]
}

export async function createEmployee(studioId: string, input: EmployeeInput): Promise<Employee> {
  return unwrap(
    await supabase
      .from('employees')
      .insert({
        studio_id: studioId,
        full_name: input.full_name.trim(),
        email: nullable(input.email)?.toLowerCase() ?? null,
        phone: nullable(input.phone),
        job_title: nullable(input.job_title),
        team_role: input.team_role,
        notes: nullable(input.notes),
      })
      .select()
      .single(),
  ) as Employee
}

export async function updateEmployee(id: string, input: Partial<EmployeeInput>): Promise<Employee> {
  const row: Record<string, unknown> = {}
  if (input.full_name !== undefined) row.full_name = input.full_name.trim()
  if (input.email !== undefined) row.email = nullable(input.email)?.toLowerCase() ?? null
  if (input.phone !== undefined) row.phone = nullable(input.phone)
  if (input.job_title !== undefined) row.job_title = nullable(input.job_title)
  if (input.team_role !== undefined) row.team_role = input.team_role
  if (input.notes !== undefined) row.notes = nullable(input.notes)
  if (input.is_active !== undefined) row.is_active = input.is_active
  return unwrap(await supabase.from('employees').update(row).eq('id', id).select().single()) as Employee
}

/** Changes what an already-invited person may do (owner only; enforced by employees_guard). */
export async function updateAccess(id: string, patch: { access_role?: AccessRole; can_view_financials?: boolean }) {
  return unwrap(await supabase.from('employees').update(patch).eq('id', id).select().single()) as Employee
}

/** Removes sign-in access but keeps the employee record and all history. */
export async function revokeAccess(id: string) {
  return unwrap(
    await supabase
      .from('employees')
      .update({ user_id: null, access_role: null, can_view_financials: false, invite_status: 'none' })
      .eq('id', id)
      .select()
      .single(),
  ) as Employee
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

/**
 * Invitations need the service-role key (to create the auth user and send the
 * e-mail), so they run in the `invite-employee` Edge Function which re-checks that
 * the caller is the studio owner. No passwords are ever created or shared.
 */
export async function inviteEmployee(input: InviteInput): Promise<InviteResult> {
  const { data, error } = await supabase.functions.invoke('invite-employee', {
    body: {
      employee_id: input.employeeId,
      access_role: input.accessRole,
      can_view_financials: input.canViewFinancials,
      redirect_to: `${window.location.origin}/reset-password?invited=1`,
    },
  })
  if (error) {
    // supabase-js hides the function's JSON body behind a FunctionsHttpError.
    const ctx = (error as { context?: Response }).context
    if (ctx && typeof ctx.json === 'function') {
      const body = (await ctx.json().catch(() => null)) as { error?: string } | null
      if (body?.error) throw new Error(body.error)
    }
    throw error
  }
  return data as InviteResult
}
