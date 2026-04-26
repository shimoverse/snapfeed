/**
 * snapfeed — LLM (BYOK) runner
 *
 * Server-side only. Do NOT import this file from any browser bundle.
 *
 * Design contracts (non-negotiable):
 *   1. Every LLM feature is opt-in. `enabled: false` => no LLM call, ever.
 *   2. BYOK. snapfeed never sees an API key in transit.
 *   3. Token budget is checked BEFORE each call. Fails closed when exceeded.
 *   4. Pre-LLM redaction (regex + entropy) optionally strips PII / secrets.
 *   5. Each feature degrades independently — one feature failing never
 *      throws out of `applyLLM`. The result carries `degraded: true` and
 *      a `warnings[]` array so the caller can surface "delivered, title
 *      generation skipped: budget exhausted".
 */

import type { FeedbackPayload } from '../types'
import { redactForLLM } from './redact'
import { anthropicProvider } from './providers/anthropic'
import { openaiProvider } from './providers/openai'
import { ollamaProvider } from './providers/ollama'
import type {
  BudgetTracker,
  LLMConfig,
  LLMProvider,
  LLMRunResult,
} from './types'

export * from './types'
export { createBudgetTracker } from './budget'
export { redactForLLM } from './redact'
export { anthropicProvider } from './providers/anthropic'
export { openaiProvider } from './providers/openai'
export { ollamaProvider } from './providers/ollama'

// Conservative pre-call estimate. Real token counts come back from the
// provider via `tokensUsed` and are recorded against the budget after the
// call succeeds. We use this only to gate the call up front.
const ESTIMATED_MAX_TOKENS_PER_CALL = 512

/**
 * Returns the right provider based on `config.provider`. Returns `null` when
 * `enabled === false` so callers can short-circuit without instantiating.
 *
 * `azure-openai` reuses the OpenAI provider — consumers point `endpoint` at
 * their Azure deployment URL and pass the `api-key` header via `config.headers`.
 *
 * `bedrock` and `custom` are reserved — not implemented in this release.
 */
export function createProvider(config: LLMConfig): LLMProvider | null {
  if (!config.enabled) return null

  switch (config.provider) {
    case 'anthropic':
      return anthropicProvider(config)
    case 'openai':
    case 'azure-openai':
      return openaiProvider(config)
    case 'ollama':
      return ollamaProvider(config)
    case 'bedrock':
    case 'custom':
      // Not implemented in this release. Returning null lets the runner
      // degrade gracefully rather than throw at config-time.
      return null
    default:
      return null
  }
}

export interface ApplyLLMOptions {
  budget?: BudgetTracker
  signal?: AbortSignal
}

/**
 * Main entrypoint. Applies enabled LLM features to a payload and returns
 * the aggregated result. Never throws — all failures degrade.
 */
