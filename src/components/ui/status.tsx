import { Check } from 'lucide-react'
import type { ReactNode } from 'react'
import type { BookingStatus, DeliveryStatus, PaymentStatus, ProductionStage, ReminderStatus } from '@/types/entities'
import type { PaymentState } from '@/lib/money'
import { BOOKING_STATUS_LABELS, PRODUCTION_STAGES, PRODUCTION_STAGE_LABELS } from '@/lib/constants'
import { REMINDER_STATUS_LABELS } from '@/lib/reminders'
import { cn } from '@/lib/utils'
import { Badge } from './display'

type Tone = 'neutral' | 'solid' | 'accent' | 'outline' | 'success' | 'warning' | 'danger'

/** Dot colours for each tone: vivid, since they are decoration next to a text label. */
const DOT: Record<Tone, string> = {
  neutral: 'bg-ink-faint', solid: 'bg-accent', accent: 'bg-ink', outline: 'bg-ink-faint',
  success: 'bg-ok', warning: 'bg-caution', danger: 'bg-risk',
}

/** The one pill used for every status in the app. `dot` adds a coloured marker like the reference's "Under review". */
export function StatusBadge({ tone = 'neutral', dot, children, className }: { tone?: Tone; dot?: boolean; children: ReactNode; className?: string }) {
  return (
    <Badge tone={tone} className={className}>
      {dot && <span className={cn('size-1.5 rounded-full', DOT[tone])} aria-hidden />}
      {children}
    </Badge>
  )
}

export function BookingBadge({ status }: { status: BookingStatus }) {
  const tone: Tone = status === 'confirmed' ? 'solid' : status === 'cancelled' ? 'danger' : 'outline'
  return <StatusBadge tone={tone}>{BOOKING_STATUS_LABELS[status]}</StatusBadge>
}

export function StageBadge({ stage }: { stage: ProductionStage }) {
  const tone: Tone = stage === 'delivered' ? 'success' : stage === 'upcoming' ? 'outline' : stage === 'awaiting_approval' ? 'warning' : stage === 'out_for_delivery' ? 'accent' : 'neutral'
  return <StatusBadge tone={tone}>{PRODUCTION_STAGE_LABELS[stage]}</StatusBadge>
}

const PAYMENT_STATE: Record<PaymentState, { label: string; tone: Tone }> = {
  paid: { label: 'Paid', tone: 'success' },
  partial: { label: 'Partially paid', tone: 'warning' },
  unpaid: { label: 'Unpaid', tone: 'danger' },
  credit: { label: 'Paid · credit', tone: 'success' },
  no_amount: { label: 'No amount set', tone: 'outline' },
}

export function PaymentStateBadge({ state }: { state: PaymentState }) {
  const s = PAYMENT_STATE[state]
  return <StatusBadge tone={s.tone}>{s.label}</StatusBadge>
}

export function PaymentRowBadge({ status }: { status: PaymentStatus }) {
  return status === 'void' ? <StatusBadge tone="danger">Void</StatusBadge> : <StatusBadge tone="success">Received</StatusBadge>
}

export function DeliveryStatusBadge({ status }: { status: DeliveryStatus }) {
  const map: Record<DeliveryStatus, { tone: Tone; label: string }> = {
    pending: { tone: 'outline', label: 'Queued' }, processing: { tone: 'neutral', label: 'Sending' }, sent: { tone: 'success', label: 'Sent' },
    failed: { tone: 'danger', label: 'Failed' }, skipped: { tone: 'warning', label: 'Not sent' },
  }
  return <StatusBadge tone={map[status].tone}>{map[status].label}</StatusBadge>
}

export function ReminderBadge({ status }: { status: ReminderStatus }) {
  const tone: Tone = status === 'sent' ? 'success' : status === 'failed' ? 'danger' : status === 'scheduled' ? 'neutral' : 'outline'
  return <StatusBadge tone={tone}>{REMINDER_STATUS_LABELS[status]}</StatusBadge>
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
                'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium',
                done && 'bg-brand text-on-brand',
                active && 'bg-accent text-on-accent',
                !done && !active && 'bg-subtle text-ink-muted',
              )}
            >
              {done && <Check className="size-3" strokeWidth={3} aria-hidden />}
              {PRODUCTION_STAGE_LABELS[s]}
            </span>
            {i < PRODUCTION_STAGES.length - 1 && <span className={cn('h-px w-3 sm:w-5', i < current ? 'bg-brand' : 'bg-line-strong')} aria-hidden />}
          </li>
        )
      })}
    </ol>
  )
}
