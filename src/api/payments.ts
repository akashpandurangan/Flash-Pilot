import { supabase } from '@/lib/supabase'
import type { Payment, PaymentMethod, ProjectFinance, ProjectFinancials } from '@/types/entities'
import { nullable, unwrap } from './core'

export interface PaymentInput {
  amount: number
  paid_on: string
  method: PaymentMethod
  reference?: string
  notes?: string
  is_advance?: boolean
  allow_overpayment?: boolean
}

/** Records a payment. The server recomputes the balance and refuses accidental overpayment. */
export async function recordPayment(projectId: string, input: PaymentInput): Promise<string> {
  return unwrap(
    await supabase.rpc('record_payment', {
      p_project_id: projectId,
      p_amount: input.amount,
      p_paid_on: input.paid_on,
      p_method: input.method,
      p_reference: nullable(input.reference),
      p_notes: nullable(input.notes),
      p_is_advance: input.is_advance ?? false,
      p_allow_overpayment: input.allow_overpayment ?? false,
    }),
  ) as string
}

export async function voidPayment(paymentId: string, reason?: string) {
  unwrap(await supabase.rpc('void_payment', { p_payment_id: paymentId, p_reason: nullable(reason) }))
}

export async function listProjectPayments(projectId: string): Promise<Payment[]> {
  return unwrap(await supabase.from('payments').select('*').eq('project_id', projectId).order('paid_on', { ascending: false }).order('created_at', { ascending: false })) as Payment[]
}

export async function getProjectFinancials(projectId: string): Promise<(ProjectFinancials & Pick<ProjectFinance, 'payment_notes'>) | null> {
  const [fin, fin2] = await Promise.all([
    supabase.from('project_financials').select('*').eq('project_id', projectId).maybeSingle(),
    supabase.from('project_finance').select('payment_notes').eq('project_id', projectId).maybeSingle(),
  ])
  const row = unwrap(fin) as ProjectFinancials | null
  if (!row) return null
  const notes = unwrap(fin2) as { payment_notes: string | null } | null
  return { ...row, payment_notes: notes?.payment_notes ?? null }
}

export async function updateFinance(projectId: string, patch: { agreed_amount?: number; payment_due_date?: string | null; payment_notes?: string | null }) {
  unwrap(await supabase.from('project_finance').update(patch).eq('project_id', projectId))
}

export async function listFinancials(studioId: string): Promise<ProjectFinancials[]> {
  return unwrap(await supabase.from('project_financials').select('*').eq('studio_id', studioId).limit(2000)) as ProjectFinancials[]
}

export type PaymentWithProject = Payment & { project: { id: string; name: string; project_code: string } | null }

export async function listPaymentsInRange(studioId: string, from: string, to: string): Promise<PaymentWithProject[]> {
  return unwrap(
    await supabase
      .from('payments')
      .select('*, project:projects(id, name, project_code)')
      .eq('studio_id', studioId)
      .gte('paid_on', from)
      .lte('paid_on', to)
      .order('paid_on', { ascending: false })
      .limit(2000),
  ) as PaymentWithProject[]
}
