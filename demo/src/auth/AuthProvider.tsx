import type { Session, User } from '@supabase/supabase-js'
import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react'
import { toast } from 'sonner'
import { DEMO_USER_EMAIL, DEMO_USER_ID, DEMO_USER_NAME, EXIT_URL } from '../store/core'

/**
 * Demo replacement for src/features/auth/AuthProvider.tsx. There is no sign-in: the visitor is simply "signed in" as the
 * studio owner, Olivia Mehra, from the first render. The context has the same shape as the real one, so every screen that
 * calls useAuth() works unchanged.
 */
interface AuthContextValue {
  session: Session | null
  user: User | null
  loading: boolean
  recovery: boolean
  signIn: (email: string, password: string) => Promise<void>
  signUp: (input: { email: string; password: string; fullName: string }) => Promise<{ needsConfirmation: boolean }>
  signOut: () => Promise<void>
  sendPasswordReset: (email: string) => Promise<void>
  updatePassword: (password: string) => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

// A plain object shaped like the SDK's User/Session. Nothing is signed and nothing is sent anywhere.
const demoUser = {
  id: DEMO_USER_ID,
  email: DEMO_USER_EMAIL,
  app_metadata: {},
  user_metadata: { full_name: DEMO_USER_NAME },
  aud: 'demo',
  created_at: '2026-01-01T00:00:00.000Z',
} as unknown as User

const demoSession = { access_token: 'demo', refresh_token: 'demo', token_type: 'demo', expires_in: 0, expires_at: 0, user: demoUser } as unknown as Session

const unavailable = (what: string) => async (): Promise<never> => {
  throw new Error(`${what} is turned off in the interactive demo.`)
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const signOut = useCallback(async () => {
    toast('Signing out is turned off in the demo', {
      description: 'You are browsing a sandbox with sample data.',
      action: { label: 'Exit demo', onClick: () => window.location.assign(EXIT_URL) },
    })
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      session: demoSession,
      user: demoUser,
      loading: false,
      recovery: false,
      signIn: unavailable('Signing in'),
      signUp: unavailable('Creating an account'),
      signOut,
      sendPasswordReset: unavailable('Password reset'),
      updatePassword: unavailable('Changing the password'),
    }),
    [signOut],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
