import type { FeedbackTheme, FeedbackPosition } from './types'

export interface ThemeColors {
  background: string
  surface: string
  surfaceHover: string
  border: string
  borderFocus: string
  text: string
  textMuted: string
  textPlaceholder: string
  overlay: string
  error: string
  errorBg: string
  success: string
  inputBg: string
  attachBg: string
  attachBorder: string
}

export const LIGHT_THEME: ThemeColors = {
  background: '#FFFFFF',
  surface: '#F5F3EF',
  surfaceHover: '#EDE9E3',
  border: 'rgba(0,0,0,0.12)',
  borderFocus: '', // set from accentColor
  text: '#1A1A1A',
  textMuted: '#6B6560',
  textPlaceholder: '#9B9590',
  overlay: 'rgba(0,0,0,0.45)',
  error: '#D64545',
  errorBg: 'rgba(214,69,69,0.08)',
  // WCAG AA: was #2D9D6F (~3.5:1 against white). Bumped to a deeper
  // green that clears 4.5:1 for the small success-body text.
  success: '#1F7A56',
  inputBg: '#F5F3EF',
  attachBg: '#F0EDE8',
  attachBorder: 'rgba(0,0,0,0.18)',
}

export const DARK_THEME: ThemeColors = {
  background: '#1C1C1E',
  surface: '#2C2C2E',
  surfaceHover: '#3A3A3C',
  border: 'rgba(255,255,255,0.12)',
  borderFocus: '',
  text: '#F2F2F7',
  textMuted: '#AEAEB2',
  textPlaceholder: '#636366',
  overlay: 'rgba(0,0,0,0.6)',
  error: '#FF6B6B',
  errorBg: 'rgba(255,107,107,0.12)',
  success: '#30D158',
  inputBg: '#2C2C2E',
  attachBg: '#2C2C2E',
  attachBorder: 'rgba(255,255,255,0.15)',
}

export function resolveTheme(theme: FeedbackTheme): 'light' | 'dark' {
  if (theme === 'light') return 'light'
  if (theme === 'dark') return 'dark'
  // auto — detect from system
  if (typeof window !== 'undefined') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return 'light'
}

export function getThemeColors(
  theme: FeedbackTheme,
  accentColor: string
): ThemeColors & { accent: string; accentDisabled: string; accentFocusRing: string } {
  const resolved = resolveTheme(theme)
  const base = resolved === 'dark' ? DARK_THEME : LIGHT_THEME

  return {
    ...base,
    borderFocus: accentColor,
    accent: accentColor,
    accentDisabled: resolved === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
    accentFocusRing: `${accentColor}20`, // 12% opacity
  }
}

// Position helpers
export function getButtonPosition(position: FeedbackPosition): React.CSSProperties {
  const base: React.CSSProperties = {
    position: 'fixed',
    zIndex: 9999,
  }

  switch (position) {
    case 'bottom-right':
      return { ...base, bottom: '24px', right: '24px' }
    case 'bottom-left':
      return { ...base, bottom: '24px', left: '24px' }
    case 'top-right':
      return { ...base, top: '24px', right: '24px' }
    case 'top-left':
      return { ...base, top: '24px', left: '24px' }
  }
}

export function getModalPosition(position: FeedbackPosition): React.CSSProperties {
  switch (position) {
    case 'bottom-right':
      return { alignItems: 'flex-end', justifyContent: 'flex-end', padding: '24px' }
    case 'bottom-left':
      return { alignItems: 'flex-end', justifyContent: 'flex-start', padding: '24px' }
    case 'top-right':
      return { alignItems: 'flex-start', justifyContent: 'flex-end', padding: '24px' }
    case 'top-left':
      return { alignItems: 'flex-start', justifyContent: 'flex-start', padding: '24px' }
  }
}

// CSS animation injector
let animationInjected = false
export function injectAnimations(): void {
  if (animationInjected || typeof document === 'undefined') return
  animationInjected = true

  const style = document.createElement('style')
  style.setAttribute('data-devtools-feedback', '')
  style.textContent = `
    @keyframes __dtfb_fadeIn {
      from { opacity: 0; transform: translateY(8px) scale(0.97); }
      to   { opacity: 1; transform: translateY(0)  scale(1); }
    }
    @keyframes __dtfb_fadeOut {
      from { opacity: 1; }
      to   { opacity: 0; }
    }
    @keyframes __dtfb_pulse {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.04); }
    }
    .__dtfb_widget {
      animation: __dtfb_fadeIn 0.18s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    }
    .__dtfb_overlay {
      animation: __dtfb_fadeIn 0.15s ease forwards;
    }
    /* Honor the OS-level reduced-motion preference. WCAG 2.3.3 guidance:
       avoid motion that could trigger vestibular discomfort. We disable
       both the entry animation and any inline transitions inside the
       widget tree. */
    @media (prefers-reduced-motion: reduce) {
      .__dtfb_widget,
      .__dtfb_overlay,
      .__dtfb_widget * {
        animation: none !important;
        transition: none !important;
      }
    }
  `
  document.head.appendChild(style)
}

/**
 * Test-only: reset the injected-state guard. Production callers should
 * never need this — `injectAnimations()` is idempotent. Tests use this to
 * exercise the inject path repeatedly.
 *
 * @internal
 */
export function __resetAnimationsForTest(): void {
  animationInjected = false
  if (typeof document !== 'undefined') {
    const existing = document.querySelectorAll('style[data-devtools-feedback]')
    existing.forEach(node => node.parentNode?.removeChild(node))
  }
}
