import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const recordPayment = vi.fn()
vi.mock('@/api/payments', () => ({ recordPayment: (...args: unknown[]) => recordPayment(...args) }))
vi.mock('@/features/studio/StudioProvider', () => ({ useStudio: () => ({ tz: 'Asia/Kolkata', currency: 'INR' }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { PaymentDialog } from './PaymentDialog'

const target = { projectId: 'p1', projectName: 'Sharma Wedding', agreed: 100000, paid: 40000 }

function open() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <PaymentDialog target={target} onOpenChange={vi.fn()} />
    </QueryClientProvider>,
  )
}

describe('record payment dialog', () => {
  beforeEach(() => {
    recordPayment.mockReset().mockResolvedValue('pay-1')
  })

  it('summarises agreed, received and the balance using Indian formatting', async () => {
    open()
    expect(await screen.findByText('₹1,00,000')).toBeInTheDocument()
    expect(screen.getByText('₹40,000')).toBeInTheDocument()
    expect(screen.getByText('₹60,000')).toBeInTheDocument()
  })

  it('rejects a zero or malformed amount with an explanation', async () => {
    open()
    await userEvent.type(await screen.findByLabelText(/Amount received/), '12.345')
    await userEvent.click(screen.getByRole('button', { name: 'Record payment' }))
    expect(await screen.findByText(/greater than zero/i)).toBeInTheDocument()
    expect(recordPayment).not.toHaveBeenCalled()
  })

  it('records a normal installment', async () => {
    open()
    await userEvent.type(await screen.findByLabelText(/Amount received/), '25,000')
    await userEvent.click(screen.getByRole('button', { name: 'Record payment' }))
    await waitFor(() => expect(recordPayment).toHaveBeenCalledTimes(1))
    expect(recordPayment).toHaveBeenCalledWith('p1', expect.objectContaining({ amount: 25000, allow_overpayment: false, method: 'upi' }))
  })

  it('blocks an accidental overpayment until the user explicitly confirms the credit', async () => {
    open()
    await userEvent.type(await screen.findByLabelText(/Amount received/), '75000') // balance is 60,000
    expect(await screen.findByText(/₹15,000 more than the balance/)).toBeInTheDocument()
    const submit = screen.getByRole('button', { name: 'Record payment' })
    expect(submit).toBeDisabled()

    await userEvent.click(screen.getByLabelText('Yes, record it anyway'))
    expect(submit).toBeEnabled()
    await userEvent.click(submit)
    await waitFor(() => expect(recordPayment).toHaveBeenCalledTimes(1))
    expect(recordPayment).toHaveBeenCalledWith('p1', expect.objectContaining({ amount: 75000, allow_overpayment: true }))
  })

  it('keeps the dialog open and the data intact when the server refuses', async () => {
    recordPayment.mockImplementation(() => Promise.reject({ message: 'overpayment: this payment exceeds the outstanding balance of 60000' }))
    open()
    await userEvent.type(await screen.findByLabelText(/Amount received/), '1000')
    await userEvent.click(screen.getByRole('button', { name: 'Record payment' }))
    expect(await screen.findByText(/more than the outstanding balance/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Amount received/)).toHaveValue('1000')
  })
})
