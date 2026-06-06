'use client'

import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useId,
  useMemo,
} from 'react'
import { useFeedbackContext } from './FeedbackProvider'
import { fileToScreenshot, captureScreenshot, extractImageFromClipboard } from './screenshot'
import { getThemeColors, getModalPosition, injectAnimations, resolveTheme } from './styles'
import { AnnotationCanvas } from './AnnotationCanvas'
import { mergeMessages, formatMessage } from './messages'
import type {
  FeedbackPayload,
  FeedbackScreenshot,
  FeedbackCategory,
  FeedbackMessages,
  FeedbackUser,
  FeedbackDeliveryRecord,
} from './types'
import type { ThemeColors } from './styles'

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Hard cap on textarea length. Matches the server handler's default
 * `maxPayloadBytes` (10KB) at ~5KB of text leaving headroom for metadata
 * and the JSON envelope. Soft counter appears past 70% of this.
 */
const MAX_TEXT_LENGTH = 5000

// ─── Category config ──────────────────────────────────────────────────────────

/**
 * Category emojis are visual; the labels are i18n-driven. We resolve the
 * label off `messages.category*` at render time so a host can fully
 * translate the chips without forking the file.
 */
const CATEGORY_EMOJI: Record<FeedbackCategory, string> = {
  bug: '🐛',
  idea: '💡',
  question: '❓',
  praise: '🙌',
  other: '📝',
}

function buildCategories(
  messages: FeedbackMessages
): Array<{ id: FeedbackCategory; label: string; emoji: string }> {
  return [
    { id: 'bug', label: messages.categoryBug, emoji: CATEGORY_EMOJI.bug },
    { id: 'idea', label: messages.categoryIdea, emoji: CATEGORY_EMOJI.idea },
    {
      id: 'question',
      label: messages.categoryQuestion,
      emoji: CATEGORY_EMOJI.question,
    },
    {
      id: 'praise',
      label: messages.categoryPraise,
      emoji: CATEGORY_EMOJI.praise,
    },
    { id: 'other', label: messages.categoryOther, emoji: CATEGORY_EMOJI.other },
  ]
}

// ─── Pen/Edit Icon ────────────────────────────────────────────────────────────

function PenIcon({ size = 14, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  )
}

function CloseIcon({ size = 18, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  )
}

