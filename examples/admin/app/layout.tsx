import type { ReactNode } from 'react'
import Link from 'next/link'
import { tryGetUser } from '../lib/auth'

export const metadata = {
  title: 'snapfeed admin',
  description: 'Internal triage tool for feedback collected with snapfeed.',
}

const NAV_LINKS: Array<{ href: string; label: string }> = [
  { href: '/', label: 'Inbox' },
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/audit', label: 'Audit log' },
]

export default function RootLayout({ children }: { children: ReactNode }) {
  const user = tryGetUser()

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
        {/* Global focus-visible styling so every button/link has a clean ring. */}
        <style>{`
          *:focus { outline: none; }
          *:focus-visible {
            outline: 2px solid #D4714B;
            outline-offset: 2px;
            border-radius: 4px;
          }
          a { color: inherit; }
        `}</style>

        <header
          style={{
            background: '#fff',
            borderBottom: '1px solid #E5E7EB',
            padding: '12px 24px',
            display: 'flex',
            alignItems: 'center',
            gap: 24,
            flexWrap: 'wrap',
          }}
        >
          <Link
            href="/"
            style={{
              textDecoration: 'none',
              fontSize: 15,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontWeight: 600,
              letterSpacing: '-0.01em',
              color: '#111',
            }}
          >
            snapfeed admin
          </Link>

          <nav
            aria-label="Primary"
            style={{ display: 'flex', gap: 4, alignItems: 'center' }}
          >
            {NAV_LINKS.map(l => (
              <Link
                key={l.href}
                href={l.href}
                style={{
                  padding: '6px 12px',
                  borderRadius: 6,
                  textDecoration: 'none',
                  color: '#374151',
                  fontSize: 13,
                  fontWeight: 500,
                }}
              >
                {l.label}
              </Link>
            ))}
          </nav>

          <div style={{ flex: 1 }} />

          {user ? (
            <div
              style={{
                fontSize: 12,
                color: '#6B7280',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <span
                title={user.id}
                style={{
                  padding: '2px 8px',
                  borderRadius: 999,
                  background: user.role === 'admin' ? '#FEE2E2' : '#E5E7EB',
                  color: user.role === 'admin' ? '#991B1B' : '#374151',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  fontSize: 10,
                }}
              >
                {user.role}
              </span>
              <span>{user.email}</span>
            </div>
          ) : null}
        </header>
        <main style={{ padding: '24px', maxWidth: 1200, margin: '0 auto' }}>
          {children}
        </main>
      </body>
    </html>
  )
}
