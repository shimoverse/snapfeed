/**
 * Tests for src/adapters/github.ts — githubAdapter
 *
 * Narrow scope: just the post-2xx JSON parse guard added in v0.5.2 hardening.
 * The rest of the GitHub adapter behavior is exercised via integration in
 * tests/edge-cases/.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { githubAdapter } from '../../src/adapters/github'
import type { FeedbackPayload } from '../../src/types'

const basePayload: FeedbackPayload = {
  text: 'something is broken',
  appName: 'TestApp',
  pageUrl: 'https://example.com/page',
  pageName: 'Page',
  timestamp: '2026-04-26T00:00:00.000Z',
  category: 'bug',
}

describe('githubAdapter', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('returns ok=true with no deliveryId when 2xx body is malformed JSON', async () => {
    // Edge proxies very rarely return a 200 with truncated/invalid JSON.
    // The adapter must not throw — the issue creation is still considered a
    // success; we just lose the deliveryId.
    fetchMock.mockResolvedValueOnce(
      new Response('not-json{{{', {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    const adapter = githubAdapter({
      token: 'ghp_test',
      owner: 'me',
      repo: 'feedback',
    })
    const result = await adapter.send(basePayload)

    expect(adapter.name).toBe('github')
    expect(result.ok).toBe(true)
    expect(result.deliveryId).toBeUndefined()
  })

  it('returns ok=true with deliveryId when 2xx body is valid', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ number: 42, html_url: 'https://x' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    const adapter = githubAdapter({
      token: 'ghp_test',
      owner: 'me',
      repo: 'feedback',
    })
    const result = await adapter.send(basePayload)

    expect(result.ok).toBe(true)
    expect(result.deliveryId).toBe('42')
  })
})
