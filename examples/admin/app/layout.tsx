import type { ReactNode } from 'react'

export const metadata = {
  title: 'snapfeed admin',
  description: 'Minimal admin viewer for feedback collected with snapfeed.',
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
        <header
          style={{
            background: '#fff',
            borderBottom: '1px solid #E5E7EB',
            padding: '14px 24px',
          }}
        >
          <h1
            style={{
              margin: 0,
              fontSize: 16,
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontWeight: 600,
              letterSpacing: '-0.01em',
            }}
          >
            snapfeed admin
          </h1>
        </header>
        <main style={{ padding: '24px', maxWidth: 1100, margin: '0 auto' }}>
          {children}
        </main>
      </body>
    </html>
  )
}
