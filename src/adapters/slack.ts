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

  // Validate the webhook URL at construction time so misconfiguration is
  // surfaced when the adapter is wired up — not lazily on the first feedback
  // submission, when the user can no longer correlate the error with their
  // setup. We accept any URL the URL parser accepts (so tests can pass
  // localhost mocks), but reject obviously empty / unparseable values.
  try {
    // We construct a URL purely for its side-effect of throwing on invalid
    // input. Assign to `void` so the no-new lint rule (and human readers)
    // know the new is intentional.
    void new URL(webhookUrl)
  } catch {
    throw new Error(
      'slackAdapter: webhookUrl must look like https://hooks.slack.com/services/T.../B.../...'
    )
  }

  return {
    name: 'slack',
    async send(payload: FeedbackPayload): Promise<FeedbackAdapterResult> {
      // Escape Slack mrkdwn control sequences in user-supplied text. Per Slack's
      // documented escaping rules (api.slack.com/reference/surfaces/formatting#escaping),
      // `<`, `>`, and `&` MUST be replaced with their HTML entities before being
      // sent in any mrkdwn block. Without this, a feedback payload of
      // `<!channel> ping` would page the entire workspace.
      const safe = (s: string | undefined): string =>
        (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

      const senderInfo = payload.user?.name
        ? `${safe(payload.user.name)}${payload.user.email ? ` <${safe(payload.user.email)}>` : ''}`
        : 'Anonymous'

      const safeText = safe(payload.text)
      const safePageName = safe(payload.pageName)
      const safePageUrl = safe(payload.pageUrl)
      const safeAppName = safe(payload.appName)

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
            text: `🔧 ${safeAppName} Feedback${categoryLabel}`,
            emoji: true,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*"${safeText}"*`,
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
              text: `*Page:*\n${safePageName || safePageUrl}`,
            },
            {
              type: 'mrkdwn',
              text: `*URL:*\n${safePageUrl}`,
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
              text: `*Viewport:* ${safe(payload.metadata.viewport)} | *UA:* ${safe(payload.metadata.userAgent.slice(0, 80))}`,
            },
          ],
        })
      }

      if (payload.target) {
        const bits = [
          `*Selector:* \`${safe(payload.target.selector)}\``,
          payload.target.componentName
            ? `*Component:* ${safe(payload.target.componentName)}`
            : undefined,
          payload.target.ariaLabel
            ? `*ARIA:* ${safe(payload.target.ariaLabel)}`
            : undefined,
          payload.target.text ? `*Text:* ${safe(payload.target.text)}` : undefined,
        ].filter(Boolean)
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Target Element:*\n${bits.join('\n')}`,
          },
        })
      }

      if (payload.metadata?.consoleErrors?.length) {
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Console Errors:*\n\`\`\`${payload.metadata.consoleErrors.slice(0, 5).map(safe).join('\n')}\`\`\``,
          },
        })
      }

      const body: Record<string, unknown> = {
        username,
        icon_emoji: iconEmoji,
        blocks,
        text: `New feedback from ${senderInfo} on ${safePageName || safePageUrl}: "${safeText.slice(0, 100)}"`,
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
