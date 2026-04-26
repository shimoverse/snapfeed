import type { FeedbackAdapter, FeedbackAdapterResult, FeedbackPayload } from './types'

export interface WebhookAdapterOptions {
  /** The URL to POST feedback to. MUST be `https://` unless `allowInsecure` is true. */
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
  /**
   * Allow non-HTTPS URLs. Default: false (only `https:` accepted).
   * Set to true ONLY for explicit dev / on-prem deployments where TLS is
   * terminated upstream. NEVER set to true for URLs sourced from request data.
   *
   * SECURITY: this adapter does no SSRF guard beyond the scheme check. The
   * consumer is responsible for ensuring `url` is NOT user-controlled. If the
   * URL must be dynamic, validate the host against an allowlist BEFORE
   * passing it to this factory.
   */
  allowInsecure?: boolean
}

/**
 * Generic webhook adapter — POSTs the full FeedbackPayload as JSON to any URL.
 *
 * SECURITY POSTURE:
 *   - HTTPS-only by default. Pass `allowInsecure: true` for `http://` (dev only).
 *   - The URL is NOT validated against an allowlist. Consumers MUST ensure
 *     the `url` option is hardcoded or sourced from a trusted config — never
 *     from request data. SSRF to internal hosts (cloud metadata, RFC1918,
 *     localhost, file://) is on the consumer to prevent.
 *
 * @example
 * webhookAdapter({ url: 'https://your-api.com/feedback' })
 * webhookAdapter({
 *   url: 'https://your-api.com/feedback',
 *   headers: { 'Authorization': 'Bearer token' },
 * })
 */
export function webhookAdapter(options: WebhookAdapterOptions): FeedbackAdapter {
  const { url, headers = {}, transform, timeoutMs = 10000, allowInsecure = false } = options

  // Validate URL scheme at construction time — fail loudly, not silently.
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`webhookAdapter: invalid URL "${url}"`)
  }
  if (parsed.protocol !== 'https:' && !(allowInsecure && parsed.protocol === 'http:')) {
    throw new Error(
      `webhookAdapter: URL must be https:// (got ${parsed.protocol}). ` +
        `Pass { allowInsecure: true } for http:// in dev only.`
    )
  }

  return {
    name: 'webhook',
    async send(payload: FeedbackPayload): Promise<FeedbackAdapterResult> {
      const body = transform ? transform(payload) : payload

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...headers,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        })

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
      } finally {
        // Always clear the timeout — leaking timers under load wastes handles.
        clearTimeout(timer)
      }
    },
  }
}
