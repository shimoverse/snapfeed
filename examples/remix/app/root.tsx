import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from '@remix-run/react'
import type { LinksFunction, MetaFunction } from '@remix-run/node'
import { SnapfeedProviderClient } from './snapfeed-provider'

export const meta: MetaFunction = () => [
  { title: 'snapfeed example — Remix' },
  {
    name: 'description',
    content: 'A minimal Remix app showing the snapfeed feedback widget.',
  },
]

export const links: LinksFunction = () => []

export default function App() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body
        style={{
          margin: 0,
          fontFamily:
            'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          background: '#FAFAF7',
          color: '#111',
        }}
      >
        <SnapfeedProviderClient>
          <Outlet />
        </SnapfeedProviderClient>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  )
}
