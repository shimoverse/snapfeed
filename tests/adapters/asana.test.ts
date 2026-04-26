/**
 * Tests for src/adapters/asana.ts — asanaAdapter
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { asanaAdapter } from '../../src/adapters/asana'
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

describe('asanaAdapter', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('POSTs a task to /tasks and returns ok=true with the gid', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, { data: { gid: 'task_999' } })
    )

    const adapter = asanaAdapter({
      accessToken: 'pat_xxx',
      workspaceId: 'ws_1',
      projectId: 'proj_1',
    })
    const result = await adapter.send(basePayload)

    expect(adapter.name).toBe('asana')
    expect(result.ok).toBe(true)
    expect(result.deliveryId).toBe('task_999')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://app.asana.com/api/1.0/tasks')
    expect(init.method).toBe('POST')

    const body = JSON.parse(init.body)
    expect(body.data.workspace).toBe('ws_1')
    expect(body.data.projects).toEqual(['proj_1'])
    expect(body.data.name).toContain('something is broken')
    expect(body.data.notes).toContain('something is broken')
  })

  it('sets Authorization: Bearer <token> header', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, { data: { gid: 'task_1' } })
    )

    const adapter = asanaAdapter({
      accessToken: 'pat_secret_123',
      workspaceId: 'ws_1',
      projectId: 'proj_1',
    })
    await adapter.send(basePayload)

    const init = fetchMock.mock.calls[0]![1]
    expect(init.headers.Authorization).toBe('Bearer pat_secret_123')
  })

  it('returns ok=false on HTTP 401', async () => {
    fetchMock.mockResolvedValueOnce(new Response('unauthorized', { status: 401 }))

    const adapter = asanaAdapter({
      accessToken: 'bad',
      workspaceId: 'ws_1',
      projectId: 'proj_1',
    })
    const result = await adapter.send(basePayload)

    expect(result.ok).toBe(false)
    expect(result.error).toContain('401')
  })

  it('returns ok=false on HTTP 500', async () => {
    fetchMock.mockResolvedValueOnce(new Response('boom', { status: 500 }))

    const adapter = asanaAdapter({
      accessToken: 'pat',
      workspaceId: 'ws_1',
      projectId: 'proj_1',
    })
    const result = await adapter.send(basePayload)

    expect(result.ok).toBe(false)
    expect(result.error).toContain('500')
  })

  it('returns ok=false on network error', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'))

    const adapter = asanaAdapter({
      accessToken: 'pat',
      workspaceId: 'ws_1',
      projectId: 'proj_1',
    })
    const result = await adapter.send(basePayload)

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/Asana adapter error/i)
    expect(result.error).toContain('ECONNREFUSED')
  })

  it('makes a second multipart POST to /attachments when a screenshot is present', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(201, { data: { gid: 'task_42' } }))
      .mockResolvedValueOnce(jsonResponse(200, { data: { gid: 'att_1' } }))

    const adapter = asanaAdapter({
      accessToken: 'pat',
      workspaceId: 'ws_1',
      projectId: 'proj_1',
    })
    const result = await adapter.send(screenshotPayload)

    expect(result.ok).toBe(true)
    expect(result.warnings).toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(2)

    const [attUrl, attInit] = fetchMock.mock.calls[1]!
    expect(attUrl).toBe('https://app.asana.com/api/1.0/tasks/task_42/attachments')
    expect(attInit.method).toBe('POST')
    expect(attInit.body).toBeInstanceOf(FormData)
    // Content-Type intentionally NOT set — fetch fills the multipart boundary.
    expect(attInit.headers['Content-Type']).toBeUndefined()
  })

  it('returns ok=true with warnings when attachment upload fails after task created', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(201, { data: { gid: 'task_77' } }))
      .mockResolvedValueOnce(new Response('too large', { status: 413 }))

    const adapter = asanaAdapter({
      accessToken: 'pat',
      workspaceId: 'ws_1',
      projectId: 'proj_1',
    })
    const result = await adapter.send(screenshotPayload)

    expect(result.ok).toBe(true)
    expect(result.deliveryId).toBe('task_77')
    expect(result.warnings).toBeDefined()
    expect(result.warnings?.length).toBe(1)
    expect(result.warnings?.[0]).toContain('screenshot')
    expect(result.warnings?.[0]).toContain('413')
  })

  it('returns ok=false (no task gid) when 2xx body is malformed JSON', async () => {
    // Malformed body must not throw — the missing-gid branch should fire instead.
    fetchMock.mockResolvedValueOnce(
      new Response('not-json{{{', {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    const adapter = asanaAdapter({
      accessToken: 'pat',
      workspaceId: 'ws_1',
      projectId: 'proj_1',
    })
    const result = await adapter.send(basePayload)

    expect(result.ok).toBe(false)
    expect(result.error).toContain('no task gid')
  })

  it('makes only a single fetch when no screenshot is provided', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, { data: { gid: 'task_1' } })
    )

    const adapter = asanaAdapter({
      accessToken: 'pat',
      workspaceId: 'ws_1',
      projectId: 'proj_1',
    })
    await adapter.send(basePayload)

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