function CheckIcon({ size = 40, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      style={{ display: 'block', margin: '0 auto 8px' }}
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function ImageIcon({ size = 14, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  )
}

// ─── Main Widget ──────────────────────────────────────────────────────────────

export function FeedbackWidget() {
  const ctx = useFeedbackContext()
  const { isOpen, close, submit, config, lastResults } = ctx
  const { appName, position, theme, accentColor } = config

  // Resolve user-overrideable strings once per render; cheap because
  // mergeMessages just spreads two objects.
  const messages = useMemo(
    () => mergeMessages(config.messages),
    [config.messages]
  )

  // Categories are derived from the resolved messages so a host can
  // translate the chip labels without forking this file.
  const categories = useMemo(() => buildCategories(messages), [messages])

  // Persistence flags (default true unless explicitly disabled).
  const persistDraft = config.persistDraft !== false
  const persistIdentity = config.persistIdentity !== false

  // Back-channel hook for the inline "set name" form. Cast because
  // the public FeedbackContextValue type does not (yet) include this in
  // the v0.5.x surface — promoted in v0.6.
  const setIdentity = (
    ctx as unknown as {
      __setIdentity?: (user: FeedbackUser | undefined) => void
    }
  ).__setIdentity

  const [text, setText] = useState('')
  const [screenshot, setScreenshot] = useState<FeedbackScreenshot | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [capturingAuto, setCapturingAuto] = useState(false)
  const [category, setCategory] = useState<FeedbackCategory | null>(null)
  const [annotating, setAnnotating] = useState(false)
  const [identityEditing, setIdentityEditing] = useState(false)
  const [identityDraft, setIdentityDraft] = useState({ name: '', email: '' })
  const [confirmDiscard, setConfirmDiscard] = useState(false)

  const fileRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const modalRef = useRef<HTMLDivElement>(null)
  const successCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevFocusRef = useRef<HTMLElement | null>(null)

  // Stable IDs for ARIA wiring (heading <-> dialog, label <-> textarea).
  const titleId = useId()
  const textareaLabelId = useId()
  const textareaId = useId()

  // Page title is read into state on open instead of during render — this
  // keeps SSR/hydration consistent (server has no `document.title`) and
  // avoids tearing if the title changes while the modal is open.
  const [pageTitle, setPageTitle] = useState('')

  const colors = getThemeColors(theme, accentColor)
  const resolvedTheme = resolveTheme(theme)

  // Inject CSS animations once
  useEffect(() => {
    injectAnimations()
  }, [])

  // Auto-screenshot when widget opens
  useEffect(() => {
    if (!isOpen || !config.autoScreenshot) return
    let cancelled = false

    async function doCapture() {
      setCapturingAuto(true)
      try {
        const shot = await captureScreenshot()
        if (!cancelled && shot) {
          setScreenshot(shot)
          setImagePreview(`data:${shot.mimeType};base64,${shot.base64}`)
        }
      } finally {
        if (!cancelled) setCapturingAuto(false)
      }
    }

    // Small delay so the modal doesn't appear in the screenshot
    const timer = setTimeout(doCapture, 150)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [isOpen, config.autoScreenshot])

  // Capture document.title once on open so render stays SSR-safe and we
  // don't tear if the host page mutates document.title while the modal is
  // visible.
  useEffect(() => {
    if (!isOpen) return
    if (typeof document !== 'undefined') {
      setPageTitle(document.title)
    }
  }, [isOpen])

  // Focus management:
  //   - On open, remember what was focused so we can restore on close.
  //   - Focus the textarea inside the modal.
  //   - On close, return focus to the original element if it still exists.
  useEffect(() => {
    if (isOpen) {
      // Remember the previously-focused element so close can restore it.
      if (typeof document !== 'undefined') {
        prevFocusRef.current = document.activeElement as HTMLElement | null
      }
      // Defer focus by a frame so the modal is mounted in the DOM.
      const id = window.setTimeout(() => {
        textareaRef.current?.focus()
      }, 0)
      return () => window.clearTimeout(id)
    }
    // On close: restore focus to whatever was focused before open.
    const prev = prevFocusRef.current
    prevFocusRef.current = null
    if (prev && typeof prev.focus === 'function') {
      // Best-effort: the element may have been removed from the DOM.
      try {
        prev.focus()
      } catch {
        /* ignore */
      }
    }
    return undefined
  }, [isOpen])

  // Reset state when closed. Also clear any pending success-close timer so
  // a quick close+reopen can't fire a stale handleClose.
  //
  // Draft persistence: when `persistDraft` is true (default) and the user
  // closes WITHOUT submitting, we keep `text`/`category` in sessionStorage
  // so the next open restores their draft. We still wipe the screenshot and
  // error/submitted flags — those are session-local UI state, not content.
  useEffect(() => {
    if (!isOpen) {
      // Small delay to allow exit animation
      const timer = setTimeout(() => {
        if (!persistDraft) {
          // Legacy behavior: nuke everything on close.
          setText('')
          setCategory(null)
        }
        setScreenshot(null)
        setImagePreview(null)
        setError(null)
        setSubmitted(false)
        setAnnotating(false)
        setConfirmDiscard(false)
      }, 200)
      return () => clearTimeout(timer)
    }
    // Re-opening: kill any leftover success-close timer from a prior cycle.
    if (successCloseTimerRef.current !== null) {
      clearTimeout(successCloseTimerRef.current)
      successCloseTimerRef.current = null
    }
    return undefined
  }, [isOpen, persistDraft])

  // ─── Draft persistence (sessionStorage, keyed by pageUrl) ────────────────
  //
  // We key by pageUrl so a tester writing feedback on /dashboard doesn't see
  // their unrelated /settings draft pop in. Cleared on successful submit.
  const draftKey =
    typeof window !== 'undefined'
      ? `snapfeed_draft_${window.location.pathname}`
      : 'snapfeed_draft'

  // Restore on open
  useEffect(() => {
    if (!isOpen || !persistDraft || typeof window === 'undefined') return
    try {
      const raw = window.sessionStorage.getItem(draftKey)
      if (!raw) return
      const parsed = JSON.parse(raw) as {
        text?: string
        category?: FeedbackCategory | null
      }
      if (parsed.text) setText(parsed.text)
      if (parsed.category) setCategory(parsed.category)
    } catch {
      /* swallow malformed JSON or QuotaExceeded */
    }
    // Run once per open; do NOT depend on text/category or we'll fight the user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, persistDraft, draftKey])

  // Persist on every change to text/category while open
  useEffect(() => {
    if (!persistDraft || typeof window === 'undefined') return
    if (!isOpen) return
    try {
      if (!text && !category) {
        window.sessionStorage.removeItem(draftKey)
      } else {
        window.sessionStorage.setItem(
          draftKey,
          JSON.stringify({ text, category })
        )
      }
    } catch {
      /* sessionStorage may be full or disabled */
    }
  }, [text, category, isOpen, persistDraft, draftKey])

  // Hydrate the identity-edit fields from the merged user (set once when
  // entering edit mode rather than on every keystroke).
  useEffect(() => {
    if (identityEditing) {
      setIdentityDraft({
        name: config.user?.name ?? '',
        email: config.user?.email ?? '',
      })
    }
  }, [identityEditing, config.user?.name, config.user?.email])

  // Always clear any pending success-close timer on unmount.
  useEffect(() => {
    return () => {
      if (successCloseTimerRef.current !== null) {
        clearTimeout(successCloseTimerRef.current)
        successCloseTimerRef.current = null
      }
    }
  }, [])

  // Global paste handler
  useEffect(() => {
    if (!isOpen) return

    function onGlobalPaste(e: ClipboardEvent) {
      const file = extractImageFromClipboard(e)
      if (!file) return
      e.preventDefault()
      handleImageFile(file)
    }

    document.addEventListener('paste', onGlobalPaste)
    return () => document.removeEventListener('paste', onGlobalPaste)
  }, [isOpen])

  // Escape to close, Ctrl+Enter to submit, Tab/Shift+Tab focus trap.
  useEffect(() => {
    if (!isOpen) return

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        close()
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        if (text.trim() && !submitting) {
          handleSubmit()
        }
        return
      }
      if (e.key === 'Tab') {
        // Focus trap: cycle within the modal so Tab can never escape.
        const root = modalRef.current
        if (!root) return
        const focusables = getFocusableElements(root)
        if (focusables.length === 0) {
          e.preventDefault()
          return
        }
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        if (!first || !last) return
        const active = document.activeElement as HTMLElement | null
        if (e.shiftKey) {
          if (active === first || !root.contains(active)) {
            e.preventDefault()
            last.focus()
          }
        } else {
          if (active === last || !root.contains(active)) {
            e.preventDefault()
            first.focus()
          }
        }
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [isOpen, text, submitting]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleImageFile(file: File) {
    const reader = new FileReader()
    reader.onload = ev => setImagePreview(ev.target?.result as string)
    reader.readAsDataURL(file)

    fileToScreenshot(file).then(shot => {
      if (shot) setScreenshot(shot)
    })
  }

  function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    handleImageFile(file)
  }

  function handleRemoveImage() {
    setScreenshot(null)
    setImagePreview(null)
    setAnnotating(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  function handleAnnotationDone(annotatedDataUrl: string) {
    setAnnotating(false)
    setImagePreview(annotatedDataUrl)

    // Convert the merged data URL back to a FeedbackScreenshot
    const base64 = annotatedDataUrl.split(',')[1] ?? ''
    setScreenshot({ base64, mimeType: 'image/png' })
  }

  // Drag and drop
  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file && file.type.startsWith('image/')) {
      handleImageFile(file)
    }
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
  }

  const handleClose = useCallback(() => {
    close()
  }, [close])

  function toggleCategory(id: FeedbackCategory) {
    setCategory(prev => (prev === id ? null : id))
  }

  async function handleSubmit() {
    if (!text.trim() || submitting) return
    setSubmitting(true)
    setError(null)

    const pageUrl =
      typeof window !== 'undefined' ? window.location.href : ''
    // Use the title we captured into state on open, with a fallback to a
    // fresh read so a submit fired during the same tick as open still has
    // a value.
    const resolvedPageName =
      pageTitle || (typeof document !== 'undefined' ? document.title : '')

    const partial: Omit<FeedbackPayload, 'timestamp' | 'appName'> = {
      text: text.trim(),
      pageUrl,
      pageName: resolvedPageName,
      user: config.user,
      screenshot: screenshot ?? undefined,
      category: category ?? undefined,
    }

    try {
      await submit(partial)
      setSubmitted(true)
      // Successful submit clears the persisted draft — the user has shipped
      // it, so re-opening on this URL should land on a blank form.
      if (persistDraft && typeof window !== 'undefined') {
        try {
          window.sessionStorage.removeItem(draftKey)
        } catch {
          /* ignore */
        }
      }
      // Auto-close after 2s — UNLESS the user prefers reduced motion, in
      // which case we leave the success card up so they can read it at
      // their own pace and dismiss manually. (The 2s timer is, in effect,
      // a motion cue.)
      const prefersReducedMotion =
        typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches

      if (!prefersReducedMotion) {
        // Track the success-close timer so a re-open or unmount can cancel
        // it — otherwise a stale handleClose could fire after the user has
        // already reopened the widget.
        if (successCloseTimerRef.current !== null) {
          clearTimeout(successCloseTimerRef.current)
        }
        successCloseTimerRef.current = setTimeout(() => {
          successCloseTimerRef.current = null
          handleClose()
        }, 2000)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : messages.errorTitle)
    } finally {
      setSubmitting(false)
    }
  }

  /**
   * "Send another" — reset content but stay open, focus textarea again.
   * Cancels any pending auto-close so the user can immediately type.
   */
  function handleSendAnother() {
    if (successCloseTimerRef.current !== null) {
      clearTimeout(successCloseTimerRef.current)
      successCloseTimerRef.current = null
    }
    setSubmitted(false)
    setText('')
    setCategory(null)
    setScreenshot(null)
    setImagePreview(null)
    setError(null)
    setConfirmDiscard(false)
    // Defer focus to the next frame so the textarea is mounted again.
    if (typeof window !== 'undefined') {
      window.setTimeout(() => textareaRef.current?.focus(), 0)
    }
  }

  /**
   * Save the inline-identity-form draft to localStorage (via the provider's
   * back-channel hook). Closes the editor afterward.
   */
  function handleSaveIdentity() {
    const next: FeedbackUser | undefined =
      identityDraft.name.trim() || identityDraft.email.trim()
        ? {
            name: identityDraft.name.trim() || undefined,
            email: identityDraft.email.trim() || undefined,
          }
        : undefined
    setIdentity?.(next)
    setIdentityEditing(false)
  }

  if (!isOpen) return null

  const modalPositionStyle = getModalPosition(position)

  const submitDisabled = !text.trim() || submitting

  return (
    <>
      {/* Annotation overlay — rendered above everything */}
      {annotating && imagePreview && (
        <AnnotationCanvas
          imageDataUrl={imagePreview}
          onDone={handleAnnotationDone}
          onCancel={() => setAnnotating(false)}
          accentColor={accentColor}
          theme={resolvedTheme}
        />
      )}

      {/* Backdrop */}
      <div
        className="__dtfb_overlay"
        data-snapfeed-ui="true"
        onClick={e => {
          // Don't let a stray backdrop click dismiss the modal mid-submit —
          // losing the in-flight state would confuse the user.
          if (submitting) return
          if (e.target !== e.currentTarget) return
          // Click-outside guard: if there's a non-empty draft, prompt
          // before discarding instead of silently closing. Esc still
          // closes immediately (a deliberate keystroke isn't a misclick).
          if (text.trim().length > 0 && !submitted) {
            setConfirmDiscard(true)
            return
          }
          handleClose()
        }}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 10000,
          background: colors.overlay,
          display: 'flex',
          ...modalPositionStyle,
        }}
      >
        {/* Modal card */}
        <div
          ref={modalRef}
          className="__dtfb_widget"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          style={{
            background: colors.background,
            borderRadius: '16px',
            width: '100%',
            maxWidth: '420px',
            boxShadow: '0 12px 48px rgba(0,0,0,0.22), 0 0 0 1px rgba(0,0,0,0.06)',
            overflow: 'hidden',
            fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
          }}
          // Stop modal click from reaching backdrop
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div
            style={{
              padding: '18px 20px 14px',
              borderBottom: `1px solid ${colors.border}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div>
              <h2
                id={titleId}
                style={{
                  fontWeight: 600,
                  fontSize: '15px',
                  color: colors.text,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  margin: 0,
                }}
              >
                <PenIcon size={15} color={accentColor} />
                {messages.title}
              </h2>
              <div
                style={{
                  fontSize: '12px',
                  // Bumped from textPlaceholder (~3.0:1) to textMuted (~4.6:1)
                  // for AA at this 12px size.
                  color: colors.textMuted,
                  marginTop: '3px',
                }}
              >
                {appName}
                {pageTitle ? ` — ${pageTitle}` : ''}
              </div>
              {/* Identity readout — "Sending as Ananya" with inline "set name". */}
              <IdentityReadout
                user={config.user}
                editing={identityEditing}
                onEdit={() => persistIdentity && setIdentityEditing(true)}
                colors={colors}
                accentColor={accentColor}
                messages={messages}
                canEdit={persistIdentity && !!setIdentity}
              />
            </div>
            <button
              onClick={handleClose}
              aria-label={messages.cancelButton}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: colors.textPlaceholder,
                padding: '4px',
                borderRadius: '6px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'color 0.15s',
              }}
              onMouseEnter={e => {
                ;(e.currentTarget as HTMLButtonElement).style.color = colors.text
              }}
              onMouseLeave={e => {
                ;(e.currentTarget as HTMLButtonElement).style.color =
                  colors.textPlaceholder
              }}
            >
              <CloseIcon size={18} />
            </button>
          </div>

          {/* Body */}
          <div style={{ padding: '16px 20px 20px' }}>
            {submitted ? (
              /* Success state — role=status + aria-live so SR users hear it. */
              <div
                role="status"
                aria-live="polite"
                style={{
                  textAlign: 'center',
                  padding: '20px 0 8px',
                  color: colors.success,
                }}
              >
                <CheckIcon size={40} color={colors.success} />
                <div style={{ fontWeight: 600, fontSize: '15px' }}>
                  {messages.successTitle}
                </div>
                <div
                  style={{
                    fontSize: '13px',
                    color: colors.textMuted,
                    marginTop: '4px',
                  }}
                >
                  {formatMessage(messages.successBody, { appName })}
                </div>
                {/* Per-adapter delivery rows — only when the provider used
                    in-process adapters (apiUrl mode currently returns []). */}
                <DeliverySummary
                  results={lastResults}
                  colors={colors}
                  partialBody={messages.partialSuccessBody}
                  partialTitle={messages.partialSuccessTitle}
                />
                {/* "Send another" CTA — keeps the modal open and resets. */}
                <div style={{ marginTop: '14px' }}>
                  <button
                    onClick={handleSendAnother}
                    style={{
                      background: 'none',
                      border: `1px solid ${colors.border}`,
                      borderRadius: '8px',
                      padding: '6px 14px',
                      cursor: 'pointer',
                      fontSize: '13px',
                      color: colors.textMuted,
                      fontFamily: 'inherit',
                    }}
                  >
                    {messages.sendAnother}
                  </button>
                </div>
              </div>
            ) : (
              <>
                {/* Inline "set name" identity form — toggled from the header
                    "set name" / "change" link. Two short inputs + Save. */}
                {identityEditing && persistIdentity && (
                  <div
                    style={{
                      marginBottom: '12px',
                      padding: '10px 12px',
                      background: colors.surface,
                      borderRadius: '8px',
                    }}
                  >
                    <div
                      style={{
                        fontSize: '12px',
                        color: colors.textMuted,
                        marginBottom: '6px',
                      }}
                    >
                      {messages.identityPromptBody}
                    </div>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      <input
                        type="text"
                        value={identityDraft.name}
                        onChange={e =>
                          setIdentityDraft(d => ({ ...d, name: e.target.value }))
                        }
                        placeholder="Name"
                        aria-label="Your name"
                        style={{
                          flex: '1 1 120px',
                          minWidth: 0,
                          fontSize: '13px',
                          padding: '6px 8px',
                          border: `1px solid ${colors.border}`,
                          borderRadius: '6px',
                          background: colors.background,
                          color: colors.text,
                          fontFamily: 'inherit',
                        }}
                      />
                      <input
                        type="email"
                        value={identityDraft.email}
                        onChange={e =>
                          setIdentityDraft(d => ({ ...d, email: e.target.value }))
                        }
                        placeholder="Email (optional)"
                        aria-label="Your email"
                        style={{
                          flex: '1 1 160px',
                          minWidth: 0,
                          fontSize: '13px',
                          padding: '6px 8px',
                          border: `1px solid ${colors.border}`,
                          borderRadius: '6px',
                          background: colors.background,
                          color: colors.text,
                          fontFamily: 'inherit',
                        }}
                      />
                      <button
                        type="button"
                        onClick={handleSaveIdentity}
                        style={{
                          padding: '6px 12px',
                          borderRadius: '6px',
                          border: 'none',
                          background: accentColor,
                          color: 'white',
                          fontSize: '13px',
                          fontFamily: 'inherit',
                          cursor: 'pointer',
                        }}
                      >
                        Save
                      </button>
                    </div>
                  </div>
                )}

                {/* Category chips */}
                <div
                  style={{
                    display: 'flex',
                    gap: '6px',
                    flexWrap: 'wrap',
                    marginBottom: '12px',
                  }}
                >
                  {categories.map(cat => {
                    const isSelected = category === cat.id
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => toggleCategory(cat.id)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          padding: '4px 10px',
                          borderRadius: '20px',
                          border: `1px solid ${isSelected ? accentColor : colors.border}`,
                          background: isSelected ? `${accentColor}18` : colors.surface,
                          cursor: 'pointer',
                          fontSize: '12px',
                          fontWeight: isSelected ? 600 : 400,
                          color: isSelected ? accentColor : colors.textMuted,
                          fontFamily: 'inherit',
                          transition: 'background 0.12s, border-color 0.12s, color 0.12s',
                          whiteSpace: 'nowrap',
                        }}
                        onMouseEnter={e => {
                          if (!isSelected) {
                            ;(e.currentTarget as HTMLButtonElement).style.background =
                              colors.surfaceHover
                          }
                        }}
                        onMouseLeave={e => {
                          if (!isSelected) {
                            ;(e.currentTarget as HTMLButtonElement).style.background =
                              colors.surface
                          }
                        }}
                      >
                        <span>{cat.emoji}</span>
                        <span>{cat.label}</span>
                      </button>
                    )
                  })}
                </div>

                {/* Textarea — visually-hidden <label> for WCAG 1.3.1
                    (placeholder alone doesn't qualify as a name). */}
                <label
                  id={textareaLabelId}
                  htmlFor={textareaId}
                  style={visuallyHiddenStyle}
                >
                  {messages.textareaLabel}
                </label>
                <textarea
                  id={textareaId}
                  ref={textareaRef}
                  value={text}
                  maxLength={MAX_TEXT_LENGTH}
                  onChange={e => setText(e.target.value)}
                  placeholder={messages.textareaPlaceholder}
                  rows={4}
                  style={{
                    width: '100%',
                    resize: 'none',
                    border: `1px solid ${colors.border}`,
                    borderRadius: '10px',
                    padding: '12px',
                    fontFamily: 'inherit',
                    fontSize: '14px',
                    color: colors.text,
                    outline: 'none',
                    boxSizing: 'border-box',
                    background: colors.inputBg,
                    transition: 'border-color 0.15s, box-shadow 0.15s',
                  }}
                  onFocus={e => {
                    e.currentTarget.style.borderColor = accentColor
                    e.currentTarget.style.boxShadow = `0 0 0 3px ${colors.accentFocusRing}`
                  }}
                  onBlur={e => {
                    e.currentTarget.style.borderColor = colors.border
                    e.currentTarget.style.boxShadow = 'none'
                  }}
                />
                {/* Soft counter — only past 70% so short feedback stays clean. */}
                {text.length > MAX_TEXT_LENGTH * 0.7 && (
                  <div
                    style={{
                      fontSize: '11px',
                      color:
                        text.length >= MAX_TEXT_LENGTH
                          ? colors.error
                          : colors.textMuted,
                      textAlign: 'right',
                      marginTop: '4px',
                    }}
                    aria-live="polite"
                  >
                    {text.length} / {MAX_TEXT_LENGTH}
                  </div>
                )}

                {/* Screenshot area */}
                <div style={{ marginTop: '12px' }}>
                  {capturingAuto ? (
                    <div
                      style={{
                        color: colors.textMuted,
                        fontSize: '12px',
                        padding: '8px 0',
                      }}
                    >
                      {messages.capturingScreenshot}
                    </div>
                  ) : imagePreview ? (
                    <div
                      style={{ position: 'relative', display: 'inline-flex', alignItems: 'flex-start', gap: '8px' }}
                    >
                      <img
                        src={imagePreview}
                        // PII: previously fell back to window.location.href
                        // which leaks query strings (auth tokens, search
                        // terms). Use the safe title/page-name pair only.
                        alt={messages.title || pageTitle || 'Attached screenshot'}
                        style={{
                          height: '80px',
                          maxWidth: '200px',
                          borderRadius: '8px',
                          border: `1px solid ${colors.border}`,
                          objectFit: 'cover',
                          display: 'block',
                        }}
                      />
                      {/* Remove button */}
                      <button
                        onClick={handleRemoveImage}
                        aria-label={messages.removeScreenshot}
                        style={{
                          position: 'absolute',
                          top: '-8px',
                          right: '-8px',
                          background: colors.error,
                          border: 'none',
                          borderRadius: '50%',
                          width: '20px',
                          height: '20px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: 'white',
                          fontSize: '14px',
                          fontWeight: 700,
                          lineHeight: 1,
                        }}
                      >
                        ×
                      </button>
                      {/* Annotate button */}
                      <button
                        onClick={() => setAnnotating(true)}
                        title={messages.annotateButton}
                        style={{
                          padding: '4px 8px',
                          borderRadius: '6px',
                          border: `1px solid ${colors.border}`,
                          background: colors.surface,
                          cursor: 'pointer',
                          fontSize: '12px',
                          color: colors.textMuted,
                          fontFamily: 'inherit',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          alignSelf: 'flex-end',
                          marginBottom: '2px',
                          transition: 'background 0.12s',
                          whiteSpace: 'nowrap',
                        }}
                        onMouseEnter={e => {
                          ;(e.currentTarget as HTMLButtonElement).style.background =
                            colors.surfaceHover
                        }}
                        onMouseLeave={e => {
                          ;(e.currentTarget as HTMLButtonElement).style.background =
                            colors.surface
                        }}
                      >
                        {messages.annotateButton}
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => fileRef.current?.click()}
                      style={{
                        background: colors.attachBg,
                        border: `1px dashed ${colors.attachBorder}`,
                        borderRadius: '10px',
                        padding: '8px 14px',
                        cursor: 'pointer',
                        fontSize: '13px',
                        color: colors.textMuted,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        fontFamily: 'inherit',
                        transition: 'background 0.15s',
                      }}
                      onMouseEnter={e => {
                        ;(e.currentTarget as HTMLButtonElement).style.background =
                          colors.surfaceHover
                      }}
                      onMouseLeave={e => {
                        ;(e.currentTarget as HTMLButtonElement).style.background =
                          colors.attachBg
                      }}
                    >
                      <ImageIcon size={14} color={colors.textMuted} />
                      {messages.attachScreenshot}
                    </button>
                  )}
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={handleImageChange}
                  />
                </div>

                {/* Error — role=alert so SR users hear it on appearance. */}
                {error && (
                  <div
                    role="alert"
                    style={{
                      marginTop: '10px',
                      color: colors.error,
                      fontSize: '13px',
                      background: colors.errorBg,
                      borderRadius: '8px',
                      padding: '8px 12px',
                    }}
                  >
                    {error}
                  </div>
                )}

                {/* Discard-draft confirmation — appears when the user clicks
                    backdrop with text in the textarea. Inline (not modal)
                    to keep it lightweight. */}
                {confirmDiscard && (
                  <div
                    role="alert"
                    style={{
                      marginTop: '10px',
                      background: colors.surface,
                      borderRadius: '8px',
                      padding: '8px 12px',
                      fontSize: '13px',
                      color: colors.textMuted,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '8px',
                    }}
                  >
                    <span>Discard draft?</span>
                    <span style={{ display: 'flex', gap: '6px' }}>
                      <button
                        onClick={() => setConfirmDiscard(false)}
                        style={{
                          background: 'none',
                          border: `1px solid ${colors.border}`,
                          borderRadius: '6px',
                          padding: '2px 10px',
                          cursor: 'pointer',
                          fontSize: '12px',
                          color: colors.textMuted,
                          fontFamily: 'inherit',
                        }}
                      >
                        Keep
                      </button>
                      <button
                        onClick={() => {
                          setConfirmDiscard(false)
                          setText('')
                          setCategory(null)
                          handleClose()
                        }}
                        style={{
                          background: colors.error,
                          color: 'white',
                          border: 'none',
                          borderRadius: '6px',
                          padding: '2px 10px',
                          cursor: 'pointer',
                          fontSize: '12px',
                          fontFamily: 'inherit',
                        }}
                      >
                        Discard
                      </button>
                    </span>
                  </div>
                )}

                {/* Actions */}
                <div
                  style={{
                    display: 'flex',
                    gap: '10px',
                    marginTop: '16px',
                  }}
                >
                  <button
                    onClick={handleClose}
                    style={{
                      flex: 1,
                      padding: '10px',
                      borderRadius: '10px',
                      border: `1px solid ${colors.border}`,
                      background: 'none',
                      cursor: 'pointer',
                      fontSize: '14px',
                      color: colors.textMuted,
                      fontFamily: 'inherit',
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={e => {
                      ;(e.currentTarget as HTMLButtonElement).style.background =
                        colors.surface
                    }}
                    onMouseLeave={e => {
                      ;(e.currentTarget as HTMLButtonElement).style.background = 'none'
                    }}
                  >
                    {messages.cancelButton}
                  </button>
                  <button
                    onClick={handleSubmit}
                    disabled={submitDisabled}
                    style={{
                      flex: 2,
                      padding: '10px',
                      borderRadius: '10px',
                      border: 'none',
                      // High-contrast disabled state: solid surface + muted
                      // text reads at ~4.6:1, vs. the prior low-alpha
                      // overlay that fell below 3:1.
                      background: submitDisabled
                        ? colors.surface
                        : `linear-gradient(135deg, ${accentColor}, ${shiftColor(accentColor, -40)})`,
                      color: submitDisabled ? colors.textMuted : 'white',
                      cursor: submitDisabled ? 'not-allowed' : 'pointer',
                      fontSize: '14px',
                      fontWeight: 600,
                      fontFamily: 'inherit',
                      transition: 'opacity 0.15s, transform 0.1s',
                    }}
                    onMouseEnter={e => {
                      if (!submitDisabled) {
                        ;(e.currentTarget as HTMLButtonElement).style.opacity = '0.9'
                      }
                    }}
                    onMouseLeave={e => {
                      ;(e.currentTarget as HTMLButtonElement).style.opacity = '1'
                    }}
                  >
                    {submitting ? messages.sendingButton : messages.sendButton}
                  </button>
                </div>

                {/* Keyboard hint — bumped from textPlaceholder to textMuted
                    so the 11px text clears AA contrast on light theme. */}
                <div
                  style={{
                    marginTop: '10px',
                    fontSize: '11px',
                    color: colors.textMuted,
                    textAlign: 'center',
                  }}
                >
                  {messages.hint}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

// ─── Identity readout ─────────────────────────────────────────────────────────

interface IdentityReadoutProps {
  user: FeedbackUser | undefined
  editing: boolean
  onEdit: () => void
  colors: ThemeColors & { accent: string }
  accentColor: string
  messages: FeedbackMessages
  canEdit: boolean
}

/**
 * "Sending as Ananya · change" line under the modal title. When no
 * identity is set and the host enabled `persistIdentity`, clicking the
 * "set name" link reveals an inline form (rendered in the body) — here
 * we just show the readout.
 *
 * Why a separate component: keeps the main FeedbackWidget body focused
 * on form layout. Lives in this file (per the constraint to avoid file
 * splitting) but is encapsulated.
 */
function IdentityReadout({
  user,
  editing,
  onEdit,
  colors,
  accentColor,
  messages,
  canEdit,
}: IdentityReadoutProps) {
  const who = user?.name ?? user?.email
  if (editing) return null // form lives in the body
  return (
    <div
      style={{
        fontSize: '11px',
        color: colors.textMuted,
        marginTop: '2px',
      }}
    >
      {who ? (
        <>
          {formatMessage(messages.sendingAs, { who })}
          {canEdit && (
            <>
              {' · '}
              <button
                type="button"
                onClick={onEdit}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  color: accentColor,
                  cursor: 'pointer',
                  fontSize: '11px',
                  fontFamily: 'inherit',
                  textDecoration: 'underline',
                }}
              >
                change
              </button>
            </>
          )}
        </>
      ) : canEdit ? (
        <>
          {formatMessage(messages.sendingAs, { who: 'anonymous' })}{' · '}
          <button
            type="button"
            onClick={onEdit}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              color: accentColor,
              cursor: 'pointer',
              fontSize: '11px',
              fontFamily: 'inherit',
              textDecoration: 'underline',
            }}
          >
            {messages.setName}
          </button>
        </>
      ) : null}
    </div>
  )
}

// ─── Per-adapter delivery summary ─────────────────────────────────────────────

interface DeliverySummaryProps {
  results: FeedbackDeliveryRecord[]
  colors: ThemeColors
  partialBody: string
  partialTitle: string
}

/**
 * Render one row per adapter that handled the most recent submission.
 * On full success, shows "Sent to: slack, linear" — succinct receipt.
 * On partial failure, surfaces a non-blocking warning so the tester
 * knows their feedback didn't fully reach destination.
 *
 * Renders nothing when `results` is empty (apiUrl mode).
 */
function DeliverySummary({
  results,
  colors,
  partialBody,
  partialTitle,
}: DeliverySummaryProps) {
  if (results.length === 0) return null

  const successes = results.filter(r => r.ok)
  const failures = results.filter(r => !r.ok)
  const partial = failures.length > 0 && successes.length > 0

  return (
    <div
      style={{
        marginTop: '10px',
        fontSize: '12px',
        color: colors.textMuted,
        textAlign: 'left',
        background: colors.surface,
        borderRadius: '8px',
        padding: '8px 12px',
      }}
    >
      {successes.length > 0 && (
        <div>
          Sent to:{' '}
          {successes
            .map(r => (r.deliveryId ? `${r.name} (${r.deliveryId})` : r.name))
            .join(', ')}
        </div>
      )}
      {partial && (
        <div style={{ color: colors.error, marginTop: '4px' }}>
          {partialTitle}:{' '}
          {formatMessage(partialBody, {
            okCount: successes.length,
            failedCount: failures.length,
          })}
        </div>
      )}
      {failures.length > 0 && successes.length === 0 && (
        <div style={{ color: colors.error }}>
          Failed: {failures.map(r => `${r.name}${r.error ? ` (${r.error})` : ''}`).join(', ')}
        </div>
      )}
    </div>
  )
}

// ─── Accessibility helpers ────────────────────────────────────────────────────

/**
 * CSS recipe for visually-hidden but screen-reader-accessible elements.
 * The combination of zero-size + clip + absolute positioning is the
 * canonical "sr-only" pattern; using `display: none` would also hide the
 * label from assistive tech.
 */
const visuallyHiddenStyle: React.CSSProperties = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  padding: 0,
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
}

/**
 * Collect every Tab-reachable descendant of `root`. Used by the modal
 * focus trap to wrap focus at the boundaries. We exclude elements that
 * are explicitly `disabled` or have `tabindex="-1"`.
 */
function getFocusableElements(root: HTMLElement): HTMLElement[] {
  const selector = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
    'audio[controls]',
    'video[controls]',
    '[contenteditable]:not([contenteditable="false"])',
  ].join(',')
  const nodes = Array.from(root.querySelectorAll<HTMLElement>(selector))
  return nodes.filter(el => {
    if (el.hasAttribute('disabled')) return false
    if (el.getAttribute('aria-hidden') === 'true') return false
    // Skip non-rendered elements (e.g. the hidden file input).
    if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') {
      return false
    }
    return true
  })
}

// ─── Standalone trigger button ────────────────────────────────────────────────

/**
 * Renders nothing — the FeedbackWidget is always rendered by FeedbackProvider.
 * Use FeedbackButton for a custom trigger.
 */
export function FeedbackWidgetTrigger() {
  return null
}

// ─── Color helper ─────────────────────────────────────────────────────────────

/**
 * Shift a hex color's hue slightly for the gradient end color.
 * Falls back to a purple-ish complement if parsing fails.
 */
function shiftColor(hex: string, hueDeg: number): string {
  try {
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)

    // Simple HSL shift
    const [h, s, l] = rgbToHsl(r, g, b)
    const newH = ((h + hueDeg + 360) % 360)
    const [nr, ng, nb] = hslToRgb(newH, s, l)

    return `rgb(${nr},${ng},${nb})`
  } catch {
    return '#8B6CC1'
  }
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rr = r / 255, gg = g / 255, bb = b / 255
  const max = Math.max(rr, gg, bb)
  const min = Math.min(rr, gg, bb)
  const l = (max + min) / 2

  if (max === min) return [0, 0, l]

  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === rr) h = ((gg - bb) / d + (gg < bb ? 6 : 0)) / 6
  else if (max === gg) h = ((bb - rr) / d + 2) / 6
  else h = ((rr - gg) / d + 4) / 6

  return [h * 360, s, l]
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hh = h / 360
  if (s === 0) {
    const v = Math.round(l * 255)
    return [v, v, v]
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return [
    Math.round(hue2rgb(p, q, hh + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, hh) * 255),
    Math.round(hue2rgb(p, q, hh - 1 / 3) * 255),
  ]
}

function hue2rgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1
  if (t > 1) t -= 1
  if (t < 1 / 6) return p + (q - p) * 6 * t
  if (t < 1 / 2) return q
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
  return p
}
