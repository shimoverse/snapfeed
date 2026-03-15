import type { FeedbackAdapter, FeedbackAdapterResult, FeedbackPayload } from './types'

export interface WebhookAdapterOptions {
  /** The URL to POST feedback to */
  url: string
  /** Additional headers to include in the request */
  headers?: Record<string, string>
  /**
   * Transform the payload before sending.
   * Useful for mapping to a specific schema.
   */
  transform?: (payload: FeedbackPayload) => unknown
  /**
   * Timeout in milliseconds.
   * @default 10000
   */
  timeoutMs?: number
}

/**
 * Generic webhook adapter — POSTs the full FeedbackPayload as JSON to any URL.
 *
 * @example
 * webhookAdapter({ url: 'https://your-api.com/feedback' })
 * webhookAdapter({
 *   url: 'https://your-api.com/feedback',
 *   headers: { 'Authorization': 'Bearer token' },
 * })
 */
export function webhookAdapter(options: WebhookAdapterOptions): FeedbackAdapter {
  const { url, headers = {}, transform, timeoutMs = 10000 } = options

  return {
    name: 'webhook',
    async send(payload: FeedbackPayload): Promise<FeedbackAdapterResult> {
      const body = transform ? transform(payload) : payload

      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), timeoutMs)

        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...headers,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        })

        clearTimeout(timer)

        if (!res.ok) {
          const text = await res.text().catch(() => '')
          return {
            ok: false,
            error: `Webhook returned ${res.status}: ${text.slice(0, 200)}`,
          }
        }

        return { ok: true }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { ok: false, error: `Webhook request failed: ${message}` }
      }
    },
  }
}
