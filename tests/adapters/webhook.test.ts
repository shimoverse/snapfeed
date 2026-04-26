/**
 * Tests for src/adapters/webhook.ts — webhookAdapter
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { webhookAdapter } from '../../src/adapters/webhook'
import type { FeedbackPayload } from '../../src/types'

const samplePayload: FeedbackPayload = {
  text: 'something is broken',
  appName: 'TestApp',
  pageUrl: 'https://example.com/page',
  pageName: 'Page',
  timestamp: '2026-01-01T00:00:00.000Z',
}

function jsonResponse(status = 200, body: unknown = { id: 'abc' }): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('webhookAdapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('POSTs JSON to the configured URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200))
    vi.stubGlobal('fetch', fetchMock)

    const adapter = webhookAdapter({ url: 'https://hooks.example.com/feedback' })
    const result = await adapter.send(samplePayload)

    expect(adapter.name).toBe('webhook')
    expect(result.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://hooks.example.com/feedback')
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/json')
    // Body should be JSON-serialized payload
    expect(JSON.parse(init.body)).toEqual(samplePayload)
  })

  it('includes custom headers (e.g. Authorization)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200))
    vi.stubGlobal('fetch', fetchMock)

    const adapter = webhookAdapter({
      url: 'https://hooks.example.com/feedback',
      headers: {
        Authorization: 'Bearer test-token',
        'X-Custom': 'yes',
      },
    })
    await adapter.send(samplePayload)

    const init = fetchMock.mock.calls[0]![1]
    expect(init.headers.Authorization).toBe('Bearer test-token')
    expect(init.headers['X-Custom']).toBe('yes')
    // Default still preserved
    expect(init.headers['Content-Type']).toBe('application/json')
  })

  it('applies the optional transform before sending', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200))
    vi.stubGlobal('fetch', fetchMock)

    const adapter = webhookAdapter({
      url: 'https://hooks.example.com/feedback',
      transform: (p) => ({ message: p.text, app: p.appName }),
    })
    await adapter.send(samplePayload)

    const init = fetchMock.mock.calls[0]![1]
    expect(JSON.parse(init.body)).toEqual({
      message: 'something is broken',
      app: 'TestApp',
    })
  })

  it('returns ok: true on a 2xx response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201))
    vi.stubGlobal('fetch', fetchMock)

    const adapter = webhookAdapter({ url: 'https://hooks.example.com/feedback' })
    const result = await adapter.send(samplePayload)
    expect(result.ok).toBe(true)
  })

  it('returns ok: false on a non-2xx response with status in error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('boom', { status: 500 })
    )
    vi.stubGlobal('fetch', fetchMock)

    const adapter = webhookAdapter({ url: 'https://hooks.example.com/feedback' })
    const result = await adapter.send(samplePayload)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('500')
  })

  it('returns ok: false on a 4xx with status code in error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('bad', { status: 401 })
    )
    vi.stubGlobal('fetch', fetchMock)

    const adapter = webhookAdapter({ url: 'https://hooks.example.com/feedback' })
    const result = await adapter.send(samplePayload)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('401')
  })

  it('returns ok: false on network error (fetch throws)', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    vi.stubGlobal('fetch', fetchMock)

    const adapter = webhookAdapter({ url: 'https://hooks.example.com/feedback' })
    const result = await adapter.send(samplePayload)
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/webhook request failed/i)
    expect(result.error).toContain('ECONNREFUSED')
  })
})
