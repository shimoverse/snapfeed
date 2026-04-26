/**
 * Tests for src/theme.ts — token shape, CSS variable emission, and the
 * deep-merge semantics of `extendTheme`.
 */

import { describe, it, expect } from 'vitest'
import {
  lightTheme,
  darkTheme,
  themeToCss,
  extendTheme,
} from '../../src/theme'

// ─── themeToCss ──────────────────────────────────────────────────────────────

describe('themeToCss', () => {
  it('produces a :root rule with no scope', () => {
    const css = themeToCss(lightTheme)
    expect(css.startsWith(':root {')).toBe(true)
    expect(css.includes('--snapfeed-color-accent: ')).toBe(true)
  })

  it('uses the supplied scope selector', () => {
    const css = themeToCss(lightTheme, '.my-app')
    expect(css.startsWith('.my-app {')).toBe(true)
    expect(css.includes('--snapfeed-color-accent: ')).toBe(true)
  })

  it('falls back to :root for empty / whitespace scope', () => {
    expect(themeToCss(lightTheme, '').startsWith(':root {')).toBe(true)
    expect(themeToCss(lightTheme, '   ').startsWith(':root {')).toBe(true)
  })

  it('emits every variable under the --snapfeed- prefix', () => {
    const css = themeToCss(lightTheme)
    const varNames = css
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.startsWith('--'))
      .map(l => l.split(':')[0])
    expect(varNames.length).toBeGreaterThan(0)
    for (const name of varNames) {
      expect(name?.startsWith('--snapfeed-')).toBe(true)
    }
  })

  it('emits the canonical color/radius/spacing/shadow/z/duration/easing names', () => {
    const css = themeToCss(lightTheme)
    // A representative sample of each group's expected naming.
    const expectedNames = [
      '--snapfeed-color-accent',
      '--snapfeed-color-accent-foreground',
      '--snapfeed-color-background',
      '--snapfeed-color-foreground',
      '--snapfeed-color-muted',
      '--snapfeed-color-border',
      '--snapfeed-color-surface',
      '--snapfeed-color-danger',
      '--snapfeed-color-warning',
      '--snapfeed-color-success',
      '--snapfeed-radius-sm',
      '--snapfeed-radius-md',
      '--snapfeed-radius-lg',
      '--snapfeed-radius-pill',
      '--snapfeed-spacing-xs',
      '--snapfeed-spacing-lg',
      '--snapfeed-font-body',
      '--snapfeed-font-mono',
      '--snapfeed-font-size-md',
      '--snapfeed-shadow-md',
      '--snapfeed-z-trigger',
      '--snapfeed-z-modal',
      '--snapfeed-z-toast',
      '--snapfeed-duration-fast',
      '--snapfeed-duration-med',
      '--snapfeed-easing',
    ]
    for (const name of expectedNames) {
      expect(css.includes(`${name}: `)).toBe(true)
    }
  })

  it('does not emit a CSS variable for `motion.reducedMotion` (it is metadata)', () => {
    const css = themeToCss(lightTheme)
    expect(css.includes('reduced-motion')).toBe(false)
    expect(css.includes('reducedMotion')).toBe(false)
  })

  it('produces distinct output for light vs dark', () => {
    expect(themeToCss(lightTheme)).not.toEqual(themeToCss(darkTheme))
  })
})

// ─── extendTheme ─────────────────────────────────────────────────────────────

describe('extendTheme', () => {
  it('overrides only the touched leaf', () => {
    const out = extendTheme(lightTheme, { colors: { accent: 'red' } })
    expect(out.colors.accent).toBe('red')
    // Untouched siblings preserved
    expect(out.colors.background).toBe(lightTheme.colors.background)
    expect(out.colors.foreground).toBe(lightTheme.colors.foreground)
    // Untouched groups preserved
    expect(out.radii.md).toBe(lightTheme.radii.md)
    expect(out.spacing.lg).toBe(lightTheme.spacing.lg)
  })

  it('does not mutate the base theme', () => {
    const before = JSON.stringify(lightTheme)
    extendTheme(lightTheme, {
      colors: { accent: 'red', background: 'blue' },
      radii: { md: '99px' },
    })
    const after = JSON.stringify(lightTheme)
    expect(after).toBe(before)
  })

  it('returns a new object identity (no shared refs at the leaf groups)', () => {
    const out = extendTheme(lightTheme, { colors: { accent: 'red' } })
    expect(out).not.toBe(lightTheme)
    expect(out.colors).not.toBe(lightTheme.colors)
    // Other groups should also be cloned, so future mutation can't leak.
    expect(out.radii).not.toBe(lightTheme.radii)
  })

  it('supports nested overrides on multiple groups at once', () => {
    const out = extendTheme(lightTheme, {
      colors: { accent: '#000', danger: '#f00' },
      spacing: { md: '20px' },
      motion: { reducedMotion: 'never-animate' },
    })
    expect(out.colors.accent).toBe('#000')
    expect(out.colors.danger).toBe('#f00')
    expect(out.colors.background).toBe(lightTheme.colors.background)
    expect(out.spacing.md).toBe('20px')
    expect(out.spacing.lg).toBe(lightTheme.spacing.lg)
    expect(out.motion.reducedMotion).toBe('never-animate')
    expect(out.motion.easing).toBe(lightTheme.motion.easing)
  })

  it('ignores undefined overrides instead of clobbering', () => {
    const out = extendTheme(lightTheme, {
      colors: { accent: undefined as unknown as string },
    })
    expect(out.colors.accent).toBe(lightTheme.colors.accent)
  })
})
