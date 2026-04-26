/**
 * snapfeed — Theme token system.
 *
 * Design intent:
 * - Tokens are POJOs in TypeScript so they are type-safe and tree-shakable.
 * - Each token maps 1:1 to a CSS custom property under the `--snapfeed-*`
 *   namespace. Consumers can override any token in their own stylesheet
 *   without touching React (Level 1 customization).
 * - Components in `snapfeed/headless` read tokens through CSS variables, so
 *   live theme changes (e.g. dark-mode toggles) propagate without a re-render.
 *
 * Naming convention for CSS variables:
 *   colors.accent       -> --snapfeed-color-accent
 *   radii.md            -> --snapfeed-radius-md
 *   spacing.lg          -> --snapfeed-spacing-lg
 *   shadows.md          -> --snapfeed-shadow-md
 *   zIndex.modal        -> --snapfeed-z-modal
 *   motion.durationFast -> --snapfeed-duration-fast
 *   motion.easing       -> --snapfeed-easing
 *   fonts.body          -> --snapfeed-font-body
 *   fontSizes.md        -> --snapfeed-font-size-md
 */

export interface SnapfeedTheme {
  colors: {
    /** Primary CTA, focus rings */
    accent: string
    /** Text color used on top of `accent` (auto-contrast hint) */
    accentForeground: string
    /** Modal background */
    background: string
    /** Primary text */
    foreground: string
    /** Secondary text */
    muted: string
    border: string
    /** Cards, inputs */
    surface: string
    /** Bug category, errors */
    danger: string
    /** Caution states */
    warning: string
    /** Success toast */
    success: string
  }
  radii: { sm: string; md: string; lg: string; pill: string }
  spacing: { xs: string; sm: string; md: string; lg: string; xl: string }
  fonts: { body: string; mono: string }
  fontSizes: { xs: string; sm: string; md: string; lg: string; xl: string }
  shadows: { sm: string; md: string; lg: string }
  zIndex: { trigger: number; modal: number; toast: number }
  motion: {
    durationFast: string
    durationMed: string
    easing: string
    /**
     * How the widget responds to `prefers-reduced-motion`.
     *  - 'respect': follow the user's OS setting (recommended default)
     *  - 'always-animate': ignore user setting (use sparingly)
     *  - 'never-animate': skip all transitions/animations
     */
    reducedMotion: 'respect' | 'always-animate' | 'never-animate'
  }
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K]
}

// ─── Default themes ──────────────────────────────────────────────────────────

const SHARED: Pick<
  SnapfeedTheme,
  'radii' | 'spacing' | 'fonts' | 'fontSizes' | 'shadows' | 'zIndex' | 'motion'
> = {
  radii: { sm: '6px', md: '10px', lg: '16px', pill: '9999px' },
  spacing: { xs: '4px', sm: '8px', md: '12px', lg: '16px', xl: '24px' },
  fonts: {
    body:
      'system-ui, -apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif',
    mono:
      'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
  },
  fontSizes: {
    xs: '11px',
    sm: '12px',
    md: '14px',
    lg: '15px',
    xl: '18px',
  },
  shadows: {
    sm: '0 1px 2px rgba(0,0,0,0.06)',
    md: '0 4px 16px rgba(0,0,0,0.18)',
    lg: '0 12px 48px rgba(0,0,0,0.22), 0 0 0 1px rgba(0,0,0,0.06)',
  },
  zIndex: { trigger: 9999, modal: 10000, toast: 10001 },
  motion: {
    durationFast: '120ms',
    durationMed: '180ms',
    easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
    reducedMotion: 'respect',
  },
}

export const lightTheme: SnapfeedTheme = {
  colors: {
    // Deeper terra-cotta — ~4.7:1 contrast against white. Earlier value
    // #D4714B was ~3.1:1 (WCAG AA fail). See FeedbackProvider DEFAULT_CONFIG.
    accent: '#B85A36',
    accentForeground: '#FFFFFF',
    background: '#FFFFFF',
    foreground: '#1A1A1A',
    muted: '#6B6560',
    border: 'rgba(0,0,0,0.12)',
    surface: '#F5F3EF',
    danger: '#D64545',
    warning: '#D49A2E',
    success: '#2D9D6F',
  },
  ...SHARED,
}

export const darkTheme: SnapfeedTheme = {
  colors: {
    accent: '#E08B68',
    accentForeground: '#1A1A1A',
    background: '#1C1C1E',
    foreground: '#F2F2F7',
    muted: '#AEAEB2',
    border: 'rgba(255,255,255,0.12)',
    surface: '#2C2C2E',
    danger: '#FF6B6B',
    warning: '#F0C75E',
    success: '#30D158',
  },
  ...SHARED,
  shadows: {
    sm: '0 1px 2px rgba(0,0,0,0.4)',
    md: '0 4px 16px rgba(0,0,0,0.45)',
    lg: '0 12px 48px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.06)',
  },
}

