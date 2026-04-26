'use client'

/**
 * snapfeed/headless — Compound components.
 *
 * Each component is a thin styleable primitive that reads from
 * `useFeedbackContext()` (open/close/submit) and `useFeedbackWidget()`
 * (form state). Consumers can:
 *   - Use them as-is
 *   - Override appearance via `className` / `style`
 *   - Replace any one of them via <FeedbackComponentsProvider>
 *   - Bypass entirely with <FeedbackHeadless> render-prop
 *
 * Styling philosophy: built-ins paint the bare minimum so the widget is
 * usable out of the box. They prefer CSS custom properties under the
 * `--snapfeed-*` namespace, so a theme override on a parent element will
 * cascade in.
 */

import * as React from 'react'
import { useFeedbackContext } from '../FeedbackProvider'
import type { FeedbackCategory } from '../types'
import { useFeedbackWidget } from './useFeedbackWidget'
import { useFeedbackComponents } from './swappable'

// ─── Built-in category list (matches the default widget) ─────────────────────

const DEFAULT_CATEGORIES: Array<{ id: FeedbackCategory; label: string; emoji: string }> = [
  { id: 'bug', label: 'Bug', emoji: '🐛' },
  { id: 'idea', label: 'Idea', emoji: '💡' },
  { id: 'question', label: 'Question', emoji: '❓' },
  { id: 'praise', label: 'Praise', emoji: '🙌' },
  { id: 'other', label: 'Other', emoji: '📝' },
]

// ─── FeedbackRoot ────────────────────────────────────────────────────────────

export interface FeedbackRootProps {
  children: React.ReactNode
  className?: string
  style?: React.CSSProperties
}

/**
 * Scope container for headless widgets. Renders a wrapper div whose only
 * job is to give consumers a place to attach a `className` / theme scope.
 * Has no behaviour itself.
 */
export function FeedbackRoot(props: FeedbackRootProps): JSX.Element {
  return (
    <div className={props.className} style={props.style} data-snapfeed-root>
      {props.children}
    </div>
  )
}

// ─── FeedbackTrigger ─────────────────────────────────────────────────────────

export interface FeedbackTriggerProps {
  children?: React.ReactNode
  className?: string
  style?: React.CSSProperties
  /**
   * Render-as-child (Radix-style). When true, the single child element is
   * cloned with the trigger's `onClick` merged in instead of rendering a
   * `<button>`. Lets consumers wire their own design-system button.
   */
  asChild?: boolean
}

export function FeedbackTrigger(props: FeedbackTriggerProps): JSX.Element {
  const { open } = useFeedbackContext()
  const components = useFeedbackComponents()

  // Honor a swap from <FeedbackComponentsProvider>
  if (components.Trigger) {
    const Custom = components.Trigger
    return <Custom onOpen={open}>{props.children}</Custom>
  }

  if (props.asChild) {
    const child = React.Children.only(props.children) as React.ReactElement<
      Record<string, unknown>
    >
    const childOnClick = child.props.onClick as
      | ((e: React.MouseEvent) => void)
      | undefined
    return React.cloneElement(child, {
      onClick: (e: React.MouseEvent) => {
        childOnClick?.(e)
        if (!e.defaultPrevented) open()
      },
    })
  }

  return (
    <button
      type="button"
      onClick={open}
      className={props.className}
      style={{
        background: 'var(--snapfeed-color-accent)',
        color: 'var(--snapfeed-color-accent-foreground)',
        border: 'none',
        borderRadius: 'var(--snapfeed-radius-pill)',
        padding: 'var(--snapfeed-spacing-sm) var(--snapfeed-spacing-lg)',
        font: 'inherit',
        cursor: 'pointer',
        ...props.style,
      }}
    >
      {props.children ?? 'Feedback'}
    </button>
  )
}

// ─── FeedbackModal ───────────────────────────────────────────────────────────

export interface FeedbackModalProps {
  children: React.ReactNode
  className?: string
  style?: React.CSSProperties
  onClose?: () => void
}

/**
 * Renders nothing until widget state is `open`. Provides an overlay + panel
 * shell with sensible defaults; consumers compose form pieces inside it.
 *
 * ESC closes the modal (calls `onClose` if provided, else the context
 * `close()`). Click on the overlay closes too.
 */
