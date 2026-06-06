/**
 * Tests for src/adapters/slack.ts — slackAdapter()
 *
 * These tests are scoped to construction-time concerns (URL validation).
 * Send-path behavior is exercised through tests/adapters/auto.test.ts and
 * the wider integration suite.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { slackAdapter } from '../../src/adapters/slack'
import type { FeedbackPayload } from '../../src/types'

const basePayload: FeedbackPayload = {
  text: 'button copy feels risky',
  appName: 'TestApp',
  pageUrl: 'https://example.com/page',
  pageName: 'Page',
  timestamp: '2026-04-26T00:00:00.000Z',
  category: 'bug',
}

describe('slackAdapter — webhookUrl validation', () => {
  it('throws synchronously when webhookUrl is empty', () => {
    expect(() => slackAdapter({ webhookUrl: '' })).toThrow(
      /webhookUrl must look like/i
    )
  })

  it('throws synchronously when webhookUrl is not a parseable URL', () => {
    expect(() => slackAdapter({ webhookUrl: 'not-a-url' })).toThrow(
      /webhookUrl must look like/i
    )
  })

  it('does NOT throw for a real-looking Slack webhook URL', () => {
    expect(() =>
      slackAdapter({
        webhookUrl: 'https://hooks.slack.com/services/T123/B123/abc',
      })
    ).not.toThrow()
  })

  it('does NOT throw for any URL the URL parser accepts (so tests can use localhost)', () => {
    expect(() =>
      slackAdapter({ webhookUrl: 'http://localhost:1234/hook' })
    ).not.toThrow()
  })

  it('error message is actionable — names the option and shows the expected shape', () => {
    let captured: Error | undefined
    try {
      slackAdapter({ webhookUrl: '' })
    } catch (e) {
      captured = e as Error
    }
    expect(captured).toBeDefined()
    expect(captured!.message).toContain('slackAdapter')
    expect(captured!.message).toContain('hooks.slack.com/services')
  })
})

describe('slackAdapter — target element context', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('includes target selector and component context in the Slack blocks', async () => {
    const adapter = slackAdapter({ webhookUrl: 'http://localhost:1234/hook' })
    await adapter.send({
      ...basePayload,
      target: {
        tagName: 'button',
        selector: '[data-testid="pay-now"]',
        domPath: 'body > main > button.primary',
        componentName: 'CheckoutButton',
        ariaLabel: 'Pay now',
        text: 'Pay now',
      },
    })

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body)
    const serialized = JSON.stringify(body.blocks)
    expect(serialized).toContain('Target')
    expect(serialized).toContain('data-testid')
    expect(serialized).toContain('pay-now')
    expect(serialized).toContain('CheckoutButton')
  })
})
