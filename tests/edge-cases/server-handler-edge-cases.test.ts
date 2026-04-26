/**
 * Edge-case coverage for the express middleware (`feedbackMiddleware`)
 * and the underlying security building blocks. The Next.js handler is hard
 * to exercise directly because it uses dynamic `import('next/server')`, so
 * we cover the express path which has identical request-lifecycle semantics.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { feedbackMiddleware } from '../../src/server/express'
import type {
  FeedbackAdapter,
  FeedbackHandlerConfig,
  FeedbackPayload,
  RateLimitStore,
} from '../../src/types'

// ─── Test shims ──────────────────────────────────────────────────────────────

interface MockResponse {
  status: ReturnType<typeof vi.fn>
  json: ReturnType<typeof vi.fn>
  set: ReturnType<typeof vi.fn>
  _status: number
  _body: unknown
  _headers: Record<string, string>
}

function makeRes(): MockResponse {
  const res: Partial<MockResponse> = {
    _status: 200,
    _body: undefined,
    _headers: {},
  }
  res.status = vi.fn((code: number) => {
    res._status = code
    return res as MockResponse
  })
  res.json = vi.fn((body: unknown) => {
    res._body = body
  })
  res.set = vi.fn((name: string, value: string) => {
    ;(res._headers as Record<string, string>)[name] = value
    return res as MockResponse
  })
  return res as MockResponse
}

function makeReq(overrides: {
  body?: unknown
  origin?: string
  ip?: string
  forwardedFor?: string
} = {}) {
  const headers: Record<string, string> = {}
  if (overrides.origin !== undefined) headers['origin'] = overrides.origin
  if (overrides.forwardedFor !== undefined)
    headers['x-forwarded-for'] = overrides.forwardedFor
  return {
    body: overrides.body,
    ip: overrides.ip,
    headers,
  }
}

function okAdapter(name = 'ok'): FeedbackAdapter {
  return {
    name,
    send: vi.fn(async () => ({ ok: true, deliveryId: 'id-1' })),
  }
}

function failAdapter(name = 'fail', err = 'kaboom'): FeedbackAdapter {
  return {
    name,
    send: vi.fn(async () => {
      throw new Error(err)
    }),
  }
}

function basePayload(overrides: Partial<FeedbackPayload> = {}): FeedbackPayload {
  return {
    text: 'something is broken on checkout',
    appName: 'Checkout',
    pageUrl: 'https://app.example.com/checkout',
    pageName: 'checkout',
    timestamp: '2026-04-25T12:00:00Z',
    ...overrides,
  }
}

// ─── Happy path / validation ─────────────────────────────────────────────────

describe('feedbackMiddleware — happy path & validation', () => {
  it('POST with valid payload returns 200 with results from all adapters', async () => {
    const a1 = okAdapter('a1')
    const a2 = okAdapter('a2')
    const handler = feedbackMiddleware({ adapters: [a1, a2] })

    const req = makeReq({ body: basePayload() })
    const res = makeRes()
    await handler(req, res, vi.fn())

    expect(res._status).toBe(200)
    expect((res._body as { success: boolean }).success).toBe(true)
    expect((res._body as { results: unknown[] }).results.length).toBe(2)
    expect(a1.send).toHaveBeenCalledTimes(1)
    expect(a2.send).toHaveBeenCalledTimes(1)
  })

  it('POST with empty body returns 400', async () => {
    const handler = feedbackMiddleware({ adapters: [okAdapter()] })
    const req = makeReq({ body: {} })
    const res = makeRes()
    await handler(req, res, vi.fn())

    expect(res._status).toBe(400)
    expect((res._body as { error: string }).error).toMatch(/text is required/i)
  })

  it('POST with text exceeding maxPayloadBytes returns 400 "too large"', async () => {
    const handler = feedbackMiddleware({
      adapters: [okAdapter()],
      maxPayloadBytes: 1000,
    })
    const req = makeReq({ body: basePayload({ text: 'a'.repeat(2000) }) })
    const res = makeRes()
    await handler(req, res, vi.fn())

    expect(res._status).toBe(400)
    expect((res._body as { error: string }).error).toMatch(/too large/i)
  })

  it('POST with screenshot exceeding maxScreenshotBytes returns 400 "too large"', async () => {
    const handler = feedbackMiddleware({
      adapters: [okAdapter()],
      maxScreenshotBytes: 1024 * 1024, // 1MB
    })
    const req = makeReq({
      body: {
        ...basePayload(),
        screenshot: { base64: 'A'.repeat(1_500_000), mimeType: 'image/png' },
      },
    })
    const res = makeRes()
    await handler(req, res, vi.fn())

    expect(res._status).toBe(400)
    expect((res._body as { error: string }).error).toMatch(/screenshot too large/i)
  })
})

// ─── Origin allowlist ────────────────────────────────────────────────────────

describe('feedbackMiddleware — origin checks', () => {
  it('returns 403 when origin not in allowlist', async () => {
    const handler = feedbackMiddleware({
      adapters: [okAdapter()],
      allowedOrigins: ['https://app.example.com'],
    })
    const req = makeReq({
      body: basePayload(),
      origin: 'https://evil.example.com',
    })
    const res = makeRes()
    await handler(req, res, vi.fn())

    expect(res._status).toBe(403)
    expect((res._body as { error: string }).error).toMatch(/origin/i)
  })

  it('returns 200 when origin matches allowlist', async () => {
    const handler = feedbackMiddleware({
      adapters: [okAdapter()],
      allowedOrigins: ['https://app.example.com'],
    })
    const req = makeReq({
      body: basePayload(),
      origin: 'https://app.example.com',
    })
    const res = makeRes()
    await handler(req, res, vi.fn())

    expect(res._status).toBe(200)
  })
})

// ─── Adapter result aggregation ──────────────────────────────────────────────

describe('feedbackMiddleware — adapter aggregation', () => {
  it('returns 503 when ALL adapters fail', async () => {
    const handler = feedbackMiddleware({
      adapters: [failAdapter('f1'), failAdapter('f2')],
    })
    const req = makeReq({ body: basePayload() })
    const res = makeRes()

    // Silence the console.error the handler emits in the all-fail path.
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await handler(req, res, vi.fn())
    errSpy.mockRestore()

    expect(res._status).toBe(503)
    expect((res._body as { error: string }).error).toMatch(/could not deliver/i)
  })

  it('partial failure: 1 of 3 adapters fails → 200 with mixed results', async () => {
    const a1 = okAdapter('a1')
    const a2 = failAdapter('a2', 'flaky')
    const a3 = okAdapter('a3')
    const handler = feedbackMiddleware({ adapters: [a1, a2, a3] })

    const req = makeReq({ body: basePayload() })
    const res = makeRes()
    await handler(req, res, vi.fn())

    expect(res._status).toBe(200)
    const results = (res._body as { results: Array<{ ok: boolean; error?: string }> }).results
    expect(results.length).toBe(3)
    expect(results.filter(r => r.ok).length).toBe(2)
    expect(results.filter(r => !r.ok).length).toBe(1)
    expect(results.find(r => !r.ok)?.error).toMatch(/flaky/)
  })
})

// ─── onReceive / onComplete hooks ────────────────────────────────────────────

describe('feedbackMiddleware — hooks', () => {
  it('onReceive returning false returns 403 "rejected" and skips adapters', async () => {
    const adapter = okAdapter()
    const handler = feedbackMiddleware({
      adapters: [adapter],
      onReceive: vi.fn(async () => false),
    })
    const req = makeReq({ body: basePayload() })
    const res = makeRes()
    await handler(req, res, vi.fn())

    expect(res._status).toBe(403)
    expect((res._body as { error: string }).error).toMatch(/rejected/i)
    expect(adapter.send).not.toHaveBeenCalled()
  })

  it('onComplete is awaited even when one adapter fails (as long as one succeeds)', async () => {
    const onComplete = vi.fn(async () => {})
    const handler = feedbackMiddleware({
      adapters: [okAdapter('ok-a'), failAdapter('fail-b')],
      onComplete,
    })

    const req = makeReq({ body: basePayload() })
    const res = makeRes()
    await handler(req, res, vi.fn())

    expect(res._status).toBe(200)
    expect(onComplete).toHaveBeenCalledTimes(1)
    const [, results] = onComplete.mock.calls[0]
    expect((results as Array<{ ok: boolean }>).length).toBe(2)
    expect((results as Array<{ ok: boolean }>).filter(r => r.ok).length).toBe(1)
  })
})

// ─── Rate limit ──────────────────────────────────────────────────────────────

describe('feedbackMiddleware — rate limit', () => {
  // Use a fresh ip per test so the module-level memoryStore Map doesn't bleed.
  let ip: string
  beforeEach(() => {
    ip = `1.2.3.${Math.floor(Math.random() * 255)}-${Date.now()}`
  })

  it('returns 429 with Retry-After header after limit hit', async () => {
    const handler = feedbackMiddleware({
      adapters: [okAdapter()],
      rateLimit: { max: 2, windowMs: 60_000 },
    })

    const send = async () => {
      const req = makeReq({ body: basePayload(), ip })
      const res = makeRes()
      await handler(req, res, vi.fn())
      return res
    }

    const r1 = await send()
    const r2 = await send()
    const r3 = await send()

    expect(r1._status).toBe(200)
    expect(r2._status).toBe(200)
    expect(r3._status).toBe(429)
    expect(r3._headers['Retry-After']).toBeDefined()
    expect(Number(r3._headers['Retry-After'])).toBeGreaterThanOrEqual(0)
    expect(r3._headers['X-RateLimit-Remaining']).toBe('0')
  })

  it('custom rate limit store is called with the ip key', async () => {
    const customStore: RateLimitStore = {
      increment: vi.fn(async () => ({
        count: 1,
        resetAt: Date.now() + 60_000,
      })),
    }
    const handler = feedbackMiddleware({
      adapters: [okAdapter()],
      rateLimit: { max: 10, windowMs: 60_000, store: customStore },
    })

    const req = makeReq({ body: basePayload(), ip })
    const res = makeRes()
    await handler(req, res, vi.fn())

    expect(customStore.increment).toHaveBeenCalledTimes(1)
    expect((customStore.increment as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(ip)
    expect((customStore.increment as ReturnType<typeof vi.fn>).mock.calls[0][1]).toBe(60_000)
  })
})

// ─── Unicode (UTF-8 byte counting) ───────────────────────────────────────────

describe('feedbackMiddleware — unicode payload byte counting', () => {
  it('emoji-laden text is sized in UTF-8 bytes (4 bytes per emoji), not chars', async () => {
    // Build a text that's small in JS char-length but exceeds maxPayloadBytes
    // when counted in UTF-8 bytes. Each "rocket" emoji is 4 UTF-8 bytes but 2
    // UTF-16 code units. 300 rockets = 1200 UTF-8 bytes, 600 chars.
    const text = '\u{1F680}'.repeat(300)
    expect(text.length).toBeLessThan(1200) // sanity: char-length is smaller
    const handler = feedbackMiddleware({
      adapters: [okAdapter()],
      maxPayloadBytes: 1000, // 1000 bytes limit
    })

    const req = makeReq({ body: basePayload({ text }) })
    const res = makeRes()
    await handler(req, res, vi.fn())

    // If the byte-count was wrong (counting chars), 600 < 1000 would pass.
    // The TextEncoder fix ensures we measure 1200 actual UTF-8 bytes → reject.
    expect(res._status).toBe(400)
    expect((res._body as { error: string }).error).toMatch(/too large/i)
  })

  it('emoji text within byte budget passes', async () => {
    const text = '\u{1F680}'.repeat(50) // 200 UTF-8 bytes
    const handler = feedbackMiddleware({
      adapters: [okAdapter()],
      maxPayloadBytes: 1000,
    })

    const req = makeReq({ body: basePayload({ text }) })
    const res = makeRes()
    await handler(req, res, vi.fn())

    expect(res._status).toBe(200)
  })
})
