/**
 * Tests for src/adapters/discord.ts — discordAdapter
 *
 * Covers v0.5.2 hardening: post-2xx JSON parse guard and the screenshot
 * try/catch (atob throws on malformed base64 → fall back to JSON-only POST
 * with a warning, primary delivery still succeeds).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { discordAdapter } from '../../src/adapters/discord'
import type { FeedbackPayload } from '../../src/types'

const basePayload: FeedbackPayload = {
  text: 'something is broken',
  appName: 'TestApp',
  pageUrl: 'https://example.com/page',
  pageName: 'Page',
  timestamp: '2026-04-26T00:00:00.000Z',
  category: 'bug',
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('discordAdapter', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('returns ok=true with default deliveryId when 2xx body is malformed JSON', async () => {
    // Edge proxies very rarely return a 200 with truncated/invalid JSON.
    // The adapter must not throw — delivery is still successful, deliveryId
    // falls back to the literal "discord:webhook".
    fetchMock.mockResolvedValueOnce(
      new Response('not-json{{{', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    const adapter = discordAdapter({
      webhookUrl: 'https://discord.com/api/webhooks/x/y',
    })
    const result = await adapter.send(basePayload)

    expect(adapter.name).toBe('discord')
    expect(result.ok).toBe(true)
    expect(result.deliveryId).toBe('discord:webhook')
  })

  it('returns ok=true with warning when atob throws on malformed base64 screenshot', async () => {
    // Falls back to JSON-only POST (no multipart) — primary delivery succeeds
    // and the screenshot failure is surfaced as a warning.
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: 'msg_1' }))

    const adapter = discordAdapter({
      webhookUrl: 'https://discord.com/api/webhooks/x/y',
    })
    const result = await adapter.send({
      ...basePayload,
      screenshot: { base64: '!!!not-base64!!!', mimeType: 'image/png' },
    })

    expect(result.ok).toBe(true)
    expect(result.deliveryId).toBe('msg_1')
    expect(result.warnings).toBeDefined()
    expect(result.warnings?.[0]).toContain('screenshot upload failed')

    // Body is JSON, not FormData (the multipart path was skipped).
    const init = fetchMock.mock.calls[0]![1]
    expect(typeof init.body).toBe('string')
    const body = JSON.parse(init.body)
    expect(body.embeds).toBeDefined()
    // image attachment reference was scrubbed
    expect(body.embeds[0].image).toBeUndefined()
  })

  it('passes mentionRoleId through as <@&ROLE_ID> in content', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: 'msg_2' }))

    const adapter = discordAdapter({
      webhookUrl: 'https://discord.com/api/webhooks/x/y',
      mentionRoleId: '111222333',
    })
    await adapter.send(basePayload)

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body)
    expect(body.content).toBe('<@&111222333>')
  })
})
