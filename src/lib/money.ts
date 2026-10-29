/**
 * Money helpers. All arithmetic happens on integer minor units (paise) so that
 * floating-point error can never creep into a balance. The database remains the
 * source of truth - these functions only mirror its maths for previews/validation.
 */

export function toMinor(amount: number | string | null | undefined): number {
  if (amount === null || amount === undefined || amount === '') return 0
  const n = typeof amount === 'number' ? amount : Number(String(amount).replace(/[,\s₹]/g, ''))
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}

export function fromMinor(minor: number): number {
  return minor / 100
}

/** Parse user input such as "1,00,000.50". Returns null when it is not a valid non-negative amount with ≤2 decimals. */
export function parseMoneyInput(raw: string): number | null {
  const cleaned = raw.replace(/[,\s₹]/g, '')
  if (cleaned === '' || !/^\d+(\.\d{1,2})?$/.test(cleaned)) return null
  return Number(cleaned)
}

export type PaymentState = 'unpaid' | 'partial' | 'paid' | 'credit' | 'no_amount'

export interface FinancialSummary {
  agreed: number
  paid: number
  /** Remaining to collect; never negative. */
  balance: number
  /** Amount received beyond the agreed price. */
  credit: number
  state: PaymentState
}

export interface PaymentLike {
  amount: number | string
  status?: 'valid' | 'void'
}

/** remaining = agreed − Σ valid payments (void payments are ignored). */
export function summarizeFinancials(agreed: number | string, payments: PaymentLike[]): FinancialSummary {
  const agreedMinor = toMinor(agreed)
  const paidMinor = payments.filter((p) => (p.status ?? 'valid') === 'valid').reduce((sum, p) => sum + toMinor(p.amount), 0)
  const diff = agreedMinor - paidMinor
  let state: PaymentState
  if (agreedMinor === 0 && paidMinor === 0) state = 'no_amount'
  else if (diff < 0) state = 'credit'
  else if (diff === 0) state = 'paid'
  else if (paidMinor === 0) state = 'unpaid'
  else state = 'partial'
  return {
    agreed: fromMinor(agreedMinor),
    paid: fromMinor(paidMinor),
    balance: fromMinor(Math.max(diff, 0)),
    credit: fromMinor(Math.max(-diff, 0)),
    state,
  }
}

/** Would recording `amount` exceed what is still owed? */
export function overpaymentOf(agreed: number | string, alreadyPaid: number | string, amount: number | string): number {
  const over = toMinor(alreadyPaid) + toMinor(amount) - toMinor(agreed)
  return fromMinor(Math.max(over, 0))
}

export function formatMoney(amount: number | null | undefined, currency = 'INR'): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return '—'
  const hasFraction = Math.round(amount * 100) % 100 !== 0
  try {
    return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: hasFraction ? 2 : 0,
      maximumFractionDigits: 2,
    }).format(amount)
  } catch {
    return `${currency} ${amount.toFixed(hasFraction ? 2 : 0)}`
  }
}

/** Compact amounts for dense UI such as KPI cards: ₹1.2L, ₹45K. */
export function formatMoneyCompact(amount: number, currency = 'INR'): string {
  if (currency !== 'INR') return formatMoney(amount, currency)
  const abs = Math.abs(amount)
  if (abs >= 1_00_00_000) return `₹${trim(amount / 1_00_00_000)}Cr`
  if (abs >= 1_00_000) return `₹${trim(amount / 1_00_000)}L`
  if (abs >= 10_000) return `₹${trim(amount / 1000)}K`
  return formatMoney(amount, currency)
}

const trim = (n: number) => String(Math.round(n * 100) / 100)
