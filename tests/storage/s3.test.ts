/**
 * Tests for src/storage/s3.ts — s3Storage()
 *
 * `fetch` is stubbed via `vi.stubGlobal`. We don't reproduce AWS's exact
 * signature math; we verify the URL shape, header shape, and the sigv4
 * algorithm/credential-scope/SignedHeaders structure of the Authorization
 * header — which is what would catch a regression in our signing path.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { s3Storage } from '../../src/storage/s3'
import type { StorageUploadInput } from '../../src/storage/types'

interface CapturedRequest {
  url: string
  method: string
  headers: Record<string, string>
  body: Uint8Array
}

function stubFetch(opts: {
  status?: number
  statusText?: string
  body?: string
} = {}) {
  const captured: CapturedRequest[] = []

  const fakeFetch = vi.fn(async (input: unknown, init?: unknown) => {
    const url = typeof input === 'string' ? input : String(input)
    const initObj = (init as {
      method?: string
      headers?: Record<string, string>
      body?: Uint8Array
    }) ?? {}

    captured.push({
      url,
      method: initObj.method ?? 'GET',
      headers: { ...(initObj.headers ?? {}) },
      body: initObj.body ?? new Uint8Array(),
    })

    const status = opts.status ?? 200
    const statusText = opts.statusText ?? 'OK'
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText,
      text: async () => opts.body ?? '',
    } as unknown as Response
  })

  vi.stubGlobal('fetch', fakeFetch)
  return { captured, fakeFetch }
}

const baseInput: StorageUploadInput = {
  bytes: new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
  mimeType: 'image/png',
  filename: 'shot.png',
}

const baseOpts = {
  bucket: 'my-bucket',
  region: 'us-east-1',
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('s3Storage URL construction', () => {
  it('uses virtual-hosted-style by default (bucket.s3.<region>.amazonaws.com)', async () => {
    const { captured } = stubFetch()
    const adapter = s3Storage(baseOpts)
    await adapter.upload(baseInput)

    expect(captured).toHaveLength(1)
    expect(captured[0]!.method).toBe('PUT')
    expect(captured[0]!.url).toBe('https://my-bucket.s3.us-east-1.amazonaws.com/shot.png')
    expect(captured[0]!.headers['host']).toBe('my-bucket.s3.us-east-1.amazonaws.com')
  })

  it('switches to path-style when forcePathStyle: true', async () => {
    const { captured } = stubFetch()
    const adapter = s3Storage({
      ...baseOpts,
      endpoint: 'http://localhost:9000',
      forcePathStyle: true,
    })
    await adapter.upload(baseInput)

    expect(captured[0]!.url).toBe('http://localhost:9000/my-bucket/shot.png')
    expect(captured[0]!.headers['host']).toBe('localhost:9000')
  })

  it('uses a custom endpoint (R2)', async () => {
    const { captured } = stubFetch()
    const adapter = s3Storage({
      ...baseOpts,
      region: 'auto',
      endpoint: 'https://acct123.r2.cloudflarestorage.com',
    })
    await adapter.upload(baseInput)

    expect(captured[0]!.url).toBe(
      'https://my-bucket.acct123.r2.cloudflarestorage.com/shot.png'
    )
    expect(captured[0]!.headers['host']).toBe('my-bucket.acct123.r2.cloudflarestorage.com')
  })
})

describe('s3Storage signing headers', () => {
  it('Authorization header has AWS4-HMAC-SHA256, scoped credential, and signed-headers list', async () => {
    const { captured } = stubFetch()
    const adapter = s3Storage(baseOpts)
    await adapter.upload(baseInput)

    const auth = captured[0]!.headers['Authorization']
    expect(auth).toBeDefined()
    expect(auth).toMatch(/^AWS4-HMAC-SHA256 /)
    // Credential=<key>/<YYYYMMDD>/<region>/s3/aws4_request
    expect(auth).toMatch(
      /Credential=AKIAIOSFODNN7EXAMPLE\/\d{8}\/us-east-1\/s3\/aws4_request/
    )
    expect(auth).toMatch(/SignedHeaders=[a-z0-9;-]+/)
    expect(auth).toMatch(/Signature=[a-f0-9]{64}/)

    // The signed-headers list MUST include the canonical trio.
    const signedMatch = auth.match(/SignedHeaders=([^,]+)/)
    expect(signedMatch).not.toBeNull()
    const signedHeaders = signedMatch![1]!.split(';')
    expect(signedHeaders).toEqual(expect.arrayContaining(['host', 'x-amz-content-sha256', 'x-amz-date']))
  })

  it('x-amz-content-sha256 equals sha256(body)', async () => {
    const { captured } = stubFetch()
    const adapter = s3Storage(baseOpts)
    await adapter.upload(baseInput)

    const expected = createHash('sha256').update(baseInput.bytes).digest('hex')
    expect(captured[0]!.headers['x-amz-content-sha256']).toBe(expected)
  })

  it('attaches Content-Type and Content-Length from the input', async () => {
    const { captured } = stubFetch()
    const adapter = s3Storage(baseOpts)
    await adapter.upload(baseInput)

    expect(captured[0]!.headers['content-type']).toBe('image/png')
    expect(captured[0]!.headers['content-length']).toBe(String(baseInput.bytes.byteLength))
  })

  it('adds x-amz-acl when acl option is set, and includes it in SignedHeaders', async () => {
    const { captured } = stubFetch()
    const adapter = s3Storage({ ...baseOpts, acl: 'public-read' })
    await adapter.upload(baseInput)

    expect(captured[0]!.headers['x-amz-acl']).toBe('public-read')
    const auth = captured[0]!.headers['Authorization']!
    const signedHeaders = auth.match(/SignedHeaders=([^,]+)/)![1]!.split(';')
    expect(signedHeaders).toContain('x-amz-acl')
  })
})

describe('s3Storage key + URL overrides', () => {
  it('honors a custom toKey', async () => {
    const { captured } = stubFetch()
    const adapter = s3Storage({
      ...baseOpts,
      toKey: (input) => `screenshots/2026/${input.filename}`,
    })
    const result = await adapter.upload(baseInput)

    expect(captured[0]!.url).toBe(
      'https://my-bucket.s3.us-east-1.amazonaws.com/screenshots/2026/shot.png'
    )
    expect(result.deliveryId).toBe('screenshots/2026/shot.png')
  })

  it('honors a custom toUrl for the public URL', async () => {
    stubFetch()
    const adapter = s3Storage({
      ...baseOpts,
      toUrl: (key, region, bucket) => `https://cdn.example.com/${bucket}/${region}/${key}`,
    })
    const result = await adapter.upload(baseInput)
    expect(result.url).toBe('https://cdn.example.com/my-bucket/us-east-1/shot.png')
  })
})

describe('s3Storage construction validation', () => {
  it('throws if endpoint host already starts with `${bucket}.`', () => {
    expect(() =>
      s3Storage({
        ...baseOpts,
        bucket: 'my-bucket',
        // User mistake: pre-baked the bucket into the endpoint host. Without
        // the guard, buildUrl would produce my-bucket.my-bucket.host and
        // every PUT would 404 with an opaque signing-mismatch error.
        endpoint: 'https://my-bucket.s3.us-east-1.amazonaws.com',
      })
    ).toThrow(/endpoint must not include the bucket name/i)
  })

  it('accepts an endpoint whose host has the bucket name as a SUFFIX (no false positive)', () => {
    // e.g. another-bucket.s3.amazonaws.com should NOT trip the guard for
    // bucket=`bucket`. Only a leading `${bucket}.` is rejected.
    expect(() =>
      s3Storage({
        ...baseOpts,
        bucket: 'bucket',
        endpoint: 'https://another-bucket.s3.us-east-1.amazonaws.com',
      })
    ).not.toThrow()
  })

  it('throws a clear error when endpoint is not a valid URL', () => {
    expect(() =>
      s3Storage({ ...baseOpts, endpoint: 'not a url at all' })
    ).toThrow(/not a valid URL/i)
  })

  it('does not throw when endpoint is omitted (AWS default)', () => {
    expect(() => s3Storage(baseOpts)).not.toThrow()
  })
})

describe('s3Storage error handling', () => {
  it('throws an Error containing the status and truncated body on non-2xx', async () => {
    stubFetch({
      status: 403,
      statusText: 'Forbidden',
      body: '<Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>',
    })
    const adapter = s3Storage(baseOpts)

    await expect(adapter.upload(baseInput)).rejects.toThrow(
      /s3Storage upload failed: 403 Forbidden.*AccessDenied/s
    )
  })

  it('truncates very long error bodies', async () => {
    const longBody = 'A'.repeat(2_000)
    stubFetch({ status: 500, statusText: 'Internal Server Error', body: longBody })
    const adapter = s3Storage(baseOpts)

    let caught: unknown = null
    try {
      await adapter.upload(baseInput)
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(Error)
    const message = (caught as Error).message
    // 500 + truncation marker present, but not the entire 2000-char body.
    expect(message).toContain('500 Internal Server Error')
    expect(message.length).toBeLessThan(longBody.length)
    expect(message).toContain('…')
  })
})
