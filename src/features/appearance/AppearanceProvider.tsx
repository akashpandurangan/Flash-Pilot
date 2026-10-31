import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Toaster } from 'sonner'
import { getRemoteAppearance, saveRemoteAppearance } from '@/api/appearance'
import {
  ACCENT_VARS, accentTokens, DEFAULT_APPEARANCE, normalizeAppearance, resolveTheme, type Appearance, type ResolvedTheme, type ThemeMode,
} from '@/lib/appearance'
import { useAuth } from '@/features/auth/AuthProvider'

/*
  Where an appearance is kept:
    fp.appearance.user.<id>   that person's choice on this device (so it survives refresh, logout/login and browser restarts)
    fp.appearance.last        the most recent choice on this device, used for the sign-in screens before anyone is known
    fp.appearance.applied     the CSS variables last applied, read by the tiny script in index.html so the page never flashes
                              the wrong theme while the app loads
    profiles.appearance       the same choice on the person's own profile row, so it follows them across devices (migration 10).
                              Best effort: if the column does not exist yet, sync is switched off for the session and the
                              local copy keeps everything working.
*/
const LAST_KEY = 'fp.appearance.last'
const APPLIED_KEY = 'fp.appearance.applied'
const REMOTE_OFF_KEY = 'fp.appearance.remote-off'
const userKey = (id: string) => `fp.appearance.user.${id}`

function readLocal(key: string): Appearance | null {
  try {
    const v = localStorage.getItem(key)
    return v ? normalizeAppearance(v) : null
  } catch {
    return null
  }
}
function writeLocal(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* storage unavailable (private window): the choice still applies for this visit */ }
}
const remoteOff = () => { try { return sessionStorage.getItem(REMOTE_OFF_KEY) === '1' } catch { return false } }
const switchRemoteOff = () => { try { sessionStorage.setItem(REMOTE_OFF_KEY, '1') } catch { /* ignore */ } }

const prefersDark = () => typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches

/** Puts a theme and accent on the page: the data-theme attribute plus the accent's CSS variables. */
function applyToDocument(a: Appearance, resolved: ResolvedTheme) {
  const root = document.documentElement
  root.dataset.theme = resolved
  const tokens = accentTokens(a.accent, resolved)
  for (const v of ACCENT_VARS) root.style.removeProperty(v)
  for (const [k, v] of Object.entries(tokens)) root.style.setProperty(k, v)
  root.dataset.accent = Object.keys(tokens).length > 0 ? 'custom' : 'default'
  // for the boot script in index.html: both themes' variables, since "System" can resolve differently next time
  writeLocal(APPLIED_KEY, { mode: a.mode, vars: { light: accentTokens(a.accent, 'light'), dark: accentTokens(a.accent, 'dark') } })
}

interface AppearanceContextValue {
  appearance: Appearance
  /** What the page is actually showing: System resolved to light or dark. */
  resolved: ResolvedTheme
  setMode: (mode: ThemeMode) => void
  setAccent: (hex: string) => void
  reset: () => void
}

const AppearanceContext = createContext<AppearanceContextValue | null>(null)

export function useAppearance(): AppearanceContextValue {
  const ctx = useContext(AppearanceContext)
  if (!ctx) throw new Error('useAppearance must be used inside AppearanceProvider')
  return ctx
}

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const userId = user?.id ?? null
  const [appearance, setAppearance] = useState<Appearance>(() => readLocal(LAST_KEY) ?? DEFAULT_APPEARANCE)
  const [systemDark, setSystemDark] = useState(prefersDark)
  const touched = useRef(false) // the person changed something since signing in: a late server answer must not undo it
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const resolved = resolveTheme(appearance.mode, systemDark)

  // follow the device while the mode is System
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setSystemDark(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  useLayoutEffect(() => applyToDocument(appearance, resolved), [appearance, resolved])

  // Signing in (or switching person): their saved choice on this device first, then the one on their profile.
  useEffect(() => {
    if (!userId) return
    touched.current = false
    const local = readLocal(userKey(userId))
    setAppearance(local ?? DEFAULT_APPEARANCE)
    if (remoteOff()) return
    let cancelled = false
    getRemoteAppearance(userId)
      .then((remote) => {
        if (cancelled || touched.current) return
        if (remote) {
          setAppearance(remote)
          writeLocal(userKey(userId), remote)
          writeLocal(LAST_KEY, remote)
        } else if (local) {
          void saveRemoteAppearance(userId, local).catch(switchRemoteOff) // first sync of a choice made before migration 10
        }
      })
      .catch(switchRemoteOff)
    return () => { cancelled = true }
  }, [userId])

  const commit = useCallback((next: Appearance) => {
    touched.current = true
    setAppearance(next)
    writeLocal(LAST_KEY, next)
    if (!userId) return
    writeLocal(userKey(userId), next)
    if (remoteOff()) return
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => { void saveRemoteAppearance(userId, next).catch(switchRemoteOff) }, 600)
  }, [userId])

  const value = useMemo<AppearanceContextValue>(() => ({
    appearance,
    resolved,
    setMode: (mode) => commit({ ...appearance, mode }),
    setAccent: (hex) => commit(normalizeAppearance({ ...appearance, accent: hex })),
    reset: () => commit(DEFAULT_APPEARANCE),
  }), [appearance, resolved, commit])

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>
}

/** The toast container, themed like the rest of the app. */
export function ThemedToaster() {
  const { resolved } = useAppearance()
  return <Toaster theme={resolved} position="top-center" closeButton toastOptions={{ classNames: { toast: '!border-line !text-ink !shadow-pop' } }} />
}
