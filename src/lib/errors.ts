/**
 * Turns Supabase/PostgREST/Postgres errors into messages a person can act on.
 * The database raises errors shaped like "token: explanation" (see the RPCs).
 */

interface PgLikeError {
  message?: string
  code?: string
  details?: string
  hint?: string
}

const TOKEN_MESSAGES: Record<string, string> = {
  overpayment: 'This payment is more than the outstanding balance.',
  invalid_amount: 'Enter an amount greater than zero with at most two decimal places.',
  invalid_client: 'Choose a client from this studio.',
  events_required: 'Add at least one session.',
  invalid_transition: 'That step is not available right now.',
  booking_not_confirmed: 'Confirm the booking before changing production.',
  delivery_details_required: 'Record the delivery method and date first.',
  employee_inactive: 'That team member is deactivated and cannot be assigned.',
  owner_protected: 'The studio owner cannot be demoted or deactivated.',
  studio_exists: 'You already have a studio.',
  project_archived: 'This event is archived.',
  invalid_timezone: 'That time zone is not recognised.',
}

export function errorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (!err) return fallback
  if (typeof err === 'string') return err
  const e = err as PgLikeError
  const message = e.message ?? ''

  const lower = message.toLowerCase()
  if (lower.includes('failed to fetch') || lower.includes('networkerror') || lower.includes('load failed')) {
    return 'Could not reach the server. Check your internet connection and try again.'
  }
  if (lower.includes('jwt expired') || lower.includes('not authenticated') || lower.startsWith('unauthenticated')) {
    return 'Your session has expired. Please sign in again.'
  }

  const token = /^([a-z_]+):\s*(.*)$/i.exec(message)
  if (token) {
    const [, key, rest] = token
    const friendly = TOKEN_MESSAGES[key!.toLowerCase()]
    if (friendly) return rest && key!.toLowerCase() === 'invalid_transition' ? rest.replace(/^./, (c) => c.toUpperCase()) : friendly
    if (key!.toLowerCase() === 'forbidden') return rest ? capitalize(rest) : permissionMessage
  }
  if (message === 'forbidden' || e.code === '42501' || lower.includes('row-level security') || lower.includes('permission denied')) {
    return permissionMessage
  }
  if (e.code === '23505') {
    if (lower.includes('asset_tag')) return 'Another item already uses that asset ID.'
    if (lower.includes('email')) return 'Someone with that email already exists.'
    return 'That record already exists.'
  }
  if (e.code === '23503') return 'That record is still referenced elsewhere and cannot be removed.'
  if (e.code === '23514') return message.includes('ends_at') ? 'The end time must be after the start time.' : 'Some of the values entered are not allowed.'
  return message || fallback
}

export const permissionMessage = "You don't have permission to do that."

export const isOverpaymentError = (err: unknown) => /^overpayment/i.test((err as PgLikeError | undefined)?.message ?? '')

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
