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

// Per-feature pre-call token estimate. Real token counts come back from the
// provider via `tokensUsed` and are recorded against the budget after the
// call succeeds. We use this only to gate the call up front.
//
// These values match each feature's `maxTokens` so the budget pre-gate is
// neither over- nor under-provisioned. A single one-size-fits-all estimate
// (the old `ESTIMATED_MAX_TOKENS_PER_CALL = 512`) was ~10x too generous for
// title and ~30x for severity, which made the pre-gate effectively useless.
//
// `redact` ceiling tracks the input size loosely — we cap at 512 since the
// rewritten output should never grow much beyond the input; if it does,
// the LLM is likely hallucinating commentary instead of redacting.
export const MAX_TOKENS_PER_FEATURE = {
  title: 64,
  severity: 16,
  repro: 256,
  redact: 512,
} as const

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

  const maybeRedact = (s: string): string =>
    config.redactBeforeLLM ? redactForLLM(s) : s

  const text = maybeRedact(payload.text)
  const consoleErrors = (payload.metadata?.consoleErrors ?? []).map(maybeRedact)
  const firstThreeErrors = consoleErrors.slice(0, 3)
  // URLs commonly leak tokens / emails (`?api_key=…`, `?token=…`,
  // `/users/foo@example.com/…`). Apply the same redaction pass so the LLM
  // never sees them in the repro feature's user message.
  const pageUrlSafe = maybeRedact(payload.pageUrl ?? '')

  const { budget, signal } = options

  // ── title ────────────────────────────────────────────────────────────────
  if (features.title) {
    if (budget && !budget.allow(MAX_TOKENS_PER_FEATURE.title)) {
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
          maxTokens: MAX_TOKENS_PER_FEATURE.title,
          signal,
        })
        result.tokensUsed += accountTokens(tokensUsed, MAX_TOKENS_PER_FEATURE.title, result, 'title')
        budget?.record(accountTokens(tokensUsed, MAX_TOKENS_PER_FEATURE.title))
        // Strip wrapping quotes from BOTH sides — the old single-character
        // /^["']|["']$/g regex stripped only one quote, leaving '"foo"' as
        // 'foo' fine but '""foo""' as '"foo"'.
        const title = out
          .trim()
          .replace(/^["']+/, '')
          .replace(/["']+$/, '')
        if (title) result.title = title
      } catch (err) {
        pushWarning(result, `title: ${describeError(err)}`)
      }
    }
  }

  // ── severity ─────────────────────────────────────────────────────────────
  if (features.severity) {
    if (budget && !budget.allow(MAX_TOKENS_PER_FEATURE.severity)) {
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
          maxTokens: MAX_TOKENS_PER_FEATURE.severity,
          signal,
        })
        result.tokensUsed += accountTokens(tokensUsed, MAX_TOKENS_PER_FEATURE.severity, result, 'severity')
        budget?.record(accountTokens(tokensUsed, MAX_TOKENS_PER_FEATURE.severity))
        const sev = parseSeverity(out)
        if (sev) result.severity = sev
        // Hash, don't echo: the unparseable provider output may include
        // fragments of the user's prompt (prompt-injection scenario) which
        // would land in result.warnings and then in consumer logs.
        else pushWarning(result, `severity: unparseable response (length=${out.length})`)
      } catch (err) {
        pushWarning(result, `severity: ${describeError(err)}`)
      }
    }
  }

  // ── repro ────────────────────────────────────────────────────────────────
  if (features.repro) {
    if (budget && !budget.allow(MAX_TOKENS_PER_FEATURE.repro)) {
      pushWarning(result, 'repro: skipped (budget exhausted)')
    } else {
      try {
        const userMsg = [
          `Feedback: ${text}`,
          pageUrlSafe ? `URL: ${pageUrlSafe}` : '',
          payload.metadata?.viewport ? `Viewport: ${payload.metadata.viewport}` : '',
          // Console errors are often the strongest reproduction signal —
          // a TypeError on pay.js:42 tells the LLM what to look for far
          // better than free-text alone. Title/severity already include
          // these; repro should too.
          firstThreeErrors.length
            ? `Console errors:\n${firstThreeErrors.join('\n')}`
            : '',
        ]
          .filter(Boolean)
          .join('\n')

        const { text: out, tokensUsed } = await provider.complete({
          system:
            'Extract steps to reproduce as a numbered list. Output as JSON array of strings. If unclear, output [].',
          user: userMsg,
          maxTokens: MAX_TOKENS_PER_FEATURE.repro,
          signal,
        })
        result.tokensUsed += accountTokens(tokensUsed, MAX_TOKENS_PER_FEATURE.repro, result, 'repro')
        budget?.record(accountTokens(tokensUsed, MAX_TOKENS_PER_FEATURE.repro))
        const steps = parseSteps(out)
        if (steps && steps.length > 0) result.reproSteps = steps
      } catch (err) {
        pushWarning(result, `repro: ${describeError(err)}`)
      }
    }
  }

  // ── redact (v0.6) ────────────────────────────────────────────────────────
  // LLM second-pass redaction of `payload.text`. The user-message passes the
  // ORIGINAL text (not `text` after `redactBeforeLLM`) — the regex pre-pass
  // already replaced things like emails with `[EMAIL]`, so feeding the
  // already-tagged version to a second redactor would produce nested tags
  // and confuse the model. The redact feature's job is to catch what regex
  // missed (names, addresses, custom-format IDs, contextual PII).
  if (features.redact) {
    if (budget && !budget.allow(MAX_TOKENS_PER_FEATURE.redact)) {
      pushWarning(result, 'redact: skipped (budget exhausted)')
    } else {
      try {
        const { text: out, tokensUsed } = await provider.complete({
          system:
            'Rewrite the following text replacing any personally-identifiable information (names, emails, phone numbers, addresses, IDs), credentials, secrets, or otherwise sensitive content with the literal token [REDACTED]. Preserve all other words and punctuation. Output ONLY the rewritten text — no preamble, no commentary, no quoting, no formatting.',
          user: payload.text,
          maxTokens: MAX_TOKENS_PER_FEATURE.redact,
          signal,
        })
        result.tokensUsed += accountTokens(tokensUsed, MAX_TOKENS_PER_FEATURE.redact, result, 'redact')
        budget?.record(accountTokens(tokensUsed, MAX_TOKENS_PER_FEATURE.redact))
        const cleaned = out.trim()
        if (cleaned.length > 0) {
          result.redactedText = cleaned
          result.redactionApplied = cleaned !== payload.text
        } else {
          // Empty response: treat as a soft failure so the consumer doesn't
          // overwrite their feedback text with nothing.
          pushWarning(result, 'redact: empty response — payload text left unchanged')
        }
      } catch (err) {
        pushWarning(result, `redact: ${describeError(err)}`)
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

/**
 * Reconcile a provider's `tokensUsed` against the per-feature ceiling.
 *
 * Some OpenAI-compatible servers omit `usage` in their response. The provider
 * signals this by returning the sentinel `tokensUsed: -1`. When the runner
 * sees the sentinel, it bills the per-feature `maxTokens` ceiling against
 * the budget (so unmetered traffic can't silently exhaust quota) and pushes
 * a one-time warning per feature.
 *
 * The `result` and `feature` parameters are optional so this helper can be
 * called twice per call (once for `result.tokensUsed += …`, once for
 * `budget?.record(…)`) without duplicating the warning.
 */
function accountTokens(
  reported: number,
  cap: number,
  result?: LLMRunResult,
  feature?: 'title' | 'severity' | 'repro' | 'redact'
): number {
  if (reported < 0) {
    if (result && feature) {
      const tag = `${feature}: provider omitted usage; billing maxTokens=${cap} to budget`
      const already = result.warnings?.some(w => w === tag)
      if (!already) pushWarning(result, tag)
    }
    return cap
  }
  return reported
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
