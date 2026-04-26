/**
 * snapfeed — Microsoft Teams Adapter
 *
 * Server-side only. Posts feedback to a Microsoft Teams channel as an
 * Adaptive Card v1.4 via an Incoming Webhook. Screenshots are embedded as
 * data URIs (Adaptive Cards support `data:` images, but Teams enforces a
 * size limit — anything above ~1MB is skipped with a warning to keep the
 * card from being silently rejected).
 *
 * @example
 * import { msTeamsAdapter } from 'snapfeed/adapters'
 *
 * msTeamsAdapter({
 *   webhookUrl: process.env.TEAMS_WEBHOOK_URL!,
 *   mentionUserIds: ['user1@mycompany.com'],
 *   theme: { bug: '#cc2936', idea: '#f5c84b' },
 * })
 */

import type {
  FeedbackAdapter,
  FeedbackAdapterResult,
  FeedbackPayload,
} from './types'

export interface MsTeamsAdapterOptions {
  /** Microsoft Teams Incoming Webhook URL. */
  webhookUrl: string
  /**
   * AAD user IDs (UPNs / email addresses) to @-mention in the card.
   * Rendered as Adaptive Card mentions in the message body.
   */
  mentionUserIds?: string[]
  /**
   * Per-category accent colors as hex strings (e.g. "#cc2936").
   * Categories without an entry fall back to a sensible default.
   */
  theme?: {
    bug?: string
    idea?: string
    question?: string
    praise?: string
    other?: string
  }
}

const CATEGORY_EMOJIS: Record<string, string> = {
  bug: '🐛',
  idea: '💡',
  question: '❓',
  praise: '🙌',
  other: '📝',
}

const DEFAULT_COLORS: Record<string, string> = {
  bug: '#cc2936',
  idea: '#f5c84b',
  question: '#4b89dc',
  praise: '#3fb950',
  other: '#8b949e',
}

/** Adaptive Cards refuse images above ~1MB after base64 decoding. */
const SCREENSHOT_DATA_URI_LIMIT_BYTES = 1024 * 1024

interface AdaptiveCardElement {
  type: string
  [key: string]: unknown
}

function buildTitle(payload: FeedbackPayload): string {
  const emoji = payload.category ? (CATEGORY_EMOJIS[payload.category] ?? '') : ''
  const head = emoji ? `${emoji} ` : ''
  const truncated =
    payload.text.length > 80 ? `${payload.text.slice(0, 80)}…` : payload.text
  return `${head}${truncated}`.trim()
}

function resolveColor(
  payload: FeedbackPayload,
  theme: MsTeamsAdapterOptions['theme']
): string {
  const cat = payload.category ?? 'other'
  return theme?.[cat] ?? DEFAULT_COLORS[cat] ?? DEFAULT_COLORS.other!
}

/**
 * Microsoft Teams Adaptive Card adapter — posts feedback as a v1.4
 * Adaptive Card to an Incoming Webhook.
 *
 * **Server-side only.** Never use this in a client-side bundle.
 *
 * @example
 * msTeamsAdapter({
 *   webhookUrl: process.env.TEAMS_WEBHOOK_URL!,
 * })
 */
