/**
 * snapfeed — LLM (BYOK) type definitions
 *
 * All LLM features are opt-in. Defaults to disabled. When disabled, the
 * runner returns the payload unchanged with no LLM call.
 *
 * BYOK (bring your own key): the consumer supplies the API key in their own
 * server config. snapfeed never proxies through any hosted relay.
 *
 * Server-side only: this module must never end up in a browser bundle.
 */

export type LLMProviderName =
  | 'anthropic'
  | 'openai'
  | 'azure-openai'
  | 'bedrock'
  | 'ollama'
  | 'custom'

export interface LLMFeatureToggles {
  /** Generate a clean title for the ticket (used by JIRA/Linear/Asana/Notion). */
  title?: boolean
  /** Infer severity (P0/P1/P2/nit) from text + console errors. */
  severity?: boolean
  /** Extract reproducible steps from the payload. */
  repro?: boolean
  // `redact` (LLM second-pass redaction) was advertised in v0.4 but never
  // implemented at the runner level — removed in v0.5.0 to avoid a
  // security-flavored no-op. Use `redactBeforeLLM: true` (regex + entropy +
  // email patterns) on the top-level LLMConfig instead. A real LLM-driven
  // redact pass is planned for v0.6.
  // dedupe + transcribe + route deferred to a later release.
}

export interface LLMConfig {
  enabled: boolean
  provider: LLMProviderName
  apiKey?: string
  /** Model id; provider-specific. */
  model?: string
  /** Override endpoint (Azure OpenAI, Ollama, custom proxy). */
  endpoint?: string
  /** Per-feature opt-in toggles. */
  features?: LLMFeatureToggles
  /** Token budget. Fails closed when exceeded in the current day. */
  budget?: { dailyTokens: number }
  /**
   * Run regex+entropy redaction on payload.text + console errors before
   * sending to the LLM.
   *
   * **Default: `false`.** Disabled by default to preserve full payload
   * fidelity for the LLM (redaction tags like `[EMAIL]` and `[REDACTED]`
   * can degrade title/severity/repro quality on otherwise-benign payloads).
   * Enable when shipping payloads to a third-party LLM endpoint where
   * leaking PII or secrets in feedback text is a concern.
   *
   * Note: server-side console-error sanitization (in `validatePayload`)
   * runs unconditionally — that pass strips obvious secret shapes
   * regardless of this flag. `redactBeforeLLM` adds emails, credit-card
   * digit groups, and high-entropy strings on top, applied to
   * `payload.text` and `pageUrl` as well.
   */
  redactBeforeLLM?: boolean
  /** Custom HTTP headers, e.g. { 'OpenAI-Organization': '...' }. */
  headers?: Record<string, string>
}

export interface LLMRunResult {
  /** Suggested title; undefined when disabled or no title feature. */
  title?: string
  /** Inferred severity; one of 'p0' | 'p1' | 'p2' | 'nit' or undefined. */
  severity?: 'p0' | 'p1' | 'p2' | 'nit'
  /** Numbered repro steps as array; undefined when disabled. */
  reproSteps?: string[]
  /** Tokens consumed by this run. */
  tokensUsed: number
  /** True when one or more requested features fell back due to error/quota. */
  degraded: boolean
  /** Per-feature notes about why a feature degraded. */
  warnings?: string[]
}

export interface LLMProvider {
  name: LLMProviderName
  /**
   * Generate a single completion from a system prompt + user message. Returns
   * the text and the tokens consumed. Implementations must throw on transport
   * failures — the runner catches and degrades gracefully.
   */
  complete(args: {
    system: string
    user: string
    maxTokens?: number
    signal?: AbortSignal
  }): Promise<{ text: string; tokensUsed: number }>
}

export interface BudgetTracker {
  /** Returns true if `tokens` more would still be within budget today. */
  allow(tokens: number): boolean
  /** Records consumed tokens. */
  record(tokens: number): void
  /** Tokens consumed today. */
  used(): number
}
