import type { BookingStatus, DeliveryStatus, PaymentStatus, ProductionStage, ReminderStatus } from '@/types/entities'
import type { PaymentState } from '@/lib/money'
import { BOOKING_STATUS_LABELS, PRODUCTION_STAGES, PRODUCTION_STAGE_LABELS } from '@/lib/constants'
import { REMINDER_STATUS_LABELS } from '@/lib/reminders'
import { cn } from '@/lib/utils'
import { Check } from 'lucide-react'
import { Badge } from './display'

export function BookingBadge({ status }: { status: BookingStatus }) {
  const tone = status === 'confirmed' ? 'solid' : status === 'cancelled' ? 'danger' : 'outline'
  return <Badge tone={tone}>{BOOKING_STATUS_LABELS[status]}</Badge>
}

export function StageBadge({ stage }: { stage: ProductionStage }) {
  return <Badge tone={stage === 'delivered' ? 'success' : stage === 'upcoming' ? 'outline' : 'neutral'}>{PRODUCTION_STAGE_LABELS[stage]}</Badge>
}

const PAYMENT_STATE: Record<PaymentState, { label: string; tone: 'neutral' | 'success' | 'warning' | 'danger' | 'outline' }> = {
  paid: { label: 'Paid', tone: 'success' },
  partial: { label: 'Partially paid', tone: 'warning' },
  unpaid: { label: 'Unpaid', tone: 'danger' },
  credit: { label: 'Paid · credit', tone: 'success' },
  no_amount: { label: 'No amount set', tone: 'outline' },
}

export function PaymentStateBadge({ state }: { state: PaymentState }) {
  const s = PAYMENT_STATE[state]
  return <Badge tone={s.tone}>{s.label}</Badge>
}

export function PaymentRowBadge({ status }: { status: PaymentStatus }) {
  return status === 'void' ? <Badge tone="danger">Void</Badge> : <Badge tone="success">Received</Badge>
}

export function DeliveryStatusBadge({ status }: { status: DeliveryStatus }) {
  const map: Record<DeliveryStatus, { tone: 'neutral' | 'success' | 'warning' | 'danger' | 'outline'; label: string }> = {
    pending: { tone: 'outline', label: 'Queued' }, processing: { tone: 'neutral', label: 'Sending' }, sent: { tone: 'success', label: 'Sent' },
    failed: { tone: 'danger', label: 'Failed' }, skipped: { tone: 'warning', label: 'Not sent' },
  }
  return <Badge tone={map[status].tone}>{map[status].label}</Badge>
}

export function ReminderBadge({ status }: { status: ReminderStatus }) {
  const tone = status === 'sent' ? 'success' : status === 'failed' ? 'danger' : status === 'scheduled' ? 'neutral' : 'outline'
  return <Badge tone={tone}>{REMINDER_STATUS_LABELS[status]}</Badge>
}

/** Horizontal progress through the production stages. */
export function StageStepper({ stage, className }: { stage: ProductionStage; className?: string }) {
  const current = PRODUCTION_STAGES.indexOf(stage)
  return (
    <ol className={cn('relative flex items-center gap-1 overflow-x-auto scrollbar-thin', className)} aria-label="Production progress">
      {PRODUCTION_STAGES.map((s, i) => {
        const done = i < current || stage === 'delivered'
        const active = i === current && stage !== 'delivered'
        return (
          <li key={s} className="flex shrink-0 items-center gap-1" aria-current={active ? 'step' : undefined}>
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
                done && 'border-ink bg-ink text-white',
                active && 'border-ink bg-canvas text-ink ring-2 ring-ink/10',
                !done && !active && 'border-line text-ink-muted',
              )}
            >
              {done && <Check className="size-3" strokeWidth={3} aria-hidden />}
              {PRODUCTION_STAGE_LABELS[s]}
            </span>
            {i < PRODUCTION_STAGES.length - 1 && <span className={cn('h-px w-3 sm:w-5', i < current ? 'bg-ink' : 'bg-line-strong')} aria-hidden />}
          </li>
        )
      })}
    </ol>
  )
}
