/**
 * Edge-case tests: authentication / authorization failures.
 *
 * Exercises the "I supplied a bad token" path for every adapter that uses
 * one. Particular attention to:
 *   - GraphQL APIs that return HTTP 200 with an `errors[]` array (Linear).
 *   - REST APIs that return HTTP 200 with `{ object: 'error' }` (Notion).
 *   - 403 Forbidden vs 401 Unauthorized — both should fail closed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { FeedbackPayload } from '../../src/types'

import { slackAdapter } from '../../src/adapters/slack'
import { jiraAdapter } from '../../src/adapters/jira'
import { linearAdapter } from '../../src/adapters/linear'
import { asanaAdapter } from '../../src/adapters/asana'
import { clickUpAdapter } from '../../src/adapters/clickUp'
import { notionAdapter } from '../../src/adapters/notion'
import { discordAdapter } from '../../src/adapters/discord'
import { telegramAdapter } from '../../src/adapters/telegram'
import { msTeamsAdapter } from '../../src/adapters/msTeams'
import { googleSheetsAdapter } from '../../src/adapters/googleSheets'
import { githubAdapter } from '../../src/adapters/github'
import { supabaseAdapter } from '../../src/adapters/supabase'

const samplePayload: FeedbackPayload = {
  text: 'auth check',
  appName: 'TestApp',
  pageUrl: 'https://example.com/page',
  pageName: 'Page',
  timestamp: '2026-04-26T00:00:00.000Z',
  category: 'bug',
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
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

describe('slack auth failure', () => {
  it('returns ok=false when webhook responds 403 invalid_token', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('invalid_token', { status: 403 })
    )

    const adapter = slackAdapter({
      webhookUrl: 'https://hooks.slack.com/services/x/y/z',
    })
    const r = await adapter.send(samplePayload)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('403')
  })
})

describe('github auth failure', () => {
  it('returns ok=false on 401 unauthorized (bad PAT)', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"message":"Bad credentials"}', { status: 401 })
    )

    const adapter = githubAdapter({
      token: 'gh_bad',
      owner: 'org',
      repo: 'app',
    })
    const r = await adapter.send(samplePayload)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('401')
  })
})

describe('jira auth failure', () => {
  it('returns ok=false on 401', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"errorMessages":["Authentication failure"]}', {
        status: 401,
      })
    )

    const adapter = jiraAdapter({
      host: 'example.atlassian.net',
      email: 'bot@example.com',
      apiToken: 'bad',
      projectKey: 'FEED',
    })
    const r = await adapter.send(samplePayload)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('401')
  })

  it('returns ok=false on 403 forbidden (project not allowed)', async () => {
    // JIRA 403 body usually mentions the project key inaccessibility.
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          errorMessages: ['You do not have permission to create issues in project FEED'],
        }),
        { status: 403 }
      )
    )

    const adapter = jiraAdapter({
      host: 'example.atlassian.net',
      email: 'bot@example.com',
      apiToken: 'tkn',
      projectKey: 'FEED',
    })
    const r = await adapter.send(samplePayload)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('403')
    expect(r.error).toContain('FEED')
  })
})

describe('linear auth failure', () => {
  it('returns ok=false when GraphQL responds 200 with errors[].message="Authentication required"', async () => {
    // The classic GraphQL gotcha: HTTP 200 but the request actually failed.
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        errors: [{ message: 'Authentication required' }],
      })
    )

    const adapter = linearAdapter({ apiKey: 'bad', teamId: 'team_1' })
    const r = await adapter.send(samplePayload)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/linear graphql/i)
    expect(r.error).toContain('Authentication required')
  })
})

describe('asana auth failure', () => {
  it('returns ok=false on 401', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"errors":[{"message":"Not Authorized"}]}', { status: 401 })
    )

    const adapter = asanaAdapter({
      accessToken: 'bad',
      workspaceId: 'ws',
      projectId: 'proj',
    })
    const r = await adapter.send(samplePayload)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('401')
  })
})

describe('clickUp auth failure', () => {
  it('returns ok=false on 401', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"err":"Token invalid"}', { status: 401 })
    )

    const adapter = clickUpAdapter({ apiToken: 'bad', listId: 'list_1' })
    const r = await adapter.send(samplePayload)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('401')
  })
})

describe('notion auth failure', () => {
  it('returns ok=false on HTTP 401', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('unauthorized', { status: 401 })
    )

    const adapter = notionAdapter({ apiKey: 'bad', databaseId: 'db_1' })
    const r = await adapter.send(samplePayload)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('401')
  })

  it('returns ok=false on Notion\'s quirky 200 + { object: "error", code: "unauthorized" } body', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        object: 'error',
        code: 'unauthorized',
        message: 'API token is invalid.',
      })
    )

    const adapter = notionAdapter({ apiKey: 'bad', databaseId: 'db_1' })
    const r = await adapter.send(samplePayload)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/notion api error/i)
    expect(r.error).toContain('API token is invalid.')
  })
})

describe('discord auth failure', () => {
  it('returns ok=false when an invalid webhook URL produces a 401/404', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"message":"Invalid Webhook Token","code":50027}', {
        status: 401,
      })
    )

    const adapter = discordAdapter({
      webhookUrl: 'https://discord.com/api/webhooks/x/INVALID',
    })
    const r = await adapter.send(samplePayload)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('401')
  })
})

describe('telegram auth failure', () => {
  it('returns ok=false when sendMessage returns 401', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"ok":false,"error_code":401,"description":"Unauthorized"}', {
        status: 401,
      })
    )

    const adapter = telegramAdapter({ botToken: 'bad', chatId: '123' })
    const r = await adapter.send(samplePayload)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/telegram sendmessage failed/i)
  })
})

describe('msTeams auth failure', () => {
  it('returns ok=false on 400 invalid card', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('Invalid card body', { status: 400 })
    )

    const adapter = msTeamsAdapter({
      webhookUrl: 'https://outlook.office.com/webhook/x',
    })
    const r = await adapter.send(samplePayload)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('400')
  })
})

describe('googleSheets auth failure', () => {
  it('returns ok=false when token exchange returns 401', async () => {
    // First fetch is the JWT-bearer token exchange against
    // https://oauth2.googleapis.com/token. Mock that as 401.
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: 'invalid_grant', error_description: 'Bad JWT' }),
        { status: 401 }
      )
    )

    const adapter = googleSheetsAdapter({
      spreadsheetId: 'sheet_1',
      serviceAccount: {
        client_email: 'unique-401@x.iam.gserviceaccount.com',
        // A syntactically-valid PEM is required for createSign().
        // This is a throwaway 1024-bit RSA key generated for tests; it will
        // produce a signature, the *exchange* is what we're forcing to fail.
        private_key:
          '-----BEGIN PRIVATE KEY-----\nMIICdgIBADANBgkqhkiG9w0BAQEFAASCAmAwggJcAgEAAoGBAMq3YJwxDQrG7Y6f\n' +
          'L+BvHAH4FAGc0UNjZ4hLF9R9wPZk6ozS1m1f+L65UjPj9NItXuYRCLoyFjPW7gPg\n' +
          'NkBe4i6yT6EwkpvPp9F2ZKmnqOofw9F4G1xDAjmEUnWjRmh3pN4WCRcbjrU4l3rN\n' +
          'JnzMPEjUOmWS7P/Yth4HJUjQvvfRAgMBAAECgYAW7L62lCAjmLefmurErurWpJ1U\n' +
          '4EVyrKr1XPYRpnZdwcetB4j5BGv0Pnw5XoAEFq0hGUnUV1Z2C8Q9rrlV3J/L7zW9\n' +
          '1qIb+fPEGpkRAJ0+aZ8mkgJcmIa0o1CyvcsZGTekHj0J2eo3sV31ngNCDsKVZB+J\n' +
          'OkrvvwBxbpNXJV9bAQJBAOl9SXfh73NzcOJqfDpEqWCOpa+R9w24CDlUqfMDR0iC\n' +
          'kK8dVB9OYnBXdsvtrV0BEQ8FRn2FJVQopw96pVZfqBECQQDdxs/HCQjgWvz7cNpR\n' +
          'Wlu0ojStM/hOEK0wHL56jzRVFn/WP4N3Lm3iW8vh+iMuS4+9tBh21+LhoHDFnNCU\n' +
          'GjzBAkAQjPzhgGxOksW9JpKRH5HE6S9Z14nRy/CwG/uvJ6PsFCaxmZHCbMVUGXc4\n' +
          'XTfH+xPpYgYLB7gkuw+1cTzpvTaRAkAdvB0w8tvW4UBF26cFn4Kbl0GxkRyEBpVm\n' +
          'sqHAcOqlJmPj4D0kLdJlx4qwiZ/HEgBUKOKAZh/q3yvZxbjW1Z3BAkEArOdVYpjf\n' +
          'YpjPQrQbTkoNPo5oQuSc41W8OLjAr6tPnvkxN0M6Su8bVBWKLY2Ad0jKp6dT6P4G\n' +
          'XaWgZjoBGCxKfQ==\n-----END PRIVATE KEY-----\n',
      },
    })

    const r = await adapter.send(samplePayload)
    expect(r.ok).toBe(false)
    // The wrapped catch reports "Google Sheets adapter error: …Token exchange failed (401)…"
    expect(r.error).toMatch(/google sheets/i)
    expect(r.error).toContain('401')
  })
})

describe('supabase auth failure', () => {
  it('returns ok=false on 401 (invalid anon key)', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"message":"Invalid API key"}', { status: 401 })
    )

    const adapter = supabaseAdapter({
      url: 'https://abc.supabase.co',
      anonKey: 'bad',
    })
    const r = await adapter.send(samplePayload)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('401')
  })
})
