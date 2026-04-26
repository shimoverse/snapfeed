/**
 * snapfeed — Linear Adapter
 *
 * Server-side only. Creates a Linear issue per feedback submission via the
 * Linear GraphQL API. Description is rendered as Markdown (Linear's native
 * format).
 *
 * Screenshots can be embedded inline as base64 data-URI images in the
 * description (`embedScreenshotAsDataUri`, default true). **Caveat:** Linear's
 * renderer may strip very large data URIs — for screenshots above ~1MB a
 * dedicated storage adapter that produces a public URL is recommended (storage
 * adapter is future work).
 *
 * @example
 * import { linearAdapter } from 'snapfeed/adapters'
 *
 * linearAdapter({
 *   apiKey: process.env.LINEAR_API_KEY!,
 *   teamId: 'team_xxx',
 *   labelIds: ['lbl_xxx'],
 *   priority: { bug: 1, idea: 3, question: 4, praise: 4, other: 3 },
 * })
 */

import type {
  FeedbackAdapter,
  FeedbackAdapterResult,
  FeedbackPayload,
} from './types'

/** Linear priority: 0 = none, 1 = urgent, 2 = high, 3 = medium, 4 = low. */
export type LinearPriority = 0 | 1 | 2 | 3 | 4

export interface LinearAdapterOptions {
  /**
   * Linear API key. Personal API keys (`lin_api_...`) are sent raw in the
   * `Authorization` header — the documented Linear convention. OAuth tokens
   * (detected by a `lin_oauth_` prefix or a JWT-style `.` in the value) are
   * automatically prefixed with `Bearer `.
   */
  apiKey: string
  /** Team ID to create issues under. */
  teamId: string
  /** Optional project ID. */
  projectId?: string
  /** Optional label IDs to apply. */
  labelIds?: string[]
  /**
   * Priority. Either a single priority applied to all issues, or a per-category
   * map. Categories without an entry receive no explicit priority.
   */
  priority?:
    | LinearPriority
    | {
        bug?: LinearPriority
        idea?: LinearPriority
        question?: LinearPriority
        praise?: LinearPriority
        other?: LinearPriority
      }
  /** Optional initial workflow state ID. */
  stateId?: string
  /** Optional assignee user ID. */
  assigneeId?: string
  /**
   * Embed screenshots inline in the issue description as a base64 data URI:
   * `![screenshot](data:image/png;base64,...)`.
   * Note: Linear may strip very large data URIs — prefer a public-URL storage
   * adapter for screenshots above ~1MB.
   * @default true
   */
  embedScreenshotAsDataUri?: boolean
  /**
   * Whether to attempt screenshot embedding at all. Distinct from
   * `embedScreenshotAsDataUri` so future storage-backed paths can opt in.
   * @default true
   */
  includeScreenshotAsAttachment?: boolean
}

const CATEGORY_EMOJIS: Record<string, string> = {
  bug: '🐛',
  idea: '💡',
  question: '❓',
  praise: '🙌',
  other: '📝',
}

function buildTitle(payload: FeedbackPayload): string {
  const emoji = payload.category ? (CATEGORY_EMOJIS[payload.category] ?? '') : ''
  const head = emoji ? `${emoji} ` : ''
  const truncated =
    payload.text.length > 80 ? `${payload.text.slice(0, 80)}…` : payload.text
  return `[Feedback] ${head}${truncated}`.trim()
}

/**
 * Linear accepts Personal API keys raw (e.g. `lin_api_...`) but OAuth tokens
 * must be prefixed with `Bearer `. Detection is conservative: only known
 * OAuth shapes get the prefix; everything else is sent as-is.
 */
function buildAuthHeader(apiKey: string): string {
  if (apiKey.startsWith('lin_oauth_') || apiKey.includes('.')) {
    return `Bearer ${apiKey}`
  }
  return apiKey
}

function buildDescription(
  payload: FeedbackPayload,
  embedScreenshot: boolean
): string {
  const sender = payload.user?.name
    ? `${payload.user.name}${payload.user.email ? ` <${payload.user.email}>` : ''}`
    : 'Anonymous'

  const lines: string[] = []
  lines.push(payload.text)
  lines.push('')
  lines.push('## Context')
  lines.push('')
  lines.push(`- **URL:** ${payload.pageUrl}`)
  lines.push(`- **Page:** ${payload.pageName || '(untitled)'}`)
  if (payload.metadata?.viewport) {
    lines.push(`- **Viewport:** ${payload.metadata.viewport}`)
  }
  if (payload.metadata?.userAgent) {
    lines.push(`- **User Agent:** ${payload.metadata.userAgent}`)
  }
  lines.push(`- **Timestamp:** ${payload.timestamp}`)
  lines.push(`- **Reporter:** ${sender}`)
  lines.push('')

  const errors = payload.metadata?.consoleErrors?.slice(-5) ?? []
  if (errors.length > 0) {
    lines.push('### Recent Console Errors')
    lines.push('')
    lines.push('```')
    lines.push(errors.join('\n'))
    lines.push('```')
    lines.push('')
  }

  if (embedScreenshot && payload.screenshot?.base64) {
    const mime = payload.screenshot.mimeType || 'image/png'
    lines.push('### Screenshot')
    lines.push('')
    lines.push(`![screenshot](data:${mime};base64,${payload.screenshot.base64})`)
    lines.push('')
  }

  return lines.join('\n')
}

