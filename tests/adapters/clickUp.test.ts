/**
 * Tests for src/adapters/clickUp.ts — clickUpAdapter
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { clickUpAdapter } from '../../src/adapters/clickUp'
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
    consoleErrors: [],
  },
}

const screenshotPayload: FeedbackPayload = {
  ...basePayload,
  screenshot: { base64: 'aGVsbG8=', mimeType: 'image/png' },
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('clickUpAdapter', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('POSTs a task to /list/{listId}/task and returns ok=true with the task id', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: 'cu_abc' }))

    const adapter = clickUpAdapter({
      apiToken: 'pk_xxx',
      listId: '901234567',
      priority: { bug: 1, idea: 3, question: 3, praise: 4, other: 3 },
    })
    const result = await adapter.send(basePayload)

    expect(adapter.name).toBe('clickUp')
    expect(result.ok).toBe(true)
    expect(result.deliveryId).toBe('cu_abc')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://api.clickup.com/api/v2/list/901234567/task')
    expect(init.method).toBe('POST')

    const body = JSON.parse(init.body)
    expect(body.name).toContain('something is broken')
    expect(body.description).toContain('something is broken')
    // bug → priority 1 (urgent) per the per-category map.
    expect(body.priority).toBe(1)
  })

  it('sets Authorization to the raw token (no Bearer prefix)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: 'cu_1' }))

    const adapter = clickUpAdapter({
      apiToken: 'pk_secret_token',
      listId: '901234567',
    })
    await adapter.send(basePayload)

    const init = fetchMock.mock.calls[0]![1]
    // ClickUp convention: raw token, no "Bearer " prefix.
    expect(init.headers.Authorization).toBe('pk_secret_token')
    expect(init.headers.Authorization).not.toContain('Bearer')
  })

  it('returns ok=false on HTTP 401', async () => {
    fetchMock.mockResolvedValueOnce(new Response('unauthorized', { status: 401 }))

    const adapter = clickUpAdapter({ apiToken: 'bad', listId: '1' })
    const result = await adapter.send(basePayload)

    expect(result.ok).toBe(false)
    expect(result.error).toContain('401')
  })

  it('returns ok=false on HTTP 500', async () => {
    fetchMock.mockResolvedValueOnce(new Response('boom', { status: 500 }))

    const adapter = clickUpAdapter({ apiToken: 'pk', listId: '1' })
    const result = await adapter.send(basePayload)

    expect(result.ok).toBe(false)
    expect(result.error).toContain('500')
  })

  it('returns ok=false on network error', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'))

    const adapter = clickUpAdapter({ apiToken: 'pk', listId: '1' })
    const result = await adapter.send(basePayload)

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/ClickUp adapter error/i)
    expect(result.error).toContain('ECONNREFUSED')
  })

  it('makes a second multipart POST to /task/{id}/attachment when screenshot is present', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { id: 'cu_42' }))
      .mockResolvedValueOnce(jsonResponse(200, { id: 'att_1' }))

    const adapter = clickUpAdapter({ apiToken: 'pk', listId: '1' })
    const result = await adapter.send(screenshotPayload)

    expect(result.ok).toBe(true)
    expect(result.warnings).toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(2)

    const [attUrl, attInit] = fetchMock.mock.calls[1]!
    expect(attUrl).toBe('https://api.clickup.com/api/v2/task/cu_42/attachment')
    expect(attInit.method).toBe('POST')
    expect(attInit.body).toBeInstanceOf(FormData)
    expect(attInit.headers['Content-Type']).toBeUndefined()
  })

  it('returns ok=true with warnings when attachment upload fails', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { id: 'cu_77' }))
      .mockResolvedValueOnce(new Response('too large', { status: 413 }))

    const adapter = clickUpAdapter({ apiToken: 'pk', listId: '1' })
    const result = await adapter.send(screenshotPayload)

    expect(result.ok).toBe(true)
    expect(result.deliveryId).toBe('cu_77')
    expect(result.warnings).toBeDefined()
    expect(result.warnings?.length).toBe(1)
    expect(result.warnings?.[0]).toContain('screenshot')
    expect(result.warnings?.[0]).toContain('413')
  })

  it('makes only a single fetch when no screenshot is provided', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: 'cu_1' }))

    const adapter = clickUpAdapter({ apiToken: 'pk', listId: '1' })
    await adapter.send(basePayload)

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('returns ok=false (no task id) when 2xx body is malformed JSON', async () => {
    // Malformed body must not throw — the missing-id branch should fire instead.
    fetchMock.mockResolvedValueOnce(
      new Response('not-json{{{', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    const adapter = clickUpAdapter({ apiToken: 'pk', listId: '1' })
    const result = await adapter.send(basePayload)

    expect(result.ok).toBe(false)
    expect(result.error).toContain('no task id')
  })
})
