/**
 * Edge-case coverage for src/llm/index.ts (the runner — `applyLLM`).
 *
 * Hardens the per-feature degradation paths: provider throws, malformed
 * outputs, empty responses, abort signals, budget exhaustion, etc. Mirrors
 * the existing tests/llm/runner.test.ts mocking pattern (stub the global
 * `fetch` used by the OpenAI provider).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { applyLLM } from '../../src/llm'
import { createBudgetTracker } from '../../src/llm/budget'
import type { LLMConfig } from '../../src/llm/types'
import type { FeedbackPayload } from '../../src/types'

const samplePayload: FeedbackPayload = {
  text: 'Checkout button does nothing when I click it on the payment page',
  appName: 'Checkout',
  pageUrl: 'https://staging.example.com/checkout/payment',
  pageName: 'payment',
  timestamp: '2026-04-25T12:00:00Z',
  metadata: {
    viewport: '1440x900',
    userAgent: 'Mozilla/5.0',
    consoleErrors: ['TypeError: cannot read property of undefined at pay.js:42'],
  },
}

function makeOpenAIConfig(overrides: Partial<LLMConfig> = {}): LLMConfig {
  return {
    enabled: true,
    provider: 'openai',
    apiKey: 'sk-test',
    ...overrides,
  }
}

function openaiBody(content: string, total_tokens = 50) {
  return {
    choices: [{ message: { content } }],
    usage: { total_tokens },
  }
}

/**
 * Stubs `fetch` to return a sequence of responses (or throw). The runner
 * calls fetch once per enabled feature; index 0 = title, 1 = severity,
 * 2 = repro (when all three are on).
 */
