import { Check, Monitor, Moon, Palette, RotateCcw, Sun } from 'lucide-react'
import { useEffect, useState, type ComponentType } from 'react'
import { Button } from '@/components/ui/button'
import { Badge, Panel } from '@/components/ui/display'
import { Input } from '@/components/ui/form'
import { ProgressBar } from '@/components/ui/progress-bar'
import { StatusBadge } from '@/components/ui/status'
import { ACCENT_PRESETS, isDefaultAppearance, isHexColor, type ThemeMode } from '@/lib/appearance'
import { cn } from '@/lib/utils'
import { useAppearance } from '@/features/appearance/AppearanceProvider'

const MODES: { value: ThemeMode; label: string; hint: string; Icon: ComponentType<{ className?: string }> }[] = [
  { value: 'light', label: 'Light', hint: 'Bright and clean', Icon: Sun },
  { value: 'dark', label: 'Dark', hint: 'Easy on the eyes', Icon: Moon },
  { value: 'system', label: 'System', hint: 'Matches your device', Icon: Monitor },
]

/**
 * Personal appearance: light / dark / system, an accent colour (presets or any colour), and a live preview. Changes apply the
 * moment they are made and are remembered for this person (see features/appearance). Available to every role - it is about
 * the person, not the studio.
 */
export function AppearanceSettings() {
  const { appearance, resolved, setMode, setAccent, reset } = useAppearance()
  const preset = ACCENT_PRESETS.find((p) => p.hex === appearance.accent)
  const isCustom = !preset
  const [hex, setHex] = useState(appearance.accent)
  useEffect(() => setHex(appearance.accent), [appearance.accent])
  const hexInvalid = hex !== '' && !isHexColor(hex)

  return (
    <Panel
      title="Appearance"
      description="Your own look for Flash Pilot. It applies to your account only, on every device you sign in on."
      action={!isDefaultAppearance(appearance) && <Button variant="ghost" size="sm" onClick={reset}><RotateCcw className="size-3.5" /> Reset</Button>}
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="min-w-0 space-y-6">
          <section aria-labelledby="theme-mode-title">
            <h3 id="theme-mode-title" className="mb-2 text-sm font-semibold">Theme</h3>
            <div role="radiogroup" aria-labelledby="theme-mode-title" className="grid grid-cols-3 gap-2">
              {MODES.map(({ value, label, hint, Icon }) => {
                const selected = appearance.mode === value
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setMode(value)}
                    className={cn(
                      'flex flex-col items-start gap-1 rounded-card border p-3 text-left transition-colors',
                      selected ? 'border-brand bg-subtle ring-1 ring-brand' : 'border-line hover:border-line-strong hover:bg-sidebar',
                    )}
                  >
                    <span className="flex w-full items-center justify-between">
                      <Icon className="size-[18px]" aria-hidden />
                      {selected && <Check className="size-4 text-brand" aria-hidden />}
                    </span>
                    <span className="text-sm font-semibold">{label}</span>
                    <span className="text-xs text-ink-muted">{hint}</span>
                  </button>
                )
              })}
            </div>
            {appearance.mode === 'system' && <p className="mt-2 text-xs text-ink-muted">Your device is currently using the <strong className="font-semibold text-ink">{resolved}</strong> theme.</p>}
          </section>

          <section aria-labelledby="accent-title">
            <h3 id="accent-title" className="mb-2 text-sm font-semibold">Accent colour</h3>
            <div role="radiogroup" aria-labelledby="accent-title" className="flex flex-wrap gap-2.5">
              {ACCENT_PRESETS.map((p) => {
                const selected = p.hex === appearance.accent
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={p.label}
                    title={p.label}
                    onClick={() => setAccent(p.hex)}
                    className={cn('relative flex size-10 items-center justify-center rounded-full ring-offset-2 ring-offset-surface transition-shadow', selected ? 'ring-2 ring-ink' : 'ring-1 ring-line-strong hover:ring-2 hover:ring-line-strong')}
                    style={{ backgroundColor: p.hex }}
                  >
                    {selected && <Check className="size-4 text-[#17171b]" strokeWidth={3} aria-hidden />}
                  </button>
                )
              })}
              <label
                className={cn('relative flex h-10 cursor-pointer items-center gap-2 rounded-full pl-1.5 pr-3.5 text-[13px] font-medium ring-offset-2 ring-offset-surface transition-shadow focus-within:outline focus-within:outline-2 focus-within:outline-focus', isCustom ? 'ring-2 ring-ink' : 'ring-1 ring-line-strong hover:ring-2 hover:ring-line-strong')}
              >
                <span
                  className="flex size-7 items-center justify-center rounded-full"
                  style={isCustom ? { backgroundColor: appearance.accent } : { backgroundImage: 'conic-gradient(#f87171, #facc15, #4ade80, #38bdf8, #a78bfa, #f472b6, #f87171)' }}
                >
                  {isCustom ? <Check className="size-3.5 text-[#17171b] mix-blend-difference" strokeWidth={3} aria-hidden /> : <Palette className="size-3.5 text-white mix-blend-difference" aria-hidden />}
                </span>
                Custom
                <input
                  type="color"
                  aria-label="Custom accent colour"
                  value={isHexColor(appearance.accent) ? appearance.accent : '#c7f34a'}
                  onChange={(e) => setAccent(e.target.value)}
                  className="absolute inset-0 size-full cursor-pointer opacity-0"
                />
              </label>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <label htmlFor="accent-hex" className="text-[13px] text-ink-muted">Colour code</label>
              <Input
                id="accent-hex"
                value={hex}
                onChange={(e) => {
                  const v = e.target.value.trim()
                  setHex(v)
                  if (isHexColor(v)) setAccent(v)
                }}
                maxLength={7}
                spellCheck={false}
                aria-invalid={hexInvalid}
                aria-describedby={hexInvalid ? 'accent-hex-error' : undefined}
                className="h-9 w-32 font-mono text-[13px]"
              />
              {preset ? <Badge tone="outline">{preset.label}</Badge> : <Badge tone="outline">Custom</Badge>}
            </div>
            {hexInvalid && <p id="accent-hex-error" role="alert" className="mt-1.5 text-xs text-danger">Enter a colour like #7c3aed (a # and six letters or numbers).</p>}
            <p className="mt-2 text-xs text-ink-muted">Buttons, the selected menu item, tabs, filters and highlights follow your accent. Status colours (paid, warning, cancelled) always stay as they are.</p>
          </section>
        </div>

        <AppearancePreview />
      </div>
    </Panel>
  )
}

