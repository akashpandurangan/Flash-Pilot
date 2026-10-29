import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const signInWithPassword = vi.fn()
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      signInWithPassword: (...args: unknown[]) => signInWithPassword(...args),
    },
  },
}))

import { AuthProvider } from './AuthProvider'
import { LoginPage, SignupPage } from './AuthPages'

function renderPage(page: React.ReactNode) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <AuthProvider>{page}</AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('login', () => {
  beforeEach(() => {
    signInWithPassword.mockReset()
  })

  it('explains what is missing instead of submitting', async () => {
    renderPage(<LoginPage />)
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument()
    expect(screen.getByText('Enter your password')).toBeInTheDocument()
    expect(signInWithPassword).not.toHaveBeenCalled()
  })

  it('shows a friendly message for wrong credentials and keeps the typed email', async () => {
    signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } })
    renderPage(<LoginPage />)
    await userEvent.type(await screen.findByLabelText(/Email/), 'owner@studio.com')
    await userEvent.type(screen.getByLabelText(/Password/), 'wrongpass1')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText(/email and password do not match/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Email/)).toHaveValue('owner@studio.com')
  })

  it('does not double-submit while a request is in flight', async () => {
    let resolve!: (v: unknown) => void
    signInWithPassword.mockReturnValue(new Promise((r) => (resolve = r)))
    renderPage(<LoginPage />)
    await userEvent.type(await screen.findByLabelText(/Email/), 'owner@studio.com')
    await userEvent.type(screen.getByLabelText(/Password/), 'Password123')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    const busy = await screen.findByRole('button', { name: /Signing in/ })
    expect(busy).toBeDisabled()
    await userEvent.click(busy)
    expect(signInWithPassword).toHaveBeenCalledTimes(1)
    resolve({ error: null })
    await waitFor(() => expect(signInWithPassword).toHaveBeenCalledTimes(1))
  })
})

describe('sign up', () => {
  it('enforces a strong-enough password and matching confirmation', async () => {
    renderPage(<SignupPage />)
    await userEvent.type(await screen.findByLabelText(/Your full name/), 'Olivia')
    await userEvent.type(screen.getByLabelText(/^Email/), 'olivia@studio.com')
    await userEvent.type(screen.getByLabelText(/^Password/), 'short')
    await userEvent.type(screen.getByLabelText(/Confirm password/), 'different')
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByText('Use at least 8 characters')).toBeInTheDocument()
    expect(screen.getByText('Passwords do not match')).toBeInTheDocument()
  })
})
