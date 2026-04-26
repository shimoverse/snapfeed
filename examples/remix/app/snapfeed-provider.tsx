import { useEffect, useState, type ReactNode } from 'react'
import { FeedbackProvider, FeedbackButton } from 'snapfeed'

/**
 * Client-only wrapper around <FeedbackProvider>.
 *
 * The snapfeed provider touches `window` (hotkey listener, screenshot
 * capture, etc.) so it can't render during SSR. We mount it after the
 * first effect runs on the client. Until then, children render as-is —
 * the page is still interactive, just without the widget.
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
