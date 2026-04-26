/**
 * snapfeed — JIRA Cloud Adapter
 *
 * Server-side only. Creates a JIRA Cloud issue (REST API v3) for each
 * feedback submission, optionally attaching the screenshot.
 *
 * @example
 * import { jiraAdapter } from 'snapfeed/adapters'
 *
 * jiraAdapter({
 *   host: 'mycompany.atlassian.net',
 *   email: 'bot@mycompany.com',
 *   apiToken: process.env.JIRA_API_TOKEN!,
 *   projectKey: 'FEED',
 *   issueType: 'Bug',
 *   labels: ['snapfeed'],
 *   priority: { bug: 'High', idea: 'Low', question: 'Low', praise: 'Low', other: 'Medium' },
 * })
 */

import type {
  FeedbackAdapter,
  FeedbackAdapterResult,
  FeedbackPayload,
} from './types'

export interface JiraAdapterOptions {
  /** JIRA Cloud host, e.g. "mycompany.atlassian.net" (no protocol) */
  host: string
  /** JIRA account email (Basic auth username) */
  email: string
  /** JIRA API token — generate at https://id.atlassian.com/manage-profile/security/api-tokens */
  apiToken: string
  /** Project key issues are created under, e.g. "FEED" */
  projectKey: string
  /**
   * Issue type name. Must match an issue type configured in the project.
   * @default "Bug"
   */
  issueType?: string
  /** Labels applied to every issue. */
  labels?: string[]
  /** Optional assignee accountId (not username/email). */
  assignee?: string
  /**
   * Priority. Either a single priority name (e.g. "High") applied to all
   * issues, or a per-category map. Categories without an entry receive no
   * explicit priority.
   */
  priority?:
    | string
    | {
        bug?: string
        idea?: string
        question?: string
        praise?: string
        other?: string
      }
  /**
   * Whether to upload the screenshot as an attachment after issue creation.
   * @default true
   */
  includeScreenshot?: boolean
}

const CATEGORY_EMOJIS: Record<string, string> = {
  bug: '🐛',
  idea: '💡',
  question: '❓',
  praise: '🙌',
  other: '📝',
}

/** Edge-runtime safe base64 encode of a UTF-8 string. */
function encodeBasicAuth(email: string, token: string): string {
  const raw = `${email}:${token}`
  if (typeof btoa === 'function') {
    return btoa(raw)
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Buffer is Node-only
  const B: any = (globalThis as any).Buffer
  if (B && typeof B.from === 'function') {
    return B.from(raw, 'utf8').toString('base64')
  }
  throw new Error('No base64 encoder available (need btoa or Buffer)')
}

/** Decode base64 to a Uint8Array in any runtime that has atob or Buffer. */
function base64ToUint8Array(b64: string): Uint8Array {
  if (typeof atob === 'function') {
    const bin = atob(b64)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Buffer is Node-only
  const B: any = (globalThis as any).Buffer
  if (B && typeof B.from === 'function') {
    const buf = B.from(b64, 'base64')
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
  }
  throw new Error('No base64 decoder available (need atob or Buffer)')
}

function buildTitle(payload: FeedbackPayload): string {
  const emoji = payload.category ? (CATEGORY_EMOJIS[payload.category] ?? '') : ''
  const head = emoji ? `${emoji} ` : ''
  const truncated =
    payload.text.length > 80 ? `${payload.text.slice(0, 80)}…` : payload.text
  return `[Feedback] ${head}${truncated}`.trim()
}

interface ADFNode {
  type: string
  attrs?: Record<string, unknown>
  content?: ADFNode[]
  text?: string
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>
}

function buildADF(payload: FeedbackPayload): ADFNode {
  const sender = payload.user?.name
    ? `${payload.user.name}${payload.user.email ? ` <${payload.user.email}>` : ''}`
    : 'Anonymous'

  const contextItems: string[] = [
    `URL: ${payload.pageUrl}`,
    `Page: ${payload.pageName || '(untitled)'}`,
  ]
  if (payload.metadata?.viewport) {
    contextItems.push(`Viewport: ${payload.metadata.viewport}`)
  }
  if (payload.metadata?.userAgent) {
    contextItems.push(`User Agent: ${payload.metadata.userAgent}`)
  }
  contextItems.push(`Timestamp: ${payload.timestamp}`)
  contextItems.push(`Reporter: ${sender}`)

  const content: ADFNode[] = [
    // Body text
    {
      type: 'paragraph',
      content: [{ type: 'text', text: payload.text }],
    },
    // Heading "Context"
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Context' }],
    },
    // Bullet list
    {
      type: 'bulletList',
      content: contextItems.map((item) => ({
        type: 'listItem',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: item }],
          },
        ],
      })),
    },
  ]

  // Console errors as a code block (last 5)
  const errors = payload.metadata?.consoleErrors?.slice(-5) ?? []
  if (errors.length > 0) {
    content.push({
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: 'Recent Console Errors' }],
    })
    content.push({
      type: 'codeBlock',
      attrs: { language: 'text' },
      content: [{ type: 'text', text: errors.join('\n') }],
    })
  }

  return { type: 'doc', attrs: { version: 1 } as Record<string, unknown>, content }
}

