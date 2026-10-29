import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, IndianRupee, Pencil, Plus } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { getProjectFinancials, listProjectPayments, voidPayment } from '@/api/payments'
import type { ProjectDetail } from '@/api/projects'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/dialog'
import { Badge, Detail, EmptyState, ErrorState, Panel, Skeleton, StatCard, TableWrap, TD, TH, THead, TR } from '@/components/ui/display'
import { Input } from '@/components/ui/form'
import { PaymentRowBadge, PaymentStateBadge } from '@/components/ui/status'
import { PAYMENT_METHOD_LABELS } from '@/lib/constants'
import { errorMessage } from '@/lib/errors'
import { formatMoney, summarizeFinancials } from '@/lib/money'
import { fmtDateOnly, todayKey } from '@/lib/time'
import { PaymentDialog } from '@/features/payments/PaymentDialog'
import { useStudio } from '@/features/studio/StudioProvider'
import { FinanceEditDialog } from './ProjectDialogs'

export function ProjectPaymentsTab({ project }: { project: ProjectDetail }) {
  const { currency, tz, can } = useStudio()
  const qc = useQueryClient()
  const [paying, setPaying] = useState(false)
  const [editing, setEditing] = useState(false)
  const [reason, setReason] = useState('')

  const fin = useQuery({ queryKey: ['project-financials', project.id], queryFn: () => getProjectFinancials(project.id) })
  const pays = useQuery({ queryKey: ['project-payments', project.id], queryFn: () => listProjectPayments(project.id) })

  const voidIt = useMutation({
    mutationFn: (id: string) => voidPayment(id, reason),
    onSuccess: () => {
      toast.success('Payment voided. The balance has been recalculated.')
      for (const k of ['project-payments', 'project-financials', 'financials', 'payments', 'project-activity', 'dashboard']) void qc.invalidateQueries({ queryKey: [k] })
      setReason('')
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  if (fin.isLoading || pays.isLoading) return <div className="space-y-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-40 w-full" /></div>
  const failed = fin.isError ? fin : pays.isError ? pays : null
  if (failed) return <ErrorState error={failed.error} onRetry={() => void failed.refetch()} />

  const f = fin.data
  const payments = pays.data ?? []
  const summary = summarizeFinancials(f?.agreed_amount ?? 0, payments)
  const overdue = !!f?.payment_due_date && f.payment_due_date < todayKey(tz) && summary.balance > 0
  const canManage = can('finance.manage') && project.booking_status !== 'cancelled'

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Agreed amount" value={formatMoney(summary.agreed, currency)} hint={f?.payment_due_date ? `Due ${fmtDateOnly(f.payment_due_date)}` : 'No due date set'} />
        <StatCard label="Received" value={formatMoney(summary.paid, currency)} hint={`${payments.filter((p) => p.status === 'valid').length} payment(s)`} />
        <StatCard
          label={summary.credit > 0 ? 'Credit' : 'Balance due'}
          value={formatMoney(summary.credit > 0 ? summary.credit : summary.balance, currency)}
          hint={<span className="inline-flex items-center gap-1.5"><PaymentStateBadge state={summary.state} />{overdue && <Badge tone="danger">Overdue</Badge>}</span>}
        />
      </div>

      <Panel
        title="Payment history"
        description="Payments are recorded here; no money moves through Flash Pilot."
        action={canManage && (
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}><Pencil className="size-3.5" /> Amount & due date</Button>
            <Button size="sm" onClick={() => setPaying(true)}><Plus className="size-3.5" /> Record payment</Button>
          </div>
        )}
        bodyClassName="p-0"
      >
        {payments.length === 0 ? (
          <div className="p-4"><EmptyState icon={<IndianRupee />} title="No payments yet" description={summary.agreed > 0 ? 'Record the advance or any installment as it arrives.' : 'Set the agreed amount, then record payments as they arrive.'} /></div>
        ) : (
          <TableWrap className="rounded-none border-0">
            <THead><tr><TH>Date</TH><TH className="text-right">Amount</TH><TH>Method</TH><TH>Reference</TH><TH>Recorded by</TH><TH>Status</TH><TH className="w-12"><span className="sr-only">Actions</span></TH></tr></THead>
            <tbody>
              {payments.map((p) => (
                <TR key={p.id} className={p.status === 'void' ? 'text-ink-muted' : ''}>
                  <TD className="whitespace-nowrap">{fmtDateOnly(p.paid_on)}{p.is_advance && <Badge tone="outline" className="ml-2">Advance</Badge>}</TD>
                  <TD className={`text-right font-medium tabular-nums ${p.status === 'void' ? 'line-through' : ''}`}>{formatMoney(Number(p.amount), currency)}</TD>
                  <TD>{PAYMENT_METHOD_LABELS[p.method]}</TD>
                  <TD className="max-w-40 truncate">{p.reference ?? '—'}</TD>
                  <TD>{p.recorded_by_name ?? '—'}</TD>
                  <TD><PaymentRowBadge status={p.status} />{p.void_reason && <span className="ml-2 text-xs">{p.void_reason}</span>}</TD>
                  <TD>
                    {canManage && p.status === 'valid' && (
                      <ConfirmDialog
                        title="Void this payment?"
                        description={<>The {formatMoney(Number(p.amount), currency)} payment stays in the history marked as void, and the balance is recalculated without it.</>}
                        confirmLabel="Void payment"
                        onConfirm={() => voidIt.mutateAsync(p.id)}
                        trigger={<Button variant="ghost" size="icon-sm" aria-label="Void payment"><Ban className="size-4" /></Button>}
                      >
                        <Input aria-label="Reason" placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
                      </ConfirmDialog>
                    )}
                  </TD>
                </TR>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>

      {f?.payment_notes && <Panel title="Payment notes"><Detail label="">{<span className="whitespace-pre-wrap">{f.payment_notes}</span>}</Detail></Panel>}

      <PaymentDialog
        target={paying ? { projectId: project.id, projectName: project.name, agreed: summary.agreed, paid: summary.paid } : null}
        onOpenChange={(o) => !o && setPaying(false)}
      />
      <FinanceEditDialog projectId={project.id} agreed={summary.agreed} dueDate={f?.payment_due_date ?? null} notes={f?.payment_notes ?? null} open={editing} onOpenChange={setEditing} currency={currency} />
    </div>
  )
}
