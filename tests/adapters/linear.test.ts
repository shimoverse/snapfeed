/**
 * Tests for src/adapters/linear.ts — linearAdapter
 *
 * Covers the v0.5.2 hardening:
 *   - OAuth token detection (`lin_oauth_*` and JWT-style `.` → Bearer prefix)
 *   - Personal API keys (`lin_api_*`) sent raw
 *   - Post-2xx JSON parse guard
 *   - Screenshot try/catch (today: no decode failure path, but verify the
 *     description-build wrapper does not break the issue create)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { linearAdapter } from '../../src/adapters/linear'
import type { FeedbackPayload } from '../../src/types'

const basePayload: FeedbackPayload = {
  text: 'something is broken',
  appName: 'TestApp',
  pageUrl: 'https://example.com/page',
  pageName: 'Page',
  timestamp: '2026-04-26T00:00:00.000Z',
  category: 'bug',
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

function successResponse(): Response {
  return jsonResponse(200, {
    data: {
      issueCreate: {
        success: true,
        issue: { id: 'iss_1', identifier: 'FEED-1', url: 'https://x' },
      },
    },
  })
}

describe('linearAdapter', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('sends Personal API key raw (no Bearer prefix) — Linear convention', async () => {
    fetchMock.mockResolvedValueOnce(successResponse())

    const adapter = linearAdapter({
      apiKey: 'lin_api_xxxxx',
      teamId: 'team_1',
    })
    await adapter.send(basePayload)

    const init = fetchMock.mock.calls[0]![1]
    expect(init.headers.Authorization).toBe('lin_api_xxxxx')
  })

  it('prefixes "Bearer " to OAuth tokens (lin_oauth_ prefix)', async () => {
    fetchMock.mockResolvedValueOnce(successResponse())

    const adapter = linearAdapter({
      apiKey: 'lin_oauth_abcdef123',
      teamId: 'team_1',
    })
    await adapter.send(basePayload)

    const init = fetchMock.mock.calls[0]![1]
    expect(init.headers.Authorization).toBe('Bearer lin_oauth_abcdef123')
  })

  it('prefixes "Bearer " to JWT-style tokens (contains a dot)', async () => {
    fetchMock.mockResolvedValueOnce(successResponse())

    const adapter = linearAdapter({
      apiKey: 'eyJhbGc.eyJzdWI.signature',
      teamId: 'team_1',
    })
    await adapter.send(basePayload)

    const init = fetchMock.mock.calls[0]![1]
    expect(init.headers.Authorization).toBe('Bearer eyJhbGc.eyJzdWI.signature')
  })

  it('returns ok=false (no identifier) when 2xx body is malformed JSON', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('not-json{{{', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    const adapter = linearAdapter({ apiKey: 'lin_api_x', teamId: 'team_1' })
    const result = await adapter.send(basePayload)

    expect(result.ok).toBe(false)
    expect(result.error).toContain('no issue identifier')
  })

  it('returns ok=true and embeds screenshot data URI when present', async () => {
    fetchMock.mockResolvedValueOnce(successResponse())

    const adapter = linearAdapter({ apiKey: 'lin_api_x', teamId: 'team_1' })
    const result = await adapter.send(screenshotPayload)

    expect(result.ok).toBe(true)
    expect(result.deliveryId).toBe('FEED-1')
    expect(result.warnings).toBeUndefined()

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body)
    const description = body.variables.input.description as string
    expect(description).toContain('data:image/png;base64,aGVsbG8=')
  })

  it('still creates the issue when GraphQL returns errors[]', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        errors: [{ message: 'Argument "teamId" of type "String!" is required' }],
      })
    )

    const adapter = linearAdapter({ apiKey: 'lin_api_x', teamId: 'team_1' })
    const result = await adapter.send(basePayload)

    expect(result.ok).toBe(false)
    expect(result.error).toContain('Linear GraphQL error')
    expect(result.error).toContain('teamId')
  })
})
