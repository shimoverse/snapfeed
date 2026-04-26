import type { FeedbackAdapter, FeedbackAdapterResult, FeedbackPayload } from './types'

export interface GoogleSheetsServiceAccount {
  client_email: string
  /**
   * PEM-encoded RSA private key. Must contain real newlines, not the
   * literal `\n` sequence that env vars often store.
   *
   * @example
   *   serviceAccount: {
   *     client_email: process.env.GOOGLE_CLIENT_EMAIL!,
   *     private_key: process.env.GOOGLE_PRIVATE_KEY!.replace(/\\n/g, '\n'),
   *   }
   */
  private_key: string
}

export interface GoogleSheetsAdapterOptions {
  /** Spreadsheet ID (the long string in the sheet URL) */
  spreadsheetId: string
  /**
   * A1-notation range to append to.
   * @default "Feedback!A:K"
   */
  range?: string
  /** Service account credentials with Sheets API access */
  serviceAccount: GoogleSheetsServiceAccount
  /**
   * Sheet (tab) name used for header detection.
   * @default "Feedback"
   */
  sheetName?: string
  /**
   * If the target range is empty on first call, write a header row before
   * appending data.
   * @default true
   */
  createHeaderIfEmpty?: boolean
}

interface CachedToken {
  accessToken: string
  /** ms epoch when the token expires */
  expiresAt: number
  /** key derived from client_email so multiple service accounts don't collide */
  key: string
}

const HEADER_ROW = [
  'timestamp',
  'appName',
  'category',
  'text',
  'pageName',
  'pageUrl',
  'reporterName',
  'reporterEmail',
  'severity',
  'userAgent',
  'viewport',
]

const tokenCache = new Map<string, CachedToken>()
// Promise-cached header check, keyed by spreadsheetId+range. Concurrent
// first-time `send()` calls share the same in-flight check, eliminating
// the race that previously wrote the header row multiple times.
const headerCheckPromises = new Map<string, Promise<void>>()

function base64UrlEncode(input: string | Uint8Array): string {
  const buf =
    typeof input === 'string' ? Buffer.from(input, 'utf8') : Buffer.from(input)
  return buf
    .toString('base64')
    .replace(/=+$/u, '')
    .replace(/\+/gu, '-')
    .replace(/\//gu, '_')
}

async function mintAccessToken(
  serviceAccount: GoogleSheetsServiceAccount
): Promise<string> {
  const cacheKey = serviceAccount.client_email
  const cached = tokenCache.get(cacheKey)
  // Refresh ~60s before actual expiry to avoid edge-of-window 401s.
  if (cached && cached.expiresAt - 60_000 > Date.now()) {
    return cached.accessToken
  }

  const { createSign } = await import('node:crypto')

  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const claims = {
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
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
    key: cacheKey,
  })
  return data.access_token
}

function invalidateToken(serviceAccount: GoogleSheetsServiceAccount): void {
  tokenCache.delete(serviceAccount.client_email)
}

async function fetchValues(
  spreadsheetId: string,
  range: string,
  accessToken: string
): Promise<unknown[][] | null> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
    spreadsheetId
  )}/values/${encodeURIComponent(range)}`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) return null
  const data = (await res.json()) as { values?: unknown[][] }
  return data.values ?? []
}

async function appendValues(
  spreadsheetId: string,
  range: string,
  rows: unknown[][],
  accessToken: string
): Promise<Response> {
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}` +
    `/values/${encodeURIComponent(range)}:append` +
    `?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`

  return fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ values: rows }),
  })
}

/**
 * Google Sheets adapter — appends each feedback as a row to a sheet using a
 * service account.
 *
 * **Node only.** This adapter signs JWTs with `node:crypto` and will return an
 * error in browser/edge runtimes that lack `process.versions.node`.
 *
 * **Private key gotcha:** environment variables typically encode newlines as
 * the literal two-character sequence `\n`. Convert before passing in:
 *
 * ```ts
 * googleSheetsAdapter({
 *   spreadsheetId: process.env.SHEET_ID!,
 *   serviceAccount: {
 *     client_email: process.env.GOOGLE_CLIENT_EMAIL!,
 *     private_key: process.env.GOOGLE_PRIVATE_KEY!.replace(/\\n/g, '\n'),
 *   },
 * })
 * ```
 */
export function googleSheetsAdapter(
  options: GoogleSheetsAdapterOptions
): FeedbackAdapter {
  const {
    spreadsheetId,
    range = 'Feedback!A:K',
    serviceAccount,
    sheetName = 'Feedback',
    createHeaderIfEmpty = true,
  } = options

  const headerKey = `${spreadsheetId}::${sheetName}`

  return {
    name: 'googleSheets',
    async send(payload: FeedbackPayload): Promise<FeedbackAdapterResult> {
      if (!(globalThis as { process?: { versions?: { node?: string } } }).process
        ?.versions?.node) {
        return {
          ok: false,
          error:
            'googleSheetsAdapter requires Node — service account auth uses node:crypto',
        }
      }

      const row: unknown[] = [
        payload.timestamp,
        payload.appName,
        payload.category ?? '',
        payload.text,
        payload.pageName ?? '',
        payload.pageUrl ?? '',
        payload.user?.name ?? '',
        payload.user?.email ?? '',
        '', // severity placeholder
        payload.metadata?.userAgent ?? '',
        payload.metadata?.viewport ?? '',
      ]

      const doSend = async (token: string): Promise<Response> => {
        if (createHeaderIfEmpty) {
          // Promise-cached: every concurrent first-time call awaits the same
          // header-check promise. On failure, drop the cache so the next call
          // can retry.
          let p = headerCheckPromises.get(headerKey)
          if (!p) {
            p = (async () => {
              const existing = await fetchValues(spreadsheetId, range, token)
              if (existing && existing.length === 0) {
                await appendValues(spreadsheetId, range, [HEADER_ROW], token)
              }
            })()
            headerCheckPromises.set(headerKey, p)
            p.catch(() => headerCheckPromises.delete(headerKey))
          }
          await p
        }
        return appendValues(spreadsheetId, range, [row], token)
      }

      try {
        let token = await mintAccessToken(serviceAccount)
        let res = await doSend(token)

        if (res.status === 401) {
          // Token may have been revoked or expired between mint and use.
          invalidateToken(serviceAccount)
          token = await mintAccessToken(serviceAccount)
          res = await doSend(token)
        }

        if (!res.ok) {
          const text = await res.text().catch(() => '')
          return {
            ok: false,
            error: `Google Sheets returned ${res.status}: ${text.slice(0, 200)}`,
          }
        }

        const data = (await res.json().catch(() => ({}))) as {
          updates?: { updatedRange?: string }
        }
        return {
          ok: true,
          deliveryId: data.updates?.updatedRange ?? 'googleSheets:append',
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { ok: false, error: `Google Sheets adapter error: ${message}` }
      }
    },
  }
}
