import { describe, expect, it } from 'vitest'
import {
  ACCENT_PRESETS, ACCENT_VARS, accentTokens, contrastRatio, DEFAULT_ACCENT, DEFAULT_APPEARANCE, isDefaultAppearance, isHexColor, normalizeAppearance,
  readableOn, resolveTheme,
} from './appearance'

describe('appearance preferences', () => {
  it('defaults to the light theme with the lime accent, so nobody is switched to a new look', () => {
    expect(DEFAULT_APPEARANCE).toEqual({ mode: 'light', accent: '#c7f34a' })
    expect(normalizeAppearance(null)).toEqual(DEFAULT_APPEARANCE)
    expect(normalizeAppearance(undefined)).toEqual(DEFAULT_APPEARANCE)
    expect(normalizeAppearance({})).toEqual(DEFAULT_APPEARANCE)
    expect(isDefaultAppearance(DEFAULT_APPEARANCE)).toBe(true)
    expect(isDefaultAppearance({ mode: 'dark', accent: DEFAULT_ACCENT })).toBe(false)
  })

  it('keeps valid choices and ignores anything unusable', () => {
    expect(normalizeAppearance({ mode: 'dark', accent: '#A78BFA' })).toEqual({ mode: 'dark', accent: '#a78bfa' })
    expect(normalizeAppearance('{"mode":"system","accent":"#2dd4bf"}')).toEqual({ mode: 'system', accent: '#2dd4bf' })
    expect(normalizeAppearance({ mode: 'neon', accent: 'red' })).toEqual(DEFAULT_APPEARANCE)
    expect(normalizeAppearance({ mode: 'dark', accent: 'javascript:alert(1)' })).toEqual({ mode: 'dark', accent: DEFAULT_ACCENT })
    expect(normalizeAppearance('not json')).toEqual(DEFAULT_APPEARANCE)
    expect(normalizeAppearance(42)).toEqual(DEFAULT_APPEARANCE)
  })

  it('validates hex colours strictly (they end up in a style attribute)', () => {
    expect(isHexColor('#00ff7f')).toBe(true)
    for (const bad of ['#fff', '00ff7f', '#00ff7g', '#00ff7f; background: red', 'rgb(0,0,0)', '', null, 12]) expect(isHexColor(bad), String(bad)).toBe(false)
  })

  it('resolves System to whatever the device prefers', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })
})

describe('accent colours', () => {
  const customs = ['#ff0000', '#123456', '#000000', '#ffffff', '#808080', '#fefefe', '#0a0a0a', '#7c3aed', '#facc15', '#00ffff']
  const accents = [...ACCENT_PRESETS.filter((p) => p.hex !== DEFAULT_ACCENT).map((p) => p.hex as string), ...customs]

  it('lime is the stylesheet default: choosing it sets nothing, in either theme', () => {
    expect(accentTokens(DEFAULT_ACCENT, 'light')).toEqual({})
    expect(accentTokens('#C7F34A', 'dark')).toEqual({})
    expect(accentTokens('not a colour', 'light')).toEqual({})
  })

  it('offers lime, violet, blue, teal, orange and rose', () => {
    expect(ACCENT_PRESETS.map((p) => p.label)).toEqual(['Lime Green', 'Violet', 'Blue', 'Teal', 'Orange', 'Rose'])
    expect(new Set(ACCENT_PRESETS.map((p) => p.hex)).size).toBe(6)
  })

  it.each(['light', 'dark'] as const)('every accent stays readable in the %s theme: text on accent, on the primary fill and on the soft wash', (theme) => {
    for (const hex of accents) {
      const t = accentTokens(hex, theme)
      expect(t['--color-accent'], hex).toBe(hex)
      expect(contrastRatio(t['--color-on-accent']!, t['--color-accent']!), `${hex} on-accent`).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(t['--color-on-brand']!, t['--color-brand']!), `${hex} on-brand`).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(t['--color-accent-ink']!, t['--color-accent-soft']!), `${hex} accent-ink`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('the primary fill is distinct from the page in both themes, so buttons and the selected nav item stand out', () => {
    for (const hex of accents) {
      expect(contrastRatio(accentTokens(hex, 'light')['--color-brand']!, '#ffffff'), `${hex} light`).toBeGreaterThanOrEqual(4.5) // white card
      expect(contrastRatio(accentTokens(hex, 'dark')['--color-brand']!, '#17171b'), `${hex} dark`).toBeGreaterThanOrEqual(4.5) // dark card
    }
  })

  it('only ever sets accent variables - status colours (success, warning, danger, cancelled) are never touched', () => {
    for (const hex of accents) for (const theme of ['light', 'dark'] as const) {
      for (const key of Object.keys(accentTokens(hex, theme))) expect(ACCENT_VARS as readonly string[], key).toContain(key)
    }
    expect(ACCENT_VARS.join(' ')).not.toMatch(/success|warning|danger|risk|caution|ok\b/)
  })

  it('picks dark text on light colours and white text on dark ones', () => {
    expect(readableOn('#c7f34a')).toBe('#17171b')
    expect(readableOn('#ffffff')).toBe('#17171b')
    expect(readableOn('#1e1b4b')).toBe('#ffffff')
    expect(readableOn('#000000')).toBe('#ffffff')
  })

  it('measures contrast like WCAG', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0)
    expect(contrastRatio('#777777', '#777777')).toBe(1)
  })
})
