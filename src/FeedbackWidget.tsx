'use client'

import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
} from 'react'
import { useFeedbackContext } from './FeedbackProvider'
import { fileToScreenshot, captureScreenshot, extractImageFromClipboard } from './screenshot'
import { getThemeColors, getModalPosition, injectAnimations, resolveTheme } from './styles'
import { AnnotationCanvas } from './AnnotationCanvas'
import type { FeedbackPayload, FeedbackScreenshot, FeedbackCategory } from './types'

// ─── Category config ──────────────────────────────────────────────────────────

const CATEGORIES: Array<{ id: FeedbackCategory; label: string; emoji: string }> = [
  { id: 'bug', label: 'Bug', emoji: '🐛' },
  { id: 'idea', label: 'Idea', emoji: '💡' },
  { id: 'question', label: 'Question', emoji: '❓' },
  { id: 'praise', label: 'Praise', emoji: '🙌' },
  { id: 'other', label: 'Other', emoji: '📝' },
]

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
  const { isOpen, close, submit, config } = useFeedbackContext()
  const { appName, position, theme, accentColor } = config

  const [text, setText] = useState('')
  const [screenshot, setScreenshot] = useState<FeedbackScreenshot | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [capturingAuto, setCapturingAuto] = useState(false)
  const [category, setCategory] = useState<FeedbackCategory | null>(null)
  const [annotating, setAnnotating] = useState(false)

  const fileRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

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

  // Focus textarea when opened
  useEffect(() => {
    if (isOpen && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [isOpen])

  // Reset state when closed
  useEffect(() => {
    if (!isOpen) {
      // Small delay to allow exit animation
      const timer = setTimeout(() => {
        setText('')
        setScreenshot(null)
        setImagePreview(null)
        setError(null)
        setSubmitted(false)
        setCategory(null)
        setAnnotating(false)
      }, 200)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [isOpen])

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

  // Escape to close, Ctrl+Enter to submit
  useEffect(() => {
    if (!isOpen) return

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        close()
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        if (text.trim() && !submitting) {
          handleSubmit()
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
    const pageTitle =
      typeof document !== 'undefined' ? document.title : ''

    const partial: Omit<FeedbackPayload, 'timestamp' | 'appName'> = {
      text: text.trim(),
      pageUrl,
      pageName: pageTitle,
      user: config.user,
      screenshot: screenshot ?? undefined,
      category: category ?? undefined,
    }

    try {
      await submit(partial)
      setSubmitted(true)
      setTimeout(handleClose, 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSubmitting(false)
    }
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
        onClick={e => {
          if (e.target === e.currentTarget) handleClose()
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
          className="__dtfb_widget"
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
              <div
                style={{
                  fontWeight: 600,
                  fontSize: '15px',
                  color: colors.text,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <PenIcon size={15} color={accentColor} />
                Share Feedback
              </div>
              <div
                style={{
                  fontSize: '12px',
                  color: colors.textPlaceholder,
                  marginTop: '3px',
                }}
              >
                {appName}
                {typeof window !== 'undefined' && document.title
                  ? ` — ${document.title}`
                  : ''}
              </div>
            </div>
            <button
              onClick={handleClose}
              aria-label="Close feedback"
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
              /* Success state */
              <div
                style={{
                  textAlign: 'center',
                  padding: '24px 0',
                  color: colors.success,
                }}
              >
                <CheckIcon size={40} color={colors.success} />
                <div style={{ fontWeight: 600, fontSize: '15px' }}>
                  Feedback sent!
                </div>
                <div
                  style={{
                    fontSize: '13px',
                    color: colors.textPlaceholder,
                    marginTop: '4px',
                  }}
                >
                  Thanks for helping improve {appName}.
                </div>
              </div>
            ) : (
              <>
                {/* Category chips */}
                <div
                  style={{
                    display: 'flex',
                    gap: '6px',
                    flexWrap: 'wrap',
                    marginBottom: '12px',
                  }}
                >
                  {CATEGORIES.map(cat => {
                    const isSelected = category === cat.id
                    return (
                      <button
                        key={cat.id}
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

                {/* Textarea */}
                <textarea
                  ref={textareaRef}
                  value={text}
                  onChange={e => setText(e.target.value)}
                  placeholder="What do you want to change or improve? (Ctrl+Enter to submit)"
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

                {/* Screenshot area */}
                <div style={{ marginTop: '12px' }}>
                  {capturingAuto ? (
                    <div
                      style={{
                        color: colors.textPlaceholder,
                        fontSize: '12px',
                        padding: '8px 0',
                      }}
                    >
                      Capturing screenshot…
                    </div>
                  ) : imagePreview ? (
                    <div
                      style={{ position: 'relative', display: 'inline-flex', alignItems: 'flex-start', gap: '8px' }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={imagePreview}
                        alt="Attached screenshot"
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
                        aria-label="Remove screenshot"
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
                        title="Annotate screenshot"
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
                        ✏️ Annotate
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
                      Attach or paste screenshot (⌘V)
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

                {/* Error */}
                {error && (
                  <div
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
                    Cancel
                  </button>
                  <button
                    onClick={handleSubmit}
                    disabled={submitDisabled}
                    style={{
                      flex: 2,
                      padding: '10px',
                      borderRadius: '10px',
                      border: 'none',
                      background: submitDisabled
                        ? colors.accentDisabled
                        : `linear-gradient(135deg, ${accentColor}, ${shiftColor(accentColor, -40)})`,
                      color: submitDisabled ? colors.textPlaceholder : 'white',
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
                    {submitting ? 'Sending…' : 'Send Feedback'}
                  </button>
                </div>

                {/* Keyboard hint */}
                <div
                  style={{
                    marginTop: '10px',
                    fontSize: '11px',
                    color: colors.textPlaceholder,
                    textAlign: 'center',
                  }}
                >
                  Press Esc to dismiss · ⌃↵ to send
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  )
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
