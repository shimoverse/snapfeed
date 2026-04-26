/**
 * Tests for src/routing-sources/googleSheets.ts
 *
 * We mock global fetch and assert request shape. We don't verify JWT signature
 * math — that's `node:crypto`'s job. We do clear the module-scoped token
 * cache between tests so caching behavior can be tested deterministically.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import {
  googleSheetsRoutingSource,
  __clearTokenCacheForTesting,
} from '../../src/routing-sources/googleSheets'

// Generate a real RSA keypair once for the suite. We sign actual JWTs in the
// source code under test, so a fake/malformed key would crash before the
// fetch mock ever sees a request.
let TEST_PRIVATE_KEY: string
let SERVICE_ACCOUNT: { client_email: string; private_key: string }

beforeAll(() => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  TEST_PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string
  SERVICE_ACCOUNT = {
    client_email: 'test@example.iam.gserviceaccount.com',
    private_key: TEST_PRIVATE_KEY,
  }
})

function tokenResponse(token = 'test-access-token', expiresIn = 3600): Response {
  return new Response(
    JSON.stringify({ access_token: token, expires_in: expiresIn }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
}

function valuesResponse(values: string[][]): Response {
  return new Response(JSON.stringify({ values }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  __clearTokenCacheForTesting()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('googleSheetsRoutingSource', () => {
  it('mints a JWT, exchanges for a token, then calls the Sheets API', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse('first-token'))
      .mockResolvedValueOnce(
        valuesResponse([
          ['match', 'flag', 'category', 'team', 'slack'],
          ['/x', '', '', 'team-x', '#x'],
        ])
      )
    vi.stubGlobal('fetch', fetchMock)

    const source = googleSheetsRoutingSource({
      spreadsheetId: 'sheet-abc',
      serviceAccount: SERVICE_ACCOUNT,
    })
    expect(source.name).toBe('googleSheets')

    const config = await source.fetch()
    expect(config).toBeDefined()
    expect(config!.routes).toHaveLength(1)
    expect(config!.routes[0]).toEqual({
      match: '/x',
      to: { team: 'team-x', slack: '#x' },
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0]!
    expect(tokenUrl).toBe('https://oauth2.googleapis.com/token')
    expect(tokenInit.method).toBe('POST')

    const [sheetsUrl, sheetsInit] = fetchMock.mock.calls[1]!
    expect(sheetsUrl).toContain('https://sheets.googleapis.com/v4/spreadsheets/')
    expect(sheetsUrl).toContain('sheet-abc')
    // Default range
    expect(sheetsUrl).toContain(encodeURIComponent('Routing!A:L'))
    expect(sheetsInit.headers.Authorization).toBe('Bearer first-token')
  })

  it('honors a custom range', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(valuesResponse([['match'], ['/y']]))
    vi.stubGlobal('fetch', fetchMock)

    const source = googleSheetsRoutingSource({
      spreadsheetId: 'sheet-abc',
      range: 'CustomTab!A:Z',
      serviceAccount: SERVICE_ACCOUNT,
    })
    await source.fetch()

    const sheetsUrl = fetchMock.mock.calls[1]![0]
    expect(sheetsUrl).toContain(encodeURIComponent('CustomTab!A:Z'))
  })

  it('returns undefined when values array is empty', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(valuesResponse([]))
    vi.stubGlobal('fetch', fetchMock)

    const source = googleSheetsRoutingSource({
      spreadsheetId: 'sheet-abc',
      serviceAccount: SERVICE_ACCOUNT,
    })
    const config = await source.fetch()
    expect(config).toBeUndefined()
  })

  it('returns undefined when the Sheets API call fails (no throw)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(new Response('forbidden', { status: 403 }))
    vi.stubGlobal('fetch', fetchMock)

    const source = googleSheetsRoutingSource({
      spreadsheetId: 'sheet-abc',
      serviceAccount: SERVICE_ACCOUNT,
    })
    const config = await source.fetch()
    expect(config).toBeUndefined()
  })

  it('caches the access token across fetches within ttl', async () => {
    const fetchMock = vi
      .fn()
      // First fetch: token + values
      .mockResolvedValueOnce(tokenResponse('cached-token'))
      .mockResolvedValueOnce(valuesResponse([['match'], ['/x']]))
      // Second fetch: only values — token should be reused.
      .mockResolvedValueOnce(valuesResponse([['match'], ['/x']]))
    vi.stubGlobal('fetch', fetchMock)

    const source = googleSheetsRoutingSource({
      spreadsheetId: 'sheet-abc',
      serviceAccount: SERVICE_ACCOUNT,
    })
    await source.fetch()
    await source.fetch()

    // 3 calls total: 1 token + 2 values. NOT 2 token calls.
    expect(fetchMock).toHaveBeenCalledTimes(3)
    const oauthCalls = fetchMock.mock.calls.filter(
      ([url]) => url === 'https://oauth2.googleapis.com/token'
    )
    expect(oauthCalls).toHaveLength(1)

    // Both Sheets calls used the cached token.
    const sheetsCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).startsWith('https://sheets.googleapis.com/')
    )
    for (const [, init] of sheetsCalls) {
      expect(init.headers.Authorization).toBe('Bearer cached-token')
    }
  })
})
