import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { recordPayment } from '@/api/payments'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Notice } from '@/components/ui/display'
import { Checkbox, Field, Input, MoneyInput, Select, Textarea } from '@/components/ui/form'
import { PAYMENT_METHOD_LABELS, options } from '@/lib/constants'
import { errorMessage, isOverpaymentError } from '@/lib/errors'
import { formatMoney, overpaymentOf, parseMoneyInput } from '@/lib/money'
import { todayKey } from '@/lib/time'
import { useStudio } from '@/features/studio/StudioProvider'

const schema = z.object({
  amount: z.string().refine((v) => parseMoneyInput(v) !== null && parseMoneyInput(v)! > 0, 'Enter an amount greater than zero (max 2 decimals)'),
  paid_on: z.string().min(1, 'Choose the date received'),
  method: z.enum(['cash', 'upi', 'bank_transfer', 'other']),
  reference: z.string().trim().max(120),
  notes: z.string().trim().max(500),
  is_advance: z.boolean(),
})
type Values = z.infer<typeof schema>

export interface PaymentTarget {
  projectId: string
  projectName: string
  agreed: number
  paid: number
}

/**
 * Record a payment received outside the app. The browser previews the balance, but the
 * database recomputes it and rejects an accidental overpayment unless it is confirmed here.
 */
export function PaymentDialog({ target, onOpenChange }: { target: PaymentTarget | null; onOpenChange: (open: boolean) => void }) {
  const { tz, currency } = useStudio()
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [confirmOver, setConfirmOver] = useState(false)
  const { register, handleSubmit, reset, watch, formState: { errors, isSubmitting } } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { amount: '', paid_on: todayKey(tz), method: 'upi', reference: '', notes: '', is_advance: false },
  })

  useEffect(() => {
    if (target) {
      setError(null)
      setConfirmOver(false)
      reset({ amount: '', paid_on: todayKey(tz), method: 'upi', reference: '', notes: '', is_advance: target.paid === 0 })
    }
  }, [target, tz, reset])

  const typed = parseMoneyInput(watch('amount')) ?? 0
  const over = target ? overpaymentOf(target.agreed, target.paid, typed) : 0
  const remaining = target ? Math.max(target.agreed - target.paid, 0) : 0

  return (
    <Dialog open={!!target} onOpenChange={onOpenChange}>
      {target && (
        <DialogContent
          title="Record payment"
          description={target.projectName}
          footer={
            <>
              <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={isSubmitting}>Cancel</Button>
              <Button type="submit" form="payment-form" loading={isSubmitting} disabled={over > 0 && !confirmOver}>Record payment</Button>
            </>
          }
        >
          <form
            id="payment-form"
            noValidate
            className="space-y-4"
            onSubmit={(e) => {
              e.stopPropagation()
              void handleSubmit(async (v) => {
                setError(null)
                try {
                  await recordPayment(target.projectId, { ...v, amount: parseMoneyInput(v.amount)!, allow_overpayment: confirmOver })
                  toast.success(`${formatMoney(parseMoneyInput(v.amount)!, currency)} recorded`)
                  for (const k of ['project-payments', 'project-financials', 'financials', 'payments', 'project-activity', 'dashboard']) void qc.invalidateQueries({ queryKey: [k] })
                  onOpenChange(false)
                } catch (err) {
                  if (isOverpaymentError(err)) setConfirmOver(false)
                  setError(errorMessage(err))
                }
              })(e)
            }}
          >
            <dl className="grid grid-cols-3 gap-3 rounded-lg bg-subtle p-3 text-center">
              {[['Agreed', target.agreed], ['Received', target.paid], ['Balance', remaining]].map(([label, value]) => (
                <div key={label as string}>
                  <dt className="text-xs text-ink-muted">{label}</dt>
                  <dd className="mt-0.5 text-sm font-semibold tabular-nums">{formatMoney(value as number, currency)}</dd>
                </div>
              ))}
            </dl>
            {error && <Notice tone="danger">{error}</Notice>}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Amount received" error={errors.amount?.message} required>
                {(a) => <MoneyInput symbol={currency === 'INR' ? '₹' : currency} autoFocus {...a} {...register('amount')} />}
              </Field>
              <Field label="Date received" error={errors.paid_on?.message} required>{(a) => <Input type="date" max={todayKey(tz)} {...a} {...register('paid_on')} />}</Field>
              <Field label="Method">
                {(a) => <Select {...a} {...register('method')}>{options(PAYMENT_METHOD_LABELS).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>}
              </Field>
              <Field label="Reference" hint="UTR, cheque no., receipt no.">{(a) => <Input {...a} {...register('reference')} />}</Field>
            </div>
            <Field label="Notes">{(a) => <Textarea rows={2} {...a} {...register('notes')} />}</Field>
            <Checkbox label="This is the advance payment" {...register('is_advance')} />
            {over > 0 && (
              <Notice tone="warning" title={`${formatMoney(over, currency)} more than the balance`}>
                {target.agreed === 0 ? 'No event amount has been set yet. ' : ''}
                Recording this will leave the client with a credit of {formatMoney(over, currency)}.
                <div className="mt-2.5">
                  <Checkbox label="Yes, record it anyway" checked={confirmOver} onChange={(e) => setConfirmOver(e.target.checked)} />
                </div>
              </Notice>
            )}
          </form>
        </DialogContent>
      )}
    </Dialog>
  )
}
