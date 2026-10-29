import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { z } from 'zod'
import { createClient, findDuplicateClients, updateClient } from '@/api/clients'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Notice } from '@/components/ui/display'
import { Field, Input, Textarea } from '@/components/ui/form'
import { errorMessage } from '@/lib/errors'
import { isValidEmail, isValidPhone } from '@/lib/utils'
import type { Client } from '@/types/entities'
import { useStudio } from '@/features/studio/StudioProvider'
import { useDebounced } from '@/hooks/hooks'

const schema = z.object({
  full_name: z.string().trim().min(2, 'Enter the client’s full name').max(120),
  phone: z.string().trim().min(1, 'Enter a phone number').refine(isValidPhone, 'Enter a valid phone number'),
  email: z.string().trim().refine((v) => v === '' || isValidEmail(v), 'Enter a valid email address'),
  address: z.string().trim().max(300),
  notes: z.string().trim().max(2000),
})
type Values = z.infer<typeof schema>

/**
 * Create or edit a client. While typing, a matching phone/e-mail already on file is
 * flagged so duplicates are noticed - but never blocked (families share numbers).
 */
export function ClientFormDialog({ open, onOpenChange, client, onSaved, initialName }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  client?: Client | null
  onSaved?: (client: Client) => void
  initialName?: string
}) {
  const { studio } = useStudio()
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const { register, handleSubmit, reset, watch, formState: { errors, isSubmitting } } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { full_name: '', phone: '', email: '', address: '', notes: '' },
  })

  useEffect(() => {
    if (open) {
      setError(null)
      reset({ full_name: client?.full_name ?? initialName ?? '', phone: client?.phone ?? '', email: client?.email ?? '', address: client?.address ?? '', notes: client?.notes ?? '' })
    }
  }, [open, client, initialName, reset])

  const phone = useDebounced(watch('phone'), 400)
  const email = useDebounced(watch('email'), 400)
  const dupes = useQuery({
    queryKey: ['client-duplicates', studio.id, phone, email, client?.id],
    queryFn: () => findDuplicateClients(studio.id, phone, isValidEmail(email) ? email : '', client?.id),
    enabled: open && (phone.length >= 7 || isValidEmail(email)),
    staleTime: 10_000,
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={client ? 'Edit client' : 'New client'}
        description={client ? 'Update contact details and notes.' : 'Add the person you are shooting for.'}
        footer={
          <>
            <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={isSubmitting}>Cancel</Button>
            <Button type="submit" form="client-form" loading={isSubmitting}>{client ? 'Save changes' : 'Add client'}</Button>
          </>
        }
      >
        <form
          id="client-form"
          noValidate
          className="space-y-4"
          onSubmit={(e) => {
            e.stopPropagation() // this form can sit inside another page's form
            void handleSubmit(async (v) => {
              setError(null)
              try {
                const saved = client ? await updateClient(client.id, v) : await createClient(studio.id, v)
                toast.success(client ? 'Client updated' : 'Client added')
                void qc.invalidateQueries({ queryKey: ['clients'] })
                void qc.invalidateQueries({ queryKey: ['client', saved.id] })
                onSaved?.(saved)
                onOpenChange(false)
              } catch (err) {
                setError(errorMessage(err))
              }
            })(e)
          }}
        >
          {error && <Notice tone="danger">{error}</Notice>}
          <Field label="Full name" error={errors.full_name?.message} required>{(a) => <Input autoFocus autoComplete="off" {...a} {...register('full_name')} />}</Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Phone" error={errors.phone?.message} required>{(a) => <Input type="tel" autoComplete="off" placeholder="+91 98765 43210" {...a} {...register('phone')} />}</Field>
            <Field label="Email" error={errors.email?.message}>{(a) => <Input type="email" autoComplete="off" {...a} {...register('email')} />}</Field>
          </div>
          {dupes.data && dupes.data.length > 0 && (
            <Notice tone="warning" title="This looks like an existing client">
              <ul className="mt-1 space-y-1">
                {dupes.data.map((d) => (
                  <li key={d.id}>
                    <Link to={`/clients/${d.id}`} target="_blank" className="font-medium underline underline-offset-2">{d.full_name}</Link>
                    <span className="text-ink-muted"> · {[d.phone, d.email].filter(Boolean).join(' · ')}{d.archived_at ? ' · archived' : ''}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-1.5">You can still save if this is a different person.</p>
            </Notice>
          )}
          <Field label="Address" error={errors.address?.message}>{(a) => <Textarea rows={2} {...a} {...register('address')} />}</Field>
          <Field label="Notes" hint="Internal only - preferences, referrals, anything useful." error={errors.notes?.message}>{(a) => <Textarea rows={3} {...a} {...register('notes')} />}</Field>
        </form>
      </DialogContent>
    </Dialog>
  )
}
