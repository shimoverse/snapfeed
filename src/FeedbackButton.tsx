'use client'

import { type CSSProperties } from 'react'
import { useFeedbackContext } from './FeedbackProvider'
import { getButtonPosition } from './styles'

export interface FeedbackButtonProps {
  /**
   * Render the button inline (inside a flex/grid container)
   * rather than as a fixed floating button.
   * @default false
   */
  inline?: boolean
  /**
   * Custom label text.
   * @default "Feedback"
   */
  label?: string
  /**
   * Custom CSS class name.
   */
  className?: string
  /**
   * Custom inline styles.
   */
  style?: CSSProperties
}

/**
 * Standalone feedback trigger button.
 *
 * When `inline` is false, renders as a fixed floating button at the
 * position configured in `FeedbackProvider`. When `inline` is true,
 * renders in the normal document flow.
 *
 * @example
 * // Floating button (default)
 * <FeedbackButton />
 *
 * // Inline in a nav sidebar
 * <FeedbackButton inline label="Send feedback" />
 */
export function FeedbackButton({
  inline = false,
  label = 'Feedback',
  className,
  style,
}: FeedbackButtonProps) {
  const { toggle, config } = useFeedbackContext()
  const { position, accentColor } = config

  const baseFloatingStyle: CSSProperties = {
    ...getButtonPosition(position),
    height: '36px',
    borderRadius: '20px',
    padding: '0 14px',
    gap: '6px',
    background: `linear-gradient(135deg, ${accentColor}, ${darkenColor(accentColor, 30)})`,
    border: 'none',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
    transition: 'transform 0.15s ease, box-shadow 0.15s ease',
    zIndex: 9999,
  }

  const baseInlineStyle: CSSProperties = {
    height: '32px',
    borderRadius: '20px',
    padding: '0 14px',
    gap: '6px',
    background: `linear-gradient(135deg, ${accentColor}, ${darkenColor(accentColor, 30)})`,
    border: 'none',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'transform 0.15s ease, opacity 0.15s ease',
  }

  const resolvedStyle: CSSProperties = {
    ...(inline ? baseInlineStyle : baseFloatingStyle),
    ...style,
  }

  return (
    <button
      onClick={toggle}
      aria-label="Send feedback"
      data-snapfeed-ui="true"
      className={className}
      style={resolvedStyle}
      onMouseEnter={e => {
        const btn = e.currentTarget as HTMLButtonElement
        btn.style.transform = 'scale(1.06)'
        if (!inline) btn.style.boxShadow = '0 6px 24px rgba(0,0,0,0.24)'
      }}
      onMouseLeave={e => {
        const btn = e.currentTarget as HTMLButtonElement
        btn.style.transform = 'scale(1)'
        if (!inline)
          btn.style.boxShadow = '0 4px 16px rgba(0,0,0,0.18)'
      }}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="white"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
      </svg>
      <span
        style={{
          fontSize: '13px',
          fontWeight: 600,
          color: 'white',
          fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
    </button>
  )
}

// Simple darken helper
function darkenColor(hex: string, amount: number): string {
  try {
    let r = parseInt(hex.slice(1, 3), 16)
    let g = parseInt(hex.slice(3, 5), 16)
    let b = parseInt(hex.slice(5, 7), 16)
    r = Math.max(0, r - amount)
    g = Math.max(0, g - amount)
    b = Math.max(0, b - amount)
    return `rgb(${r},${g},${b})`
  } catch {
    return '#6B3D2E'
  }
}