function resolvePriority(
  payload: FeedbackPayload,
  priority: JiraAdapterOptions['priority']
): string | undefined {
  if (!priority) return undefined
  if (typeof priority === 'string') return priority
  const cat = payload.category ?? 'other'
  return priority[cat]
}

/**
 * JIRA Cloud Issues adapter — creates an issue per feedback submission and
 * (optionally) attaches the screenshot.
 *
 * **Server-side only.** Never use this in a client-side bundle.
 *
 * @example
 * jiraAdapter({
 *   host: 'mycompany.atlassian.net',
 *   email: 'bot@mycompany.com',
 *   apiToken: process.env.JIRA_API_TOKEN!,
 *   projectKey: 'FEED',
 * })
 */
export function jiraAdapter(options: JiraAdapterOptions): FeedbackAdapter {
  const {
    host,
    email,
    apiToken,
    projectKey,
    issueType = 'Bug',
    labels,
    assignee,
    priority,
    includeScreenshot = true,
  } = options

  if (!host || !email || !apiToken || !projectKey) {
    throw new Error('[jiraAdapter] host, email, apiToken, and projectKey are required')
  }

  const baseUrl = `https://${host}/rest/api/3`
  const authHeader = `Basic ${encodeBasicAuth(email, apiToken)}`

  return {
    name: 'jira',
    async send(payload: FeedbackPayload): Promise<FeedbackAdapterResult> {
      try {
        const fields: Record<string, unknown> = {
          project: { key: projectKey },
          summary: buildTitle(payload),
          description: buildADF(payload),
          issuetype: { name: issueType },
        }

        if (labels && labels.length > 0) fields.labels = labels
        if (assignee) fields.assignee = { accountId: assignee }

        const priorityName = resolvePriority(payload, priority)
        if (priorityName) fields.priority = { name: priorityName }

        const createRes = await fetch(`${baseUrl}/issue`, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: authHeader,
          },
          body: JSON.stringify({ fields }),
        })

        if (!createRes.ok) {
          const text = await createRes.text().catch(() => '')
          return {
            ok: false,
            error: `${createRes.status}: ${text.slice(0, 500)}`,
          }
        }

        const created = (await createRes.json()) as { key?: string; id?: string }
        const issueKey = created.key
        if (!issueKey) {
          return {
            ok: false,
            error: 'JIRA returned 2xx but no issue key in response body',
          }
        }

        // Attachment upload — best-effort, non-fatal.
        if (includeScreenshot && payload.screenshot?.base64) {
          try {
            const bytes = base64ToUint8Array(payload.screenshot.base64)
            const mimeType = payload.screenshot.mimeType || 'image/png'
            const ext = mimeType.split('/')[1] ?? 'png'
            const blob = new Blob([bytes as BlobPart], { type: mimeType })

            const form = new FormData()
            form.append('file', blob, `screenshot.${ext}`)

            const attachRes = await fetch(
              `${baseUrl}/issue/${issueKey}/attachments`,
              {
                method: 'POST',
                headers: {
                  Authorization: authHeader,
                  'X-Atlassian-Token': 'no-check',
                  Accept: 'application/json',
                  // NOTE: do NOT set Content-Type — fetch will fill in the
                  // multipart boundary for us.
                },
                body: form,
              }
            )

            if (!attachRes.ok) {
              const text = await attachRes.text().catch(() => '')
              console.warn(
                `[jira adapter] screenshot upload to ${issueKey} failed (${attachRes.status}): ${text.slice(0, 200)}`
              )
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            console.warn(
              `[jira adapter] screenshot upload to ${issueKey} threw: ${message}`
            )
          }
        }

        return { ok: true, deliveryId: issueKey }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { ok: false, error: `JIRA adapter error: ${message}` }
      }
    },
  }
}
