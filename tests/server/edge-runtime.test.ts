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
