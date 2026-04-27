/**
 * Tests for the Mattermost example adapter.
 *
 * Demonstrates the testing pattern for any custom snapfeed adapter:
 *   1. Inject a fake `fetch` via the `fetch` option (no global mocking).
 *   2. Drive `send()` with a representative `FeedbackPayload`.
 *   3. Assert on the body the adapter posted + the result it returned.
 *
 * Not wired into the main snapfeed test runner (this is a separate
 * example sub-project). Run with `npx vitest run` from this directory
 * after `npm install` if you want to execute it.
 */

import { describe, it, expect, vi } from 'vitest'
import type { FeedbackPayload } from 'snapfeed/adapters'
import { mattermostAdapter, formatMattermostMessage } from './mattermost-adapter'

const samplePayload: FeedbackPayload = {
  text: 'Checkout button is not responding when I click it',
  appName: 'AcmeApp',
  pageUrl: 'https://app.acme.com/checkout/payment',
  pageName: 'Payment page',
  timestamp: '2026-04-26T12:00:00Z',
  user: { name: 'Ananya', email: 'ananya@acme.com' },
  category: 'bug',
  metadata: {
    viewport: '1440x900',
    userAgent: 'Mozilla/5.0',
    consoleErrors: ['TypeError: cannot read property of undefined at pay.js:42'],
  },
}

describe('mattermostAdapter — construction-time validation', () => {
  it('throws on a malformed webhook URL', () => {
    expect(() => mattermostAdapter({ webhookUrl: 'not-a-url' })).toThrowError(
      /webhookUrl/
    )
  })

  it('accepts a well-formed URL', () => {
    expect(() =>
      mattermostAdapter({ webhookUrl: 'https://chat.example.com/hooks/abc' })
    ).not.toThrow()
  })
})

describe('mattermostAdapter — send', () => {
  it('POSTs a markdown payload to the webhook URL', async () => {
    const fetchMock = vi.fn(
      async () => new Response('ok', { status: 200 })
    )
    const adapter = mattermostAdapter({
      webhookUrl: 'https://chat.example.com/hooks/abc',
      fetch: fetchMock,
    })

    const result = await adapter.send(samplePayload)

    expect(result.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://chat.example.com/hooks/abc')
    expect((init as RequestInit).method).toBe('POST')
    const body = JSON.parse((init as RequestInit).body as string) as { text: string }
    expect(body.text).toContain('AcmeApp')
    expect(body.text).toContain('Ananya')
  })

  it('returns ok=false with the response body on a non-2xx', async () => {
    const fetchMock = vi.fn(
      async () => new Response('Invalid webhook', { status: 403 })
    )
    const adapter = mattermostAdapter({
      webhookUrl: 'https://chat.example.com/hooks/abc',
      fetch: fetchMock,
    })

    const result = await adapter.send(samplePayload)
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/403.*Invalid webhook/)
  })

  it('returns ok=false with a network error message on fetch throw', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('ECONNREFUSED')
    })
    const adapter = mattermostAdapter({
      webhookUrl: 'https://chat.example.com/hooks/abc',
      fetch: fetchMock,
    })

    const result = await adapter.send(samplePayload)
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/network error.*ECONNREFUSED/)
  })

  it('returns a screenshot warning when payload has a screenshot (webhook auth cant upload files)', async () => {
    const fetchMock = vi.fn(
      async () => new Response('ok', { status: 200 })
    )
    const adapter = mattermostAdapter({
      webhookUrl: 'https://chat.example.com/hooks/abc',
      fetch: fetchMock,
    })

    const result = await adapter.send({
      ...samplePayload,
      screenshot: { base64: 'iVBORw0KGgo=', mimeType: 'image/png' },
    })

    expect(result.ok).toBe(true)
    expect(result.warnings?.[0]).toMatch(/screenshot not uploaded/)
  })
})

describe('formatMattermostMessage — pure formatter', () => {
  it('renders the bug emoji + reporter + page link', () => {
    const msg = formatMattermostMessage(samplePayload, {
      username: 'snapfeed',
      iconEmoji: 'memo',
    })
    expect(msg.text).toContain('🐛')
    expect(msg.text).toContain('### 🐛 AcmeApp feedback')
    expect(msg.text).toContain('Ananya')
    expect(msg.text).toContain('(ananya@acme.com)')
    expect(msg.text).toContain('[Payment page](https://app.acme.com/checkout/payment)')
  })

  it('escapes mattermost markdown control chars in user text (no injection)', () => {
    const msg = formatMattermostMessage(
      { ...samplePayload, text: '**bold** _italic_ `code`' },
      { username: 'snapfeed', iconEmoji: 'memo' }
    )
    // Underscores escaped → no rendered italics
    expect(msg.text).toContain('\\*\\*bold\\*\\* \\_italic\\_ \\`code\\`')
  })

  it('omits the channel field when not configured', () => {
    const msg = formatMattermostMessage(samplePayload, {
      username: 'snapfeed',
      iconEmoji: 'memo',
    })
    expect(msg.channel).toBeUndefined()
  })

  it('includes channel when configured', () => {
    const msg = formatMattermostMessage(samplePayload, {
      username: 'snapfeed',
      iconEmoji: 'memo',
      channel: 'feedback',
    })
    expect(msg.channel).toBe('feedback')
  })
})
