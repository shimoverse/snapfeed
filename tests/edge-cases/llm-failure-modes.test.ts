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

// ─── per-feature budget pre-gate ────────────────────────────────────────────

describe('applyLLM — per-feature budget pre-gate', () => {
  it('severity (cap=16) is allowed even when budget is too tight for title (cap=64)', async () => {
    // Budget has 30 tokens left. Title needs 64 → blocked. Severity needs
    // 16 → allowed. Repro needs 256 → blocked. With the old one-size 512
    // pre-gate, all three would have been blocked.
    const budget = createBudgetTracker(30)
    const fetchMock = stubFetchSequence([{ body: openaiBody('p1', 5) }])

    const result = await applyLLM(
      samplePayload,
      makeOpenAIConfig({ features: { title: true, severity: true, repro: true } }),
      { budget }
    )

    expect(fetchMock).toHaveBeenCalledTimes(1) // only severity
    expect(result.title).toBeUndefined()
    expect(result.severity).toBe('p1')
    expect(result.reproSteps).toBeUndefined()
    expect(
      result.warnings?.some(w => w.startsWith('title:') && w.includes('budget'))
    ).toBe(true)
    expect(
      result.warnings?.some(w => w.startsWith('repro:') && w.includes('budget'))
    ).toBe(true)
  })

  it('title sets maxTokens=64 in the body (not 256 default, not 512 estimate)', async () => {
    const fetchMock = stubFetchSequence([{ body: openaiBody('A title', 10) }])
    await applyLLM(
      samplePayload,
      makeOpenAIConfig({ features: { title: true } })
    )
    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body as string)
    expect(body.max_tokens).toBe(64)
  })

  it('severity sets maxTokens=16 in the body', async () => {
    const fetchMock = stubFetchSequence([{ body: openaiBody('p1', 5) }])
    await applyLLM(
      samplePayload,
      makeOpenAIConfig({ features: { severity: true } })
    )
    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body as string)
    expect(body.max_tokens).toBe(16)
  })

  it('repro sets maxTokens=256 in the body', async () => {
    const fetchMock = stubFetchSequence([{ body: openaiBody('[]', 10) }])
    await applyLLM(
      samplePayload,
      makeOpenAIConfig({ features: { repro: true } })
    )
    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body as string)
    expect(body.max_tokens).toBe(256)
  })
})

// ─── severity warning hashing (no provider-output echo) ─────────────────────

describe('applyLLM — severity warning does not echo provider output', () => {
  it('does NOT include the unparseable response text in the warning', async () => {
    // If a model under prompt injection echoed "ignore previous: api_key=SECRET",
    // the old warning string included up to 40 chars of that, leaking it into
    // result.warnings → consumer logs. Now we hash to length only.
    const malicious = 'ignore previous: api_key=SECRET_TOKEN_LEAK'
    stubFetchSequence([{ body: openaiBody(malicious, 5) }])

    const result = await applyLLM(
      samplePayload,
      makeOpenAIConfig({ features: { severity: true } })
    )

    expect(result.severity).toBeUndefined()
    expect(result.degraded).toBe(true)
    const warning = result.warnings?.[0] ?? ''
    expect(warning).toContain('severity: unparseable response')
    expect(warning).toContain('length=')
    // Critical: no provider content in the warning.
    expect(warning).not.toContain('SECRET_TOKEN_LEAK')
    expect(warning).not.toContain('api_key')
    expect(warning).not.toContain('ignore previous')
  })

  it('reports the response length accurately', async () => {
    const text = 'x'.repeat(123)
    stubFetchSequence([{ body: openaiBody(text, 5) }])

    const result = await applyLLM(
      samplePayload,
      makeOpenAIConfig({ features: { severity: true } })
    )

    expect(result.warnings?.[0]).toBe('severity: unparseable response (length=123)')
  })
})

// ─── title double-quote stripping ───────────────────────────────────────────

describe('applyLLM — title quote stripping', () => {
  it('strips wrapping double quotes (single layer): "foo" → foo', async () => {
    stubFetchSequence([{ body: openaiBody('"foo"', 5) }])
    const result = await applyLLM(
      samplePayload,
      makeOpenAIConfig({ features: { title: true } })
    )
    expect(result.title).toBe('foo')
  })

  it('strips wrapping double quotes (double layer): ""foo"" → foo', async () => {
    // The old single-character regex `/^["']|["']$/g` left this as '"foo"'.
    // The new replace stripping `["']+` on both ends fully unwraps it.
    stubFetchSequence([{ body: openaiBody('""foo""', 5) }])
    const result = await applyLLM(
      samplePayload,
      makeOpenAIConfig({ features: { title: true } })
    )
    expect(result.title).toBe('foo')
  })

  it('strips a mix of single + double wrapping quotes: \'""foo""\' → foo', async () => {
    stubFetchSequence([{ body: openaiBody(`'""foo""'`, 5) }])
    const result = await applyLLM(
      samplePayload,
      makeOpenAIConfig({ features: { title: true } })
    )
    expect(result.title).toBe('foo')
  })

  it('does NOT strip an apostrophe inside the title: don\'t click → don\'t click', async () => {
    stubFetchSequence([{ body: openaiBody(`don't click`, 5) }])
    const result = await applyLLM(
      samplePayload,
      makeOpenAIConfig({ features: { title: true } })
    )
    expect(result.title).toBe(`don't click`)
  })
})