function stubFetchSequence(
  responses: Array<{ status?: number; body: unknown } | { throws: Error }>
): ReturnType<typeof vi.fn> {
  let i = 0
  const fn = vi.fn(async () => {
    const r = responses[i++] ?? responses[responses.length - 1]
    if ('throws' in r) throw r.throws
    return new Response(JSON.stringify(r.body), {
      status: r.status ?? 200,
      headers: { 'content-type': 'application/json' },
    })
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

// ─── all providers throw ─────────────────────────────────────────────────────

describe('applyLLM — exhaustive failure', () => {
  it('marks every enabled feature degraded when provider throws on every call', async () => {
    stubFetchSequence([
      { throws: new Error('boom-title') },
      { throws: new Error('boom-severity') },
      { throws: new Error('boom-repro') },
    ])

    const result = await applyLLM(
      samplePayload,
      makeOpenAIConfig({ features: { title: true, severity: true, repro: true } })
    )

    expect(result.title).toBeUndefined()
    expect(result.severity).toBeUndefined()
    expect(result.reproSteps).toBeUndefined()
    expect(result.degraded).toBe(true)
    expect(result.warnings?.length).toBe(3)
    expect(result.warnings?.some(w => w.startsWith('title:') && w.includes('boom-title'))).toBe(true)
    expect(result.warnings?.some(w => w.startsWith('severity:') && w.includes('boom-severity'))).toBe(true)
    expect(result.warnings?.some(w => w.startsWith('repro:') && w.includes('boom-repro'))).toBe(true)
  })
})

// ─── empty / pathological responses ──────────────────────────────────────────

describe('applyLLM — empty provider responses', () => {
  it('title: empty string leaves title undefined; no warning is currently emitted', async () => {
    stubFetchSequence([{ body: openaiBody('', 5) }])

    const result = await applyLLM(
      samplePayload,
      makeOpenAIConfig({ features: { title: true } })
    )

    expect(result.title).toBeUndefined()
    // Source: empty title silently skips (no warning, no degraded). This is the
    // current behavior — documenting it. Tokens are still counted.
    expect(result.tokensUsed).toBe(5)
    expect(result.degraded).toBe(false)
  })

  it('severity: empty string yields undefined and emits an "unparseable" warning', async () => {
    stubFetchSequence([{ body: openaiBody('', 3) }])

    const result = await applyLLM(
      samplePayload,
      makeOpenAIConfig({ features: { severity: true } })
    )

    expect(result.severity).toBeUndefined()
    expect(result.degraded).toBe(true)
    expect(result.warnings?.[0]).toMatch(/severity: unparseable/)
  })

  it('repro: empty string leaves reproSteps undefined; no warning emitted', async () => {
    stubFetchSequence([{ body: openaiBody('', 4) }])

    const result = await applyLLM(
      samplePayload,
      makeOpenAIConfig({ features: { repro: true } })
    )

    expect(result.reproSteps).toBeUndefined()
    // Source: parseSteps returns undefined for empty input; runner only sets
    // reproSteps when length > 0, never warns. No degraded flag set.
    expect(result.degraded).toBe(false)
  })
})

// ─── long title flows through (no truncation in source) ──────────────────────

describe('applyLLM — long title', () => {
  it('passes a 200-char title through unchanged (no truncation in runner)', async () => {
    const longTitle = 'A'.repeat(200)
    stubFetchSequence([{ body: openaiBody(longTitle, 25) }])

    const result = await applyLLM(
      samplePayload,
      makeOpenAIConfig({ features: { title: true } })
    )

    expect(result.title).toBe(longTitle)
    expect(result.title?.length).toBe(200)
    expect(result.degraded).toBe(false)
  })
})

// ─── severity garbage parsing ───────────────────────────────────────────────

describe('applyLLM — severity tolerant parser', () => {
  it('garbage label "p99" yields undefined + unparseable warning', async () => {
    stubFetchSequence([{ body: openaiBody('p99', 4) }])

    const result = await applyLLM(
      samplePayload,
      makeOpenAIConfig({ features: { severity: true } })
    )

    // parseSeverity uses /\bp0\b/ /\bp1\b/ etc — "p99" matches none.
    expect(result.severity).toBeUndefined()
    expect(result.degraded).toBe(true)
    expect(result.warnings?.[0]).toMatch(/severity: unparseable/)
  })

  it('garbage label "broken" yields undefined + unparseable warning', async () => {
    stubFetchSequence([{ body: openaiBody('broken', 4) }])

    const result = await applyLLM(
      samplePayload,
      makeOpenAIConfig({ features: { severity: true } })
    )

    expect(result.severity).toBeUndefined()
    expect(result.degraded).toBe(true)
    expect(result.warnings?.[0]).toMatch(/severity: unparseable/)
  })

  it('label-prefixed response "p1 (functional bug)" still parses as p1', async () => {
    stubFetchSequence([{ body: openaiBody('p1 (functional bug)', 6) }])

    const result = await applyLLM(
      samplePayload,
      makeOpenAIConfig({ features: { severity: true } })
    )

    expect(result.severity).toBe('p1')
    expect(result.degraded).toBe(false)
  })
})

// ─── repro malformed JSON ───────────────────────────────────────────────────

describe('applyLLM — repro tolerant parser', () => {
  it('malformed JSON with trailing comma yields undefined reproSteps and no warning', async () => {
    // Source: parseSteps attempts JSON.parse, then a bracket-extraction
    // fallback. Both fail on '[1, 2,]' (trailing comma). Returns undefined.
    // The runner only sets reproSteps when array length > 0, so the field
    // stays undefined and no warning is pushed (this is current behavior).
    stubFetchSequence([{ body: openaiBody('[1, 2,]', 10) }])

    const result = await applyLLM(
      samplePayload,
      makeOpenAIConfig({ features: { repro: true } })
    )

    expect(result.reproSteps).toBeUndefined()
    expect(result.degraded).toBe(false)
  })

  it('valid JSON object (not an array) yields undefined reproSteps', async () => {
    stubFetchSequence([{ body: openaiBody('{"step1": "do thing"}', 10) }])

    const result = await applyLLM(
      samplePayload,
      makeOpenAIConfig({ features: { repro: true } })
    )

    expect(result.reproSteps).toBeUndefined()
    expect(result.degraded).toBe(false)
  })

  it('array of non-strings (numbers) yields undefined reproSteps', async () => {
    stubFetchSequence([{ body: openaiBody('[1, 2, 3]', 10) }])

    const result = await applyLLM(
      samplePayload,
      makeOpenAIConfig({ features: { repro: true } })
    )

    expect(result.reproSteps).toBeUndefined()
  })
})

// ─── network timeout (slow rejection) ───────────────────────────────────────

describe('applyLLM — network timeout', () => {
  it('catches a delayed rejection and degrades gracefully', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Request timed out')), 5)
          )
      )
    )

    const result = await applyLLM(
      samplePayload,
      makeOpenAIConfig({ features: { title: true } })
    )

    expect(result.title).toBeUndefined()
    expect(result.degraded).toBe(true)
    expect(result.warnings?.[0]).toMatch(/title: Request timed out/)
  })
})

