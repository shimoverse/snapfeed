import type { CSSProperties } from 'react'
import { ClientPanel } from './client-panel'

/**
 * Server component — reads SNAPFEED_* env vars and passes detection
 * results to the client. The <FeedbackProvider> is mounted in layout.tsx,
 * so this page just renders the marketing surface.
 */
const ENV_KEYS = [
  'SNAPFEED_SLACK_WEBHOOK',
  'SNAPFEED_DISCORD_WEBHOOK',
  'SNAPFEED_GITHUB_TOKEN',
  'SNAPFEED_GITHUB_REPO',
  'SNAPFEED_TELEGRAM_BOT_TOKEN',
  'SNAPFEED_TELEGRAM_CHAT_ID',
  'SNAPFEED_WEBHOOK_URL',
  'SNAPFEED_FILE_PATH',
] as const

export default function ExamplePage() {
  const detected: Record<string, boolean> = {}
  for (const k of ENV_KEYS) {
    detected[k] = Boolean(process.env[k] && process.env[k]!.length > 0)
  }
  const anyDetected = Object.values(detected).some(Boolean)

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
      }}
    >
      <h1 style={{ margin: 0, fontSize: '32px' }}>snapfeed example</h1>

      <p style={{ color: '#6B7280', maxWidth: '500px', textAlign: 'center', margin: 0 }}>
        Press <kbd style={kbdStyle}>Ctrl</kbd>+<kbd style={kbdStyle}>Shift</kbd>+
        <kbd style={kbdStyle}>F</kbd> to open the feedback widget.
      </p>

      <ClientPanel />

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
        }}
      >
        <h2 style={{ margin: '0 0 12px', fontSize: 16 }}>
          Detected SNAPFEED_* env vars
        </h2>
        {anyDetected ? (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {ENV_KEYS.map(k => (
              <li
                key={k}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '4px 0',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                }}
              >
                <span>{k}</span>
                <span
                  style={{
                    color: detected[k] ? '#059669' : '#9CA3AF',
                    fontWeight: 600,
                  }}
                >
                  {detected[k] ? 'set' : '—'}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p style={{ margin: 0, color: '#6B7280' }}>
            None set. The API route falls back to <code>consoleAdapter()</code> so
            submissions log to the dev server. Copy <code>.env.example</code> to{' '}
            <code>.env.local</code> and set one to wire a real destination.
          </p>
        )}
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
