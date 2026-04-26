/**
 * Tests for src/adapters/telegram.ts
 *
 * Specifically covers the previously-silent screenshot upload failure:
 * when the text message succeeds but the photo upload fails, the result
 * should still be ok=true (the user did get the text), but warnings
 * should be populated so the caller can surface "delivered with issues".
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { telegramAdapter } from '../../src/adapters/telegram'
import type { FeedbackPayload } from '../../src/types'

const basePayload: FeedbackPayload = {
  text: 'something is broken',
  appName: 'TestApp',
  pageUrl: 'https://x.com/page',
  pageName: 'Page',
  timestamp: '2026-04-26T00:00:00.000Z',
  category: 'bug',
}

const screenshotPayload: FeedbackPayload = {
  ...basePayload,
  screenshot: {
    base64: 'aGVsbG8=', // "hello"
    mimeType: 'image/png',
  },
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('telegramAdapter', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('returns ok=true with no warnings when both text and photo succeed', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(200, { ok: true, result: { message_id: 42 } })
      )
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }))

    const adapter = telegramAdapter({ botToken: 't', chatId: '123' })
    const r = await adapter.send(screenshotPayload)

    expect(r.ok).toBe(true)
    expect(r.deliveryId).toBe('42')
    expect(r.warnings).toBeUndefined()
  })

  it('returns ok=false when the text message itself fails', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('chat not found', { status: 400 })
    )

    const adapter = telegramAdapter({ botToken: 't', chatId: '123' })
    const r = await adapter.send(basePayload)

    expect(r.ok).toBe(false)
    expect(r.error).toContain('Telegram sendMessage failed')
  })

  it('returns ok=true WITH a warning when photo upload fails after text succeeds', async () => {
    // This is the regression: previously the photo failure was silently
    // swallowed and the caller never knew the screenshot was missing.
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(200, { ok: true, result: { message_id: 99 } })
      )
      .mockResolvedValueOnce(
        new Response('photo too large', { status: 413 })
      )

    const adapter = telegramAdapter({ botToken: 't', chatId: '123' })
    const r = await adapter.send(screenshotPayload)

    expect(r.ok).toBe(true)
    expect(r.deliveryId).toBe('99')
    expect(r.warnings).toBeDefined()
    expect(r.warnings?.length).toBe(1)
    expect(r.warnings?.[0]).toContain('screenshot')
    expect(r.warnings?.[0]).toContain('413')
  })

  it('does not call sendPhoto when sendScreenshot=false', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { ok: true, result: { message_id: 7 } })
    )

    const adapter = telegramAdapter({
      botToken: 't',
      chatId: '123',
      sendScreenshot: false,
    })
    const r = await adapter.send(screenshotPayload)

    expect(r.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(r.warnings).toBeUndefined()
  })
})
