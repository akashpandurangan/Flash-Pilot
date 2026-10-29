// process-notifications
// ---------------------------------------------------------------------------
// The scheduled worker behind reminders and e-mail. Invoked every few minutes by
// Supabase Cron (see docs/SETUP.md). Each run:
//
//   1. calls public.process_due_notifications()   - turns due reminders / deadlines
//      into in-app notifications and queues e-mail deliveries (idempotent: every
//      notification has a unique dedupe key, so overlapping runs cannot double-send);
//   2. claims queued e-mail deliveries with a lease (FOR UPDATE SKIP LOCKED), sends
//      them, and records the outcome - retrying temporary failures with back-off and
//      logging every failed attempt.
//
// If no e-mail provider is configured it says so honestly: deliveries are marked
// "skipped" with the reason. It never pretends a message was sent.
//
// Auth: this function is public to Supabase's JWT check (verify_jwt = false) and is
// protected by the shared CRON_SECRET header instead.
// ---------------------------------------------------------------------------
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders, json, requireEnv, safeEqual } from '../_shared/http.ts'

interface Delivery {
  delivery_id: string
  to_address: string
  subject: string
  body: string | null
  link: string | null
  attempts: number
  max_attempts: number
}

const BATCH = 25
const MAX_BATCHES = 4

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function renderEmail(d: Delivery, appUrl: string) {
  const url = d.link && appUrl ? `${appUrl}${d.link}` : null
  const text = [d.body ?? '', url ? `\nOpen in Flash Pilot: ${url}` : ''].join('').trim()
  const html = `<div style="font-family:Inter,Arial,sans-serif;color:#111;max-width:560px">
  <h2 style="font-size:18px;margin:0 0 12px">${escapeHtml(d.subject)}</h2>
  <p style="font-size:14px;line-height:1.6;color:#333;margin:0 0 16px">${escapeHtml(d.body ?? '').replace(/\n/g, '<br>')}</p>
  ${url ? `<p><a href="${escapeHtml(url)}" style="display:inline-block;background:#111;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;font-size:14px">Open in Flash Pilot</a></p>` : ''}
  <p style="font-size:12px;color:#777;margin-top:24px">You receive this because you are on a Flash Pilot studio team. Change what you receive under Notifications → Preferences.</p>
</div>`
  return { text, html }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const url = requireEnv('SUPABASE_URL')
    const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY')
    const cronSecret = requireEnv('CRON_SECRET')

    const supplied = req.headers.get('x-cron-secret') ?? ''
    if (!safeEqual(supplied, cronSecret)) return json({ error: 'Unauthorized' }, 401)

    const admin = createClient(url, serviceKey, { auth: { persistSession: false } })
    const appUrl = (Deno.env.get('APP_URL') ?? '').replace(/\/$/, '')
    const resendKey = Deno.env.get('RESEND_API_KEY')
    const from = Deno.env.get('EMAIL_FROM')
    const providerConfigured = !!(resendKey && from)

    // 1. Generate notifications that are due.
    const { data: generated, error: genError } = await admin.rpc('process_due_notifications')
    if (genError) throw genError

    // 2. Deliver queued e-mail.
    const result = { sent: 0, skipped: 0, retried: 0, failed: 0 }
    for (let round = 0; round < MAX_BATCHES; round++) {
      const { data: claimed, error: claimError } = await admin.rpc('claim_pending_deliveries', { p_limit: BATCH })
      if (claimError) throw claimError
      const batch = (claimed ?? []) as Delivery[]
      if (batch.length === 0) break

      for (const d of batch) {
        const record = (outcome: 'sent' | 'retry' | 'failed' | 'skipped', error?: string, providerId?: string, response?: unknown) =>
          admin.rpc('record_delivery_result', {
            p_delivery_id: d.delivery_id, p_outcome: outcome, p_error: error ?? null, p_provider_message_id: providerId ?? null, p_provider_response: response ?? null,
          })

        if (!providerConfigured) {
          await record('skipped', 'Email provider not configured (set RESEND_API_KEY and EMAIL_FROM).')
          result.skipped++
          continue
        }

        try {
          const { text, html } = renderEmail(d, appUrl)
          const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${resendKey}`,
              'Content-Type': 'application/json',
              // Same delivery => same key, so a retry after a crash cannot send twice.
              'Idempotency-Key': d.delivery_id,
            },
            body: JSON.stringify({ from, to: [d.to_address], subject: d.subject, text, html }),
          })
          const payload = await res.json().catch(() => null)
          if (res.ok) {
            await record('sent', undefined, payload?.id, payload)
            result.sent++
          } else if (res.status === 429 || res.status >= 500) {
            await record('retry', `Provider ${res.status}: ${payload?.message ?? res.statusText}`, undefined, payload)
            result.retried++
          } else {
            await record('failed', `Provider ${res.status}: ${payload?.message ?? res.statusText}`, undefined, payload)
            result.failed++
          }
        } catch (err) {
          await record('retry', `Network error: ${err instanceof Error ? err.message : String(err)}`)
          result.retried++
        }
      }
      if (batch.length < BATCH) break
    }

    return json({ ok: true, providerConfigured, generated, email: result })
  } catch (err) {
    console.error('process-notifications failed', err)
    return json({ error: err instanceof Error ? err.message : 'Unexpected error' }, 500)
  }
})
