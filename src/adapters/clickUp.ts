/**
 * snapfeed — ClickUp Adapter
 *
 * Server-side only. Creates a ClickUp task in a list per feedback submission
 * via the REST v2 API. Optionally uploads the screenshot as an attachment
 * after task creation. Attachment failures are non-fatal and surfaced via
 * `warnings`.
 *
 * Caveat: ClickUp's auth header is just the raw API token (no `Bearer`
 * prefix), unlike most modern REST APIs.
 *
 * @example
 * import { clickUpAdapter } from 'snapfeed/adapters'
 *
 * clickUpAdapter({
 *   apiToken: process.env.CLICKUP_API_TOKEN!,
 *   listId: '901234567',
 *   tags: ['snapfeed'],
 *   priority: { bug: 1, idea: 3, question: 3, praise: 4, other: 3 },
 * })
 */

import type {
  FeedbackAdapter,
  FeedbackAdapterResult,
  FeedbackPayload,
} from './types'

/** ClickUp priority: 1 = urgent, 2 = high, 3 = normal, 4 = low. */
export type ClickUpPriority = 1 | 2 | 3 | 4

export interface ClickUpAdapterOptions {
  /** ClickUp personal API token. */
  apiToken: string
  /** List id tasks are created under. */
  listId: string
  /** Optional assignee user ids. */
  assignees?: number[]
  /** Optional tag names to apply. */
  tags?: string[]
  /**
   * Priority. Either a single priority applied to all tasks, or a per-category
   * map. Categories without an entry receive no explicit priority.
   */
  priority?:
    | ClickUpPriority
    | {
        bug?: ClickUpPriority
        idea?: ClickUpPriority
        question?: ClickUpPriority
        praise?: ClickUpPriority
        other?: ClickUpPriority
      }
  /**
   * Whether to upload the screenshot as an attachment after task creation.
   * @default true
   */
  includeScreenshot?: boolean
}

const CLICKUP_BASE_URL = 'https://api.clickup.com/api/v2'

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

function buildDescription(payload: FeedbackPayload): string {
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
  lines.push(`- **Reporter:** ${sender}`)
  lines.push(`- **Timestamp:** ${payload.timestamp}`)

  const errors = payload.metadata?.consoleErrors?.slice(-5) ?? []
  if (errors.length > 0) {
    lines.push('')
    lines.push('### Recent console errors')
    lines.push('')
    lines.push('```')
    lines.push(errors.join('\n'))
    lines.push('```')
  }

  return lines.join('\n')
}

function resolvePriority(
  payload: FeedbackPayload,
  priority: ClickUpAdapterOptions['priority']
): ClickUpPriority | undefined {
  if (priority === undefined) return undefined
  if (typeof priority === 'number') return priority
  const cat = payload.category ?? 'other'
  return priority[cat]
}

/** Decode base64 to Uint8Array in any runtime that has atob or Buffer. */
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

function extensionForMime(mimeType: string): string {
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return 'jpg'
  if (mimeType.includes('webp')) return 'webp'
  if (mimeType.includes('gif')) return 'gif'
  return 'png'
}

/**
 * ClickUp adapter — creates a task in a list for each feedback submission
 * and (optionally) attaches the screenshot.
 *
 * **Server-side only.** Never use this in a client-side bundle.
 *
 * Note: ClickUp's auth header is `Authorization: <token>` with no `Bearer`
 * prefix — this is the documented ClickUp convention.
 *
 * @example
 * clickUpAdapter({
 *   apiToken: process.env.CLICKUP_API_TOKEN!,
 *   listId: '901234567',
 * })
 */
export function clickUpAdapter(options: ClickUpAdapterOptions): FeedbackAdapter {
  const {
    apiToken,
    listId,
    assignees,
    tags,
    priority,
    includeScreenshot = true,
  } = options

  if (!apiToken || !listId) {
    throw new Error('[clickUpAdapter] apiToken and listId are required')
  }

  // ClickUp convention: raw token, no Bearer prefix.
  const authHeader = apiToken

  return {
    name: 'clickUp',
    async send(payload: FeedbackPayload): Promise<FeedbackAdapterResult> {
      const warnings: string[] = []

      try {
        const taskBody: Record<string, unknown> = {
          name: buildTitle(payload),
          description: buildDescription(payload),
        }
        if (assignees && assignees.length > 0) taskBody.assignees = assignees
        if (tags && tags.length > 0) taskBody.tags = tags
        const resolvedPriority = resolvePriority(payload, priority)
        if (typeof resolvedPriority === 'number') {
          taskBody.priority = resolvedPriority
        }

        const createRes = await fetch(
          `${CLICKUP_BASE_URL}/list/${listId}/task`,
          {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
              Authorization: authHeader,
            },
            body: JSON.stringify(taskBody),
          }
        )

        if (!createRes.ok) {
          const text = await createRes.text().catch(() => '')
          return {
            ok: false,
            error: `${createRes.status}: ${text.slice(0, 500)}`,
          }
        }

        const created = (await createRes.json()) as { id?: string }
        const taskId = created.id
        if (!taskId) {
          return {
            ok: false,
            error: 'ClickUp returned 2xx but no task id in response body',
          }
        }

        // Attachment upload — best-effort, non-fatal.
        if (includeScreenshot && payload.screenshot?.base64) {
          try {
            const bytes = base64ToUint8Array(payload.screenshot.base64)
            const mimeType = payload.screenshot.mimeType || 'image/png'
            const ext = extensionForMime(mimeType)
            const blob = new Blob([bytes as BlobPart], { type: mimeType })

            const form = new FormData()
            form.append('attachment', blob, `screenshot.${ext}`)

            const attachRes = await fetch(
              `${CLICKUP_BASE_URL}/task/${taskId}/attachment`,
              {
                method: 'POST',
                headers: {
                  Authorization: authHeader,
                  Accept: 'application/json',
                  // Do NOT set Content-Type — fetch fills the multipart boundary.
                },
                body: form,
              }
            )

            if (!attachRes.ok) {
              const text = await attachRes.text().catch(() => '')
              warnings.push(
                `screenshot upload to task ${taskId} failed (${attachRes.status}): ${text.slice(0, 200)}`
              )
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            warnings.push(
              `screenshot upload to task ${taskId} threw: ${message}`
            )
          }
        }

        return {
          ok: true,
          deliveryId: taskId,
          ...(warnings.length > 0 ? { warnings } : {}),
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { ok: false, error: `ClickUp adapter error: ${message}` }
      }
    },
  }
}
