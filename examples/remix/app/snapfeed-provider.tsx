// ─────────────────────────────────────────────────────────────────────────────
// useEffect mount-gate pattern
//
// `<FeedbackProvider>` reaches for `window` (global hotkey listener, screenshot
// capture via html2canvas, clipboard, etc.) at construction time. Rendering it
// during SSR throws `ReferenceError: window is not defined`.
//
// We can't `dynamic()`-import in Remix the way Next.js does, and pulling in
// `remix-utils` just for `<ClientOnly>` is overkill. The lightweight pattern:
//
//   1. On the SERVER (and the first client render before hydration), `mounted`
//      is `false` and we return `<>{children}</>` — the markup matches what
//      the server emitted, so React doesn't complain about hydration mismatch.
//   2. After hydration, the `useEffect` fires (effects only run on the
//      client), `setMounted(true)` flips state, and the next render swaps in
//      the real `<FeedbackProvider>` — `window` is safely available now.
//
// Trade-off: the widget appears one tick after hydration. That's acceptable
// for an internal feedback tool; users won't notice.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState, type ReactNode } from 'react'
import { FeedbackProvider, FeedbackButton } from 'snapfeed'

/**
 * Client-only wrapper around <FeedbackProvider>.
 *
 * See the file header above for why this gate exists. Until the first
 * effect runs on the client, children render as-is — the page is still
 * interactive, just without the widget.
 */
export function SnapfeedProviderClient({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return <>{children}</>
  }

  return (
    <FeedbackProvider
      appName="Remix Demo"
      hotkey="ctrl+shift+f"
      position="bottom-right"
      theme="auto"
      accentColor="#D4714B"
      autoScreenshot
      enableInProduction={false}
      apiUrl="/api/feedback"
    >
      {children}
      <FeedbackButton />
    </FeedbackProvider>
  )
}
