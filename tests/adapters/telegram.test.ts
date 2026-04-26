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

  it('returns ok=true when sendMessage 2xx body is malformed JSON (graceful parse)', async () => {
    // Edge proxies very rarely return a 200 with a truncated/invalid JSON body.
    // The adapter should still treat the delivery as successful — just with an
    // empty messageId — instead of throwing and turning success into an error.
    fetchMock.mockResolvedValueOnce(
      new Response('not-json{{{', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    const adapter = telegramAdapter({ botToken: 't', chatId: '123' })
    const r = await adapter.send(basePayload)

    expect(r.ok).toBe(true)
    expect(r.deliveryId).toBe('')
  })

  it('returns ok=true with warning when atob throws on malformed base64', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { ok: true, result: { message_id: 11 } })
    )

    const adapter = telegramAdapter({ botToken: 't', chatId: '123' })
    const r = await adapter.send({
      ...basePayload,
      // `!` is not in the base64 alphabet → atob throws InvalidCharacterError.
      screenshot: { base64: '!!!not-base64!!!', mimeType: 'image/png' },
    })

    expect(r.ok).toBe(true)
    expect(r.deliveryId).toBe('11')
    expect(r.warnings).toBeDefined()
    expect(r.warnings?.[0]).toContain('screenshot upload failed')
    // Only one fetch — sendPhoto was never reached.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('uses correct extension for image/svg+xml (svg, not svg+xml)', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(200, { ok: true, result: { message_id: 1 } })
      )
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }))

    const adapter = telegramAdapter({ botToken: 't', chatId: '123' })
    await adapter.send({
      ...basePayload,
      screenshot: { base64: 'aGVsbG8=', mimeType: 'image/svg+xml' },
    })

    const photoCall = fetchMock.mock.calls[1]!
    const form = photoCall[1].body as FormData
    const photo = form.get('photo')
    expect(photo).toBeInstanceOf(Blob)
    // Filename is the third arg to FormData.append; vitest exposes it via the
    // File wrapper that FormData creates. Read it through the entries() API.
    let filename = ''
    for (const [k, v] of form.entries()) {
      if (k === 'photo' && v instanceof File) filename = v.name
    }
    expect(filename).toBe('screenshot.svg')
    expect(filename).not.toContain('+')
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
