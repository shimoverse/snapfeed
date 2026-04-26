/**
 * Tests for src/adapters/msTeams.ts — msTeamsAdapter
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { msTeamsAdapter } from '../../src/adapters/msTeams'
import type { FeedbackPayload } from '../../src/types'

const basePayload: FeedbackPayload = {
  text: 'something is broken',
  appName: 'TestApp',
  pageUrl: 'https://example.com/page',
  pageName: 'Page',
  timestamp: '2026-04-26T00:00:00.000Z',
  category: 'bug',
  metadata: {
    viewport: '1440x900',
    userAgent: 'TestUA/1.0',
    consoleErrors: ['TypeError: x is undefined'],
  },
}

const screenshotPayload: FeedbackPayload = {
  ...basePayload,
  screenshot: {
    base64: 'aGVsbG8=', // "hello" — small, well under 1MB.
    mimeType: 'image/png',
  },
}

function ok2xxResponse(): Response {
  return new Response('1', {
    status: 200,
    headers: { 'Content-Type': 'text/plain' },
  })
}

describe('msTeamsAdapter', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('POSTs an Adaptive Card to the configured webhook URL', async () => {
    fetchMock.mockResolvedValueOnce(ok2xxResponse())

    const adapter = msTeamsAdapter({
      webhookUrl: 'https://outlook.office.com/webhook/AAA',
    })
    const result = await adapter.send(basePayload)

    expect(adapter.name).toBe('msTeams')
    expect(result.ok).toBe(true)
    expect(result.deliveryId).toBe('msteams:webhook')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://outlook.office.com/webhook/AAA')
    expect(init.method).toBe('POST')

    const body = JSON.parse(init.body)
    expect(body.type).toBe('message')
    expect(body.attachments).toHaveLength(1)
    expect(body.attachments[0].contentType).toBe(
      'application/vnd.microsoft.card.adaptive'
    )
    const card = body.attachments[0].content
    expect(card.type).toBe('AdaptiveCard')
    expect(card.version).toBe('1.4')
    // Body should contain a TextBlock title, FactSet, and the body text.
    const types = (card.body as Array<{ type: string }>).map((b) => b.type)
    expect(types).toContain('TextBlock')
    expect(types).toContain('FactSet')
  })

  it('sets Content-Type: application/json header', async () => {
    fetchMock.mockResolvedValueOnce(ok2xxResponse())

    const adapter = msTeamsAdapter({
      webhookUrl: 'https://outlook.office.com/webhook/AAA',
    })
    await adapter.send(basePayload)

    const init = fetchMock.mock.calls[0]![1]
    expect(init.headers['Content-Type']).toBe('application/json')
  })

  it('returns ok=false with status code on HTTP 401', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('unauthorized', { status: 401 })
    )

    const adapter = msTeamsAdapter({
      webhookUrl: 'https://outlook.office.com/webhook/AAA',
    })
    const result = await adapter.send(basePayload)

    expect(result.ok).toBe(false)
    expect(result.error).toContain('401')
  })

  it('returns ok=false with status code on HTTP 500', async () => {
    fetchMock.mockResolvedValueOnce(new Response('boom', { status: 500 }))

    const adapter = msTeamsAdapter({
      webhookUrl: 'https://outlook.office.com/webhook/AAA',
    })
    const result = await adapter.send(basePayload)

    expect(result.ok).toBe(false)
    expect(result.error).toContain('500')
  })

  it('returns ok=false on network error', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'))

    const adapter = msTeamsAdapter({
      webhookUrl: 'https://outlook.office.com/webhook/AAA',
    })
    const result = await adapter.send(basePayload)

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/msTeams adapter error/i)
    expect(result.error).toContain('ECONNREFUSED')
  })

  it('includes an Image element in the card when a small screenshot is present', async () => {
    fetchMock.mockResolvedValueOnce(ok2xxResponse())

    const adapter = msTeamsAdapter({
      webhookUrl: 'https://outlook.office.com/webhook/AAA',
    })
    const result = await adapter.send(screenshotPayload)

    expect(result.ok).toBe(true)
    expect(result.warnings).toBeUndefined()

    // Only one fetch (Teams card is one POST, screenshot embedded inline).
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const init = fetchMock.mock.calls[0]![1]
    const body = JSON.parse(init.body)
    const card = body.attachments[0].content
    const imageElement = (card.body as Array<{ type: string; url?: string }>).find(
      (b) => b.type === 'Image'
    )
    expect(imageElement).toBeDefined()
    expect(imageElement!.url).toContain('data:image/png;base64,')
  })

  it('skips the image and emits a warning when the screenshot exceeds ~1MB', async () => {
    fetchMock.mockResolvedValueOnce(ok2xxResponse())

    // 2MB of base64 input → ~1.5MB decoded, above the limit.
    const oversize = 'A'.repeat(2 * 1024 * 1024)
    const huge: FeedbackPayload = {
      ...basePayload,
      screenshot: { base64: oversize, mimeType: 'image/png' },
    }

    const adapter = msTeamsAdapter({
      webhookUrl: 'https://outlook.office.com/webhook/AAA',
    })
    const result = await adapter.send(huge)

    expect(result.ok).toBe(true)
    expect(result.warnings).toBeDefined()
    expect(result.warnings?.[0]).toContain('screenshot')

    const init = fetchMock.mock.calls[0]![1]
    const body = JSON.parse(init.body)
    const card = body.attachments[0].content
    const imageElement = (card.body as Array<{ type: string }>).find(
      (b) => b.type === 'Image'
    )
    expect(imageElement).toBeUndefined()
  })

  it('makes only a single fetch call when no screenshot is provided', async () => {
    fetchMock.mockResolvedValueOnce(ok2xxResponse())

    const adapter = msTeamsAdapter({
      webhookUrl: 'https://outlook.office.com/webhook/AAA',
    })
    await adapter.send(basePayload)

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