export function msTeamsAdapter(
  options: MsTeamsAdapterOptions
): FeedbackAdapter {
  const { webhookUrl, mentionUserIds, theme } = options

  if (!webhookUrl) {
    throw new Error('[msTeamsAdapter] webhookUrl is required')
  }

  return {
    name: 'msTeams',
    async send(payload: FeedbackPayload): Promise<FeedbackAdapterResult> {
      const warnings: string[] = []

      try {
        const sender = payload.user?.name
          ? `${payload.user.name}${payload.user.email ? ` <${payload.user.email}>` : ''}`
          : payload.user?.email || 'Anonymous'

        const accent = resolveColor(payload, theme)
        const title = buildTitle(payload)

        const facts: Array<{ title: string; value: string }> = []
        facts.push({
          title: 'Page',
          value: payload.pageName
            ? `${payload.pageName} (${payload.pageUrl})`
            : payload.pageUrl,
        })
        facts.push({ title: 'Reporter', value: sender })
        if (payload.metadata?.viewport) {
          facts.push({ title: 'Viewport', value: payload.metadata.viewport })
        }
        facts.push({ title: 'Timestamp', value: payload.timestamp })

        const body: AdaptiveCardElement[] = [
          {
            type: 'TextBlock',
            text: title,
            weight: 'Bolder',
            size: 'Large',
            color: 'Accent',
            wrap: true,
          },
          {
            type: 'FactSet',
            facts,
          },
          {
            type: 'TextBlock',
            text: payload.text,
            wrap: true,
            spacing: 'Medium',
          },
        ]

        // Mentions appear as a tail TextBlock and the AC `msteams.entities` array.
        const entities: Array<Record<string, unknown>> = []
        if (mentionUserIds && mentionUserIds.length > 0) {
          const mentionLine = mentionUserIds
            .map((id) => `<at>${id}</at>`)
            .join(' ')
          body.push({
            type: 'TextBlock',
            text: mentionLine,
            wrap: true,
            spacing: 'Small',
          })
          for (const id of mentionUserIds) {
            entities.push({
              type: 'mention',
              text: `<at>${id}</at>`,
              mentioned: { id, name: id },
            })
          }
        }

        // Console errors (last 5) as a code-style TextBlock.
        const errors = payload.metadata?.consoleErrors?.slice(-5) ?? []
        if (errors.length > 0) {
          body.push({
            type: 'TextBlock',
            text: 'Recent console errors',
            weight: 'Bolder',
            spacing: 'Medium',
          })
          body.push({
            type: 'TextBlock',
            text: errors.join('\n'),
            wrap: true,
            fontType: 'Monospace',
            isSubtle: true,
          })
        }

        // Optional screenshot as data URI — skip with a warning if too large.
        if (payload.screenshot?.base64) {
          // base64 length * 0.75 ≈ decoded byte count.
          const approxBytes = Math.floor(payload.screenshot.base64.length * 0.75)
          if (approxBytes > SCREENSHOT_DATA_URI_LIMIT_BYTES) {
            warnings.push(
              `screenshot skipped: data URI ${approxBytes} bytes exceeds Teams Adaptive Card limit (~1MB)`
            )
          } else {
            const mime = payload.screenshot.mimeType || 'image/png'
            body.push({
              type: 'Image',
              url: `data:${mime};base64,${payload.screenshot.base64}`,
              size: 'Large',
              altText: 'Feedback screenshot',
              spacing: 'Medium',
            })
          }
        }

        const card: Record<string, unknown> = {
          type: 'AdaptiveCard',
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          version: '1.4',
          body,
          msteams: {
            width: 'Full',
            ...(entities.length > 0 ? { entities } : {}),
          },
          // Accent color isn't a first-class card property; we leverage it
          // by setting the title's color="Accent" and tinting via container.
          backgroundImage: undefined,
          // Hint to Teams renderers that pick up `accentColor`.
          accentColor: accent,
        }

        const teamsBody = {
          type: 'message',
          attachments: [
            {
              contentType: 'application/vnd.microsoft.card.adaptive',
              contentUrl: null,
              content: card,
            },
          ],
        }

        const res = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(teamsBody),
        })

        if (!res.ok) {
          const text = await res.text().catch(() => '')
          return {
            ok: false,
            error: `${res.status}: ${text.slice(0, 500)}`,
          }
        }

        // Teams returns 200 with body "1" on success. Any 2xx is good.
        return {
          ok: true,
          deliveryId: 'msteams:webhook',
          ...(warnings.length > 0 ? { warnings } : {}),
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { ok: false, error: `msTeams adapter error: ${message}` }
      }
    },
  }
}
