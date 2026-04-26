/**
 * snapfeed — Asana Adapter
 *
 * Server-side only. Creates an Asana task per feedback submission via the
 * REST v1 API. Optionally uploads the screenshot as an attachment after
 * task creation. Attachment failures are non-fatal and surfaced via
 * `warnings`.
 *
 * @example
 * import { asanaAdapter } from 'snapfeed/adapters'
 *
 * asanaAdapter({
 *   accessToken: process.env.ASANA_PAT!,
 *   workspaceId: '12345',
 *   projectId: '67890',
 *   tagGids: ['tag_1', 'tag_2'],
 * })
 */

import type {
  FeedbackAdapter,
  FeedbackAdapterResult,
  FeedbackPayload,
} from './types'

export interface AsanaAdapterOptions {
  /** Asana Personal Access Token. */
  accessToken: string
  /** Workspace gid the task belongs to. */
  workspaceId: string
  /** Project gid the task is created in. */
  projectId: string
  /** Optional assignee user gid. */
  assigneeGid?: string
  /** Optional tag gids to apply. */
  tagGids?: string[]
  /**
   * Whether to upload the screenshot as an attachment after task creation.
   * @default true
   */
  includeScreenshotAsAttachment?: boolean
}

const ASANA_BASE_URL = 'https://app.asana.com/api/1.0'

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

function buildNotes(payload: FeedbackPayload): string {
  const sender = payload.user?.name
    ? `${payload.user.name}${payload.user.email ? ` <${payload.user.email}>` : ''}`
    : 'Anonymous'

  const lines: string[] = []
  lines.push(payload.text)
  lines.push('')
  lines.push('Context')
  lines.push('-------')
  lines.push(`URL: ${payload.pageUrl}`)
  lines.push(`Page: ${payload.pageName || '(untitled)'}`)
  if (payload.metadata?.viewport) {
    lines.push(`Viewport: ${payload.metadata.viewport}`)
  }
  if (payload.metadata?.userAgent) {
    lines.push(`User Agent: ${payload.metadata.userAgent}`)
  }
  lines.push(`Reporter: ${sender}`)
  lines.push(`Timestamp: ${payload.timestamp}`)

  const errors = payload.metadata?.consoleErrors?.slice(-5) ?? []
  if (errors.length > 0) {
    lines.push('')
    lines.push('Recent console errors')
    lines.push('---------------------')
    for (const err of errors) lines.push(`- ${err}`)
  }

  return lines.join('\n')
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
 * Asana adapter — creates a task in a project for each feedback submission
 * and (optionally) attaches the screenshot.
 *
 * **Server-side only.** Never use this in a client-side bundle.
 *
 * Note: Asana requires both a `workspaceId` and a `projectId`. The project
 * must live inside that workspace.
 *
 * @example
 * asanaAdapter({
 *   accessToken: process.env.ASANA_PAT!,
 *   workspaceId: '12345',
 *   projectId: '67890',
 * })
 */
export function asanaAdapter(options: AsanaAdapterOptions): FeedbackAdapter {
  const {
    accessToken,
    workspaceId,
    projectId,
    assigneeGid,
    tagGids,
    includeScreenshotAsAttachment = true,
  } = options

  if (!accessToken || !workspaceId || !projectId) {
    throw new Error(
      '[asanaAdapter] accessToken, workspaceId, and projectId are required'
    )
  }

  const authHeader = `Bearer ${accessToken}`

  return {
    name: 'asana',
    async send(payload: FeedbackPayload): Promise<FeedbackAdapterResult> {
      const warnings: string[] = []

      try {
        const taskBody: Record<string, unknown> = {
          workspace: workspaceId,
          projects: [projectId],
          name: buildTitle(payload),
          notes: buildNotes(payload),
        }
        if (assigneeGid) taskBody.assignee = assigneeGid
        if (tagGids && tagGids.length > 0) taskBody.tags = tagGids

        const createRes = await fetch(`${ASANA_BASE_URL}/tasks`, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: authHeader,
          },
          body: JSON.stringify({ data: taskBody }),
        })

        if (!createRes.ok) {
          const text = await createRes.text().catch(() => '')
          return {
            ok: false,
            error: `${createRes.status}: ${text.slice(0, 500)}`,
          }
        }

        const created = (await createRes.json()) as {
          data?: { gid?: string }
        }
        const taskGid = created.data?.gid
        if (!taskGid) {
          return {
            ok: false,
            error: 'Asana returned 2xx but no task gid in response body',
          }
        }

        // Attachment upload — best-effort, non-fatal.
        if (includeScreenshotAsAttachment && payload.screenshot?.base64) {
          try {
            const bytes = base64ToUint8Array(payload.screenshot.base64)
            const mimeType = payload.screenshot.mimeType || 'image/png'
            const ext = extensionForMime(mimeType)
            const blob = new Blob([bytes as BlobPart], { type: mimeType })

            const form = new FormData()
            form.append('file', blob, `screenshot.${ext}`)

            const attachRes = await fetch(
              `${ASANA_BASE_URL}/tasks/${taskGid}/attachments`,
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
                `screenshot upload to task ${taskGid} failed (${attachRes.status}): ${text.slice(0, 200)}`
              )
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            warnings.push(
              `screenshot upload to task ${taskGid} threw: ${message}`
            )
          }
        }

        return {
          ok: true,
          deliveryId: taskGid,
          ...(warnings.length > 0 ? { warnings } : {}),
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { ok: false, error: `Asana adapter error: ${message}` }
      }
    },
  }
}
