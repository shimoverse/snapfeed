/**
 * Tests for src/adapters/auto.ts — autoAdapters()
 *
 * Mutates `process.env` per test (saved + restored in beforeEach/afterEach).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { autoAdapters } from '../../src/adapters/auto'

const ENV_KEYS = [
  'SNAPFEED_SLACK_WEBHOOK',
  'SNAPFEED_SLACK_USERNAME',
  'SNAPFEED_SLACK_CHANNEL',
  'SNAPFEED_DISCORD_WEBHOOK',
  'SNAPFEED_DISCORD_MENTION_ROLE',
  'SNAPFEED_GITHUB_TOKEN',
  'SNAPFEED_GITHUB_REPO',
  'SNAPFEED_TELEGRAM_BOT_TOKEN',
  'SNAPFEED_TELEGRAM_CHAT_ID',
  'SNAPFEED_WEBHOOK_URL',
  'SNAPFEED_FILE_PATH',
  // Unprefixed forms — must also be saved/restored so the typo-detection
  // tests don't pollute later cases.
  'SLACK_WEBHOOK',
  'DISCORD_WEBHOOK',
  'GITHUB_TOKEN',
  'WEBHOOK_URL',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_CHAT_ID',
  'NODE_ENV',
] as const

describe('autoAdapters', () => {
  let saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    saved = {}
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k]
      delete process.env[k]
    }
  })

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
    vi.restoreAllMocks()
  })

  it('returns file + console adapters in dev with no env vars set', () => {
    process.env.NODE_ENV = 'development'
    const adapters = autoAdapters()
    const names = adapters.map((a) => a.name)
    expect(names).toContain('file')
    expect(names).toContain('console')
  })

  it('returns empty array and warns in production with no env vars', () => {
    process.env.NODE_ENV = 'production'
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const adapters = autoAdapters()
    expect(adapters).toEqual([])
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]![0]).toMatch(/no adapters configured/i)
  })

  it('includes slack adapter when SNAPFEED_SLACK_WEBHOOK is set', () => {
    process.env.SNAPFEED_SLACK_WEBHOOK = 'https://hooks.slack.com/services/T/B/abc'
    const adapters = autoAdapters()
    expect(adapters.some((a) => a.name === 'slack')).toBe(true)
  })

  it('includes github adapter when both GITHUB_TOKEN and GITHUB_REPO are set', () => {
    process.env.SNAPFEED_GITHUB_TOKEN = 'ghp_test'
    process.env.SNAPFEED_GITHUB_REPO = 'owner/repo'
    const adapters = autoAdapters()
    expect(adapters.some((a) => a.name === 'github')).toBe(true)
  })

  it('does NOT include github adapter when GITHUB_REPO is missing', () => {
    process.env.SNAPFEED_GITHUB_TOKEN = 'ghp_test'
    // SNAPFEED_GITHUB_REPO intentionally unset
    process.env.NODE_ENV = 'production' // avoid dev fallback noise
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const adapters = autoAdapters()
    expect(adapters.some((a) => a.name === 'github')).toBe(false)
  })

  it('does NOT include github adapter when GITHUB_TOKEN is missing', () => {
    process.env.SNAPFEED_GITHUB_REPO = 'owner/repo'
    process.env.NODE_ENV = 'production'
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const adapters = autoAdapters()
    expect(adapters.some((a) => a.name === 'github')).toBe(false)
  })

  it('warns and skips github when GITHUB_REPO is malformed (no slash)', () => {
    process.env.SNAPFEED_GITHUB_TOKEN = 'ghp_test'
    process.env.SNAPFEED_GITHUB_REPO = 'just-a-name-no-slash'
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const adapters = autoAdapters()
    expect(adapters.some((a) => a.name === 'github')).toBe(false)
    expect(warn).toHaveBeenCalled()
  })

  it('returns multiple adapters in stable detection order when multiple env vars set', () => {
    process.env.SNAPFEED_SLACK_WEBHOOK = 'https://hooks.slack.com/services/T/B/abc'
    process.env.SNAPFEED_DISCORD_WEBHOOK = 'https://discord.com/api/webhooks/x/y'
    process.env.SNAPFEED_GITHUB_TOKEN = 'ghp_test'
    process.env.SNAPFEED_GITHUB_REPO = 'owner/repo'
    process.env.SNAPFEED_WEBHOOK_URL = 'https://example.com/hook'

    const adapters = autoAdapters()
    const names = adapters.map((a) => a.name)
    // Detection order documented in auto.ts: slack → discord → github → telegram → webhook → file
    expect(names).toEqual(['slack', 'discord', 'github', 'webhook'])
  })

  it('includes telegram adapter when both bot token and chat id are set', () => {
    process.env.SNAPFEED_TELEGRAM_BOT_TOKEN = 'bot-token'
    process.env.SNAPFEED_TELEGRAM_CHAT_ID = '12345'
    const adapters = autoAdapters()
    expect(adapters.some((a) => a.name === 'telegram')).toBe(true)
  })

  it('includes file adapter when SNAPFEED_FILE_PATH is set', () => {
    process.env.SNAPFEED_FILE_PATH = '/tmp/feedback.jsonl'
    const adapters = autoAdapters()
    expect(adapters.some((a) => a.name === 'file')).toBe(true)
  })

  it('includes generic webhook adapter when SNAPFEED_WEBHOOK_URL is set', () => {
    process.env.SNAPFEED_WEBHOOK_URL = 'https://example.com/feedback'
    const adapters = autoAdapters()
    expect(adapters.some((a) => a.name === 'webhook')).toBe(true)
  })

  it('treats empty-string env vars as unset', () => {
    process.env.SNAPFEED_SLACK_WEBHOOK = ''
    process.env.NODE_ENV = 'production'
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const adapters = autoAdapters()
    expect(adapters.some((a) => a.name === 'slack')).toBe(false)
  })

  it('passes mentionRoleId to discord adapter when SNAPFEED_DISCORD_MENTION_ROLE is set', async () => {
    // Verify by sending a payload through the constructed adapter and inspecting
    // the JSON body that lands at the webhook — the role should appear in the
    // `content` field as `<@&ROLE_ID>`.
    process.env.SNAPFEED_DISCORD_WEBHOOK = 'https://discord.com/api/webhooks/x/y'
    process.env.SNAPFEED_DISCORD_MENTION_ROLE = '987654321012345678'

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'msg_1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    try {
      const adapters = autoAdapters()
      const discord = adapters.find((a) => a.name === 'discord')
      expect(discord).toBeDefined()

      await discord!.send({
        text: 'hi',
        appName: 'X',
        pageUrl: 'https://x.com',
        pageName: 'X',
        timestamp: '2026-04-26T00:00:00.000Z',
      })

      const body = JSON.parse(fetchMock.mock.calls[0]![1].body)
      expect(body.content).toBe('<@&987654321012345678>')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('warns when an unprefixed SLACK_WEBHOOK is set without its SNAPFEED_ sibling', () => {
    process.env.SLACK_WEBHOOK = 'https://hooks.slack.com/services/T/B/abc'
    // Production so the dev fallback doesn't muddy the warn-call assertions.
    process.env.NODE_ENV = 'production'
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const adapters = autoAdapters()
    // SLACK_WEBHOOK alone (without SNAPFEED_ prefix) does NOT wire slack.
    expect(adapters.some(a => a.name === 'slack')).toBe(false)
    // We expect the typo warning AND the no-adapters-configured warning.
    const messages = warn.mock.calls.map(c => String(c[0]))
    expect(messages.some(m => m.includes('Did you mean SNAPFEED_SLACK_WEBHOOK?'))).toBe(true)
  })

  it('does NOT warn when both SLACK_WEBHOOK and SNAPFEED_SLACK_WEBHOOK are set', () => {
    process.env.SLACK_WEBHOOK = 'https://other.example.com'
    process.env.SNAPFEED_SLACK_WEBHOOK = 'https://hooks.slack.com/services/T/B/abc'
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    autoAdapters()
    const messages = warn.mock.calls.map(c => String(c[0]))
    expect(messages.some(m => m.includes('Did you mean SNAPFEED_SLACK_WEBHOOK?'))).toBe(false)
  })

  it('warns and skips github when GITHUB_REPO has too many segments', () => {
    // Previously `owner/repo/extra/junk` was silently truncated to owner/repo
    // via destructuring — masking the misconfiguration. Now strict.
    process.env.SNAPFEED_GITHUB_TOKEN = 'ghp_test'
    process.env.SNAPFEED_GITHUB_REPO = 'owner/repo/extra/junk'
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const adapters = autoAdapters()
    expect(adapters.some((a) => a.name === 'github')).toBe(false)
    expect(warn).toHaveBeenCalled()
    expect(warn.mock.calls[0]![0]).toMatch(/owner\/repo/)
  })

  // ─── v0.7: near-miss typo detection + dev-fallback explanation ────────

  describe('near-miss typo detection (v0.7)', () => {
    // After the EXACT-match unprefixed check, also catch close-but-wrong
    // prefixed names like SNAPFEED_SLACK_WEBHOK (missing "O") that
    // previously silently fell through to the "no adapters configured"
    // dev-fallback path with no clue why.
    afterEach(() => {
      // Clean any extra typo-shaped vars these tests set.
      for (const k of [
        'SNAPFEED_SLACK_WEBHOK',
        'SNAPFEED_SLAK_WEBHOOK',
        'SNAPFEED_GITHB_TOKEN',
        'SNAPFEED_DISCORD_WEBOOK',
        'SNAPFEED_TELEGRAM_BOT',
      ]) {
        delete process.env[k]
      }
    })

    function mentionsBoth(messages: string[], typo: string, suggested: string): boolean {
      return messages.some((m) => m.includes(typo) && m.includes(suggested))
    }

    it('warns with a "did you mean" suggestion when SNAPFEED_SLACK_WEBHOK (missing O) is set', () => {
      process.env.NODE_ENV = 'development'
      process.env.SNAPFEED_SLACK_WEBHOK = 'https://hooks.slack.com/services/T/B/abc'
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      autoAdapters()
      const messages = warn.mock.calls.map((c) => String(c[0]))
      expect(mentionsBoth(messages, 'SNAPFEED_SLACK_WEBHOK', 'SNAPFEED_SLACK_WEBHOOK')).toBe(true)
    })

    it('warns when SNAPFEED_DISCORD_WEBOOK (missing H) is set', () => {
      process.env.NODE_ENV = 'development'
      process.env.SNAPFEED_DISCORD_WEBOOK = 'https://discord.com/api/webhooks/1/abc'
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      autoAdapters()
      const messages = warn.mock.calls.map((c) => String(c[0]))
      expect(mentionsBoth(messages, 'SNAPFEED_DISCORD_WEBOOK', 'SNAPFEED_DISCORD_WEBHOOK')).toBe(true)
    })

    it('warns when SNAPFEED_GITHB_TOKEN (missing U) is set', () => {
      process.env.NODE_ENV = 'development'
      process.env.SNAPFEED_GITHB_TOKEN = 'ghp_test'
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      autoAdapters()
      const messages = warn.mock.calls.map((c) => String(c[0]))
      expect(mentionsBoth(messages, 'SNAPFEED_GITHB_TOKEN', 'SNAPFEED_GITHUB_TOKEN')).toBe(true)
    })

    it('does NOT suggest when the env var is too far from any known name', () => {
      process.env.NODE_ENV = 'development'
      // Distance ≥ 4 from any known SNAPFEED_* — should NOT trip a suggestion
      // (we only suggest when the typo is plausibly close).
      process.env.SNAPFEED_TOTALLY_UNRELATED_THING = 'value'
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      autoAdapters()
      const messages = warn.mock.calls.map((c) => String(c[0]))
      expect(
        messages.some((m) => /Did you mean SNAPFEED_/i.test(m))
      ).toBe(false)
      delete process.env.SNAPFEED_TOTALLY_UNRELATED_THING
    })

    it('does NOT suggest when the suspected typo is itself a valid SNAPFEED_ key', () => {
      // SNAPFEED_SLACK_USERNAME is a real key — must not be flagged as a
      // typo of SNAPFEED_SLACK_WEBHOOK just because the prefix matches.
      process.env.NODE_ENV = 'development'
      process.env.SNAPFEED_SLACK_USERNAME = 'feedback-bot'
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      autoAdapters()
      const messages = warn.mock.calls.map((c) => String(c[0]))
      expect(
        messages.some((m) => /Did you mean.*SNAPFEED_SLACK_USERNAME/i.test(m))
      ).toBe(false)
    })
  })

  describe('dev-fallback explanatory warning (v0.7)', () => {
    it('warns once explaining the fallback when dev mode falls back to file+console', () => {
      // No real adapter env vars set, dev mode → file + console fallback.
      // Today this is silent; integrators have no idea their env var didn't
      // resolve to a real adapter. v0.7 adds an info-level explanation.
      process.env.NODE_ENV = 'development'
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      autoAdapters()
      const messages = warn.mock.calls.map((c) => String(c[0]))
      expect(
        messages.some((m) =>
          /falling back to file \+ console/i.test(m) ||
          /no SNAPFEED_\* env vars detected/i.test(m)
        )
      ).toBe(true)
    })

    it('does NOT warn about fallback when a real adapter env var IS set', () => {
      process.env.NODE_ENV = 'development'
      process.env.SNAPFEED_SLACK_WEBHOOK = 'https://hooks.slack.com/services/T/B/abc'
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      autoAdapters()
      const messages = warn.mock.calls.map((c) => String(c[0]))
      expect(
        messages.some((m) => /falling back/i.test(m))
      ).toBe(false)
    })
  })
})
