/**
 * snapfeed — OpenAI Chat Completions provider
 *
 * Server-side only. BYOK: api key supplied by consumer config. The same
 * provider works for Azure OpenAI by setting `endpoint` to the deployment
 * URL and passing the `api-key` header via `config.headers` (Azure uses
 * `api-key` instead of `Authorization: Bearer`).
 *
 * Custom endpoints (`config.endpoint`) are consumer-trusted: snapfeed
 * validates the scheme (http/https only, throws otherwise) but does NOT
 * validate the host. Consumers must ensure the URL points at a service
 * they trust with payload contents and the API key. See
 * `providers/endpoint.ts` for details.
 *
 * Reasoning-model support: o-series models (`o1`, `o3`, `o4`, `o5`,
 * including `o3-mini`, `o4-mini`, etc.) reject `max_tokens` and require
 * `max_completion_tokens` instead. We detect by model-name prefix and
 * switch the param name automatically.
 *
 * Throws on non-2xx so the runner can degrade gracefully.
 */

import type { LLMConfig, LLMProvider } from '../types'
import { validateEndpoint } from './endpoint'

const DEFAULT_ENDPOINT = 'https://api.openai.com/v1/chat/completions'
const DEFAULT_MODEL = 'gpt-4o-mini'

/**
 * o-series reasoning models (o1, o3, o4, o5 — including the `-mini` and
 * `-preview` variants) deprecated `max_tokens` in favor of
 * `max_completion_tokens`. Sending `max_tokens` to an o-series model
 * returns a 400 from the OpenAI API.
 *
 * Detection is by model-name prefix only — a custom-named gateway can
 * always pass an explicit body via a future hook. Adding new o-series
 * generations is a one-line edit to this regex.
 */
export function pickTokenParam(
  model: string
): 'max_tokens' | 'max_completion_tokens' {
  if (/^o\d+(?:-|$)/i.test(model)) return 'max_completion_tokens'
  return 'max_tokens'
}

export function openaiProvider(config: LLMConfig): LLMProvider {
  const endpoint = config.endpoint ?? DEFAULT_ENDPOINT
  const model = config.model ?? DEFAULT_MODEL

  if (config.endpoint) validateEndpoint(endpoint, 'openai')

  return {
    name: 'openai',
    async complete({ system, user, maxTokens, signal }) {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        ...(config.headers ?? {}),
      }
      if (config.apiKey) headers['authorization'] = `Bearer ${config.apiKey}`

      const tokenParam = pickTokenParam(model)
      const body: Record<string, unknown> = {
        model,
        [tokenParam]: maxTokens ?? 256,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
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
          `openai provider HTTP ${res.status}: ${errText.slice(0, 200)}`
        )
      }

      const json = (await res.json()) as OpenAIResponse
      const text = json?.choices?.[0]?.message?.content ?? ''
      // Some OpenAI-compatible servers (LM Studio, vLLM with default config,
      // older llama.cpp) omit `usage` entirely. Returning 0 here would let
      // the budget tracker silently undercount. We return -1 as a sentinel;
      // the runner treats -1 as "estimate from per-feature cap" and pushes
      // a one-time warning so the consumer notices.
      const tokensUsed =
        json?.usage && typeof json.usage.total_tokens === 'number'
          ? json.usage.total_tokens
          : -1

      return { text, tokensUsed }
    },
  }
}

interface OpenAIResponse {
  choices?: Array<{ message?: { content?: string } }>
  usage?: { total_tokens?: number }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text()
  } catch {
    return ''
  }
}