function resolvePriority(
  payload: FeedbackPayload,
  priority: LinearAdapterOptions['priority']
): LinearPriority | undefined {
  if (priority === undefined) return undefined
  if (typeof priority === 'number') return priority
  const cat = payload.category ?? 'other'
  return priority[cat]
}

interface LinearGraphQLResponse {
  data?: {
    issueCreate?: {
      success?: boolean
      issue?: { id?: string; identifier?: string; url?: string }
    }
  }
  errors?: Array<{ message?: string }>
}

const ISSUE_CREATE_MUTATION = `
mutation IssueCreate($input: IssueCreateInput!) {
  issueCreate(input: $input) {
    success
    issue { id identifier url }
  }
}
`.trim()

/**
 * Linear adapter — creates a Linear issue for each feedback submission via
 * the GraphQL API.
 *
 * **Server-side only.** Never use this in a client-side bundle.
 *
 * @example
 * linearAdapter({
 *   apiKey: process.env.LINEAR_API_KEY!,
 *   teamId: 'team_xxx',
 * })
 */
export function linearAdapter(options: LinearAdapterOptions): FeedbackAdapter {
  const {
    apiKey,
    teamId,
    projectId,
    labelIds,
    priority,
    stateId,
    assigneeId,
    embedScreenshotAsDataUri = true,
    includeScreenshotAsAttachment = true,
  } = options

  if (!apiKey || !teamId) {
    throw new Error('[linearAdapter] apiKey and teamId are required')
  }

  const authHeader = buildAuthHeader(apiKey)

  return {
    name: 'linear',
    async send(payload: FeedbackPayload): Promise<FeedbackAdapterResult> {
      const wantsScreenshot =
        includeScreenshotAsAttachment &&
        embedScreenshotAsDataUri &&
        !!payload.screenshot?.base64

      const warnings: string[] = []
      let description: string

      // Building the description with the data URI is pure string work and
      // unlikely to throw — but if it does (e.g. a future change adds decoding),
      // we want the issue to still be created without the screenshot.
      try {
        description = buildDescription(payload, wantsScreenshot)
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err)
        warnings.push(`screenshot upload failed: ${detail}`)
        description = buildDescription(payload, false)
      }

      const input: Record<string, unknown> = {
        teamId,
        title: buildTitle(payload),
        description,
      }

      if (projectId) input.projectId = projectId
      if (labelIds && labelIds.length > 0) input.labelIds = labelIds
      if (stateId) input.stateId = stateId
      if (assigneeId) input.assigneeId = assigneeId

      const resolvedPriority = resolvePriority(payload, priority)
      if (typeof resolvedPriority === 'number') input.priority = resolvedPriority

      try {
        const res = await fetch('https://api.linear.app/graphql', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: authHeader,
          },
          body: JSON.stringify({
            query: ISSUE_CREATE_MUTATION,
            variables: { input },
          }),
        })

        if (!res.ok) {
          const text = await res.text().catch(() => '')
          return {
            ok: false,
            error: `${res.status}: ${text.slice(0, 500)}`,
          }
        }

        // Guard against malformed 2xx bodies — a parse failure here will be
        // caught below as "no issue identifier" rather than crashing the adapter.
        const json = (await res.json().catch(() => ({}))) as LinearGraphQLResponse

        // GraphQL can return 200 with errors[] populated.
        if (json.errors && json.errors.length > 0) {
          const first = json.errors[0]?.message ?? 'Unknown GraphQL error'
          return { ok: false, error: `Linear GraphQL error: ${first}` }
        }

        const issue = json.data?.issueCreate?.issue
        if (!json.data?.issueCreate?.success || !issue?.identifier) {
          return {
            ok: false,
            error: 'Linear returned no issue identifier in successful response',
          }
        }

        return warnings.length > 0
          ? { ok: true, deliveryId: issue.identifier, warnings }
          : { ok: true, deliveryId: issue.identifier }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { ok: false, error: `Linear adapter error: ${message}` }
      }
    },
  }
}
