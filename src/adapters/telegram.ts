import type { FeedbackAdapter, FeedbackAdapterResult, FeedbackPayload } from './types'

export interface TelegramAdapterOptions {
  /** Telegram Bot API token */
  botToken: string
  /** Chat ID to send messages to (group or user) */
  chatId: string
  /**
   * Whether to send the screenshot as a photo message.
   * @default true
   */
  sendScreenshot?: boolean
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

const CATEGORY_EMOJIS: Record<string, string> = {
  bug: '🐛',
  idea: '💡',
  question: '❓',
  praise: '🙌',
  other: '📝',
}

function buildMessage(payload: FeedbackPayload): string {
  const categoryEmoji = payload.category ? (CATEGORY_EMOJIS[payload.category] ?? '') : ''
  const categoryLabel = payload.category
    ? ` ${categoryEmoji} ${payload.category.charAt(0).toUpperCase() + payload.category.slice(1)}`
    : ''

  const parts: string[] = [
    `🔧 <b>${escapeHtml(payload.appName)} Feedback${categoryLabel}</b>`,
  ]

  if (payload.user?.name) {
    parts.push(`<b>From:</b> ${escapeHtml(payload.user.name)}`)
  }

  const page = payload.pageName
    ? `${escapeHtml(payload.pageName)} <code>${escapeHtml(payload.pageUrl)}</code>`
    : `<code>${escapeHtml(payload.pageUrl)}</code>`
  parts.push(`<b>Page:</b> ${page}`)

  parts.push('')
  parts.push(`<i>${escapeHtml(payload.text)}</i>`)

  if (payload.metadata?.viewport) {
    parts.push('')
    parts.push(
      `<b>Viewport:</b> <code>${escapeHtml(payload.metadata.viewport)}</code>`
    )
  }

  return parts.join('\n')
}

/**
 * Telegram Bot API adapter — sends formatted HTML messages to a Telegram chat.
 * Supports sending screenshot images as photo messages.
 *
 * @example
 * telegramAdapter({
 *   botToken: process.env.TELEGRAM_BOT_TOKEN!,
 *   chatId: '-5133507091',
 * })
 */
export function telegramAdapter(options: TelegramAdapterOptions): FeedbackAdapter {
  const { botToken, chatId, sendScreenshot = true } = options
  const baseUrl = `https://api.telegram.org/bot${botToken}`

  return {
    name: 'telegram',
    async send(payload: FeedbackPayload): Promise<FeedbackAdapterResult> {
      const message = buildMessage(payload)

      try {
        // Send the text message
        const textRes = await fetch(`${baseUrl}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: message,
            parse_mode: 'HTML',
          }),
        })

        if (!textRes.ok) {
          const err = await textRes.text().catch(() => '')
          return { ok: false, error: `Telegram sendMessage failed: ${err.slice(0, 200)}` }
        }

        const textData = (await textRes.json()) as {
          result?: { message_id?: number }
        }
        const messageId = String(textData.result?.message_id ?? '')

        // Optionally send screenshot as a follow-up photo
        if (sendScreenshot && payload.screenshot?.base64) {
          const mimeType = payload.screenshot.mimeType || 'image/png'
          // Build a data URI for FormData
          // Convert base64 to Blob for FormData
          const byteChars = atob(payload.screenshot.base64)
          const byteNums = new Array(byteChars.length)
          for (let i = 0; i < byteChars.length; i++) {
            byteNums[i] = byteChars.charCodeAt(i)
          }
          const byteArray = new Uint8Array(byteNums)
          const blob = new Blob([byteArray], { type: mimeType })

          const form = new FormData()
          form.append('chat_id', chatId)
          form.append('photo', blob, `screenshot.${mimeType.split('/')[1] ?? 'png'}`)
          form.append('caption', `📸 Screenshot for feedback #${messageId}`)

          const photoRes = await fetch(`${baseUrl}/sendPhoto`, {
            method: 'POST',
            body: form,
          })

          if (!photoRes.ok) {
            // Screenshot failed but text was sent — still count as ok
            console.warn('[telegram adapter] screenshot upload failed')
          }
        }

        return { ok: true, deliveryId: messageId }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { ok: false, error: `Telegram adapter error: ${message}` }
      }
    },
  }
}
