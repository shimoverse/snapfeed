import type { FeedbackAdapter, FeedbackAdapterResult, FeedbackPayload } from './types'

export interface DiscordAdapterOptions {
  /** Discord Incoming Webhook URL */
  webhookUrl: string
  /**
   * Username to post as.
   * @default "snapfeed"
   */
  username?: string
  /** Avatar URL for the webhook bot */
  avatarUrl?: string
  /**
   * Role ID to mention in the message content (e.g. "123456789012345678").
   * Will render as `<@&ROLE_ID>` ping above the embed.
   */
  mentionRoleId?: string
}

const CATEGORY_EMOJIS: Record<string, string> = {
  bug: '🐛',
  idea: '💡',
  question: '❓',
  praise: '🙌',
  other: '📝',
}

const CATEGORY_COLORS: Record<string, number> = {
  bug: 0xcc2936,
  idea: 0xf5c84b,
  question: 0x4b89dc,
  praise: 0x3fb950,
  other: 0x8b949e,
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, Math.max(0, max - 1))}…`
}

function base64ToUint8Array(base64: string): Uint8Array {
  // Works in Node 18+ (atob is global) and modern browsers.
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function extensionForMime(mimeType: string): string {
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return 'jpg'
  if (mimeType.includes('webp')) return 'webp'
  if (mimeType.includes('gif')) return 'gif'
  return 'png'
}

/**
 * Discord incoming webhook adapter — posts feedback as a rich embed.
 *
 * If the payload has a screenshot, it is sent as a file attachment via
 * multipart/form-data alongside the embed. Otherwise a plain JSON POST is used.
 *
 * @example
 * discordAdapter({
 *   webhookUrl: 'https://discord.com/api/webhooks/.../...',
 *   mentionRoleId: '123456789012345678',
 * })
 */
export function discordAdapter(options: DiscordAdapterOptions): FeedbackAdapter {
  const {
    webhookUrl,
    username = 'snapfeed',
    avatarUrl,
    mentionRoleId,
  } = options

  return {
    name: 'discord',
    async send(payload: FeedbackPayload): Promise<FeedbackAdapterResult> {
      const category = payload.category ?? 'other'
      const emoji = CATEGORY_EMOJIS[category] ?? CATEGORY_EMOJIS.other
      const color = CATEGORY_COLORS[category] ?? CATEGORY_COLORS.other

      const title = `${emoji} ${truncate(payload.text, 80)}`

      let description = truncate(payload.text, 2000)

      const consoleErrors = payload.metadata?.consoleErrors ?? []
      if (consoleErrors.length > 0) {
        const lastThree = consoleErrors.slice(-3).map((e) => truncate(e, 300))
        const block = `\n\n**Console errors:**\n\`\`\`\n${lastThree.join('\n')}\n\`\`\``
        // Keep total description under Discord's 4096 limit while staying conservative.
        description = truncate(description, 2000 - block.length) + block
      }

      const reporter = payload.user?.name
        ? `${payload.user.name}${payload.user.email ? ` <${payload.user.email}>` : ''}`
        : payload.user?.email || 'Anonymous'

      const fields: Array<{ name: string; value: string; inline?: boolean }> = [
        {
          name: 'Page',
          value: `[${payload.pageName || payload.pageUrl}](${payload.pageUrl})`,
          inline: false,
        },
        { name: 'Reporter', value: reporter, inline: true },
        { name: 'App', value: payload.appName, inline: true },
      ]

      if (payload.metadata?.viewport) {
        fields.push({ name: 'Viewport', value: payload.metadata.viewport, inline: true })
      }

      const embed: Record<string, unknown> = {
        title: truncate(title, 256),
        description,
        color,
        fields,
        footer: { text: 'snapfeed' },
        timestamp: payload.timestamp,
      }

      const content = mentionRoleId ? `<@&${mentionRoleId}>` : undefined

      const jsonPayload: Record<string, unknown> = {
        username,
        ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
        ...(content ? { content } : {}),
        embeds: [embed],
      }

      const warnings: string[] = []

      try {
        let res: Response
        let screenshotAttached = false

        if (payload.screenshot?.base64) {
          // Wrapped so a malformed base64 (atob throws) does not abort the
          // whole post — fall back to the JSON-only path and surface a warning.
          try {
            const bytes = base64ToUint8Array(payload.screenshot.base64)
            const ext = extensionForMime(payload.screenshot.mimeType)
            const blob = new Blob([bytes as BlobPart], { type: payload.screenshot.mimeType })

            // Reference the file from the embed so Discord renders it inline.
            ;(embed as { image?: { url: string } }).image = { url: `attachment://screenshot.${ext}` }

            const form = new FormData()
            form.append('payload_json', JSON.stringify(jsonPayload))
            form.append('files[0]', blob, `screenshot.${ext}`)

            // Append ?wait=true so Discord returns the created message JSON
            // (otherwise it 204s with no body and we lose the message id).
            const url = webhookUrl.includes('?')
              ? `${webhookUrl}&wait=true`
              : `${webhookUrl}?wait=true`

            res = await fetch(url, { method: 'POST', body: form })
            screenshotAttached = true
          } catch (err) {
            const detail = err instanceof Error ? err.message : String(err)
            warnings.push(`screenshot upload failed: ${detail}`)
            // Drop the embed image reference (we never attached the file).
            delete (embed as { image?: { url: string } }).image

            const url = webhookUrl.includes('?')
              ? `${webhookUrl}&wait=true`
              : `${webhookUrl}?wait=true`
            res = await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(jsonPayload),
            })
          }
        } else {
          const url = webhookUrl.includes('?')
            ? `${webhookUrl}&wait=true`
            : `${webhookUrl}?wait=true`

          res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(jsonPayload),
          })
        }

        if (!res.ok) {
          const text = await res.text().catch(() => '')
          return {
            ok: false,
            error: `${res.status}: ${text.slice(0, 200)}`,
          }
        }

        let deliveryId = 'discord:webhook'
        try {
          const ct = res.headers.get('content-type') ?? ''
          if (ct.includes('application/json')) {
            // Guard against malformed 2xx bodies — a parse failure should not
            // turn a successful delivery into an error.
            const data = (await res.json().catch(() => ({}))) as { id?: string }
            if (data?.id) deliveryId = data.id
          }
        } catch {
          // Non-JSON (204 No Content) — keep default deliveryId.
        }

        // Suppress unused-var warning in environments where TS is strict.
        void screenshotAttached

        return warnings.length > 0
          ? { ok: true, deliveryId, warnings }
          : { ok: true, deliveryId }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { ok: false, error: `Discord adapter error: ${message}` }
      }
    },
  }
}
