'use client'

import { useDevFeedback, FeedbackButton } from 'snapfeed'

/**
 * Client island that uses the snapfeed hook. Lives inside the
 * <FeedbackProvider> mounted in layout.tsx → snapfeed-client.tsx.
 */
export function ClientPanel() {
  const { open, isOpen } = useDevFeedback()

  return (
    <div
      style={{
        display: 'flex',
        gap: 12,
        flexWrap: 'wrap',
        justifyContent: 'center',
      }}
    >
      <FeedbackButton inline label="Inline button" />
      <button
        type="button"
        onClick={open}
        style={{
          padding: '10px 20px',
          background: '#D4714B',
          color: 'white',
          border: 'none',
          borderRadius: 8,
          cursor: 'pointer',
          fontSize: 14,
          fontWeight: 500,
        }}
      >
        {isOpen ? 'Widget is open' : 'Trigger feedback programmatically'}
      </button>
    </div>
  )
}