// ─── CSS variable mapping ────────────────────────────────────────────────────

interface VarPair {
  name: string
  value: string | number
}

/**
 * Convert `camelCase` -> `kebab-case`, leaving acronyms alone.
 *  fontSize -> font-size
 *  zIndex   -> z-index
 *  durationFast -> duration-fast
 */
function kebab(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
}

/**
 * Each top-level theme group has a stable CSS-variable prefix. Some groups
 * collapse the group name (e.g. `colors.accent` -> `--snapfeed-color-accent`,
 * not `--snapfeed-colors-accent`) for ergonomics — `color`, `radius`,
 * `spacing`, `shadow` read better singular.
 */
const GROUP_PREFIX: Record<keyof SnapfeedTheme, string> = {
  colors: 'color',
  radii: 'radius',
  spacing: 'spacing',
  fonts: 'font',
  fontSizes: 'font-size',
  shadows: 'shadow',
  zIndex: 'z',
  motion: '', // motion uses bare keys, see below
}

/**
 * `motion` keys map to friendlier variable names than a mechanical kebab pass:
 *   durationFast -> --snapfeed-duration-fast
 *   easing       -> --snapfeed-easing
 *   reducedMotion is metadata, not a CSS var (skipped).
 */
function motionPairs(motion: SnapfeedTheme['motion']): VarPair[] {
  return [
    { name: '--snapfeed-duration-fast', value: motion.durationFast },
    { name: '--snapfeed-duration-med', value: motion.durationMed },
    { name: '--snapfeed-easing', value: motion.easing },
  ]
}

function flatten(theme: SnapfeedTheme): VarPair[] {
  const out: VarPair[] = []
  for (const groupKey of Object.keys(theme) as Array<keyof SnapfeedTheme>) {
    if (groupKey === 'motion') {
      out.push(...motionPairs(theme.motion))
      continue
    }
    const prefix = GROUP_PREFIX[groupKey]
    const group = theme[groupKey] as Record<string, string | number>
    for (const tokenKey of Object.keys(group)) {
      const name = `--snapfeed-${prefix}-${kebab(tokenKey)}`
      out.push({ name, value: group[tokenKey] as string | number })
    }
  }
  return out
}

/**
 * Render a theme as a CSS rule. Pass a `scope` selector to namespace the
 * variables (e.g. `'.my-app'`); omit it for `:root`.
 *
 * The output is intended to be embedded in a `<style>` tag or a stylesheet —
 * it does NOT include the surrounding `<style>` element.
 */
export function themeToCss(theme: SnapfeedTheme, scope?: string): string {
  const selector = scope && scope.trim().length > 0 ? scope : ':root'
  const lines = flatten(theme).map(p => `  ${p.name}: ${p.value};`)
  return `${selector} {\n${lines.join('\n')}\n}`
}

// ─── extendTheme ─────────────────────────────────────────────────────────────

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return (
    typeof v === 'object' &&
    v !== null &&
    !Array.isArray(v) &&
    Object.getPrototypeOf(v) === Object.prototype
  )
}

/**
 * Merge a partial theme override on top of a base theme.
 *
 * Always returns a NEW object — neither `base` nor `override` is mutated.
 * Useful for branding: `extendTheme(lightTheme, { colors: { accent: '#FF0' } })`.
 */
export function extendTheme(
  base: SnapfeedTheme,
  override: DeepPartial<SnapfeedTheme>
): SnapfeedTheme {
  return deepMerge(
    base as unknown as Record<string, unknown>,
    override as Record<string, unknown>
  ) as unknown as SnapfeedTheme
}

function deepMerge<T extends Record<string, unknown>>(
  base: T,
  override: Record<string, unknown>
): T {
  const out: Record<string, unknown> = {}
  // Copy base first, recursing into nested objects so we never share refs
  for (const key of Object.keys(base)) {
    const baseVal = (base as Record<string, unknown>)[key]
    if (isPlainObject(baseVal)) {
      out[key] = deepMerge(
        baseVal as Record<string, unknown>,
        {} // empty override; just clones
      )
    } else {
      out[key] = baseVal
    }
  }
  // Apply overrides
  for (const key of Object.keys(override)) {
    const overrideVal = override[key]
    const baseVal = out[key]
    if (isPlainObject(overrideVal) && isPlainObject(baseVal)) {
      out[key] = deepMerge(
        baseVal as Record<string, unknown>,
        overrideVal as Record<string, unknown>
      )
    } else if (overrideVal !== undefined) {
      out[key] = overrideVal
    }
  }
  return out as T
}
