/**
 * Mattermost adapter — example custom snapfeed adapter.
 *
 * Mattermost is the most-common Slack alternative for self-hosted teams.
 * snapfeed doesn't ship a built-in Mattermost adapter (the API surface is
 * mostly Slack-compatible, but the auth model differs and corp deployments
 * usually run their own incoming-webhook URLs), so this is a good example
 * of writing your own.
 *
 * The same pattern applies to any HTTP-based destination: Symphony,
 * RocketChat, Zulip, Microsoft Teams (you can use the bundled msTeamsAdapter
 * for that one), an internal bug tracker, etc.
 *
 * What this file shows:
 *   1. The minimum interface a custom adapter must satisfy
 *   2. How to handle screenshots (encode/upload depending on destination)
 *   3. How to surface partial failures (warnings vs full failure)
 *   4. How to make the adapter testable (no implicit globals)
 */

import type {
  FeedbackAdapter,
  FeedbackAdapterResult,
  FeedbackPayload,
} from 'snapfeed/adapters'

// ─── Options ────────────────────────────────────────────────────────────────

export interface MattermostAdapterOptions {
  /**
   * Incoming-webhook URL. Generate one in Mattermost:
   *   System Console → Integrations → Incoming Webhooks → Add Incoming Webhook
   *   Copy the resulting URL — looks like `https://chat.example.com/hooks/<id>`
   */
  webhookUrl: string

  /**
   * Channel name to post into (overrides the webhook's bound channel).
   * Most setups bind the webhook to a single channel; leave undefined
   * unless your admin explicitly enabled per-message channel override.
   *
   * @default undefined (use the webhook's configured channel)
   */
  channel?: string

  /**
   * Username the bot posts as.
   * @default "Feedback Bot"
   */
  username?: string

  /**
   * Mattermost emoji slug used as the bot avatar (without colons).
   * @default "memo"
   */
  iconEmoji?: string

  /**
   * Inject your own fetch for testing. Defaults to global `fetch`
   * (Node 18+ / browsers / edge runtimes).
   *
   * @internal
   */
  fetch?: typeof fetch
}

// ─── Adapter factory ────────────────────────────────────────────────────────

/**
 * Build a Mattermost-posting `FeedbackAdapter`.
 *
 * @example
 *   const mattermost = mattermostAdapter({
 *     webhookUrl: process.env.MATTERMOST_WEBHOOK!,
 *     channel: 'feedback',
 *     username: 'snapfeed',
 *   })
 *
 *   createFeedbackHandler({ adapters: [mattermost] })
 */
export function mattermostAdapter(opts: MattermostAdapterOptions): FeedbackAdapter {
  // Validate at construction time. Misconfigurations should surface when the
  // adapter is wired up — not lazily on the first feedback submission, when
  // the user can no longer correlate the error with their config.
  try {
    void new URL(opts.webhookUrl)
  } catch {
    throw new Error(
      'mattermostAdapter: webhookUrl must be a valid URL — got ' +
        JSON.stringify(opts.webhookUrl)
    )
  }

  const {
    webhookUrl,
    channel,
    username = 'Feedback Bot',
    iconEmoji = 'memo',
    fetch: fetchImpl = globalThis.fetch,
  } = opts

  return {
    name: 'mattermost',
    async send(payload: FeedbackPayload): Promise<FeedbackAdapterResult> {
      // Mattermost incoming webhooks are largely Slack-compatible, but they
      // use plain `text` (markdown) over Slack's Block Kit. Build a single
      // markdown message — testers can paste into a thread later for triage.
      const body = formatMattermostMessage(payload, { channel, username, iconEmoji })

      try {
        const res = await fetchImpl(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })

        if (!res.ok) {
          // Mattermost returns the error body as JSON; truncate so we don't
          // dump a 5KB stacktrace into our adapter result.
          const text = await res.text().catch(() => '')
          const truncated = text.length > 200 ? `${text.slice(0, 200)}…` : text
          return {
            ok: false,
            error: `Mattermost returned ${res.status}: ${truncated}`,
          }
        }

        // Optional: try to upload the screenshot as a follow-up message.
        // Mattermost has a separate /api/v4/files endpoint for this, but it
        // requires a bot token (not just a webhook), so we surface a warning
        // rather than failing the primary delivery.
        const warnings: string[] = []
        if (payload.screenshot) {
          warnings.push(
            'screenshot not uploaded: webhook auth cannot post files. ' +
              'Use the bot-token API (https://api.mattermost.com/#tag/files) for attachments.'
          )
        }

        return { ok: true, ...(warnings.length ? { warnings } : {}) }
      } catch (err) {
        // Network errors (DNS, ECONNREFUSED, etc.) — caller decides whether
        // to retry. We never throw out of `send` — the contract is "return
        // a result; never throw."
        const message = err instanceof Error ? err.message : String(err)
        return { ok: false, error: `Mattermost adapter network error: ${message}` }
      }
    },
  }
}

