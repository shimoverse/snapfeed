/**
 * Custom 404 — keeps Next from auto-generating one. The auto-generated
 * `/_not-found` route is statically prerendered through the root layout,
 * which mounts `<SnapfeedClient>` → `<FeedbackProvider>` → `<FeedbackButton>`.
 * That prerender path was tripping on a context-resolution timing issue
 * during static generation; a real, dynamic 404 page sidesteps it.
 */
export const dynamic = 'force-dynamic'

export default function NotFound() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '12px',
        padding: '40px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <h1 style={{ margin: 0, fontSize: '32px' }}>404 — page not found</h1>
      <p style={{ color: '#666', fontSize: '14px' }}>
        Press <kbd>Ctrl+Shift+F</kbd> to send feedback about a missing page.
      </p>
    </main>
  )
}
