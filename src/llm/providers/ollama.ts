/**
 * snapfeed — Ollama (local) provider
 *
 * Server-side only. Ollama runs on the same machine (or in-tenant), so no
 * API key is needed. Uses Ollama's `/api/generate` endpoint with the
 * `prompt` field (not `messages` — Ollama's chat endpoint is separate).
 *
 * `stream: false` keeps the response single-shot. We deliberately do NOT
 * support streaming here — the runner aggregates short, non-streamed
 * completions per feature, and streaming would complicate token accounting
 * for the budget tracker. Consumers who want streaming should call Ollama
 * directly outside snapfeed.
 *
 * Throws on non-2xx so the runner can degrade gracefully.
 */

import type { LLMConfig, LLMProvider } from '../types'

const DEFAULT_ENDPOINT = 'http://localhost:11434/api/generate'
const DEFAULT_MODEL = 'llama3'

export function ollamaProvider(config: LLMConfig): LLMProvider {
  const endpoint = config.endpoint ?? DEFAULT_ENDPOINT
  const model = config.model ?? DEFAULT_MODEL

  return {
    name: 'ollama',
    async complete({ system, user, signal }) {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        ...(config.headers ?? {}),
      }

      const body = {
        model,
        prompt: `${system}\n\n${user}`,
        stream: false,
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
          `ollama provider HTTP ${res.status}: ${errText.slice(0, 200)}`
        )
      }

      const json = (await res.json()) as OllamaResponse
      const text = json?.response ?? ''
      const tokensUsed =
        (json?.eval_count ?? 0) + (json?.prompt_eval_count ?? 0)

      return { text, tokensUsed }
    },
  }
}

interface OllamaResponse {
  response?: string
  eval_count?: number
  prompt_eval_count?: number
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text()
  } catch {
    return ''
  }
}