export function FeedbackModal(props: FeedbackModalProps): JSX.Element | null {
  const { state, close } = useFeedbackWidget()
  const components = useFeedbackComponents()

  const onClose = React.useCallback(() => {
    props.onClose?.()
    if (!props.onClose) close()
  }, [props, close])

  // ESC handler — only attached when the modal is mounted, removed on close.
  React.useEffect(() => {
    if (state !== 'open' && state !== 'submitting' && state !== 'error') return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    if (typeof document === 'undefined') return undefined
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [state, onClose])

  // Treat success/idle as "not visible" — success has its own brief flash
  // handled by FeedbackSuccess.
  const visible = state === 'open' || state === 'submitting' || state === 'error'
  if (!visible) return null

  if (components.Modal) {
    const Custom = components.Modal
    return <Custom onClose={onClose}>{props.children}</Custom>
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={e => {
        if (e.target === e.currentTarget) onClose()
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 'var(--snapfeed-z-modal, 10000)' as unknown as number,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--snapfeed-spacing-xl)',
      }}
    >
      <div
        className={props.className}
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--snapfeed-color-background)',
          color: 'var(--snapfeed-color-foreground)',
          borderRadius: 'var(--snapfeed-radius-lg)',
          boxShadow: 'var(--snapfeed-shadow-lg)',
          padding: 'var(--snapfeed-spacing-lg)',
          width: '100%',
          maxWidth: '420px',
          fontFamily: 'var(--snapfeed-font-body)',
          ...props.style,
        }}
      >
        {props.children}
      </div>
    </div>
  )
}

// ─── FeedbackTextarea ────────────────────────────────────────────────────────

export interface FeedbackTextareaProps {
  placeholder?: string
  rows?: number
  className?: string
  style?: React.CSSProperties
  autoFocus?: boolean
}

export function FeedbackTextarea(props: FeedbackTextareaProps): JSX.Element {
  const { form } = useFeedbackWidget()
  const components = useFeedbackComponents()

  if (components.Textarea) {
    const Custom = components.Textarea
    return (
      <Custom
        value={form.text}
        onChange={form.setText}
        placeholder={props.placeholder}
      />
    )
  }

  return (
    <textarea
      autoFocus={props.autoFocus}
      value={form.text}
      onChange={e => form.setText(e.target.value)}
      placeholder={props.placeholder ?? 'What would you like to share?'}
      rows={props.rows ?? 4}
      className={props.className}
      style={{
        width: '100%',
        resize: 'vertical',
        border: '1px solid var(--snapfeed-color-border)',
        borderRadius: 'var(--snapfeed-radius-md)',
        padding: 'var(--snapfeed-spacing-md)',
        fontFamily: 'var(--snapfeed-font-body)',
        fontSize: 'var(--snapfeed-font-size-md)',
        color: 'var(--snapfeed-color-foreground)',
        background: 'var(--snapfeed-color-surface)',
        outline: 'none',
        boxSizing: 'border-box',
        ...props.style,
      }}
    />
  )
}

// ─── FeedbackCategorySelect ──────────────────────────────────────────────────

export interface FeedbackCategorySelectProps {
  categories?: Array<{ id: string; label: string; emoji?: string }>
  className?: string
  style?: React.CSSProperties
}

export function FeedbackCategorySelect(
  props: FeedbackCategorySelectProps
): JSX.Element {
  const { form } = useFeedbackWidget()
  const components = useFeedbackComponents()
  const cats = props.categories ?? DEFAULT_CATEGORIES

  return (
    <div
      className={props.className}
      style={{
        display: 'flex',
        gap: 'var(--snapfeed-spacing-xs)',
        flexWrap: 'wrap',
        ...props.style,
      }}
    >
      {cats.map(cat => {
        const selected = form.category === (cat.id as FeedbackCategory)
        const onClick = () =>
          form.setCategory(
            selected ? null : (cat.id as FeedbackCategory)
          )

        if (components.CategoryChip) {
          const Custom = components.CategoryChip
          return (
            <Custom
              key={cat.id}
              label={cat.label}
              emoji={cat.emoji ?? ''}
              selected={selected}
              onClick={onClick}
            />
          )
        }

        return (
          <button
            key={cat.id}
            type="button"
            onClick={onClick}
            aria-pressed={selected}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: 'var(--snapfeed-spacing-xs) var(--snapfeed-spacing-md)',
              borderRadius: 'var(--snapfeed-radius-pill)',
              border: `1px solid ${selected ? 'var(--snapfeed-color-accent)' : 'var(--snapfeed-color-border)'}`,
              background: selected
                ? 'var(--snapfeed-color-accent)'
                : 'var(--snapfeed-color-surface)',
              color: selected
                ? 'var(--snapfeed-color-accent-foreground)'
                : 'var(--snapfeed-color-muted)',
              fontFamily: 'inherit',
              fontSize: 'var(--snapfeed-font-size-sm)',
              cursor: 'pointer',
            }}
          >
            {cat.emoji && <span aria-hidden>{cat.emoji}</span>}
            <span>{cat.label}</span>
          </button>
        )
      })}
    </div>
  )
}

