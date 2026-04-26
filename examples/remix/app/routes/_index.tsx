import type { CSSProperties } from 'react'
import { useDevFeedback, FeedbackButton } from 'snapfeed'

/**
 * Index route. Lives inside <SnapfeedProviderClient> in root.tsx, so
 * the useDevFeedback hook is available — but only after the provider
 * mounts (client-only). On the very first SSR pass, the hook's context
 * is undefined; we guard for that.
 */
export default function Index() {
  // The hook returns a context value or throws if no provider is mounted.
  // Wrap in a try/catch via a small inline component to keep the SSR
  // pass clean.
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
      <h1 style={{ margin: 0, fontSize: '32px' }}>
        snapfeed example — Remix
      </h1>

      <p style={{ color: '#6B7280', maxWidth: 520, textAlign: 'center', margin: 0 }}>
        Press <kbd style={kbdStyle}>Ctrl</kbd>+<kbd style={kbdStyle}>Shift</kbd>+
        <kbd style={kbdStyle}>F</kbd> (or{' '}
        <kbd style={kbdStyle}>Cmd</kbd>+<kbd style={kbdStyle}>Shift</kbd>+
        <kbd style={kbdStyle}>F</kbd> on Mac) to open the feedback widget.
      </p>

      <TriggerPanel />

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
          The widget POSTs to <code>/api/feedback</code> — a Remix
          resource route at <code>app/routes/api.feedback.tsx</code> that
          runs <code>autoAdapters()</code> based on the{' '}
          <code>SNAPFEED_*</code> env vars in <code>.env</code>.
        </p>
        <p style={{ margin: 0, color: '#6B7280' }}>
          With no env vars, the route falls back to{' '}
          <code>consoleAdapter()</code> so submissions log to the dev
          server.
        </p>
      </section>

      <p style={{ color: '#9CA3AF', fontSize: 13, margin: 0 }}>
        Esc to close · Ctrl+Enter to submit
      </p>
    </main>
  )
}

/**
 * The provider is mounted client-only, so we can't call useDevFeedback
 * during SSR. Render a placeholder server-side; swap in the real
 * controls once mounted.
 */
function TriggerPanel() {
  // This component will only ever render after hydration in practice
  // (the provider gates everything client-side), but we still keep the
  // hook call inside a tiny boundary for safety.
  return <ProgrammaticTrigger />
}

function ProgrammaticTrigger() {
  // useDevFeedback throws outside <FeedbackProvider>. Since the provider
  // is mounted on the client only, we render a static fallback during
  // SSR by using try/catch around the hook call.
  let api: ReturnType<typeof useDevFeedback> | null = null
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks -- intentional SSR-safe pattern; provider mounts client-only in this Remix example
    api = useDevFeedback()
  } catch {
    api = null
  }

  if (!api) {
    return (
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
        <button type="button" disabled style={disabledBtnStyle}>
          Loading…
        </button>
      </div>
    )
  }

  const { open, isOpen } = api
  return (
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

const disabledBtnStyle: CSSProperties = {
  padding: '10px 20px',
  background: '#E5E7EB',
  color: '#9CA3AF',
  border: 'none',
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 500,
}
