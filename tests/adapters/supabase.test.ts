/**
 * Tests for src/adapters/supabase.ts — supabaseAdapter
 *
 * Narrow scope: post-2xx JSON parse guard + headers immutability.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { supabaseAdapter } from '../../src/adapters/supabase'
import type { FeedbackPayload } from '../../src/types'

const basePayload: FeedbackPayload = {
  text: 'something is broken',
  appName: 'TestApp',
  pageUrl: 'https://example.com/page',
  pageName: 'Page',
  timestamp: '2026-04-26T00:00:00.000Z',
  category: 'bug',
}

describe('supabaseAdapter', () => {
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
    // Body parse failure must not throw — insert was successful, we just lose
    // the row id.
    fetchMock.mockResolvedValueOnce(
      new Response('not-json{{{', {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    const adapter = supabaseAdapter({
      url: 'https://x.supabase.co',
      anonKey: 'anon',
    })
    const result = await adapter.send(basePayload)

    expect(adapter.name).toBe('supabase')
    expect(result.ok).toBe(true)
    expect(result.deliveryId).toBeUndefined()
  })

  it('returns ok=true with row id when 2xx body is valid', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify([{ id: 'row_42' }]), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    const adapter = supabaseAdapter({
      url: 'https://x.supabase.co',
      anonKey: 'anon',
    })
    const result = await adapter.send(basePayload)

    expect(result.ok).toBe(true)
    expect(result.deliveryId).toBe('row_42')
  })

  it('stores target context inside metadata for agent/orchestrator consumers', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify([{ id: 'row_target' }]), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    const adapter = supabaseAdapter({
      url: 'https://x.supabase.co',
      anonKey: 'anon',
    })
    await adapter.send({
      ...basePayload,
      target: {
        tagName: 'button',
        selector: '[data-testid="pay-now"]',
        domPath: 'body > main > button.primary',
        componentName: 'CheckoutButton',
      },
    })

    const row = JSON.parse(fetchMock.mock.calls[0]![1].body)
    expect(row.metadata.target).toMatchObject({
      selector: '[data-testid="pay-now"]',
      componentName: 'CheckoutButton',
    })
  })

  it('keeps fetch headers frozen for defensive immutability', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify([{ id: 'row_1' }]), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    const adapter = supabaseAdapter({
      url: 'https://x.supabase.co',
      anonKey: 'anon',
    })
    await adapter.send(basePayload)

    const init = fetchMock.mock.calls[0]![1]
    expect(Object.isFrozen(init.headers)).toBe(true)
  })
})
