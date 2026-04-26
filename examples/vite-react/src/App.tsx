import type { CSSProperties } from 'react'
import { useDevFeedback, FeedbackButton } from 'snapfeed'

/**
 * Demo page — renders inside <FeedbackProvider> (see main.tsx) so
 * useDevFeedback() can drive the widget programmatically.
 */
export function App() {
  const { open, isOpen } = useDevFeedback()

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '24px',
        padding: '40px',
        fontFamily:
          'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        color: '#111',
      }}
    >
      <h1 style={{ margin: 0, fontSize: '32px' }}>
        snapfeed example — Vite + React
      </h1>

      <p style={{ color: '#6B7280', maxWidth: 520, textAlign: 'center', margin: 0 }}>
        Press <kbd style={kbdStyle}>Ctrl</kbd>+<kbd style={kbdStyle}>Shift</kbd>+
        <kbd style={kbdStyle}>F</kbd> (or{' '}
        <kbd style={kbdStyle}>Cmd</kbd>+<kbd style={kbdStyle}>Shift</kbd>+
        <kbd style={kbdStyle}>F</kbd> on Mac) to open the feedback widget.
      </p>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
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
          {isOpen ? 'Widget is open' : 'Trigger programmatically'}
        </button>
      </div>

      <section
        style={{
          width: '100%',
          maxWidth: 560,
          background: '#fff',
          border: '1px solid #E5E7EB',
          borderRadius: 12,
          padding: 20,
          fontSize: 14,
          lineHeight: 1.5,
          color: '#374151',
        }}
      >
        <h2 style={{ margin: '0 0 8px', fontSize: 16 }}>How this is wired</h2>
        <p style={{ margin: '0 0 8px' }}>
          The widget POSTs to <code>/api/feedback</code>. Vite's dev server
          proxies that to the Express backend in <code>server.mjs</code> on
          port <code>8788</code>, which calls{' '}
          <code>autoAdapters()</code> to dispatch via whichever{' '}
          <code>SNAPFEED_*</code> env vars you've set in <code>.env</code>.
        </p>
        <p style={{ margin: 0, color: '#6B7280' }}>
          With no env vars, the backend falls back to a JSONL file +
          console output so the demo still works.
        </p>
      </section>

      <p style={{ color: '#9CA3AF', fontSize: 13, margin: 0 }}>
        Esc to close · Ctrl+Enter to submit
      </p>
    </main>
  )
}

const kbdStyle: CSSProperties = {
  background: '#F3F4F6',
  border: '1px solid #D1D5DB',
  borderRadius: 4,
  padding: '1px 6px',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 12,
}