export async function applyLLM(
  payload: FeedbackPayload,
  config: LLMConfig,
  options: ApplyLLMOptions = {}
): Promise<LLMRunResult> {
  const result: LLMRunResult = {
    tokensUsed: 0,
    degraded: false,
  }

  // Rule 1: opt-in. Disabled => no LLM call, no work.
  if (!config.enabled) return result

  const features = config.features ?? {}
  const anyFeature =
    features.title || features.severity || features.repro || features.redact
  if (!anyFeature) return result

  const provider = createProvider(config)
  if (!provider) {
    pushWarning(result, 'no_provider: provider not configured or unsupported')
    return result
  }

  const text = config.redactBeforeLLM ? redactForLLM(payload.text) : payload.text
  const consoleErrors = (payload.metadata?.consoleErrors ?? []).map(e =>
    config.redactBeforeLLM ? redactForLLM(e) : e
  )
  const firstThreeErrors = consoleErrors.slice(0, 3)

  const { budget, signal } = options

  // ── title ────────────────────────────────────────────────────────────────
  if (features.title) {
    if (budget && !budget.allow(ESTIMATED_MAX_TOKENS_PER_CALL)) {
      pushWarning(result, 'title: skipped (budget exhausted)')
    } else {
      try {
        const userMsg = [
          `Feedback: ${text}`,
          firstThreeErrors.length
            ? `Console errors:\n${firstThreeErrors.join('\n')}`
            : '',
        ]
          .filter(Boolean)
          .join('\n\n')

        const { text: out, tokensUsed } = await provider.complete({
          system:
            'Write a 6-12 word, sentence-case title for a developer feedback ticket. Output only the title, no quotes, no prefix.',
          user: userMsg,
          maxTokens: 64,
          signal,
        })
        result.tokensUsed += tokensUsed
        budget?.record(tokensUsed)
        const title = out.trim().replace(/^["']|["']$/g, '')
        if (title) result.title = title
      } catch (err) {
        pushWarning(result, `title: ${describeError(err)}`)
      }
    }
  }

  // ── severity ─────────────────────────────────────────────────────────────
  if (features.severity) {
    if (budget && !budget.allow(ESTIMATED_MAX_TOKENS_PER_CALL)) {
      pushWarning(result, 'severity: skipped (budget exhausted)')
    } else {
      try {
        const userMsg = [
          `Feedback: ${text}`,
          firstThreeErrors.length
            ? `Console errors:\n${firstThreeErrors.join('\n')}`
            : '',
        ]
          .filter(Boolean)
          .join('\n\n')

        const { text: out, tokensUsed } = await provider.complete({
          system:
            'Classify this feedback as one of: p0 (broken/blocking), p1 (functional bug), p2 (minor issue), nit (cosmetic). Output only the label.',
          user: userMsg,
          maxTokens: 16,
          signal,
        })
        result.tokensUsed += tokensUsed
        budget?.record(tokensUsed)
        const sev = parseSeverity(out)
        if (sev) result.severity = sev
        else pushWarning(result, `severity: unparseable response "${out.slice(0, 40)}"`)
      } catch (err) {
        pushWarning(result, `severity: ${describeError(err)}`)
      }
    }
  }

  // ── repro ────────────────────────────────────────────────────────────────
  if (features.repro) {
    if (budget && !budget.allow(ESTIMATED_MAX_TOKENS_PER_CALL)) {
      pushWarning(result, 'repro: skipped (budget exhausted)')
    } else {
      try {
        const userMsg = [
          `Feedback: ${text}`,
          payload.pageUrl ? `URL: ${payload.pageUrl}` : '',
          payload.metadata?.viewport ? `Viewport: ${payload.metadata.viewport}` : '',
        ]
          .filter(Boolean)
          .join('\n')

        const { text: out, tokensUsed } = await provider.complete({
          system:
            'Extract steps to reproduce as a numbered list. Output as JSON array of strings. If unclear, output [].',
          user: userMsg,
          maxTokens: 256,
          signal,
        })
        result.tokensUsed += tokensUsed
        budget?.record(tokensUsed)
        const steps = parseSteps(out)
        if (steps && steps.length > 0) result.reproSteps = steps
      } catch (err) {
        pushWarning(result, `repro: ${describeError(err)}`)
      }
    }
  }

  return result
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function pushWarning(result: LLMRunResult, msg: string): void {
  result.degraded = true
  result.warnings = result.warnings ?? []
  result.warnings.push(msg)
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

function parseSeverity(raw: string): 'p0' | 'p1' | 'p2' | 'nit' | undefined {
  const s = raw.trim().toLowerCase()
  // Accept exact label or label-prefixed responses.
  if (/\bp0\b/.test(s)) return 'p0'
  if (/\bp1\b/.test(s)) return 'p1'
  if (/\bp2\b/.test(s)) return 'p2'
  if (/\bnit\b/.test(s)) return 'nit'
  return undefined
}

function parseSteps(raw: string): string[] | undefined {
  // Try a clean JSON parse first. Many models wrap JSON in ```json fences;
  // strip those before parsing.
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()

  try {
    const parsed = JSON.parse(stripped)
    if (Array.isArray(parsed) && parsed.every(s => typeof s === 'string')) {
      return parsed
    }
  } catch {
    // Fall through to bracket-extraction fallback below.
  }

  // Fallback: pull the first [...] block out of the response and parse it.
  const match = stripped.match(/\[[\s\S]*\]/)
  if (match) {
    try {
      const parsed = JSON.parse(match[0])
      if (Array.isArray(parsed) && parsed.every(s => typeof s === 'string')) {
        return parsed
      }
    } catch {
      /* give up */
    }
  }

  return undefined
}
