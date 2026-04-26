/**
 * Tests for src/adapters/notion.ts — notionAdapter
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { notionAdapter } from '../../src/adapters/notion'
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
  screenshot: { base64: 'aGVsbG8=', mimeType: 'image/png' },
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('notionAdapter', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('POSTs a page to https://api.notion.com/v1/pages and returns ok=true with the page id', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { object: 'page', id: 'page_abc' })
    )

    const adapter = notionAdapter({
      apiKey: 'secret_xxx',
      databaseId: 'db_1',
    })
    const result = await adapter.send(basePayload)

    expect(adapter.name).toBe('notion')
    expect(result.ok).toBe(true)
    expect(result.deliveryId).toBe('page_abc')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://api.notion.com/v1/pages')
    expect(init.method).toBe('POST')

    const body = JSON.parse(init.body)
    expect(body.parent.database_id).toBe('db_1')
    // Default property names.
    expect(body.properties.Name.title[0].text.content).toContain(
      'something is broken'
    )
    expect(body.properties.Category.select.name).toBe('bug')
    expect(body.properties.Status.select.name).toBe('Triage')

    // Children: paragraph + divider + heading_3 "Context" + bullets + heading_3 "Console errors" + code.
    const childTypes = (body.children as Array<{ type: string }>).map(
      (c) => c.type
    )
    expect(childTypes[0]).toBe('paragraph')
    expect(childTypes).toContain('divider')
    expect(childTypes).toContain('heading_3')
    expect(childTypes).toContain('bulleted_list_item')
    expect(childTypes).toContain('code')
  })

  it('sets Authorization, Notion-Version, and Content-Type headers', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { object: 'page', id: 'page_1' })
    )

    const adapter = notionAdapter({
      apiKey: 'secret_token',
      databaseId: 'db_1',
      notionVersion: '2022-06-28',
    })
    await adapter.send(basePayload)

    const init = fetchMock.mock.calls[0]![1]
    expect(init.headers.Authorization).toBe('Bearer secret_token')
    expect(init.headers['Notion-Version']).toBe('2022-06-28')
    expect(init.headers['Content-Type']).toBe('application/json')
  })

  it('respects custom property names', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { object: 'page', id: 'page_1' })
    )

    const adapter = notionAdapter({
      apiKey: 'secret',
      databaseId: 'db_1',
      titleProperty: 'Title',
      categoryProperty: 'Type',
      statusProperty: 'Stage',
      defaultStatus: 'Inbox',
    })
    await adapter.send(basePayload)

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body)
    expect(body.properties.Title).toBeDefined()
    expect(body.properties.Type.select.name).toBe('bug')
    expect(body.properties.Stage.select.name).toBe('Inbox')
  })

  it('returns ok=false on HTTP 401', async () => {
    fetchMock.mockResolvedValueOnce(new Response('unauthorized', { status: 401 }))

    const adapter = notionAdapter({ apiKey: 'bad', databaseId: 'db_1' })
    const result = await adapter.send(basePayload)

    expect(result.ok).toBe(false)
    expect(result.error).toContain('401')
  })

  it('returns ok=false on HTTP 500', async () => {
    fetchMock.mockResolvedValueOnce(new Response('boom', { status: 500 }))

    const adapter = notionAdapter({ apiKey: 'k', databaseId: 'db_1' })
    const result = await adapter.send(basePayload)

    expect(result.ok).toBe(false)
    expect(result.error).toContain('500')
  })

  it('returns ok=false on network error', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'))

    const adapter = notionAdapter({ apiKey: 'k', databaseId: 'db_1' })
    const result = await adapter.send(basePayload)

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/Notion adapter error/i)
    expect(result.error).toContain('ECONNREFUSED')
  })

  it('returns ok=false when Notion responds 200 with object: "error" body', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        object: 'error',
        code: 'validation_error',
        message: 'Category is not a valid select option',
      })
    )

    const adapter = notionAdapter({ apiKey: 'k', databaseId: 'db_1' })
    const result = await adapter.send(basePayload)

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/Notion API error/i)
    expect(result.error).toContain('Category is not a valid select option')
  })

  it('embeds an image block with a data URI when a small screenshot is present', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { object: 'page', id: 'page_42' })
    )

    const adapter = notionAdapter({ apiKey: 'k', databaseId: 'db_1' })
    const result = await adapter.send(screenshotPayload)

    expect(result.ok).toBe(true)
    expect(result.warnings).toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body)
    const imageBlock = (
      body.children as Array<{
        type: string
        image?: { external?: { url?: string } }
      }>
    ).find((c) => c.type === 'image')
    expect(imageBlock).toBeDefined()
    expect(imageBlock!.image?.external?.url).toContain(
      'data:image/png;base64,'
    )
  })

  it('skips the image and emits a warning when the screenshot exceeds ~1MB', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { object: 'page', id: 'page_88' })
    )

    const oversize = 'A'.repeat(2 * 1024 * 1024)
    const huge: FeedbackPayload = {
      ...basePayload,
      screenshot: { base64: oversize, mimeType: 'image/png' },
    }

    const adapter = notionAdapter({ apiKey: 'k', databaseId: 'db_1' })
    const result = await adapter.send(huge)

    expect(result.ok).toBe(true)
    expect(result.warnings).toBeDefined()
    expect(result.warnings?.[0]).toContain('screenshot')

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body)
    const imageBlock = (body.children as Array<{ type: string }>).find(
      (c) => c.type === 'image'
    )
    expect(imageBlock).toBeUndefined()
  })

  it('returns ok=false (no page id) when 2xx body is malformed JSON', async () => {
    // Malformed body must not throw — the missing-id branch should fire instead.
    fetchMock.mockResolvedValueOnce(
      new Response('not-json{{{', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    const adapter = notionAdapter({ apiKey: 'k', databaseId: 'db_1' })
    const result = await adapter.send(basePayload)

    expect(result.ok).toBe(false)
    expect(result.error).toContain('no page id')
  })

  it('makes only a single fetch when no screenshot is provided', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { object: 'page', id: 'page_1' })
    )

    const adapter = notionAdapter({ apiKey: 'k', databaseId: 'db_1' })
    await adapter.send(basePayload)

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
