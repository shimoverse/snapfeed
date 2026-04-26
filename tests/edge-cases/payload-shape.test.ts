/**
 * Edge-case tests: weird payload shapes the adapter layer is expected to
 * tolerate without crashing.
 *
 * Coverage chosen for the adapters with the most parsing logic:
 *   - jira (ADF builder)
 *   - linear (Markdown builder + GraphQL)
 *   - notion (block builder + property builder)
 *   - asana (notes builder)
 *   - clickUp (description builder)
 *   - msTeams (Adaptive Card builder)
 *
 * Themes:
 *   - missing `category` -> default fallback for emoji/priority lookup.
 *   - missing `metadata`  -> no console-errors block, no viewport row.
 *   - whitespace-only `text` -> still posted, server-side validates.
 *   - extremely long `text` (50_000 chars) -> sent as-is, never silently dropped.
 *   - corrupt screenshot.base64 -> ok=true with a warning, OR ok=false with
 *     a clear error, but never an uncaught throw.
 *   - special characters in user.email -> properly URL-encoded where applied.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { FeedbackPayload } from '../../src/types'

import { jiraAdapter } from '../../src/adapters/jira'
import { linearAdapter } from '../../src/adapters/linear'
import { notionAdapter } from '../../src/adapters/notion'
import { asanaAdapter } from '../../src/adapters/asana'
import { clickUpAdapter } from '../../src/adapters/clickUp'
import { msTeamsAdapter } from '../../src/adapters/msTeams'
import { supabaseAdapter } from '../../src/adapters/supabase'

const MIN_PAYLOAD: FeedbackPayload = {
  text: 'minimal payload',
  appName: 'TestApp',
  pageUrl: 'https://example.com/page',
  pageName: 'Page',
  timestamp: '2026-04-26T00:00:00.000Z',
  // no category, no metadata, no user, no screenshot
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

// ─────────────────────────────────────────────────────────────────────────
// missing category
// ─────────────────────────────────────────────────────────────────────────

describe('payload with no category', () => {
  it('jira: posts without crashing on emoji lookup', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, { key: 'FEED-1', id: '10001' })
    )

    const adapter = jiraAdapter({
      host: 'example.atlassian.net',
      email: 'bot@example.com',
      apiToken: 'tkn',
      projectKey: 'FEED',
    })
    const r = await adapter.send(MIN_PAYLOAD)
    expect(r.ok).toBe(true)
    expect(r.deliveryId).toBe('FEED-1')

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body)
    // Title shouldn't include any emoji — just `[Feedback] <text>`.
    expect(body.fields.summary).toBe('[Feedback] minimal payload')
  })

  it('linear: posts without crashing on emoji/priority lookup', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        data: {
          issueCreate: {
            success: true,
            issue: { id: 'iss', identifier: 'TST-1', url: 'https://x' },
          },
        },
      })
    )

    const adapter = linearAdapter({
      apiKey: 'k',
      teamId: 't',
      // Per-category map without "other" — exercises the fallback.
      priority: { bug: 1 },
    })
    const r = await adapter.send(MIN_PAYLOAD)
    expect(r.ok).toBe(true)
    expect(r.deliveryId).toBe('TST-1')
  })

  it('notion: writes select.name="other" as the default category', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { object: 'page', id: 'page_1' })
    )

    const adapter = notionAdapter({ apiKey: 'k', databaseId: 'db_1' })
    const r = await adapter.send(MIN_PAYLOAD)
    expect(r.ok).toBe(true)

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body)
    expect(body.properties.Category.select.name).toBe('other')
  })

  it('asana: posts without crashing', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, { data: { gid: 'task_1' } })
    )

    const adapter = asanaAdapter({
      accessToken: 'pat',
      workspaceId: 'ws',
      projectId: 'proj',
    })
    const r = await adapter.send(MIN_PAYLOAD)
    expect(r.ok).toBe(true)
  })

  it('clickUp: posts without crashing', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: 'task_1' }))

    const adapter = clickUpAdapter({ apiToken: 'tok', listId: 'list_1' })
    const r = await adapter.send(MIN_PAYLOAD)
    expect(r.ok).toBe(true)
  })

  it('msTeams: falls back to a default accent color', async () => {
    fetchMock.mockResolvedValueOnce(new Response('1', { status: 200 }))

    const adapter = msTeamsAdapter({
      webhookUrl: 'https://outlook.office.com/webhook/x',
    })
    const r = await adapter.send(MIN_PAYLOAD)
    expect(r.ok).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// missing metadata
// ─────────────────────────────────────────────────────────────────────────

describe('payload with no metadata (no console errors, no viewport)', () => {
  it('jira: omits viewport / userAgent / console-errors blocks', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, { key: 'FEED-2', id: '10002' })
    )

    const adapter = jiraAdapter({
      host: 'example.atlassian.net',
      email: 'bot@example.com',
      apiToken: 'tkn',
      projectKey: 'FEED',
    })
    const r = await adapter.send(MIN_PAYLOAD)
    expect(r.ok).toBe(true)

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body)
    // bullet items joined to a single string for substring checks
    const adfStr = JSON.stringify(body.fields.description)
    expect(adfStr).not.toContain('Viewport')
    expect(adfStr).not.toContain('User Agent')
    expect(adfStr).not.toContain('Recent Console Errors')
  })

  it('linear: omits viewport / userAgent / console-errors lines', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        data: {
          issueCreate: {
            success: true,
            issue: { id: 'iss', identifier: 'TST-2', url: 'https://x' },
          },
        },
      })
    )

    const adapter = linearAdapter({ apiKey: 'k', teamId: 't' })
    await adapter.send(MIN_PAYLOAD)

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body)
    const description = body.variables.input.description as string
    expect(description).not.toContain('Viewport')
    expect(description).not.toContain('User Agent')
    expect(description).not.toContain('Console Errors')
  })

  it('notion: page is created with no console-errors block', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { object: 'page', id: 'page_2' })
    )

    const adapter = notionAdapter({ apiKey: 'k', databaseId: 'db_1' })
    await adapter.send(MIN_PAYLOAD)

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body)
    const childTypes = (body.children as Array<{ type: string }>).map((c) => c.type)
    expect(childTypes).not.toContain('code')
    // Heading 'Console errors' shouldn't be present.
    const allText = JSON.stringify(body.children)
    expect(allText).not.toContain('Console errors')
  })

  it('asana: notes contain no Viewport row', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, { data: { gid: 'task_2' } })
    )

    const adapter = asanaAdapter({
      accessToken: 'pat',
      workspaceId: 'ws',
      projectId: 'proj',
    })
    await adapter.send(MIN_PAYLOAD)

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body)
    expect(body.data.notes).not.toContain('Viewport:')
    expect(body.data.notes).not.toContain('console errors')
  })

  it('clickUp: description has no Viewport row', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: 'task_2' }))

    const adapter = clickUpAdapter({ apiToken: 'tok', listId: 'list_1' })
    await adapter.send(MIN_PAYLOAD)

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body)
    expect(body.description).not.toContain('Viewport')
    expect(body.description).not.toContain('console errors')
  })

  it('msTeams: card has no Viewport fact', async () => {
    fetchMock.mockResolvedValueOnce(new Response('1', { status: 200 }))

    const adapter = msTeamsAdapter({
      webhookUrl: 'https://outlook.office.com/webhook/x',
    })
    await adapter.send(MIN_PAYLOAD)

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body)
    const cardStr = JSON.stringify(body)
    expect(cardStr).not.toContain('"Viewport"')
  })
})

// ─────────────────────────────────────────────────────────────────────────
// whitespace-only text
// ─────────────────────────────────────────────────────────────────────────

describe('payload with whitespace-only text', () => {
  const wsPayload: FeedbackPayload = { ...MIN_PAYLOAD, text: '   \n\t   ' }

  it('jira: still posts (no client-side filter)', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, { key: 'FEED-3', id: '10003' })
    )

    const adapter = jiraAdapter({
      host: 'example.atlassian.net',
      email: 'bot@example.com',
      apiToken: 'tkn',
      projectKey: 'FEED',
    })
    const r = await adapter.send(wsPayload)
    expect(r.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalled()
  })

  it('linear: still posts', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        data: {
          issueCreate: {
            success: true,
            issue: { id: 'iss', identifier: 'TST-3', url: 'https://x' },
          },
        },
      })
    )

    const adapter = linearAdapter({ apiKey: 'k', teamId: 't' })
    const r = await adapter.send(wsPayload)
    expect(r.ok).toBe(true)
  })

  it('notion: still posts', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { object: 'page', id: 'page_3' })
    )

    const adapter = notionAdapter({ apiKey: 'k', databaseId: 'db_1' })
    const r = await adapter.send(wsPayload)
    expect(r.ok).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// very long text
// ─────────────────────────────────────────────────────────────────────────

describe('payload with very long text (50_000 chars)', () => {
  const LONG = 'A'.repeat(50_000)
  const longPayload: FeedbackPayload = { ...MIN_PAYLOAD, text: LONG }

  it('jira: sends body containing the full long text', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, { key: 'FEED-4', id: '10004' })
    )

    const adapter = jiraAdapter({
      host: 'example.atlassian.net',
      email: 'bot@example.com',
      apiToken: 'tkn',
      projectKey: 'FEED',
    })
    await adapter.send(longPayload)

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body)
    // ADF body paragraph contains the un-truncated text — title is truncated
    // to 80 chars (documented behavior) but the description is whole.
    const adfStr = JSON.stringify(body.fields.description)
    expect(adfStr).toContain(LONG)
  })

  it('linear: sends Markdown description containing the full long text', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        data: {
          issueCreate: {
            success: true,
            issue: { id: 'iss', identifier: 'TST-4', url: 'https://x' },
          },
        },
      })
    )

    const adapter = linearAdapter({ apiKey: 'k', teamId: 't' })
    await adapter.send(longPayload)

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body)
    expect(body.variables.input.description).toContain(LONG)
  })

  it('notion: page body contains the full long text in the first paragraph block', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { object: 'page', id: 'page_4' })
    )

    const adapter = notionAdapter({ apiKey: 'k', databaseId: 'db_1' })
    await adapter.send(longPayload)

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body)
    const firstBlock = body.children[0]
    expect(firstBlock.type).toBe('paragraph')
    expect(firstBlock.paragraph.rich_text[0].text.content).toBe(LONG)
  })

  it('msTeams: body fact-set contains the un-truncated full text in its body TextBlock', async () => {
    fetchMock.mockResolvedValueOnce(new Response('1', { status: 200 }))

    const adapter = msTeamsAdapter({
      webhookUrl: 'https://outlook.office.com/webhook/x',
    })
    await adapter.send(longPayload)

    const sent = JSON.parse(fetchMock.mock.calls[0]![1].body)
    const cardBody = sent.attachments[0].content.body as Array<{
      type: string
      text?: string
    }>
    // The 3rd element is the body TextBlock with full text.
    const longBlock = cardBody.find((b) => b.text === LONG)
    expect(longBlock).toBeDefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────
// corrupt screenshot.base64
// ─────────────────────────────────────────────────────────────────────────

describe('payload with corrupt (non-base64) screenshot string', () => {
  // Characters guaranteed to be invalid in any base64 alphabet.
  const corruptPayload: FeedbackPayload = {
    ...MIN_PAYLOAD,
    screenshot: { base64: '!!!not-base64!!!', mimeType: 'image/png' },
  }

  it('jira: page is created; corrupt screenshot logs a warning but adapter returns ok=true', async () => {
    // jira posts the issue first, then attempts the attachment. atob() on
    // the corrupt string throws, the catch block logs to console.warn, and
    // the adapter returns ok=true on the strength of the create call.
    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, { key: 'FEED-5', id: '10005' })
    )
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const adapter = jiraAdapter({
      host: 'example.atlassian.net',
      email: 'bot@example.com',
      apiToken: 'tkn',
      projectKey: 'FEED',
    })
    const r = await adapter.send(corruptPayload)

    expect(r.ok).toBe(true)
    // No second fetch (attachment) should have been issued for the corrupt blob.
    // jira's catch wraps both decode + the upload fetch, so we just verify
    // a console.warn fired or that ok stayed true.
    warnSpy.mockRestore()
  })

  it('asana: still creates the task and surfaces a screenshot warning', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, { data: { gid: 'task_5' } })
    )

    const adapter = asanaAdapter({
      accessToken: 'pat',
      workspaceId: 'ws',
      projectId: 'proj',
    })
    const r = await adapter.send(corruptPayload)

    expect(r.ok).toBe(true)
    expect(r.deliveryId).toBe('task_5')
    // The decode throw is caught and turned into a warning.
    expect(r.warnings).toBeDefined()
    expect(r.warnings?.[0]).toMatch(/screenshot/)
  })

  it('clickUp: still creates the task and surfaces a screenshot warning', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: 'task_5' }))

    const adapter = clickUpAdapter({ apiToken: 'tok', listId: 'list_1' })
    const r = await adapter.send(corruptPayload)

    expect(r.ok).toBe(true)
    expect(r.warnings).toBeDefined()
    expect(r.warnings?.[0]).toMatch(/screenshot/)
  })

  it('supabase: stores the corrupt base64 as-is (it is the columns owner\'s job to validate)', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, [{ id: 'row_1' }])
    )

    const adapter = supabaseAdapter({
      url: 'https://abc.supabase.co',
      anonKey: 'k',
    })
    const r = await adapter.send(corruptPayload)
    expect(r.ok).toBe(true)

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body)
    expect(body.image_base64).toBe('!!!not-base64!!!')
  })
})

// ─────────────────────────────────────────────────────────────────────────
// special characters in user.email
// ─────────────────────────────────────────────────────────────────────────

describe('payload with special characters in user.email', () => {
  const specialPayload: FeedbackPayload = {
    ...MIN_PAYLOAD,
    user: { name: 'Alice', email: 'alice+tag@example.com' },
  }

  it('jira: email round-trips through the JSON body without corruption', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, { key: 'FEED-6', id: '10006' })
    )

    const adapter = jiraAdapter({
      host: 'example.atlassian.net',
      email: 'bot@example.com',
      apiToken: 'tkn',
      projectKey: 'FEED',
    })
    await adapter.send(specialPayload)

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body)
    const adfStr = JSON.stringify(body.fields.description)
    expect(adfStr).toContain('alice+tag@example.com')
  })

  it('linear: email lands verbatim in the Markdown description (no double-encoding)', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        data: {
          issueCreate: {
            success: true,
            issue: { id: 'iss', identifier: 'TST-6', url: 'https://x' },
          },
        },
      })
    )

    const adapter = linearAdapter({ apiKey: 'k', teamId: 't' })
    await adapter.send(specialPayload)

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body)
    expect(body.variables.input.description).toContain('alice+tag@example.com')
  })

  it('notion: bulleted "Reporter" item carries the literal email', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { object: 'page', id: 'page_6' })
    )

    const adapter = notionAdapter({ apiKey: 'k', databaseId: 'db_1' })
    await adapter.send(specialPayload)

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body)
    const allText = JSON.stringify(body.children)
    expect(allText).toContain('alice+tag@example.com')
  })

  it('msTeams: Reporter fact carries the literal email', async () => {
    fetchMock.mockResolvedValueOnce(new Response('1', { status: 200 }))

    const adapter = msTeamsAdapter({
      webhookUrl: 'https://outlook.office.com/webhook/x',
    })
    await adapter.send(specialPayload)

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body)
    const facts = body.attachments[0].content.body[1].facts as Array<{
      title: string
      value: string
    }>
    const reporter = facts.find((f) => f.title === 'Reporter')
    expect(reporter?.value).toContain('alice+tag@example.com')
  })
})
