'use client'

/**
 * Example Next.js page showing how to use snapfeed
 *
 * In a real app, wrap your root layout.tsx with FeedbackProvider.
 */

import { FeedbackProvider, FeedbackButton, useDevFeedback } from 'snapfeed'
import { supabaseAdapter } from 'snapfeed/adapters'
import { telegramAdapter } from 'snapfeed/adapters'

// Example of programmatic usage
function ProgrammaticExample() {
  const { open, isOpen } = useDevFeedback()

  return (
    <button
      onClick={open}
      style={{
        padding: '10px 20px',
        background: '#3B82F6',
        color: 'white',
        border: 'none',
        borderRadius: '8px',
        cursor: 'pointer',
      }}
    >
      {isOpen ? 'Widget is open' : 'Open feedback programmatically'}
    </button>
  )
}

export default function ExamplePage() {
  return (
    <FeedbackProvider
      appName="My App"
      hotkey="ctrl+shift+f"
      position="bottom-right"
      theme="auto"
      accentColor="#D4714B"
      enableInProduction={false}
      // Option A: Client-side adapters (no API route needed)
      // adapters={[consoleAdapter()]}

      // Option B: Server-side via API route (recommended for production)
      apiUrl="/api/feedback"
      user={{ name: 'Dev User', email: 'dev@example.com' }}
    >
      <main
        style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '24px',
          padding: '40px',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <h1 style={{ margin: 0, fontSize: '32px' }}>
          snapfeed Example
        </h1>

        <p style={{ color: '#6B7280', maxWidth: '500px', textAlign: 'center' }}>
          Press <kbd>Ctrl+Shift+F</kbd> to open the feedback widget, or use the
          floating button in the bottom-right corner.
        </p>

        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center' }}>
          {/* Inline trigger button */}
          <FeedbackButton inline label="Inline Feedback Button" />

          {/* Programmatic access */}
          <ProgrammaticExample />
        </div>

        <p style={{ color: '#9CA3AF', fontSize: '13px' }}>
          Press Esc to close · Ctrl+Enter to submit
        </p>
      </main>

      {/* Floating button (default behavior — always visible) */}
      <FeedbackButton />
    </FeedbackProvider>
  )
}
