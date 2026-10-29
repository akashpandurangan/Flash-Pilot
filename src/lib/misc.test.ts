import { describe, expect, it } from 'vitest'
import { toCsv } from './csv'
import { errorMessage, isOverpaymentError } from './errors'
import { reminderDueAt, reminderExplanation } from './reminders'
import { escapeLike, initials, isValidEmail, isValidPhone, isValidUrl } from './utils'

describe('reminder scheduling rules', () => {
  const now = new Date('2030-01-01T00:00:00Z')
  const confirmed = (startsAt: string) => ({ startsAt, bookingStatus: 'confirmed' as const })

  it('reminds 24 hours before the reporting time', () => {
    expect(reminderDueAt(confirmed('2030-01-05T09:00:00Z'), now)?.toISOString()).toBe('2030-01-04T09:00:00.000Z')
  })

  it('reminds immediately when the event is already inside the window', () => {
    expect(reminderDueAt(confirmed('2030-01-01T10:00:00Z'), now)?.toISOString()).toBe(now.toISOString())
  })

  it('never reminds for inquiries, cancelled bookings/events, archived projects or past events', () => {
    const start = '2030-01-05T09:00:00Z'
    expect(reminderDueAt({ startsAt: start, bookingStatus: 'inquiry' }, now)).toBeNull()
    expect(reminderDueAt({ startsAt: start, bookingStatus: 'cancelled' }, now)).toBeNull()
    expect(reminderDueAt({ ...confirmed(start), eventCancelled: true }, now)).toBeNull()
    expect(reminderDueAt({ ...confirmed(start), archived: true }, now)).toBeNull()
    expect(reminderDueAt(confirmed('2029-12-31T09:00:00Z'), now)).toBeNull()
  })

  it('honours a custom lead time', () => {
    expect(reminderDueAt(confirmed('2030-01-05T09:00:00Z'), now, 48)?.toISOString()).toBe('2030-01-03T09:00:00.000Z')
  })

  it('explains the outcome in plain words', () => {
    expect(reminderExplanation({ startsAt: '2030-01-05T09:00:00Z', bookingStatus: 'inquiry' }, now)).toMatch(/Confirm the booking/)
    expect(reminderExplanation(confirmed('2030-01-05T09:00:00Z'), now)).toMatch(/24 hours/)
  })
})

describe('csv export', () => {
  const cols = [{ header: 'Name', value: (r: { n: string }) => r.n }, { header: 'Amt', value: () => 5 }]

  it('quotes commas, quotes and newlines', () => {
    expect(toCsv([{ n: 'Sharma, Anita' }, { n: 'say "hi"' }, { n: 'a\nb' }], cols)).toBe('Name,Amt\r\n"Sharma, Anita",5\r\n"say ""hi""",5\r\n"a\nb",5')
  })

  it('neutralises spreadsheet formulas', () => {
    const csv = toCsv([{ n: '=HYPERLINK("http://evil")' }, { n: '+1+1' }, { n: '@SUM(A1)' }, { n: '-2' }], cols)
    for (const line of csv.split('\r\n').slice(1)) expect(line.startsWith("'") || line.startsWith('"\'')).toBe(true)
  })
})

describe('errors', () => {
  it('maps database tokens to friendly messages', () => {
    expect(errorMessage({ message: 'overpayment: this payment exceeds the outstanding balance of 500' })).toMatch(/more than the outstanding/)
    expect(isOverpaymentError({ message: 'overpayment: x' })).toBe(true)
    expect(errorMessage({ message: 'new row violates row-level security policy for table "clients"', code: '42501' })).toMatch(/permission/)
    expect(errorMessage({ message: 'TypeError: Failed to fetch' })).toMatch(/internet connection/)
    expect(errorMessage({ message: 'duplicate key value violates unique constraint "equipment_asset_tag_key"', code: '23505' })).toMatch(/asset ID/)
    expect(errorMessage({ message: 'invalid_transition: finish editing first' })).toBe('Finish editing first')
    expect(errorMessage(null)).toMatch(/went wrong/)
  })
})

describe('validators & helpers', () => {
  it('validates phone, email and URL', () => {
    expect(isValidPhone('+91 98765 43210')).toBe(true)
    expect(isValidPhone('98765-43210')).toBe(true)
    expect(isValidPhone('12')).toBe(false)
    expect(isValidPhone('call me')).toBe(false)
    expect(isValidEmail('a@b.co')).toBe(true)
    expect(isValidEmail('a@b')).toBe(false)
    expect(isValidUrl('https://maps.app.goo.gl/x')).toBe(true)
    expect(isValidUrl('javascript:alert(1)')).toBe(false)
  })

  it('derives initials and safe filter text', () => {
    expect(initials('Anita Rao Sharma')).toBe('AS')
    expect(initials('  ')).toBe('?')
    expect(escapeLike('50%_off,(x)')).toBe('50\\%\\_off  x')
  })
})
