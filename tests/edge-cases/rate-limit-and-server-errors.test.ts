/**
 * Edge-case tests: rate limits & 5xx server errors across HTTP-using adapters.
 *
 * For every adapter:
 *   - HTTP 429 (rate limited) -> ok=false, error contains "429"
 *   - HTTP 503 (service unavailable) -> ok=false
 *   - HTTP 500 -> ok=false
 *
 * Plus: truncated/malformed JSON response — adapters that try to parse the
 * 2xx body should return ok=false with a parse-error message rather than
 * throw an uncaught SyntaxError.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { FeedbackPayload } from '../../src/types'

import { slackAdapter } from '../../src/adapters/slack'
import { jiraAdapter } from '../../src/adapters/jira'
import { linearAdapter } from '../../src/adapters/linear'
import { asanaAdapter } from '../../src/adapters/asana'
import { clickUpAdapter } from '../../src/adapters/clickUp'
import { notionAdapter } from '../../src/adapters/notion'
import { msTeamsAdapter } from '../../src/adapters/msTeams'
import { discordAdapter } from '../../src/adapters/discord'
import { webhookAdapter } from '../../src/adapters/webhook'
import { telegramAdapter } from '../../src/adapters/telegram'
import { githubAdapter } from '../../src/adapters/github'
import { supabaseAdapter } from '../../src/adapters/supabase'

const samplePayload: FeedbackPayload = {
  text: 'rate-limit / server-error coverage',
  appName: 'TestApp',
  pageUrl: 'https://example.com/page',
  pageName: 'Page',
  timestamp: '2026-04-26T00:00:00.000Z',
  category: 'bug',
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

type AdapterEntry = {
  name: string
  build: () => { send: (p: FeedbackPayload) => Promise<{ ok: boolean; error?: string }> }
  /** Whether the adapter parses a 2xx JSON body on the create-call path. */
  parsesJsonOnSuccess: boolean
  /**
   * v0.5.2 hardening: adapters whose 2xx body parse failure should NOT crash
   * the adapter but ALSO should not be reported as ok=false. These adapters
   * return ok=true with a missing deliveryId on a malformed 2xx body
   * (delivery succeeded; we just lost the id).
   */
  malformedJsonStaysOk?: boolean
}

const ADAPTERS: AdapterEntry[] = [
  {
    name: 'slack',
    build: () => slackAdapter({ webhookUrl: 'https://hooks.slack.com/services/x/y/z' }),
    // Slack ignores the body — returns ok on any 2xx.
    parsesJsonOnSuccess: false,
  },
  {
    name: 'jira',
    build: () =>
      jiraAdapter({
        host: 'example.atlassian.net',
        email: 'bot@example.com',
        apiToken: 'tkn',
        projectKey: 'FEED',
      }),
    parsesJsonOnSuccess: true,
  },
  {
    name: 'linear',
    build: () => linearAdapter({ apiKey: 'lin_key', teamId: 'team_1' }),
    parsesJsonOnSuccess: true,
  },
  {
    name: 'asana',
    build: () =>
      asanaAdapter({
        accessToken: 'pat',
        workspaceId: 'ws',
        projectId: 'proj',
      }),
    parsesJsonOnSuccess: true,
  },
  {
    name: 'clickUp',
    build: () => clickUpAdapter({ apiToken: 'tok', listId: 'list_1' }),
    parsesJsonOnSuccess: true,
  },
  {
    name: 'notion',
    build: () => notionAdapter({ apiKey: 'secret_x', databaseId: 'db_1' }),
    parsesJsonOnSuccess: true,
  },
  {
    name: 'msTeams',
    build: () =>
      msTeamsAdapter({
        webhookUrl: 'https://outlook.office.com/webhook/x',
      }),
    parsesJsonOnSuccess: false,
  },
  {
    name: 'discord',
    build: () =>
      discordAdapter({ webhookUrl: 'https://discord.com/api/webhooks/x/y' }),
    // Discord parses the body only when content-type is application/json,
    // and swallows JSON errors, so a malformed body still leaves ok=true.
    // Skip parse-error coverage for it (separate test below documents this).
    parsesJsonOnSuccess: false,
  },
  {
    name: 'webhook',
    build: () => webhookAdapter({ url: 'https://hooks.example.com/feedback' }),
    parsesJsonOnSuccess: false,
  },
  {
    name: 'telegram',
    build: () => telegramAdapter({ botToken: 't', chatId: '123' }),
    parsesJsonOnSuccess: true,
    // Text message succeeded (HTTP 200); a malformed body just costs us the
    // message_id. Delivery is real — surfacing ok=true is correct.
    malformedJsonStaysOk: true,
  },
  {
    name: 'github',
    build: () =>
      githubAdapter({ token: 'gh_pat', owner: 'org', repo: 'app' }),
    parsesJsonOnSuccess: true,
    // Issue creation succeeded; a malformed body just costs us the issue number.
    malformedJsonStaysOk: true,
  },
  {
    name: 'supabase',
    build: () =>
      supabaseAdapter({
        url: 'https://abc.supabase.co',
        anonKey: 'anon_key',
      }),
    parsesJsonOnSuccess: true,
    // Insert succeeded; a malformed body just costs us the row id.
    malformedJsonStaysOk: true,
  },
]

