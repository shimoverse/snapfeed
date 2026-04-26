/**
 * snapfeed — OpenAI Chat Completions provider
 *
 * Server-side only. BYOK: api key supplied by consumer config. The same
 * provider works for Azure OpenAI by setting `endpoint` to the deployment
 * URL and passing the `api-key` header via `config.headers` (Azure uses
 * `api-key` instead of `Authorization: Bearer`).
 *
 * Throws on non-2xx so the runner can degrade gracefully.
 */

import type { LLMConfig, LLMProvider } from '../types'

const DEFAULT_ENDPOINT = 'https://api.openai.com/v1/chat/completions'
const DEFAULT_MODEL = 'gpt-4o-mini'

export function openaiProvider(config: LLMConfig): LLMProvider {
  const endpoint = config.endpoint ?? DEFAULT_ENDPOINT
  const model = config.model ?? DEFAULT_MODEL

  return {
    name: 'openai',
    async complete({ system, user, maxTokens, signal }) {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        ...(config.headers ?? {}),
      }
      if (config.apiKey) headers['authorization'] = `Bearer ${config.apiKey}`

      const body = {
        model,
        max_tokens: maxTokens ?? 256,
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
      const tokensUsed = json?.usage?.total_tokens ?? 0

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