// ─── AbortSignal ────────────────────────────────────────────────────────────

describe('applyLLM — abort signal', () => {
  it('already-aborted signal causes provider fetch to reject; runner degrades all features', async () => {
    // Source: applyLLM does NOT check the abort signal before calling the
    // provider. It passes the signal through to fetch, which rejects with
    // an AbortError. Each feature catches independently and pushes a warning.
    const fetchMock = vi.fn(async (_: unknown, init: { signal?: AbortSignal }) => {
      if (init?.signal?.aborted) {
        const err = new Error('The operation was aborted.')
        err.name = 'AbortError'
        throw err
      }
      return new Response('{}', { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const ctrl = new AbortController()
    ctrl.abort()

    const result = await applyLLM(
      samplePayload,
      makeOpenAIConfig({ features: { title: true, severity: true, repro: true } }),
      { signal: ctrl.signal }
    )

    // Each feature still attempted (3 fetch calls); each catches abort and degrades.
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(result.title).toBeUndefined()
    expect(result.severity).toBeUndefined()
    expect(result.reproSteps).toBeUndefined()
    expect(result.degraded).toBe(true)
    expect(result.warnings?.length).toBe(3)
    expect(result.warnings?.every(w => /aborted/i.test(w))).toBe(true)
  })
})

// ─── tokens > maxTokens (no clamping) ───────────────────────────────────────

describe('applyLLM — tokensUsed accounting', () => {
  it('records tokensUsed > maxTokens as-is; budget sees the unclamped impact', async () => {
    const budget = createBudgetTracker(10_000)
    // maxTokens for title = 64, but provider claims 5000 used.
    stubFetchSequence([{ body: openaiBody('A title', 5000) }])

    const result = await applyLLM(
      samplePayload,
      makeOpenAIConfig({ features: { title: true } }),
      { budget }
    )

    expect(result.tokensUsed).toBe(5000)
    expect(budget.used()).toBe(5000)
  })
})

// ─── enabled: false absolutely never calls fetch ────────────────────────────

describe('applyLLM — disabled by config', () => {
  it('enabled:false makes ZERO fetch calls even with all features set', async () => {
    const fetchSpy = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchSpy)

    const result = await applyLLM(samplePayload, {
      enabled: false,
      provider: 'openai',
      apiKey: 'sk-test',
      features: { title: true, severity: true, repro: true, redact: true },
    })

    expect(fetchSpy).toHaveBeenCalledTimes(0)
    expect(result).toEqual({ tokensUsed: 0, degraded: false })
  })
})

// ─── budget=0 falls back on every feature ───────────────────────────────────

describe('applyLLM — zero budget', () => {
  it('dailyTokens:0 + budget passed in skips every feature with budget warnings', async () => {
    const budget = createBudgetTracker(0)
    const fetchSpy = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchSpy)

    const result = await applyLLM(
      samplePayload,
      makeOpenAIConfig({ features: { title: true, severity: true, repro: true } }),
      { budget }
    )

    expect(fetchSpy).toHaveBeenCalledTimes(0)
    expect(result.title).toBeUndefined()
    expect(result.severity).toBeUndefined()
    expect(result.reproSteps).toBeUndefined()
    expect(result.degraded).toBe(true)
    expect(result.warnings?.length).toBe(3)
    for (const w of result.warnings ?? []) {
      expect(w).toMatch(/budget exhausted/)
    }
  })
})

// ─── unsupported provider degrades cleanly ──────────────────────────────────

describe('applyLLM — unsupported provider', () => {
  it('provider:"bedrock" returns no_provider warning, no fetch call', async () => {
    const fetchSpy = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchSpy)

    const result = await applyLLM(samplePayload, {
      enabled: true,
      provider: 'bedrock',
      features: { title: true },
    })

    expect(fetchSpy).toHaveBeenCalledTimes(0)
    expect(result.degraded).toBe(true)
    expect(result.warnings?.[0]).toMatch(/no_provider/)
  })
})
