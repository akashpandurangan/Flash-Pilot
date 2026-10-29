import { describe, expect, it } from 'vitest'
import { formatMoney, formatMoneyCompact, overpaymentOf, parseMoneyInput, summarizeFinancials, toMinor } from './money'

describe('money', () => {
  it('avoids floating-point drift', () => {
    // 0.1 + 0.2 !== 0.3 in floating point; minor-unit maths must not care
    const s = summarizeFinancials(0.3, [{ amount: 0.1 }, { amount: 0.2 }])
    expect(s.balance).toBe(0)
    expect(s.state).toBe('paid')
    expect(toMinor('1,00,000.55')).toBe(10000055)
  })

  it('balance = agreed − valid payments, ignoring voided ones', () => {
    const s = summarizeFinancials(100000, [
      { amount: 25000, status: 'valid' },
      { amount: 30000, status: 'void' },
      { amount: 10000 },
    ])
    expect(s).toMatchObject({ agreed: 100000, paid: 35000, balance: 65000, credit: 0, state: 'partial' })
  })

  it('classifies payment state', () => {
    expect(summarizeFinancials(5000, []).state).toBe('unpaid')
    expect(summarizeFinancials(5000, [{ amount: 5000 }]).state).toBe('paid')
    expect(summarizeFinancials(0, []).state).toBe('no_amount')
    expect(summarizeFinancials(5000, [{ amount: 6000 }])).toMatchObject({ state: 'credit', balance: 0, credit: 1000 })
  })

  it('detects overpayment', () => {
    expect(overpaymentOf(10000, 4000, 6000)).toBe(0)
    expect(overpaymentOf(10000, 4000, 7500.5)).toBe(1500.5)
  })

  it('parses user input strictly', () => {
    expect(parseMoneyInput('1,00,000')).toBe(100000)
    expect(parseMoneyInput('₹ 2500.5')).toBe(2500.5)
    expect(parseMoneyInput('12.345')).toBeNull()
    expect(parseMoneyInput('-5')).toBeNull()
    expect(parseMoneyInput('abc')).toBeNull()
    expect(parseMoneyInput('')).toBeNull()
  })

  it('formats INR with Indian digit grouping', () => {
    expect(formatMoney(15000)).toBe('₹15,000')
    expect(formatMoney(100000)).toBe('₹1,00,000')
    expect(formatMoney(1234.5)).toBe('₹1,234.50')
    expect(formatMoney(null)).toBe('—')
    expect(formatMoneyCompact(250000)).toBe('₹2.5L')
    expect(formatMoneyCompact(25000)).toBe('₹25K')
  })
})