// ─── FeedbackScreenshotPreview ───────────────────────────────────────────────

export interface FeedbackScreenshotPreviewProps {
  className?: string
  style?: React.CSSProperties
}

export function FeedbackScreenshotPreview(
  props: FeedbackScreenshotPreviewProps
): JSX.Element | null {
  const { form } = useFeedbackWidget()
  if (!form.screenshot) return null
  const src = `data:${form.screenshot.mimeType};base64,${form.screenshot.base64}`
  return (
    <div
      className={props.className}
      style={{ position: 'relative', display: 'inline-block', ...props.style }}
    >
      <img
        src={src}
        alt="Attached screenshot"
        style={{
          maxHeight: '120px',
          maxWidth: '100%',
          borderRadius: 'var(--snapfeed-radius-md)',
          border: '1px solid var(--snapfeed-color-border)',
          objectFit: 'cover',
          display: 'block',
        }}
      />
      <button
        type="button"
        onClick={() => form.setScreenshot(null)}
        aria-label="Remove screenshot"
        style={{
          position: 'absolute',
          top: '-8px',
          right: '-8px',
          background: 'var(--snapfeed-color-danger)',
          color: '#fff',
          border: 'none',
          borderRadius: 'var(--snapfeed-radius-pill)',
          width: '20px',
          height: '20px',
          cursor: 'pointer',
          fontSize: '14px',
          lineHeight: 1,
        }}
      >
        ×
      </button>
    </div>
  )
}

// ─── FeedbackSubmitButton ────────────────────────────────────────────────────

export interface FeedbackSubmitButtonProps {
  children?: React.ReactNode
  className?: string
  style?: React.CSSProperties
}

export function FeedbackSubmitButton(
  props: FeedbackSubmitButtonProps
): JSX.Element {
  const { state, submit, form } = useFeedbackWidget()
  const components = useFeedbackComponents()

  const loading = state === 'submitting'
  const disabled = loading || form.text.trim().length === 0

  // Submit handler swallows the rejection so React doesn't log an
  // unhandled-promise warning — `state === 'error'` already surfaces it.
  const onClick = () => {
    void submit().catch(() => undefined)
  }

  if (components.SubmitButton) {
    const Custom = components.SubmitButton
    return (
      <Custom onClick={onClick} loading={loading} disabled={disabled}>
        {props.children ?? (loading ? 'Sending…' : 'Send feedback')}
      </Custom>
    )
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={props.className}
      style={{
        background: 'var(--snapfeed-color-accent)',
        color: 'var(--snapfeed-color-accent-foreground)',
        border: 'none',
        borderRadius: 'var(--snapfeed-radius-md)',
        padding: 'var(--snapfeed-spacing-sm) var(--snapfeed-spacing-lg)',
        fontFamily: 'inherit',
        fontSize: 'var(--snapfeed-font-size-md)',
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        ...props.style,
      }}
    >
      {props.children ?? (loading ? 'Sending…' : 'Send feedback')}
    </button>
  )
}

// ─── FeedbackError ───────────────────────────────────────────────────────────

export interface FeedbackErrorProps {
  className?: string
  style?: React.CSSProperties
}

export function FeedbackError(props: FeedbackErrorProps): JSX.Element | null {
  const { state, error } = useFeedbackWidget()
  if (state !== 'error' || !error) return null
  return (
    <div
      role="alert"
      className={props.className}
      style={{
        color: 'var(--snapfeed-color-danger)',
        fontSize: 'var(--snapfeed-font-size-sm)',
        background: 'rgba(214,69,69,0.08)',
        borderRadius: 'var(--snapfeed-radius-md)',
        padding: 'var(--snapfeed-spacing-sm) var(--snapfeed-spacing-md)',
        ...props.style,
      }}
    >
      {error.message}
    </div>
  )
}

// ─── FeedbackSuccess ─────────────────────────────────────────────────────────

export interface FeedbackSuccessProps {
  className?: string
  style?: React.CSSProperties
}

export function FeedbackSuccess(props: FeedbackSuccessProps): JSX.Element | null {
  const { state } = useFeedbackWidget()
  if (state !== 'success') return null
  return (
    <div
      role="status"
      className={props.className}
      style={{
        color: 'var(--snapfeed-color-success)',
        fontSize: 'var(--snapfeed-font-size-md)',
        textAlign: 'center',
        padding: 'var(--snapfeed-spacing-md)',
        ...props.style,
      }}
    >
      Thanks — your feedback was sent.
    </div>
  )
}
