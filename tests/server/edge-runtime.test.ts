/**
 * Tests that src/server/security.ts works in non-Node runtimes that
 * don't expose `Buffer` as a global (Vercel Edge Functions, Cloudflare
 * Workers, Deno without compat, browsers).
 *
 * Previously the payload validator called `Buffer.byteLength()` directly,
 * which throws `ReferenceError: Buffer is not defined` outside of Node.
 * That broke the Next.js handler when consumers ran their feedback API
 * route on the edge.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { validatePayload } from '../../src/server/security'
import type { FeedbackHandlerConfig } from '../../src/types'

const config: FeedbackHandlerConfig = { adapters: [] }

const validBody = {
  text: 'hello world',
  appName: 'TestApp',
  pageUrl: '/x',
  pageName: 'Page',
  timestamp: '2026-04-26T00:00:00.000Z',
  metadata: { viewport: '1024x768', userAgent: 'test', consoleErrors: [] },
}

describe('validatePayload — edge-runtime safety', () => {
  let originalBuffer: typeof globalThis.Buffer | undefined

  beforeEach(() => {
    originalBuffer = (globalThis as { Buffer?: typeof globalThis.Buffer }).Buffer
    // Simulate edge runtime: no Buffer global
    delete (globalThis as { Buffer?: typeof globalThis.Buffer }).Buffer
  })

  afterEach(() => {
    if (originalBuffer) {
      ;(globalThis as { Buffer?: typeof globalThis.Buffer }).Buffer = originalBuffer
    }
  })

  it('does not throw "Buffer is not defined" on a normal payload', () => {
    expect(() => validatePayload(validBody, config)).not.toThrow()
  })

  it('correctly validates a normal payload without Buffer', () => {
    const r = validatePayload(validBody, config)
    expect(r.valid).toBe(true)
    expect(r.error).toBeUndefined()
  })

  it('still rejects oversized payload without Buffer', () => {
    const tooBig = { ...validBody, text: 'x'.repeat(20_000) }
    const r = validatePayload(tooBig, { ...config, maxPayloadBytes: 5_000 })
    expect(r.valid).toBe(false)
    expect(r.error).toMatch(/too large/i)
  })

  it('correctly counts UTF-8 byte length for multi-byte characters', () => {
    // 5 emoji = 20 bytes in UTF-8 (each is 4 bytes), not 5
    const emojiBody = { ...validBody, text: '🚀🚀🚀🚀🚀' }
    const r = validatePayload(emojiBody, { ...config, maxPayloadBytes: 15 })
    expect(r.valid).toBe(false)
    expect(r.error).toMatch(/too large/i)
  })

  it('passes UTF-8 byte length when within limit', () => {
    const r = validatePayload(
      { ...validBody, text: '🚀🚀🚀🚀🚀' },
      { ...config, maxPayloadBytes: 100 }
    )
    expect(r.valid).toBe(true)
  })
})

describe('validatePayload — 64KB hard cap counts UTF-8 bytes', () => {
  it('rejects ASCII text > 64,000 bytes', () => {
    const r = validatePayload(
      { ...validBody, text: 'a'.repeat(64_001) },
      { ...config, maxPayloadBytes: 1_000_000 } // soft cap large enough to reach hard cap
    )
    expect(r.valid).toBe(false)
    expect(r.error).toMatch(/too long/i)
    expect(r.error).toMatch(/64,000 bytes/)
  })

  it('rejects emoji text whose JS char-length is well under 64k but UTF-8 byte length is above', () => {
    // 32,000 4-byte rocket emojis = 128,000 UTF-8 bytes (was 64,000 chars).
    // The OLD `payload.text.length > 64_000` check used JS char-length:
    //   - JS string length is UTF-16 code units (2 per emoji) → 64,000
    //   - The `>` was strict, so 64,000 chars passed the cap
    // This test would have passed under the buggy implementation. The new
    // UTF-8-byte cap correctly rejects 128,000 bytes.
    const text = '\u{1F680}'.repeat(32_000)
    expect(text.length).toBe(64_000) // sanity: at the OLD threshold but not over
    const r = validatePayload(
      { ...validBody, text },
      { ...config, maxPayloadBytes: 1_000_000 }
    )
    expect(r.valid).toBe(false)
    expect(r.error).toMatch(/too long/i)
    expect(r.error).toMatch(/64,000 bytes/)
  })

  it('accepts text whose UTF-8 byte length is exactly at the cap (64,000)', () => {
    // 16,000 rockets = exactly 64,000 UTF-8 bytes (4 each).
    const text = '\u{1F680}'.repeat(16_000)
    const r = validatePayload(
      { ...validBody, text },
      { ...config, maxPayloadBytes: 1_000_000 }
    )
    expect(r.valid).toBe(true)
  })
})

describe('utf8ByteLength fallback — throws when neither TextEncoder nor Buffer is present', () => {
  let origTE: typeof TextEncoder | undefined
  let origBuf: typeof globalThis.Buffer | undefined

  beforeEach(() => {
    origTE = (globalThis as { TextEncoder?: typeof TextEncoder }).TextEncoder
    origBuf = (globalThis as { Buffer?: typeof globalThis.Buffer }).Buffer
    delete (globalThis as { TextEncoder?: typeof TextEncoder }).TextEncoder
    delete (globalThis as { Buffer?: typeof globalThis.Buffer }).Buffer
  })

  afterEach(() => {
    if (origTE) {
      ;(globalThis as { TextEncoder?: typeof TextEncoder }).TextEncoder = origTE
    }
    if (origBuf) {
      ;(globalThis as { Buffer?: typeof globalThis.Buffer }).Buffer = origBuf
    }
  })

  it('throws a clear error rather than silently under-validating', () => {
    expect(() => validatePayload({ text: 'x' }, config)).toThrow(
      /utf8ByteLength requires TextEncoder or Buffer/
    )
  })
})