/** A miniature of the app in the chosen theme and accent: it uses the same tokens as the real thing, so it is always accurate. */
function AppearancePreview() {
  return (
    <div role="img" aria-label="Preview of the selected theme and accent colour" className="self-start rounded-card border border-line bg-page p-3 shadow-card">
      <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-ink-faint">Preview</p>
      <div className="space-y-3 rounded-xl border border-line bg-surface p-3">
        <div className="flex gap-1.5">
          <span className="inline-flex h-7 items-center rounded-full bg-brand px-3 text-xs font-medium text-on-brand">Overview</span>
          <span className="inline-flex h-7 items-center rounded-full px-3 text-xs font-medium text-ink-muted">Events</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <span className="inline-flex h-7 items-center rounded-full bg-accent px-3 text-xs font-medium text-on-accent">Upcoming 2</span>
          <span className="inline-flex h-7 items-center rounded-full bg-subtle px-3 text-xs font-medium text-ink-muted ring-1 ring-line">Editing 1</span>
        </div>
        <div className="rounded-xl bg-accent-soft px-3 py-2 ring-1 ring-accent/60">
          <p className="text-[11px] text-accent-ink">Pending amount</p>
          <p className="text-lg font-semibold leading-tight">₹45,000</p>
        </div>
        <ProgressBar value={60} label="Preview progress" />
        <div className="flex flex-wrap gap-1.5">
          <StatusBadge tone="success" dot>Paid</StatusBadge>
          <StatusBadge tone="warning" dot>Pending</StatusBadge>
          <StatusBadge tone="danger" dot>Cancelled</StatusBadge>
        </div>
        <div className="flex gap-2">
          <span className="inline-flex h-8 items-center rounded-full bg-brand px-4 text-[13px] font-medium text-on-brand">Create event</span>
          <span className="inline-flex h-8 items-center rounded-full border border-line-strong bg-surface px-4 text-[13px] font-medium">Cancel</span>
        </div>
      </div>
    </div>
  )
}
