/**
 * Tests for src/adapters/slack.ts — slackAdapter()
 *
 * These tests are scoped to construction-time concerns (URL validation).
 * Send-path behavior is exercised through tests/adapters/auto.test.ts and
 * the wider integration suite.
 */

import { describe, it, expect } from 'vitest'
import { slackAdapter } from '../../src/adapters/slack'

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
