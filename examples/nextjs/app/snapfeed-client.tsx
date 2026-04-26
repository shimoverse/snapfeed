'use client'

import type { ReactNode } from 'react'
import { FeedbackProvider, FeedbackButton } from 'snapfeed'

/**
 * Client wrapper around <FeedbackProvider>.
 *
 * Server-side adapters (Slack/GitHub/etc) are configured via
 * `app/api/feedback/route.ts` + SNAPFEED_* env vars. The provider here
 * just POSTs to /api/feedback.
 */
export function SnapfeedClient({ children }: { children: ReactNode }) {
  return (
    <FeedbackProvider
      appName="Demo App"
      hotkey="ctrl+shift+f"
      position="bottom-right"
      theme="auto"
      accentColor="#B85A36"
      autoScreenshot
      enableInProduction={false}
      apiUrl="/api/feedback"
    >
      {children}
      <FeedbackButton />
    </FeedbackProvider>
  )
}