// ─── Pure formatter (testable) ──────────────────────────────────────────────

interface FormatOptions {
  channel?: string
  username: string
  iconEmoji: string
}

interface MattermostMessage {
  text: string
  username: string
  icon_emoji: string
  channel?: string
}

/**
 * Pure function that produces the Mattermost payload from a `FeedbackPayload`.
 * Exported separately so it's easy to unit-test the formatting without
 * mocking fetch.
 *
 * Mattermost markdown supports headers (`### `), bold (`**`), inline code,
 * and code blocks. We escape backticks in user content to avoid breaking
 * code-block boundaries.
 */
export function formatMattermostMessage(
  payload: FeedbackPayload,
  opts: FormatOptions
): MattermostMessage {
  const lines: string[] = []
  const categoryEmoji =
    payload.category === 'bug'
      ? '🐛'
      : payload.category === 'idea'
        ? '💡'
        : payload.category === 'question'
          ? '❓'
          : payload.category === 'praise'
            ? '🙌'
            : '📝'

  lines.push(`### ${categoryEmoji} ${payload.appName} feedback`)
  lines.push('')
  lines.push(`> ${escapeMarkdown(payload.text)}`)
  lines.push('')

  // Reporter line.
  if (payload.user?.name || payload.user?.email) {
    const name = payload.user.name ?? 'Anonymous'
    const email = payload.user.email ? ` (${payload.user.email})` : ''
    lines.push(`**Reporter:** ${escapeMarkdown(name)}${escapeMarkdown(email)}`)
  } else {
    lines.push('**Reporter:** Anonymous')
  }

  // Page context.
  lines.push(`**Page:** [${escapeMarkdown(payload.pageName)}](${payload.pageUrl})`)
  if (payload.category) lines.push(`**Category:** ${payload.category}`)

  // Build / env context — opt-in via `metadata.custom`.
  if (payload.metadata?.custom) {
    for (const [k, v] of Object.entries(payload.metadata.custom)) {
      lines.push(`**${escapeMarkdown(k)}:** \`${escapeMarkdown(v)}\``)
    }
  }

  // Console errors collapsed into a fenced code block.
  if (payload.metadata?.consoleErrors?.length) {
    lines.push('')
    lines.push('**Console errors:**')
    lines.push('```')
    for (const e of payload.metadata.consoleErrors.slice(0, 5)) {
      lines.push(escapeForCodeBlock(e))
    }
    lines.push('```')
  }

  return {
    text: lines.join('\n'),
    username: opts.username,
    icon_emoji: opts.iconEmoji,
    ...(opts.channel ? { channel: opts.channel } : {}),
  }
}

/** Escape Mattermost markdown control chars in user-supplied text. */
function escapeMarkdown(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\*/g, '\\*')
    .replace(/_/g, '\\_')
    .replace(/~/g, '\\~')
}

/** Inside a fenced code block, only triple-backticks are dangerous. */
function escapeForCodeBlock(s: string): string {
  return s.replace(/```/g, "''`")
}
