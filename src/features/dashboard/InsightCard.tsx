import { ChevronRight, Sparkles } from 'lucide-react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import type { Insight } from '@/lib/dashboard'
import { cn } from '@/lib/utils'

const DOT: Record<Insight['tone'], string> = { risk: 'bg-risk', caution: 'bg-caution', ok: 'bg-ok' }

/**
 * A near-black summary panel. IMPORTANT: it is *not* AI. Every line is a rule applied to the studio's
 * own records (see buildInsights), and the panel says so - Flash Pilot has no AI service connected.
 */
export function InsightCard({ headline, insights, updatedLabel, onReview }: {
  headline: string
  insights: Insight[]
  updatedLabel?: string
  /** Called by the CTA; the dashboard scrolls to the "Needs attention" table. */
  onReview?: () => void
}) {
  return (
    <section aria-labelledby="insights-title" className="on-dark relative overflow-hidden rounded-panel bg-dark p-5 text-white">
      <div className="pointer-events-none absolute -right-16 -top-16 size-48 rounded-full bg-accent/10 blur-2xl" aria-hidden />
      <div className="relative flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-full bg-accent text-ink"><Sparkles className="size-4" aria-hidden /></span>
          <h2 id="insights-title" className="text-[15px] font-semibold">Studio insights</h2>
        </div>
        <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-xs text-white/75">{updatedLabel ?? 'Live data'}</span>
      </div>

      <p className="relative mt-4 text-xl font-semibold leading-tight tracking-tight sm:text-2xl">{headline}</p>
      <p className="relative mt-1 text-[13px] text-white/70">Your studio operations at a glance.</p>

      <ul className="relative mt-4 space-y-2.5">
        {insights.map((i) => (
          <li key={i.id}>
            <Link to={i.href} className="group flex items-center gap-2.5 text-sm text-white/90 hover:text-white">
              <span className={cn('size-2 shrink-0 rounded-full', DOT[i.tone])} aria-hidden />
              <span className="min-w-0 flex-1 group-hover:underline">{i.text}</span>
              <ChevronRight className="size-4 shrink-0 text-white/40 transition-transform group-hover:translate-x-0.5 group-hover:text-white" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>

      <div className="relative mt-5 flex flex-wrap items-center gap-x-4 gap-y-2.5">
        <Button variant="accent" onClick={onReview}>Review insights</Button>
        <p className="text-xs text-white/65">Rule-based summary of your own data - not AI-generated.</p>
      </div>
    </section>
  )
}
