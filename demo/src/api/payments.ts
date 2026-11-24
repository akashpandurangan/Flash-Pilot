import { formatMoney } from '@/lib/money'
import type { Payment, PaymentMethod, ProjectFinance, ProjectFinancials } from '@/types/entities'
import { read, write } from '../store/access'
import { newId, notFound, raise, round2 } from '../store/core'
import { logActivity } from '../store/log'
import { financialsOf, newestFirst } from '../store/views'
import { nullable } from './core'

export interface PaymentInput {
  amount: number
  paid_on: string
  method: PaymentMethod
  reference?: string
  notes?: string
  is_advance?: boolean
  allow_overpayment?: boolean
}

/** At most two decimal places, greater than zero. */
const validAmount = (n: number) => Number.isFinite(n) && n > 0 && Math.abs(n * 100 - Math.round(n * 100)) < 1e-6

/** Records a payment. The balance is recomputed and an accidental overpayment is refused, like the real function. */
export async function recordPayment(projectId: string, input: PaymentInput): Promise<string> {
  return write((db, at) => {
    const project = db.projects.find((p) => p.id === projectId)
    if (!project) throw notFound('event')
    if (!validAmount(input.amount)) throw raise('invalid_amount: the amount must be greater than zero with at most two decimal places')
    const fin = financialsOf(db, projectId)!
    if (input.amount > fin.balance + 1e-9 && !input.allow_overpayment) {
      throw raise(`overpayment: this payment exceeds the outstanding balance of ${round2(Math.max(fin.balance, 0))}`)
    }
    const payment: Payment = {
      id: newId(),
      project_id: projectId,
      amount: round2(input.amount),
      paid_on: input.paid_on,
      method: input.method,
      reference: nullable(input.reference),
      notes: nullable(input.notes),
      is_advance: input.is_advance ?? false,
      status: 'valid',
      voided_at: null,
      void_reason: null,
      recorded_by_name: db.profile.full_name,
      created_at: at.toISOString(),
    }
    db.payments.push(payment)
    logActivity(db, {
      projectId, entityType: 'payment', entityId: payment.id, action: 'payment_recorded', category: 'financial',
      summary: payment.is_advance ? 'Advance payment recorded' : 'Payment recorded', at,
      metadata: { amount: payment.amount, method: payment.method, display: formatMoney(payment.amount, db.studio.currency) },
    })
    return payment.id
  })
}

export async function voidPayment(paymentId: string, reason?: string) {
  await write((db, at) => {
    const payment = db.payments.find((p) => p.id === paymentId)
    if (!payment) throw notFound('payment')
    if (payment.status === 'void') throw raise('invalid_transition: this payment is already voided')
    payment.status = 'void'
    payment.voided_at = at.toISOString()
    payment.void_reason = nullable(reason)
    logActivity(db, { projectId: payment.project_id, entityType: 'payment', entityId: payment.id, action: 'payment_voided', category: 'financial', summary: 'Payment voided', at, metadata: { amount: payment.amount } })
  })
}

export async function listProjectPayments(projectId: string): Promise<Payment[]> {
  return read((db) => {
    const rows = db.payments.filter((p) => p.project_id === projectId)
    return newestFirst(rows).sort((a, b) => (a.paid_on === b.paid_on ? 0 : a.paid_on < b.paid_on ? 1 : -1))
  })
}

export async function getProjectFinancials(projectId: string): Promise<(ProjectFinancials & Pick<ProjectFinance, 'payment_notes'>) | null> {
  return read((db) => {
    const fin = financialsOf(db, projectId)
    if (!fin) return null
    return { ...fin, payment_notes: db.finances.find((f) => f.project_id === projectId)?.payment_notes ?? null }
  })
}

export async function updateFinance(projectId: string, patch: { agreed_amount?: number; payment_due_date?: string | null; payment_notes?: string | null }) {
  await write((db) => {
    const row = db.finances.find((f) => f.project_id === projectId)
    if (!row) throw notFound('event')
    if (patch.agreed_amount !== undefined) row.agreed_amount = round2(patch.agreed_amount)
    if (patch.payment_due_date !== undefined) row.payment_due_date = patch.payment_due_date
    if (patch.payment_notes !== undefined) row.payment_notes = patch.payment_notes
  })
}

export async function listFinancials(studioId: string): Promise<ProjectFinancials[]> {
  return read((db) =>
    db.projects.filter((p) => p.studio_id === studioId).map((p) => financialsOf(db, p.id)!).slice(0, 2000),
  )
}

export type PaymentWithProject = Payment & { project: { id: string; name: string; project_code: string } | null }

/** `from` and `to` are calendar dates (yyyy-MM-dd), compared with each payment's `paid_on`. */
export async function listPaymentsInRange(studioId: string, from: string, to: string): Promise<PaymentWithProject[]> {
  return read((db) => {
    const projectIds = new Set(db.projects.filter((p) => p.studio_id === studioId).map((p) => p.id))
    const rows = db.payments.filter((p) => projectIds.has(p.project_id) && p.paid_on >= from && p.paid_on <= to)
    return newestFirst(rows)
      .sort((a, b) => (a.paid_on === b.paid_on ? 0 : a.paid_on < b.paid_on ? 1 : -1))
      .slice(0, 2000)
      .map((p) => {
        const project = db.projects.find((x) => x.id === p.project_id)
        return { ...p, project: project ? { id: project.id, name: project.name, project_code: project.project_code } : null }
      })
  })
}