describe('rate-limit-and-server-errors', () => {
  for (const { name, build, parsesJsonOnSuccess, malformedJsonStaysOk } of ADAPTERS) {
    describe(`${name} server errors`, () => {
      it('returns ok=false on HTTP 429 (rate limited) with status code in error', async () => {
        fetchMock.mockResolvedValue(
          new Response('{"message":"rate limited"}', { status: 429 })
        )
        const adapter = build()

        const r = await adapter.send(samplePayload)
        expect(r.ok).toBe(false)
        // We accept either '429' or a literal mention of "rate"
        expect((r.error ?? '').toLowerCase()).toMatch(/429|rate/)
      })

      // F-002 fixed in v0.4.1: every adapter, including telegram, now includes
      // the HTTP status in its non-2xx error message.
      const expectStatusInError = true

      it('returns ok=false on HTTP 503 (service unavailable)', async () => {
        fetchMock.mockResolvedValue(
          new Response('Service Unavailable', { status: 503 })
        )
        const adapter = build()

        const r = await adapter.send(samplePayload)
        expect(r.ok).toBe(false)
        if (expectStatusInError) {
          expect(r.error).toContain('503')
        }
      })

      it('returns ok=false on HTTP 500', async () => {
        fetchMock.mockResolvedValue(new Response('boom', { status: 500 }))
        const adapter = build()

        const r = await adapter.send(samplePayload)
        expect(r.ok).toBe(false)
        if (expectStatusInError) {
          expect(r.error).toContain('500')
        }
      })

      if (parsesJsonOnSuccess) {
        it('does not throw when 2xx body is truncated/invalid JSON', async () => {
          fetchMock.mockResolvedValue(
            new Response('{"incomplete":', {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            })
          )
          const adapter = build()

          // The adapter must catch the SyntaxError thrown by res.json().
          // Two valid responses depending on adapter contract:
          //   - ok=false with a "no <id>" error message (most adapters): the
          //     create succeeded but we have no way to identify what was
          //     created, so treat it as a soft failure.
          //   - ok=true with a missing/empty deliveryId (telegram, github,
          //     supabase): primary delivery is unambiguously real, the body
          //     parse only cost us the id.
          // Either is fine — the regression we guard against is an uncaught
          // SyntaxError propagating to the caller.
          const r = await adapter.send(samplePayload)
          if (malformedJsonStaysOk) {
            expect(r.ok).toBe(true)
          } else {
            expect(r.ok).toBe(false)
            expect(r.error).toBeTruthy()
          }
        })
      }
    })
  }

  describe('discord truncated-JSON-on-success behavior (documented)', () => {
    it('discord swallows malformed JSON on a 2xx response and still returns ok=true with default deliveryId', async () => {
      // Documented intentional behavior: Discord adapter wraps the JSON parse
      // in try/catch and falls back to a default deliveryId because some
      // Discord webhooks 204-no-content. A malformed body therefore looks
      // identical to "no body" from the adapter's perspective.
      fetchMock.mockResolvedValueOnce(
        new Response('{"incomplete":', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )

      const adapter = discordAdapter({
        webhookUrl: 'https://discord.com/api/webhooks/x/y',
      })
      const r = await adapter.send(samplePayload)
      expect(r.ok).toBe(true)
      expect(r.deliveryId).toBe('discord:webhook')
    })
  })
})
