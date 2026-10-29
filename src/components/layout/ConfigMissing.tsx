import { Aperture, Database } from 'lucide-react'

/**
 * Shown instead of the app when Supabase credentials are absent. Flash Pilot never
 * pretends to work with fake or local data - real operations need the real database.
 */
export function ConfigMissing() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-5 py-10">
      <div className="mb-6 flex items-center gap-2 text-lg font-semibold"><Aperture className="size-6" aria-hidden /> Flash Pilot</div>
      <div className="rounded-lg border border-line p-6">
        <div className="mb-4 flex size-10 items-center justify-center rounded-full bg-subtle"><Database className="size-5" aria-hidden /></div>
        <h1 className="text-xl font-semibold tracking-tight">Connect your Supabase project</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          Flash Pilot stores everything in your own Supabase database and needs two values before it can run. No data is
          kept in the browser as a substitute.
        </p>
        <ol className="mt-5 list-decimal space-y-3 pl-5 text-sm leading-relaxed">
          <li>
            Copy <code className="rounded bg-subtle px-1.5 py-0.5 text-[13px]">.env.example</code> to{' '}
            <code className="rounded bg-subtle px-1.5 py-0.5 text-[13px]">.env.local</code>.
          </li>
          <li>
            Set <code className="rounded bg-subtle px-1.5 py-0.5 text-[13px]">VITE_SUPABASE_URL</code> and{' '}
            <code className="rounded bg-subtle px-1.5 py-0.5 text-[13px]">VITE_SUPABASE_PUBLISHABLE_KEY</code> from
            Project Settings → API in the Supabase dashboard.
          </li>
          <li>
            Apply the SQL files in <code className="rounded bg-subtle px-1.5 py-0.5 text-[13px]">supabase/migrations</code> (
            <code className="rounded bg-subtle px-1.5 py-0.5 text-[13px]">supabase db push</code>).
          </li>
          <li>Restart <code className="rounded bg-subtle px-1.5 py-0.5 text-[13px]">npm run dev</code>.</li>
        </ol>
        <p className="mt-5 text-[13px] text-ink-muted">
          Full instructions, including e-mail and reminder setup, are in <code className="rounded bg-subtle px-1.5 py-0.5">docs/SETUP.md</code>.
        </p>
      </div>
    </div>
  )
}
