import type { Session, User } from '@supabase/supabase-js'
import { useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { appUrl } from '@/lib/env'
import { supabase } from '@/lib/supabase'

interface AuthContextValue {
  session: Session | null
  user: User | null
  /** True until the persisted session has been read once. */
  loading: boolean
  /** Set when the user arrived through a password-recovery link. */
  recovery: boolean
  signIn: (email: string, password: string) => Promise<void>
  signUp: (input: { email: string; password: string; fullName: string }) => Promise<{ needsConfirmation: boolean }>
  signOut: () => Promise<void>
  sendPasswordReset: (email: string) => Promise<void>
  updatePassword: (password: string) => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

function friendlyAuthError(err: { message?: string; code?: string }): Error {
  const m = (err.message ?? '').toLowerCase()
  if (m.includes('invalid login credentials')) return new Error('That email and password do not match. Check them and try again.')
  if (m.includes('email not confirmed')) return new Error('Please confirm your email first - check your inbox for the confirmation link.')
  if (m.includes('already registered') || err.code === 'user_already_exists') return new Error('An account with this email already exists. Try signing in instead.')
  if (m.includes('rate limit') || err.code === 'over_email_send_rate_limit') return new Error('Too many attempts. Please wait a few minutes and try again.')
  if (m.includes('password') && m.includes('weak')) return new Error('Choose a stronger password (at least 8 characters, mixing letters and numbers).')
  if (m.includes('same password') || err.code === 'same_password') return new Error('Choose a password different from your current one.')
  if (m.includes('failed to fetch')) return new Error('Could not reach the server. Check your internet connection.')
  return new Error(err.message || 'Something went wrong. Please try again.')
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [recovery, setRecovery] = useState(false)

  useEffect(() => {
    let active = true
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      setLoading(false)
    })
    // Keep this callback synchronous: awaiting Supabase calls inside it can deadlock the client.
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next)
      if (event === 'PASSWORD_RECOVERY') setRecovery(true)
      if (event === 'SIGNED_OUT') {
        setRecovery(false)
        queryClient.clear() // never show one person's cached data to the next
      }
    })
    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [queryClient])

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error) throw friendlyAuthError(error)
  }, [])

  const signUp = useCallback(async ({ email, password, fullName }: { email: string; password: string; fullName: string }) => {
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { full_name: fullName.trim() }, emailRedirectTo: `${appUrl()}/login` },
    })
    if (error) throw friendlyAuthError(error)
    // With e-mail confirmation on, an existing address returns a user with no identities instead of an error.
    if (data.user && data.user.identities && data.user.identities.length === 0) {
      throw new Error('An account with this email already exists. Try signing in instead.')
    }
    return { needsConfirmation: !data.session }
  }, [])

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut()
    if (error) throw friendlyAuthError(error)
  }, [])

  const sendPasswordReset = useCallback(async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${appUrl()}/reset-password` })
    if (error) throw friendlyAuthError(error)
  }, [])

  const updatePassword = useCallback(async (password: string) => {
    const { error } = await supabase.auth.updateUser({ password })
    if (error) throw friendlyAuthError(error)
    setRecovery(false)
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({ session, user: session?.user ?? null, loading, recovery, signIn, signUp, signOut, sendPasswordReset, updatePassword }),
    [session, loading, recovery, signIn, signUp, signOut, sendPasswordReset, updatePassword],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
