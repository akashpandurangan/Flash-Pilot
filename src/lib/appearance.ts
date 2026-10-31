/**
 * Personal appearance: light / dark / system, plus one accent colour. Pure (no DOM, no network) so the colour maths and
 * the preference parsing can be tested exhaustively; the provider (features/appearance) applies the result to the page.
 *
 * How an accent is applied
 *   The design tokens in index.css are CSS variables. Choosing the default lime changes nothing (the stylesheet already
 *   carries the hand-tuned lime for both themes). Any other colour overrides a small set of variables:
 *     accent        the colour itself - highlights, selected chips, progress, pills
 *     on-accent     text on it, picked for contrast
 *     accent-soft   a pale wash of it (the Pending amount card)
 *     accent-ink    readable text on that wash
 *     brand         the colour of primary buttons, the selected nav item and active tabs. Lime keeps the near-black
 *                   brand; every other accent gets a deeper, accessible shade of itself.
 *     focus         focus rings
 *   Success / warning / danger / cancelled colours are never touched, so statuses stay distinguishable.
 */

export type ThemeMode = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

export interface Appearance {
  mode: ThemeMode
  /** #rrggbb, lower case */
  accent: string
}

export const DEFAULT_ACCENT = '#c7f34a'
export const DEFAULT_APPEARANCE: Appearance = { mode: 'light', accent: DEFAULT_ACCENT }

export const ACCENT_PRESETS = [
  { id: 'lime', label: 'Lime Green', hex: DEFAULT_ACCENT },
  { id: 'violet', label: 'Violet', hex: '#a78bfa' },
  { id: 'blue', label: 'Blue', hex: '#60a5fa' },
  { id: 'teal', label: 'Teal', hex: '#2dd4bf' },
  { id: 'orange', label: 'Orange', hex: '#fb923c' },
  { id: 'rose', label: 'Rose', hex: '#fb7185' },
] as const

export const isHexColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)
export const THEME_MODES: ThemeMode[] = ['light', 'dark', 'system']

/** Tolerant parse of whatever was stored (local storage, the profile row): anything unusable falls back to the defaults. */
export function normalizeAppearance(raw: unknown): Appearance {
  const o = (typeof raw === 'string' ? safeJson(raw) : raw) as Partial<Record<keyof Appearance, unknown>> | null
  return {
    mode: THEME_MODES.includes(o?.mode as ThemeMode) ? (o!.mode as ThemeMode) : DEFAULT_APPEARANCE.mode,
    accent: isHexColor(o?.accent) ? o.accent.toLowerCase() : DEFAULT_ACCENT,
  }
}

const safeJson = (s: string): unknown => { try { return JSON.parse(s) } catch { return null } }

export const resolveTheme = (mode: ThemeMode, systemPrefersDark: boolean): ResolvedTheme => (mode === 'system' ? (systemPrefersDark ? 'dark' : 'light') : mode)
export const isDefaultAppearance = (a: Appearance) => a.mode === DEFAULT_APPEARANCE.mode && a.accent === DEFAULT_ACCENT

/* ------------------------------------------------------------------ colour maths */
type RGB = [number, number, number]
const toRgb = (hex: string): RGB => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as RGB
const toHex = (c: RGB) => `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`

function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }) as RGB
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio between two colours (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

/** `ratio` of `b` mixed into `a` (0 = a, 1 = b). */
function mix(a: string, b: string, ratio: number): string {
  const [x, y] = [toRgb(a), toRgb(b)]
  return toHex([0, 1, 2].map((i) => x[i]! + (y[i]! - x[i]!) * ratio) as RGB)
}

function toHsl(hex: string): [number, number, number] {
  const [r, g, b] = toRgb(hex).map((v) => v / 255) as RGB
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h * 60, s, l]
}

function fromHsl(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return toHex([f(0) * 255, f(8) * 255, f(4) * 255])
}

const INK = '#17171b'
const WHITE = '#ffffff'

/**
 * Dark or white text, whichever reads better on `bg` - and for mid-tones where neither reaches 4.5:1 (pure red, say), pure
 * black or white, one of which always does.
 */
export function readableOn(bg: string): string {
  const best = contrastRatio(bg, INK) >= contrastRatio(bg, WHITE) ? INK : WHITE
  if (contrastRatio(bg, best) >= 4.5) return best
  return contrastRatio(bg, '#000000') >= contrastRatio(bg, WHITE) ? '#000000' : WHITE
}

/** Moves `color` lighter or darker (keeping its hue) until it reaches `min` contrast against `against`. */
function withContrast(color: string, against: string, min: number, direction: 'darker' | 'lighter'): string {
  const [h, s, l] = toHsl(color)
  let current = color
  for (let step = 0; step <= 50 && contrastRatio(current, against) < min; step++) {
    const next = direction === 'darker' ? l - step * 0.02 : l + step * 0.02
    current = fromHsl(h, s, Math.max(0.04, Math.min(0.97, next)))
  }
  return current
}

/** Every CSS variable an accent can set - listed so the provider can clear them all when the accent goes back to lime. */
export const ACCENT_VARS = [
  '--color-accent', '--color-accent-hover', '--color-accent-soft', '--color-accent-ink', '--color-on-accent',
  '--color-brand', '--color-brand-hover', '--color-on-brand', '--color-focus',
] as const

const SURFACE = { light: WHITE, dark: INK }

/**
 * The variables to set for an accent in a given theme. Empty for the default lime: the stylesheet already defines it, so the
 * existing look is preserved exactly (and there is nothing to clean up).
 */
export function accentTokens(accent: string, theme: ResolvedTheme): Record<string, string> {
  if (!isHexColor(accent) || accent.toLowerCase() === DEFAULT_ACCENT) return {}
  const a = accent.toLowerCase()
  const soft = theme === 'light' ? mix(a, WHITE, 0.82) : mix(a, SURFACE.dark, 0.8)
  // primary buttons / selected nav / active tabs: a deep shade with white text on light; the vivid accent with dark text on dark
  const brand = theme === 'light' ? withContrast(a, WHITE, 4.6, 'darker') : withContrast(a, INK, 4.6, 'lighter')
  return {
    '--color-accent': a,
    '--color-on-accent': readableOn(a),
    '--color-accent-hover': mix(a, theme === 'light' ? '#000000' : WHITE, 0.08),
    '--color-accent-soft': soft,
    '--color-accent-ink': theme === 'light' ? withContrast(a, soft, 5, 'darker') : withContrast(a, soft, 5, 'lighter'),
    '--color-brand': brand,
    '--color-brand-hover': mix(brand, theme === 'light' ? '#000000' : WHITE, 0.14),
    '--color-on-brand': readableOn(brand),
    '--color-focus': brand,
  }
}
