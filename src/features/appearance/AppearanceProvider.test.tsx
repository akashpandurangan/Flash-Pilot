import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const auth = { user: null as { id: string } | null }
vi.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => auth }))
const getRemote = vi.fn()
const saveRemote = vi.fn()
vi.mock('@/api/appearance', () => ({ getRemoteAppearance: (...a: unknown[]) => getRemote(...a), saveRemoteAppearance: (...a: unknown[]) => saveRemote(...a) }))
vi.mock('sonner', () => ({ Toaster: () => null }))

import { AppearanceProvider, useAppearance } from './AppearanceProvider'

/** A controllable stand-in for the device's colour-scheme preference. */
function mockSystemTheme(initialDark: boolean) {
  let dark = initialDark
  const listeners = new Set<() => void>()
  window.matchMedia = ((query: string) => ({
    get matches() { return query.includes('dark') ? dark : false },
    media: query,
    addEventListener: (_: string, l: () => void) => listeners.add(l),
    removeEventListener: (_: string, l: () => void) => listeners.delete(l),
  })) as unknown as typeof window.matchMedia
  return (next: boolean) => { dark = next; listeners.forEach((l) => l()) }
}

function Probe() {
  const { appearance, resolved, setMode, setAccent, reset } = useAppearance()
  return (
    <div>
      <output data-testid="state">{appearance.mode}|{appearance.accent}|{resolved}</output>
      <button onClick={() => setMode('dark')}>dark</button>
      <button onClick={() => setMode('system')}>system</button>
      <button onClick={() => setAccent('#a78bfa')}>violet</button>
      <button onClick={reset}>reset</button>
    </div>
  )
}

const mount = () => render(<AppearanceProvider><Probe /></AppearanceProvider>)
const state = () => screen.getByTestId('state').textContent
const root = () => document.documentElement

describe('appearance provider', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    root().removeAttribute('data-theme')
    root().removeAttribute('data-accent')
    root().removeAttribute('style')
    auth.user = null
    getRemote.mockReset().mockResolvedValue(null)
    saveRemote.mockReset().mockResolvedValue(undefined)
    mockSystemTheme(false)
  })
  afterEach(() => vi.useRealTimers())

  it('keeps the existing look by default: light theme, lime accent, no overrides', () => {
    mount()
    expect(state()).toBe('light|#c7f34a|light')
    expect(root().dataset.theme).toBe('light')
    expect(root().dataset.accent).toBe('default')
    expect(root().style.getPropertyValue('--color-accent')).toBe('')
  })

  it('applies a theme and an accent to the page, and removes the overrides when lime is chosen again', async () => {
    mount()
    await userEvent.click(screen.getByText('dark'))
    await userEvent.click(screen.getByText('violet'))
    expect(root().dataset.theme).toBe('dark')
    expect(root().dataset.accent).toBe('custom')
    expect(root().style.getPropertyValue('--color-accent')).toBe('#a78bfa')
    expect(root().style.getPropertyValue('--color-brand')).not.toBe('')
    await userEvent.click(screen.getByText('reset'))
    expect(state()).toBe('light|#c7f34a|light')
    expect(root().style.getPropertyValue('--color-accent')).toBe('')
    expect(root().style.getPropertyValue('--color-brand')).toBe('')
  })

  it('remembers the choice for that person across a reload, and for the sign-in screen', async () => {
    auth.user = { id: 'u1' }
    const first = mount()
    await userEvent.click(screen.getByText('dark'))
    await userEvent.click(screen.getByText('violet'))
    first.unmount()

    // reload while signed in
    mount()
    await act(async () => {})
    expect(state()).toBe('dark|#a78bfa|dark')

    // signed out: the sign-in screen keeps the last look used on this device
    auth.user = null
    document.body.innerHTML = ''
    mount()
    expect(state()).toBe('dark|#a78bfa|dark')
  })

  it("does not hand one person's look to another on the same device", async () => {
    auth.user = { id: 'u1' }
    const a = mount()
    await userEvent.click(screen.getByText('dark'))
    a.unmount()
    auth.user = { id: 'u2' }
    mount()
    await act(async () => {})
    expect(state()).toBe('light|#c7f34a|light')
    auth.user = { id: 'u1' }
    document.body.innerHTML = ''
    mount()
    await act(async () => {})
    expect(state()).toBe('dark|#c7f34a|dark')
  })

  it('writes what the early page script needs, so the next load does not flash', async () => {
    mount()
    await userEvent.click(screen.getByText('violet'))
    const applied = JSON.parse(localStorage.getItem('fp.appearance.applied')!)
    expect(applied.mode).toBe('light')
    expect(applied.vars.light['--color-accent']).toBe('#a78bfa')
    expect(applied.vars.dark['--color-accent']).toBe('#a78bfa')
    expect(applied.vars.light['--color-brand']).not.toBe(applied.vars.dark['--color-brand'])
  })

  it('follows the device when the mode is System, live', async () => {
    const setSystemDark = mockSystemTheme(true)
    mount()
    await userEvent.click(screen.getByText('system'))
    expect(state()).toBe('system|#c7f34a|dark')
    expect(root().dataset.theme).toBe('dark')
    act(() => setSystemDark(false))
    expect(state()).toBe('system|#c7f34a|light')
    expect(root().dataset.theme).toBe('light')
  })

  it("syncs the choice to the person's own profile (debounced), and adopts the one saved there on a new device", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    auth.user = { id: 'u1' }
    getRemote.mockResolvedValue({ mode: 'dark', accent: '#2dd4bf' })
    mount()
    await act(async () => {})
    expect(state()).toBe('dark|#2dd4bf|dark') // from the profile, nothing was stored on this device yet
    expect(localStorage.getItem('fp.appearance.user.u1')).toContain('#2dd4bf')

    await userEvent.click(screen.getByText('violet'))
    expect(saveRemote).not.toHaveBeenCalled() // waits for the choosing to settle
    await act(async () => { await vi.advanceTimersByTimeAsync(700) })
    expect(saveRemote).toHaveBeenCalledTimes(1)
    expect(saveRemote).toHaveBeenCalledWith('u1', { mode: 'dark', accent: '#a78bfa' })
  })

  it('a slow server answer never overwrites a choice made in the meantime', async () => {
    auth.user = { id: 'u1' }
    let answer!: (v: unknown) => void
    getRemote.mockReturnValue(new Promise((resolve) => { answer = resolve }))
    mount()
    await userEvent.click(screen.getByText('violet'))
    await act(async () => { answer({ mode: 'dark', accent: '#2dd4bf' }) })
    expect(state()).toBe('light|#a78bfa|light')
  })

  it('keeps working from the device when the server copy is unavailable (migration not applied yet), and stops asking', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    auth.user = { id: 'u1' }
    getRemote.mockRejectedValue({ code: '42703', message: 'column profiles.appearance does not exist' })
    mount()
    await act(async () => {})
    await userEvent.click(screen.getByText('dark'))
    await act(async () => { await vi.advanceTimersByTimeAsync(700) })
    expect(state()).toBe('dark|#c7f34a|dark')
    expect(saveRemote).not.toHaveBeenCalled() // sync was switched off for the session
    expect(localStorage.getItem('fp.appearance.user.u1')).toContain('dark')
  })

  it('shrugs off corrupt stored values', () => {
    localStorage.setItem('fp.appearance.last', '{"mode":"neon","accent":"javascript:alert(1)"}')
    mount()
    expect(state()).toBe('light|#c7f34a|light')
  })
})
