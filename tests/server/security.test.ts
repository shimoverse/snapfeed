/**
 * Tests for src/server/security.ts
 *
 * Covers payload validation, origin checking, the in-memory rate-limit store,
 * and the secret-redaction regex applied to metadata.consoleErrors.
 *
 * Note: `sanitizeConsoleError` is not exported directly. We exercise it via
 * `validatePayload`, which calls it on `payload.metadata.consoleErrors`.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  validatePayload,
  checkOrigin,
  defaultRateLimitStore,
} from '../../src/server/security'
import type { FeedbackHandlerConfig } from '../../src/types'

const baseConfig: FeedbackHandlerConfig = {
  adapters: [],
}

// ─── validatePayload ─────────────────────────────────────────────────────────

describe('validatePayload', () => {
  it('accepts a valid minimal payload', () => {
    const result = validatePayload(
      {
        text: 'Something is broken',
        appName: 'TestApp',
        pageUrl: 'https://example.com/page',
      },
      baseConfig
    )
    expect(result.valid).toBe(true)
    expect(result.error).toBeUndefined()
  })

  it('rejects when body is null', () => {
    const result = validatePayload(null, baseConfig)
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/invalid request body/i)
  })

  it('rejects when body is not an object (string)', () => {
    const result = validatePayload('not-an-object', baseConfig)
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/invalid request body/i)
  })

  it('rejects when text is missing', () => {
    const result = validatePayload({ appName: 'X', pageUrl: 'https://x.com' }, baseConfig)
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/text is required/i)
  })

  it('rejects when text is empty string', () => {
    const result = validatePayload({ text: '' }, baseConfig)
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/text is required/i)
  })

  it('rejects when text is whitespace only', () => {
    const result = validatePayload({ text: '   \n\t  ' }, baseConfig)
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/text is required/i)
  })

  it('rejects when text is the wrong type (number)', () => {
    const result = validatePayload({ text: 12345 }, baseConfig)
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/text is required/i)
  })

  it('rejects oversized text (> 64,000 chars)', () => {
    const result = validatePayload({ text: 'a'.repeat(64_001) }, baseConfig)
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/too long/i)
  })

  it('rejects when text + metadata exceeds maxPayloadBytes', () => {
    const result = validatePayload(
      { text: 'a'.repeat(20_000) },
      { adapters: [], maxPayloadBytes: 10_000 }
    )
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/payload too large/i)
  })

  it('rejects oversized screenshot', () => {
    // 1MB max => limit is 1024*1024 raw bytes => need base64 length
    // such that estimatedBytes > 1MB. base64 -> raw is *3/4, so > ~1.4M base64 chars.
    const big = 'A'.repeat(1_500_000)
    const result = validatePayload(
      {
        text: 'hello',
        screenshot: { base64: big, mimeType: 'image/png' },
      },
      { adapters: [], maxScreenshotBytes: 1024 * 1024 }
    )
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/screenshot too large/i)
  })

  it('accepts a screenshot under the limit', () => {
    const result = validatePayload(
      {
        text: 'hello',
        screenshot: { base64: 'AAAA', mimeType: 'image/png' },
      },
      baseConfig
    )
    expect(result.valid).toBe(true)
  })

  it('redacts secrets in metadata.consoleErrors', () => {
    const payload = {
      text: 'hi',
      metadata: {
        viewport: '1024x768',
        userAgent: 'test',
        consoleErrors: [
          'request failed token=abc123def',
          'Bearer eyJhbGciOiJIUzI1NiJ9.abc.def',
          'normal log line, nothing sensitive',
        ],
      },
    }
    validatePayload(payload, baseConfig)
    const cleaned = payload.metadata.consoleErrors
    expect(cleaned[0]).toContain('[REDACTED]')
    expect(cleaned[0]).not.toContain('abc123def')
    // 'Bearer ...' AND the JWT itself match → both should be redacted
    expect(cleaned[1]).toContain('[REDACTED]')
    expect(cleaned[1]).not.toContain('eyJhbGciOiJIUzI1NiJ9')
    expect(cleaned[2]).toBe('normal log line, nothing sensitive')
  })

  it('redacts a bare JWT-looking string', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
    const payload = {
      text: 'hi',
      metadata: {
        viewport: '1x1',
        userAgent: 'ua',
        consoleErrors: [`error: ${jwt}`],
      },
    }
    validatePayload(payload, baseConfig)
    expect(payload.metadata.consoleErrors[0]).toContain('[REDACTED]')
    expect(payload.metadata.consoleErrors[0]).not.toContain(jwt)
  })
})

// ─── checkOrigin ─────────────────────────────────────────────────────────────

describe('checkOrigin', () => {
  it('returns true when no allowlist configured (undefined)', () => {
    expect(checkOrigin('https://anywhere.com', undefined)).toBe(true)
  })

  it('returns true when allowlist is empty array', () => {
    expect(checkOrigin('https://anywhere.com', [])).toBe(true)
  })

  it('returns false when origin is missing but allowlist exists', () => {
    expect(checkOrigin(null, ['https://app.com'])).toBe(false)
    expect(checkOrigin(undefined, ['https://app.com'])).toBe(false)
  })

  it('accepts exact string match', () => {
    expect(checkOrigin('https://app.com', ['https://app.com'])).toBe(true)
  })

  it('rejects when string does not match', () => {
    expect(checkOrigin('https://evil.com', ['https://app.com'])).toBe(false)
  })

  it('accepts when regex matches', () => {
    expect(
      checkOrigin('https://staging.app.com', [/\.app\.com$/])
    ).toBe(true)
  })

  it('rejects when regex does not match', () => {
    expect(checkOrigin('https://app.evil.com', [/\.app\.com$/])).toBe(false)
  })

  it('matches against any entry in a mixed allowlist', () => {
    expect(
      checkOrigin('https://staging.app.com', [
        'https://app.com',
        /\.app\.com$/,
      ])
    ).toBe(true)
  })
})

// ─── defaultRateLimitStore ───────────────────────────────────────────────────

describe('defaultRateLimitStore', () => {
  // Use a unique key per test so the module-level Map doesn't bleed state.
  let key: string
  beforeEach(() => {
    key = `test-${Date.now()}-${Math.random()}`
  })

  it('first call returns count = 1', async () => {
    const r = await defaultRateLimitStore.increment(key, 60_000)
    expect(r.count).toBe(1)
    expect(r.resetAt).toBeGreaterThan(Date.now())
  })

  it('repeated calls in the same window increment the count', async () => {
    const a = await defaultRateLimitStore.increment(key, 60_000)
    const b = await defaultRateLimitStore.increment(key, 60_000)
    const c = await defaultRateLimitStore.increment(key, 60_000)
    expect(a.count).toBe(1)
    expect(b.count).toBe(2)
    expect(c.count).toBe(3)
    // resetAt should stay anchored to the first increment
    expect(b.resetAt).toBe(a.resetAt)
    expect(c.resetAt).toBe(a.resetAt)
  })

  it('resets after the window expires', async () => {
    // 1ms window → expires immediately
    const first = await defaultRateLimitStore.increment(key, 1)
    expect(first.count).toBe(1)
    // Wait slightly longer than the window
    await new Promise(resolve => setTimeout(resolve, 10))
    const second = await defaultRateLimitStore.increment(key, 60_000)
    expect(second.count).toBe(1)
    expect(second.resetAt).toBeGreaterThan(first.resetAt)
  })

  it('different keys are independent', async () => {
    const a = await defaultRateLimitStore.increment(`${key}-a`, 60_000)
    const b = await defaultRateLimitStore.increment(`${key}-b`, 60_000)
    expect(a.count).toBe(1)
    expect(b.count).toBe(1)
  })
})
