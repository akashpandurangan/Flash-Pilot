import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, LogOut } from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router'
import { acceptInvitation, fetchMemberships, type Membership } from '@/api/studio'
import { Button } from '@/components/ui/button'
import { EmptyState, ErrorState } from '@/components/ui/display'
import { can as canDo, type Actor, type Permission } from '@/lib/permissions'
import type { AccessRole, Employee, Studio } from '@/types/entities'
import { useAuth } from '@/features/auth/AuthProvider'
import { FullPageSpinner } from '@/features/auth/AuthPages'

/** A membership whose studio is known and whose employee record is active. */
export type ActiveMembership = Membership & { studio: Studio }

interface MembershipState {
  status: 'loading' | 'error' | 'none' | 'inactive' | 'ready'
  membership: ActiveMembership | null
  error: unknown
  refetch: () => Promise<unknown>
}

const MembershipContext = createContext<MembershipState | null>(null)

/** Loads which studio (and which employee record / role) the signed-in user belongs to. */
export function MembershipProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const query = useQuery({
    queryKey: ['membership', user?.id],
    queryFn: () => fetchMemberships(user!.id),
    enabled: !!user,
    staleTime: 60_000,
  })

  const active = (query.data?.find((m) => m.employee.is_active && m.studio) as ActiveMembership | undefined) ?? null
  const pending = active?.employee.invite_status === 'pending'

  // First sign-in after an invitation: mark it accepted (best effort).
  useEffect(() => {
    if (!pending || !user) return
    void acceptInvitation().then(() => qc.invalidateQueries({ queryKey: ['membership', user.id] })).catch(() => undefined)
  }, [pending, user, qc])

  const state: MembershipState = useMemo(() => {
    let status: MembershipState['status'] = 'ready'
    if (query.isLoading) status = 'loading'
    else if (query.isError) status = 'error'
    else if (!query.data || query.data.length === 0) status = 'none'
    else if (!active) status = 'inactive'
    return { status, membership: active, error: query.error, refetch: query.refetch }
  }, [query.isLoading, query.isError, query.data, query.error, query.refetch, active])

  return <MembershipContext.Provider value={state}>{children}</MembershipContext.Provider>
}

export function useMembership(): MembershipState {
  const ctx = useContext(MembershipContext)
  if (!ctx) throw new Error('useMembership must be used inside <MembershipProvider>')
  return ctx
}

export interface StudioContextValue {
  studio: Studio
  me: Employee
  role: AccessRole
  actor: Actor
  tz: string
  currency: string
  can: (permission: Permission) => boolean
}

const StudioContext = createContext<StudioContextValue | null>(null)

export function useStudio(): StudioContextValue {
  const ctx = useContext(StudioContext)
  if (!ctx) throw new Error('useStudio must be used inside the app shell')
  return ctx
}

/** Gate for everything that needs a finished studio: loading, errors, no access, onboarding. */
export function StudioGate() {
  const { status, membership, error, refetch } = useMembership()
  const { signOut } = useAuth()
  const location = useLocation()

  const value = useMemo<StudioContextValue | null>(() => {
    if (!membership) return null
    const role = membership.employee.access_role ?? 'photographer'
    const actor: Actor = { role, canViewFinancials: membership.employee.can_view_financials }
    return {
      studio: membership.studio,
      me: membership.employee,
      role,
      actor,
      tz: membership.studio.timezone,
      currency: membership.studio.currency,
      can: (p) => canDo(actor, p),
    }
  }, [membership])

  const doSignOut = useCallback(() => void signOut(), [signOut])

  if (status === 'loading') return <FullPageSpinner />
  if (status === 'error') {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md items-center px-4">
        <div className="w-full"><ErrorState title="Could not load your studio" error={error} onRetry={() => void refetch()} /></div>
      </div>
    )
  }
  if (status === 'none') return <Navigate to="/onboarding" replace />
  if (status === 'inactive') {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md items-center px-4">
        <EmptyState
          icon={<Ban />}
          title="Your access has been deactivated"
          description="You no longer have access to this studio. Contact the studio owner if you think this is a mistake."
          action={<Button variant="secondary" onClick={doSignOut}><LogOut className="size-4" /> Sign out</Button>}
          className="w-full"
        />
      </div>
    )
  }
  if (!value) return <FullPageSpinner />

  // The owner is walked through setup once; invited crew skip it.
  if (value.role === 'owner' && !value.studio.onboarding_completed_at && location.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />
  }

  return (
    <StudioContext.Provider value={value}>
      <Outlet />
    </StudioContext.Provider>
  )
}

/** Route guard: renders the page only when the role holds the permission. */
export function RequirePermission({ permission, children }: { permission: Permission; children: ReactNode }) {
  const { can } = useStudio()
  if (!can(permission)) {
    return (
      <EmptyState
        icon={<Ban />}
        title="You don't have access to this page"
        description="Your role doesn't include this area. If you think that's wrong, ask the studio owner."
        action={<Button variant="secondary" onClick={() => window.history.back()}>Go back</Button>}
        className="mx-auto mt-16 max-w-lg"
      />
    )
  }
  return <>{children}</>
}

/** Redirects anonymous visitors to /login, remembering where they were headed. */
export function RequireAuth() {
  const { session, loading } = useAuth()
  const location = useLocation()
  if (loading) return <FullPageSpinner />
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  return (
    <MembershipProvider>
      <Outlet />
    </MembershipProvider>
  )
}
