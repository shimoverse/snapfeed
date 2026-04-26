/**
 * snapfeed — Anthropic Messages API provider
 *
 * Server-side only. The API key comes from the consumer's config (BYOK).
 * snapfeed never sees a key in transit; calls go directly to Anthropic
 * (or to `endpoint`, which a corp can point at an in-tenant proxy).
 *
 * Custom endpoints (`config.endpoint`) are consumer-trusted: snapfeed
 * validates the scheme (http/https only, throws otherwise) but does NOT
 * validate the host. Consumers must ensure the URL points at a service
 * they trust with payload contents and the API key. See
 * `providers/endpoint.ts` for details.
 *
 * Throws on non-2xx so the runner can catch and degrade gracefully.
 */

import type { LLMConfig, LLMProvider } from '../types'
import { validateEndpoint } from './endpoint'

const DEFAULT_ENDPOINT = 'https://api.anthropic.com/v1/messages'
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001'
const ANTHROPIC_VERSION = '2023-06-01'

export function anthropicProvider(config: LLMConfig): LLMProvider {
  const endpoint = config.endpoint ?? DEFAULT_ENDPOINT
  const model = config.model ?? DEFAULT_MODEL

  // Validate at construction so a bad endpoint surfaces immediately rather
  // than at the first .complete() call. Throws synchronously.
  if (config.endpoint) validateEndpoint(endpoint, 'anthropic')

  return {
    name: 'anthropic',
    async complete({ system, user, maxTokens, signal }) {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        'anthropic-version': ANTHROPIC_VERSION,
        ...(config.headers ?? {}),
      }
      if (config.apiKey) headers['x-api-key'] = config.apiKey

      const body = {
        model,
        max_tokens: maxTokens ?? 256,
        system,
        messages: [{ role: 'user', content: user }],
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal,
      })

      if (!res.ok) {
        const errText = await safeText(res)
        throw new Error(
          `anthropic provider HTTP ${res.status}: ${errText.slice(0, 200)}`
        )
      }

      const json = (await res.json()) as AnthropicResponse
      const text = json?.content?.[0]?.text ?? ''
      const tokensUsed =
        (json?.usage?.input_tokens ?? 0) + (json?.usage?.output_tokens ?? 0)

      return { text, tokensUsed }
    },
  }
}

interface AnthropicResponse {
  content?: Array<{ type?: string; text?: string }>
  usage?: { input_tokens?: number; output_tokens?: number }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text()
  } catch {
    return ''
  }
}
