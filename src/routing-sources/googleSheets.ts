/**
 * snapfeed — Google Sheets Routing Source (Tier 2, Node-only)
 *
 * Same `match,flag,category,...` schema as `csvRoutingSource`, but pulled
 * live from a Google Sheet so non-engineers can edit routing in a tab they
 * already use. Auth uses a service account (JWT → OAuth2 access token);
 * no user OAuth flow needed.
 *
 * Mirrors the JWT signing approach in `src/adapters/googleSheets.ts` rather
 * than importing from it, because:
 *   1. The adapter is for *writing* (scope = spreadsheets); this source is
 *      read-only (scope = spreadsheets.readonly), and we want least-privilege.
 *   2. Coupling Tier-2 routing infra to a specific destination adapter would
 *      make the dependency graph awkward (routing imports adapters).
 *
 * The token cache is module-scoped and keyed on `client_email`. Tokens live
 * for an hour; we refresh ~60s early to avoid edge-of-window 401s.
 */

import type { RoutingConfig, RoutingDestination, RoutingRule } from '../routing'
import type { RoutingSource } from './types'

export interface GoogleSheetsRoutingSourceOptions {
  spreadsheetId: string
  /**
   * Sheet name + range, A1 notation.
   * @default 'Routing!A:L'
   */
  range?: string
  serviceAccount: { client_email: string; private_key: string }
  /**
   * Same default-row convention as csvRoutingSource.
   * @default true
   */
  treatDefaultRow?: boolean
}

const EXPECTED_COLUMNS = [
  'match',
  'flag',
  'category',
  'team',
  'slack',
  'jira',
  'linear',
  'github',
  'discord',
  'sheet',
  'assignee',
  'labels',
] as const

type ColumnName = (typeof EXPECTED_COLUMNS)[number]
const DEFAULT_SENTINEL = '*default*'

interface CachedToken {
  accessToken: string
  expiresAt: number
}

// Module-scoped so multiple sources sharing the same service account share
// the token. Keyed on client_email.
const tokenCache = new Map<string, CachedToken>()

function base64UrlEncode(input: string | Uint8Array): string {
  const buf =
    typeof input === 'string' ? Buffer.from(input, 'utf8') : Buffer.from(input)
  return buf
    .toString('base64')
    .replace(/=+$/u, '')
    .replace(/\+/gu, '-')
    .replace(/\//gu, '_')
}

async function mintAccessToken(serviceAccount: {
  client_email: string
  private_key: string
}): Promise<string> {
  const cacheKey = serviceAccount.client_email
  const cached = tokenCache.get(cacheKey)
  if (cached && cached.expiresAt - 60_000 > Date.now()) {
    return cached.accessToken
  }

  const { createSign } = await import('node:crypto')

  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const claims = {
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  }

  const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(
    JSON.stringify(claims)
  )}`

  const signer = createSign('RSA-SHA256')
  signer.update(signingInput)
  signer.end()
  const signature = signer.sign(serviceAccount.private_key)
  const jwt = `${signingInput}.${base64UrlEncode(signature)}`

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }).toString(),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Token exchange failed (${res.status}): ${text.slice(0, 200)}`)
  }

  const data = (await res.json()) as { access_token: string; expires_in: number }
  tokenCache.set(cacheKey, {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  })
  return data.access_token
}

export function googleSheetsRoutingSource(
  options: GoogleSheetsRoutingSourceOptions
): RoutingSource {
  const {
    spreadsheetId,
    range = 'Routing!A:L',
    serviceAccount,
    treatDefaultRow = true,
  } = options

  return {
    name: 'googleSheets',
    async fetch(): Promise<RoutingConfig | undefined> {
      let token: string
      try {
        token = await mintAccessToken(serviceAccount)
      } catch {
        return undefined
      }

      let values: string[][]
      try {
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
          spreadsheetId
        )}/values/${encodeURIComponent(range)}`
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) return undefined
        const data = (await res.json()) as { values?: string[][] }
        values = data.values ?? []
      } catch {
        return undefined
      }

      if (values.length === 0) return undefined

      const headerCells = (values[0] ?? []).map((c) =>
        String(c ?? '').trim().toLowerCase()
      )
      const columnIndex: Partial<Record<ColumnName, number>> = {}
      for (const col of EXPECTED_COLUMNS) {
        const idx = headerCells.indexOf(col)
        if (idx !== -1) columnIndex[col] = idx
      }

      const routes: RoutingRule[] = []
      let defaultDest: RoutingDestination | undefined

      for (let r = 1; r < values.length; r++) {
        const row = values[r] ?? []
        if (row.length === 0 || row.every((c) => String(c ?? '').trim() === '')) {
          continue
        }

        const get = (name: ColumnName): string | undefined => {
          const idx = columnIndex[name]
          if (idx === undefined) return undefined
          const raw = row[idx]
          if (raw === undefined || raw === null) return undefined
          const trimmed = String(raw).trim()
          return trimmed === '' ? undefined : trimmed
        }

        const match = get('match')
        const dest: RoutingDestination = {
          team: get('team'),
          slack: get('slack'),
          jira: get('jira'),
          linear: get('linear'),
          github: get('github'),
          discord: get('discord'),
          sheet: get('sheet'),
          assignee: get('assignee'),
          labels: parseLabels(get('labels')),
        }
        for (const key of Object.keys(dest) as (keyof RoutingDestination)[]) {
          if (dest[key] === undefined) delete dest[key]
        }

        if (
          treatDefaultRow &&
          match !== undefined &&
          match.toLowerCase() === DEFAULT_SENTINEL
        ) {
          defaultDest = dest
          continue
        }

        const rule: RoutingRule = { to: dest }
        if (match !== undefined) rule.match = match
        const flag = get('flag')
        if (flag !== undefined) rule.flag = flag
        const category = get('category')
        if (category !== undefined) rule.category = category

        routes.push(rule)
      }

      const config: RoutingConfig = { routes }
      if (defaultDest) config.default = defaultDest
      return config
    },
  }
}

function parseLabels(raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined
  const parts = raw
    .split(';')
    .map((p) => p.trim())
    .filter((p) => p !== '')
  return parts.length === 0 ? undefined : parts
}

// Test-only helper to clear the module-scoped token cache between cases.
// Kept private to the module; tests reach in via `import * as`.
export function __clearTokenCacheForTesting(): void {
  tokenCache.clear()
}
