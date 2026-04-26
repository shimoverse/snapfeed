import type { ReactNode } from 'react'
import { SnapfeedClient } from './snapfeed-client'

export const metadata = {
  title: 'snapfeed example',
  description: 'A minimal Next.js app showing the snapfeed feedback widget.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily:
            'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          background: '#FAFAF7',
          color: '#111',
        }}
      >
        <SnapfeedClient>{children}</SnapfeedClient>
      </body>
    </html>
  )
}
