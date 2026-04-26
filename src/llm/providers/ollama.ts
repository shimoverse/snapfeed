/**
 * snapfeed — Ollama (local) provider
 *
 * Server-side only. Ollama runs on the same machine (or in-tenant), so no
 * API key is needed.
 *
 * Uses Ollama's `/api/chat` endpoint with a role-tagged `messages` array.
 * The previous implementation called `/api/generate` with a concatenated
 * `prompt: system + '\n\n' + user`, which works for raw base models but
 * skips the model's chat template — most chat-tuned Ollama models
 * (llama3, qwen, mistral-instruct, gemma, phi3, etc.) expect the
 * Modelfile-defined template wrapping each turn. Switching to `/api/chat`
 * lets Ollama apply the right template per-model with no per-model logic
 * in snapfeed.
 *
 * Custom endpoints (`config.endpoint`) are consumer-trusted: snapfeed
 * validates the scheme (http/https only, throws otherwise) but does NOT
 * validate the host. See `providers/endpoint.ts` for details.
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
import { validateEndpoint } from './endpoint'

const DEFAULT_ENDPOINT = 'http://localhost:11434/api/chat'
const DEFAULT_MODEL = 'llama3'

export function ollamaProvider(config: LLMConfig): LLMProvider {
  const endpoint = config.endpoint ?? DEFAULT_ENDPOINT
  const model = config.model ?? DEFAULT_MODEL

  if (config.endpoint) validateEndpoint(endpoint, 'ollama')

  return {
    name: 'ollama',
    async complete({ system, user, signal }) {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        ...(config.headers ?? {}),
      }

      const body = {
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
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

      const json = (await res.json()) as OllamaChatResponse
      const text = json?.message?.content ?? ''
      const tokensUsed =
        (json?.eval_count ?? 0) + (json?.prompt_eval_count ?? 0)

      return { text, tokensUsed }
    },
  }
}

interface OllamaChatResponse {
  message?: { role?: string; content?: string }
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
