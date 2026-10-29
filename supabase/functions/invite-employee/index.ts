// invite-employee
// ---------------------------------------------------------------------------
// Gives an existing employee record a sign-in account through Supabase's secure
// invitation e-mail (they choose their own password - nothing is ever shared).
//
// Why an Edge Function: creating auth users needs the service-role key, which must
// never reach the browser. The function therefore re-verifies, on the server, that
// the caller is the active OWNER of the employee's studio before doing anything.
//
// POST { employee_id, access_role: 'manager'|'photographer'|'editor',
//        can_view_financials?: boolean, redirect_to?: string }
// ---------------------------------------------------------------------------
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders, json, requireEnv, UUID_RE } from '../_shared/http.ts'

const ROLES = new Set(['manager', 'photographer', 'editor'])

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const url = requireEnv('SUPABASE_URL')
    const anonKey = requireEnv('SUPABASE_ANON_KEY')
    const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY')

    // 1. Who is calling? Trust only the verified JWT, never a user id from the body.
    const authHeader = req.headers.get('Authorization') ?? ''
    const caller = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } })
    const { data: userData, error: userError } = await caller.auth.getUser()
    if (userError || !userData.user) return json({ error: 'Please sign in again.' }, 401)
    const callerId = userData.user.id

    // 2. Validate input.
    const body = await req.json().catch(() => null)
    const employeeId = body?.employee_id
    const accessRole = body?.access_role
    if (typeof employeeId !== 'string' || !UUID_RE.test(employeeId)) return json({ error: 'Invalid employee.' }, 400)
    if (!ROLES.has(accessRole)) return json({ error: 'Choose an access level: manager, photographer or editor.' }, 400)
    const canViewFinancials = accessRole === 'manager' && body?.can_view_financials === true

    const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

    // 3. Authorise: the caller must be an active owner of this employee's studio.
    const { data: emp, error: empError } = await admin.from('employees').select('*').eq('id', employeeId).maybeSingle()
    if (empError) throw empError
    if (!emp) return json({ error: 'Employee not found.' }, 404)
    const { data: owner } = await admin
      .from('employees')
      .select('id')
      .eq('studio_id', emp.studio_id)
      .eq('user_id', callerId)
      .eq('access_role', 'owner')
      .eq('is_active', true)
      .maybeSingle()
    if (!owner) return json({ error: 'Only the studio owner can invite people.' }, 403)

    if (emp.access_role === 'owner') return json({ error: 'The owner already has full access.' }, 400)
    if (!emp.is_active) return json({ error: 'Reactivate this person before inviting them.' }, 400)
    if (!emp.email) return json({ error: 'Add an email address to this person first.' }, 400)

    // 4. Redirect target: prefer the configured APP_URL; otherwise accept the browser's, which
    //    Supabase additionally checks against the project's redirect allow-list.
    const appUrl = (Deno.env.get('APP_URL') ?? '').replace(/\/$/, '')
    const requested = typeof body?.redirect_to === 'string' ? body.redirect_to : ''
    const redirectTo = appUrl ? `${appUrl}/reset-password?invited=1` : requested || undefined

    // 5. Invite (or link an account that already exists for this e-mail).
    let userId: string | null = emp.user_id
    let status: 'invited' | 'linked' = 'invited'
    let message = `Invitation sent to ${emp.email}.`

    const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(emp.email, {
      redirectTo,
      data: { full_name: emp.full_name },
    })

    if (!inviteError) {
      userId = invited.user.id
    } else if (inviteError.code === 'email_exists' || /already (been )?registered/i.test(inviteError.message)) {
      const { data: existingId } = await admin.rpc('auth_user_id_by_email', { p_email: emp.email })
      if (!existingId) return json({ error: 'That email belongs to an account we could not link. Try a different address.' }, 409)
      userId = existingId as string
      if (emp.invite_status === 'pending') {
        // Still hasn't set a password: send a fresh link they can use to do so.
        await caller.auth.resetPasswordForEmail(emp.email, { redirectTo })
        message = `A new link to set a password was sent to ${emp.email}.`
      } else {
        status = 'linked'
        message = `${emp.email} already has a Flash Pilot account, so it was linked. They can sign in with their existing password.`
      }
    } else {
      return json({ error: inviteError.message }, 400)
    }

    // 6. Record the link. (The service role bypasses the owner-only guard trigger.)
    const { error: updateError } = await admin
      .from('employees')
      .update({
        user_id: userId,
        access_role: accessRole,
        can_view_financials: canViewFinancials,
        invite_status: status === 'linked' ? 'accepted' : 'pending',
        invited_at: new Date().toISOString(),
      })
      .eq('id', emp.id)
    if (updateError) throw updateError

    return json({ status, message })
  } catch (err) {
    console.error('invite-employee failed', err)
    return json({ error: err instanceof Error ? err.message : 'Unexpected error' }, 500)
  }
})
