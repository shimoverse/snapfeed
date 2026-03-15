import type { FeedbackAdapter, FeedbackAdapterResult, FeedbackPayload } from './types'

export interface SlackAdapterOptions {
  /** Slack Incoming Webhook URL */
  webhookUrl: string
  /**
   * Channel to post to (optional, overrides webhook default).
   * Note: most Slack webhooks are bound to a channel.
   */
  channel?: string
  /**
   * Username to post as.
   * @default "Feedback Bot"
   */
  username?: string
  /**
   * Emoji icon for the bot.
   * @default ":pencil:"
   */
  iconEmoji?: string
}

/**
 * Slack incoming webhook adapter — posts feedback as a Block Kit message.
 *
 * @example
 * slackAdapter({
 *   webhookUrl: 'https://hooks.slack.com/services/T.../B.../...',
 * })
 */
export function slackAdapter(options: SlackAdapterOptions): FeedbackAdapter {
  const {
    webhookUrl,
    channel,
    username = 'Feedback Bot',
    iconEmoji = ':pencil:',
  } = options

  return {
    name: 'slack',
    async send(payload: FeedbackPayload): Promise<FeedbackAdapterResult> {
      const senderInfo = payload.user?.name
        ? `${payload.user.name}${payload.user.email ? ` <${payload.user.email}>` : ''}`
        : 'Anonymous'

      const CATEGORY_EMOJIS: Record<string, string> = {
        bug: '🐛',
        idea: '💡',
        question: '❓',
        praise: '🙌',
        other: '📝',
      }

      const categoryLabel = payload.category
        ? ` ${CATEGORY_EMOJIS[payload.category] ?? ''} ${payload.category.charAt(0).toUpperCase() + payload.category.slice(1)}`
        : ''

      const blocks: unknown[] = [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: `🔧 ${payload.appName} Feedback${categoryLabel}`,
            emoji: true,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*"${payload.text}"*`,
          },
        },
        {
          type: 'section',
          fields: [
            {
              type: 'mrkdwn',
              text: `*From:*\n${senderInfo}`,
            },
            ...(payload.category
              ? [
                  {
                    type: 'mrkdwn',
                    text: `*Category:*\n${CATEGORY_EMOJIS[payload.category] ?? ''} ${payload.category}`,
                  },
                ]
              : []),
            {
              type: 'mrkdwn',
              text: `*Page:*\n${payload.pageName || payload.pageUrl}`,
            },
            {
              type: 'mrkdwn',
              text: `*URL:*\n${payload.pageUrl}`,
            },
            {
              type: 'mrkdwn',
              text: `*Submitted:*\n${new Date(payload.timestamp).toLocaleString()}`,
            },
          ],
        },
      ]

      if (payload.metadata?.viewport) {
        blocks.push({
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `*Viewport:* ${payload.metadata.viewport} | *UA:* ${payload.metadata.userAgent.slice(0, 80)}`,
            },
          ],
        })
      }

      if (payload.metadata?.consoleErrors?.length) {
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Console Errors:*\n\`\`\`${payload.metadata.consoleErrors.slice(0, 5).join('\n')}\`\`\``,
          },
        })
      }

      const body: Record<string, unknown> = {
        username,
        icon_emoji: iconEmoji,
        blocks,
        text: `New feedback from ${senderInfo} on ${payload.pageName || payload.pageUrl}: "${payload.text.slice(0, 100)}"`,
      }

      if (channel) body.channel = channel

      try {
        const res = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })

        if (!res.ok) {
          const text = await res.text().catch(() => '')
          return { ok: false, error: `Slack webhook returned ${res.status}: ${text.slice(0, 200)}` }
        }

        return { ok: true }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { ok: false, error: `Slack adapter error: ${message}` }
      }
    },
  }
}