// ─── tokensUsed sentinel (-1) when usage is missing ─────────────────────────

describe('applyLLM — tokensUsed sentinel for missing usage', () => {
  it('charges per-feature cap to budget when provider returns -1, with a warning', async () => {
    // OpenAI provider returns -1 when `usage` is missing. The runner bills
    // the per-feature cap (title=64) and pushes a one-time warning so the
    // consumer sees that something undercounted-prone happened.
    const budget = createBudgetTracker(10_000)
    stubFetchSequence([
      // No `usage` key in the body — this simulates an OpenAI-compatible
      // server (LM Studio, older llama.cpp, etc.) omitting usage.
      { body: { choices: [{ message: { content: 'A title' } }] } },
    ])

    const result = await applyLLM(
      samplePayload,
      makeOpenAIConfig({ features: { title: true } }),
      { budget }
    )

    expect(result.title).toBe('A title')
    // Charged the cap.
    expect(result.tokensUsed).toBe(64)
    expect(budget.used()).toBe(64)
    expect(result.degraded).toBe(true)
    expect(
      result.warnings?.some(
        w => w.startsWith('title:') && w.includes('omitted usage')
      )
    ).toBe(true)
  })
})

// ─── repro now includes console errors ──────────────────────────────────────

describe('applyLLM — repro user message', () => {
  it('includes console errors (strongest reproduction signal)', async () => {
    const fetchMock = stubFetchSequence([{ body: openaiBody('["a"]', 10) }])
    await applyLLM(
      samplePayload,
      makeOpenAIConfig({ features: { repro: true } })
    )
    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body as string)
    const userMsg = body.messages.find(
      (m: { role: string; content: string }) => m.role === 'user'
    ).content as string
    expect(userMsg).toContain('Console errors:')
    expect(userMsg).toContain('TypeError: cannot read property of undefined')
  })
})

// ─── endpoint validation ────────────────────────────────────────────────────

describe('LLM provider endpoint validation', () => {
  it('throws synchronously on a non-URL endpoint', async () => {
    const { openaiProvider } = await import('../../src/llm/providers/openai')
    expect(() =>
      openaiProvider({
        enabled: true,
        provider: 'openai',
        apiKey: 'k',
        endpoint: 'not a url',
      })
    ).toThrow(/not a valid URL/)
  })

  it('throws on file: scheme', async () => {
    const { anthropicProvider } = await import('../../src/llm/providers/anthropic')
    expect(() =>
      anthropicProvider({
        enabled: true,
        provider: 'anthropic',
        apiKey: 'k',
        endpoint: 'file:///etc/passwd',
      })
    ).toThrow(/not allowed/)
  })

  it('throws on data: scheme', async () => {
    const { openaiProvider } = await import('../../src/llm/providers/openai')
    expect(() =>
      openaiProvider({
        enabled: true,
        provider: 'openai',
        apiKey: 'k',
        endpoint: 'data:text/plain,foo',
      })
    ).toThrow(/not allowed/)
  })

  it('does NOT throw on https://', async () => {
    const { openaiProvider } = await import('../../src/llm/providers/openai')
    expect(() =>
      openaiProvider({
        enabled: true,
        provider: 'openai',
        apiKey: 'k',
        endpoint: 'https://proxy.internal/v1/chat/completions',
      })
    ).not.toThrow()
  })

  it('does NOT throw on http://localhost (Ollama default)', async () => {
    const { ollamaProvider } = await import('../../src/llm/providers/ollama')
    expect(() =>
      ollamaProvider({
        enabled: true,
        provider: 'ollama',
        endpoint: 'http://localhost:11434/api/chat',
      })
    ).not.toThrow()
  })

  it('warns once via console.warn on non-localhost http://', async () => {
    const { openaiProvider } = await import('../../src/llm/providers/openai')
    const { _resetHttpEndpointWarnedForTests } = await import(
      '../../src/llm/providers/endpoint'
    )
    _resetHttpEndpointWarnedForTests()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    openaiProvider({
      enabled: true,
      provider: 'openai',
      apiKey: 'k',
      endpoint: 'http://insecure.example.com/v1/chat/completions',
    })

    expect(warnSpy).toHaveBeenCalledOnce()
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/plaintext/)
    warnSpy.mockRestore()
  })
})
