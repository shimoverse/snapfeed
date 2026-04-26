/**
 * Tests for src/adapters/jira.ts — jiraAdapter
 *
 * Narrow scope: the post-2xx JSON parse guard added in v0.5.2 hardening.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { jiraAdapter } from '../../src/adapters/jira'
import type { FeedbackPayload } from '../../src/types'

const basePayload: FeedbackPayload = {
  text: 'something is broken',
  appName: 'TestApp',
  pageUrl: 'https://example.com/page',
  pageName: 'Page',
  timestamp: '2026-04-26T00:00:00.000Z',
  category: 'bug',
}

describe('jiraAdapter', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('returns ok=false (no issue key) when 2xx body is malformed JSON', async () => {
    // Malformed body must not throw — the missing-key branch should fire.
    fetchMock.mockResolvedValueOnce(
      new Response('not-json{{{', {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    const adapter = jiraAdapter({
      host: 'mycompany.atlassian.net',
      email: 'bot@x.com',
      apiToken: 'tok',
      projectKey: 'FEED',
    })
    const result = await adapter.send(basePayload)

    expect(adapter.name).toBe('jira')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('no issue key')
  })

  it('returns ok=true with issue key when 2xx body is valid', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: '10001', key: 'FEED-7' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    const adapter = jiraAdapter({
      host: 'mycompany.atlassian.net',
      email: 'bot@x.com',
      apiToken: 'tok',
      projectKey: 'FEED',
    })
    const result = await adapter.send(basePayload)

    expect(result.ok).toBe(true)
    expect(result.deliveryId).toBe('FEED-7')
  })
})
