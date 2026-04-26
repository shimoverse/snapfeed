/**
 * snapfeed — GitHub Issues Adapter
 *
 * Server-side only. Creates a GitHub issue for each feedback submission.
 * Do NOT use this in client-side bundles — it requires a GitHub token.
 *
 * @example
 * import { githubAdapter } from 'snapfeed/adapters'
 *
 * githubAdapter({
 *   token: process.env.GITHUB_TOKEN!,
 *   owner: 'my-org',
 *   repo: 'my-app',
 *   labels: ['feedback'],
 *   assignees: ['myusername'],
 * })
 */

import type { FeedbackAdapter, FeedbackAdapterResult, FeedbackPayload } from './types'

export interface GitHubAdapterOptions {
  /** GitHub Personal Access Token or fine-grained token with issues:write scope */
  token: string
  /** Repository owner (org or user) */
  owner: string
  /** Repository name */
  repo: string
  /**
   * Default labels to apply to every issue.
   * Category labels (e.g. "bug", "enhancement") are added automatically.
   * @default []
   */
  labels?: string[]
  /**
   * GitHub usernames to assign to every issue.
   * @default []
   */
  assignees?: string[]
}

const CATEGORY_EMOJIS: Record<string, string> = {
  bug: '🐛',
  idea: '💡',
  question: '❓',
  praise: '🙌',
  other: '📝',
}

/** Maps snapfeed categories to sensible GitHub labels */
const CATEGORY_LABEL_MAP: Record<string, string> = {
  bug: 'bug',
  idea: 'enhancement',
  question: 'question',
  praise: 'feedback',
  other: 'feedback',
}

function buildIssueTitle(payload: FeedbackPayload): string {
  const categoryEmoji = payload.category ? (CATEGORY_EMOJIS[payload.category] ?? '') : ''
  const prefix = categoryEmoji ? `[Feedback] ${categoryEmoji} ` : '[Feedback] '
  const truncated =
    payload.text.length > 80 ? `${payload.text.slice(0, 80)}…` : payload.text
  return `${prefix}${truncated}`
}

function buildIssueBody(payload: FeedbackPayload): string {
  const lines: string[] = []

  lines.push('## Feedback Details')
  lines.push('')

  if (payload.category) {
    const emoji = CATEGORY_EMOJIS[payload.category] ?? ''
    lines.push(`**Category:** ${emoji} ${payload.category}`)
  }

  const sender = payload.user?.name
    ? `${payload.user.name}${payload.user.email ? ` (${payload.user.email})` : ''}`
    : 'Anonymous'
  lines.push(`**From:** ${sender}`)
  lines.push(`**App:** ${payload.appName}`)
  lines.push(`**Page:** ${payload.pageName || '(untitled)'}`)
  lines.push(`**URL:** ${payload.pageUrl}`)
  lines.push(`**Submitted:** ${new Date(payload.timestamp).toLocaleString('en-US', { timeZoneName: 'short' })}`)
  lines.push('')

  lines.push('## Message')
  lines.push('')
  lines.push(payload.text)
  lines.push('')

  if (payload.metadata) {
    lines.push('## Environment')
    lines.push('')
    lines.push(`- **Viewport:** ${payload.metadata.viewport}`)
    lines.push(`- **User Agent:** ${payload.metadata.userAgent}`)

    if (payload.metadata.consoleErrors.length > 0) {
      lines.push('')
      lines.push('**Console Errors:**')
      lines.push('```')
      lines.push(payload.metadata.consoleErrors.slice(0, 10).join('\n'))
      lines.push('```')
    }

    lines.push('')
  }

  if (payload.screenshot?.base64) {
    lines.push('## Screenshot')
    lines.push('')
    lines.push(
      '> **Note:** A screenshot was attached to this feedback. ' +
      'GitHub Issues does not support base64 image uploads via the API. ' +
      'The image is stored in the primary adapter (e.g. Supabase). ' +
      'Check the `image_base64` column in your feedback table for the full image.'
    )
    lines.push('')
  }

  lines.push('---')
  lines.push('*Submitted via [snapfeed](https://github.com/shimoverse/snapfeed)*')

  return lines.join('\n')
}

/**
 * GitHub Issues adapter — creates a GitHub issue for each feedback submission.
 *
 * **Server-side only.** Never use this in a client-side bundle.
 *
 * @example
 * githubAdapter({
 *   token: process.env.GITHUB_TOKEN!,
 *   owner: 'my-org',
 *   repo: 'my-app',
 *   labels: ['feedback'],
 * })
 */
export function githubAdapter(options: GitHubAdapterOptions): FeedbackAdapter {
  const { token, owner, repo, labels = [], assignees = [] } = options

  if (!token || !owner || !repo) {
    throw new Error('[githubAdapter] token, owner, and repo are required')
  }

  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/issues`

  return {
    name: 'github',
    async send(payload: FeedbackPayload): Promise<FeedbackAdapterResult> {
      // Build label list: default labels + category-specific label
      const issueLabels = [...labels]
      if (payload.category && CATEGORY_LABEL_MAP[payload.category]) {
        const catLabel = CATEGORY_LABEL_MAP[payload.category]
        if (catLabel && !issueLabels.includes(catLabel)) {
          issueLabels.push(catLabel)
        }
      }

      const body = {
        title: buildIssueTitle(payload),
        body: buildIssueBody(payload),
        labels: issueLabels.length > 0 ? issueLabels : undefined,
        assignees: assignees.length > 0 ? assignees : undefined,
      }

      try {
        const res = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Accept': 'application/vnd.github+json',
            'Authorization': `Bearer ${token}`,
            'X-GitHub-Api-Version': '2022-11-28',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        })

        if (!res.ok) {
          const text = await res.text().catch(() => '')
          return {
            ok: false,
            error: `GitHub Issues API returned ${res.status}: ${text.slice(0, 300)}`,
          }
        }

        // Guard against malformed 2xx bodies — drop deliveryId rather than
        // crashing the adapter on a JSON parse error.
        const data = (await res.json().catch(() => ({}))) as {
          number?: number
          html_url?: string
        }
        return {
          ok: true,
          deliveryId: data.number ? String(data.number) : undefined,
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { ok: false, error: `GitHub adapter error: ${message}` }
      }
    },
  }
}
