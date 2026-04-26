/**
 * snapfeed admin — Auth shim (placeholder)
 *
 * This file is a deliberately minimal placeholder for whatever real auth your
 * organisation runs in front of internal tools. The expected production
 * topology is: a reverse proxy (oauth2-proxy, Pomerium, Cloudflare Access,
 * Google IAP, etc.) terminates SSO and forwards an identity header to this
 * Next.js app. We read that header here. If you don't have a proxy in front,
 * you can flip `SNAPFEED_ADMIN_BYPASS=1` for local development; in any other
 * environment the absence of the header throws a 401-shaped error so a
 * misconfigured deploy fails closed instead of leaking the inbox.
 *
 * For v0.6 we expect to ship a first-class auth adapter (NextAuth + a SAML/
 * OIDC bridge). Until then, treat this module as the single seam where you
 * wire your own identity layer.
 */

import { headers } from 'next/headers'

export interface AdminUser {
  id: string
  email: string
  role: 'admin' | 'viewer'
}

export class UnauthorizedError extends Error {
  readonly status = 401
  constructor(message = 'Unauthorized') {
    super(message)
    this.name = 'UnauthorizedError'
  }
}

/**
 * Read the current admin user from the request.
 *
 * Call this from server components, server actions, and route handlers. It
 * throws `UnauthorizedError` if no identity could be resolved — let it
 * propagate; Next.js will render the error boundary, or in a route handler
 * you can catch and return a 401 JSON response.
 *
 * Resolution order:
 *   1. `SNAPFEED_ADMIN_BYPASS=1`   — dev convenience, returns a stub admin.
 *   2. `x-snapfeed-admin-user`     — set by your reverse proxy after SSO.
 *      Optional companion headers: `x-snapfeed-admin-email`,
 *      `x-snapfeed-admin-role` (defaults to "admin").
 *   3. Otherwise → throw.
 */
export function requireUser(): AdminUser {
  if (process.env.SNAPFEED_ADMIN_BYPASS === '1') {
    return {
      id: 'dev-bypass',
      email: 'dev@localhost',
      role: 'admin',
    }
  }

  const h = headers()
  const id = h.get('x-snapfeed-admin-user')
  if (!id || id.trim() === '') {
    throw new UnauthorizedError(
      'No admin identity found. Configure your reverse proxy to forward x-snapfeed-admin-user, or set SNAPFEED_ADMIN_BYPASS=1 for local dev.',
    )
  }
  const email = h.get('x-snapfeed-admin-email') ?? id
  const roleHeader = h.get('x-snapfeed-admin-role')?.toLowerCase()
  const role: AdminUser['role'] = roleHeader === 'viewer' ? 'viewer' : 'admin'
  return { id, email, role }
}

/**
 * Soft variant — returns null instead of throwing. Useful for layout-level
 * banners ("Logged in as …") that shouldn't crash the page.
 */
export function tryGetUser(): AdminUser | null {
  try {
    return requireUser()
  } catch {
    return null
  }
}
