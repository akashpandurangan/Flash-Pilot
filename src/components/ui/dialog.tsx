import { X } from 'lucide-react'
import { AlertDialog, Dialog as RadixDialog } from 'radix-ui'
import { useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Button } from './button'

export const Dialog = RadixDialog.Root
export const DialogTrigger = RadixDialog.Trigger
export const DialogClose = RadixDialog.Close

interface ContentProps {
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
  className?: string
  /** Hide the visible title (kept for screen readers). */
  hideTitle?: boolean
}

const sizes = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }

/** Centered modal on desktop; a full-width sheet on small screens. */
export function DialogContent({ title, description, children, footer, size = 'md', className, hideTitle }: ContentProps) {
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="fixed inset-0 z-50 bg-black/40 [animation:fp-fade-in_.15s_ease-out]" />
      <RadixDialog.Content
        className={cn(
          'fixed z-50 flex max-h-[92dvh] w-full flex-col border border-line bg-surface shadow-pop [animation:fp-pop-in_.18s_ease-out]',
          'bottom-0 left-0 rounded-t-2xl md:bottom-auto md:left-1/2 md:top-1/2 md:w-[calc(100%-2rem)] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-card',
          sizes[size],
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className={cn(hideTitle && 'sr-only')}>
            <RadixDialog.Title className="text-base font-semibold">{title}</RadixDialog.Title>
            <RadixDialog.Description className={cn('mt-1 text-[13px] text-ink-muted', !description && 'sr-only')}>
              {description ?? title}
            </RadixDialog.Description>
          </div>
          <RadixDialog.Close asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Close" className="-mr-1.5 -mt-1"><X className="size-4" /></Button>
          </RadixDialog.Close>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-col-reverse gap-2 border-t border-line px-5 py-3 sm:flex-row sm:justify-end">{footer}</div>}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  )
}

interface ConfirmProps {
  trigger?: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  title: string
  description: ReactNode
  confirmLabel: string
  tone?: 'danger' | 'primary'
  /** Awaited; the dialog stays open and shows a spinner until it settles. Throw to keep it open. */
  onConfirm: () => Promise<unknown> | unknown
  children?: ReactNode
}

/** Confirmation for consequential actions. Explains the effect and shows progress. */
export function ConfirmDialog({ trigger, open, onOpenChange, title, description, confirmLabel, tone = 'danger', onConfirm, children }: ConfirmProps) {
  const [internal, setInternal] = useState(false)
  const [busy, setBusy] = useState(false)
  const isOpen = open ?? internal
  const setOpen = (v: boolean) => (onOpenChange ?? setInternal)(v)

  return (
    <AlertDialog.Root open={isOpen} onOpenChange={(v) => !busy && setOpen(v)}>
      {trigger && <AlertDialog.Trigger asChild>{trigger}</AlertDialog.Trigger>}
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/40 [animation:fp-fade-in_.15s_ease-out]" />
        <AlertDialog.Content className="fixed bottom-0 left-0 z-50 w-full rounded-t-2xl border border-line bg-surface p-6 shadow-pop [animation:fp-pop-in_.18s_ease-out] md:bottom-auto md:left-1/2 md:top-1/2 md:w-[calc(100%-2rem)] md:max-w-md md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-card">
          <AlertDialog.Title className="text-base font-semibold">{title}</AlertDialog.Title>
          <AlertDialog.Description asChild>
            <div className="mt-2 text-sm leading-relaxed text-ink-muted">{description}</div>
          </AlertDialog.Description>
          {children && <div className="mt-4">{children}</div>}
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialog.Cancel asChild>
              <Button variant="secondary" disabled={busy}>Cancel</Button>
            </AlertDialog.Cancel>
            <Button
              variant={tone === 'danger' ? 'danger' : 'primary'}
              loading={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  await onConfirm()
                  setOpen(false)
                } catch {
                  /* the caller surfaces the error (toast); keep the dialog open so nothing is lost */
                } finally {
                  setBusy(false)
                }
              }}
            >
              {confirmLabel}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
