/**
 * Tests for src/llm/index.ts (the runner — `applyLLM`).
 *
 * This is the integration surface for the LLM module. It must:
 *   1. Be a no-op when `enabled: false` (no fetch call).
 *   2. Run only the features the consumer opted into.
 *   3. Degrade gracefully — one feature failing never throws out.
 *   4. Respect the budget tracker (skip + warn when exhausted).
 *   5. Apply pre-LLM redaction to text before it hits the provider.
 *
 * We mock the provider at the function level (passing a fake provider
 * via a stubbed `createProvider`-equivalent path is messy, so instead we
 * stub the global `fetch` used by the OpenAI provider). This exercises
 * the runner's HTTP path end-to-end.
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

/**
 * Build a fetch stub that returns a different OpenAI response on each call,
 * cycling through the provided list. The runner calls fetch once per
 * enabled feature; tests pass one response per expected call.
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

function openaiResponse(content: string, total_tokens = 50) {
  return {
    body: {
      choices: [{ message: { content } }],
      usage: { total_tokens },
    },
  }
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ─── enabled toggle ──────────────────────────────────────────────────────────

describe('applyLLM — enabled toggle', () => {
  it('returns a no-op result and does NOT call fetch when enabled: false', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await applyLLM(samplePayload, {
      enabled: false,
      provider: 'openai',
      apiKey: 'sk-test',
      features: { title: true, severity: true, repro: true },
    })

    expect(result).toEqual({ tokensUsed: 0, degraded: false })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns a no-op result when enabled but no features set', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await applyLLM(samplePayload, makeOpenAIConfig())
    expect(result.tokensUsed).toBe(0)
    expect(result.degraded).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// ─── per-feature execution ───────────────────────────────────────────────────

describe('applyLLM — single features', () => {
  it('returns a title when features.title is on', async () => {
    stubFetchSequence([openaiResponse('Checkout button is unresponsive on payment', 30)])

    const result = await applyLLM(
      samplePayload,
      makeOpenAIConfig({ features: { title: true } })
    )

    expect(result.title).toBe('Checkout button is unresponsive on payment')
    expect(result.tokensUsed).toBe(30)
    expect(result.degraded).toBe(false)
  })

  it('strips surrounding quotes from a title response', async () => {
    stubFetchSequence([openaiResponse('"Checkout button broken"', 12)])

    const result = await applyLLM(
      samplePayload,
      makeOpenAIConfig({ features: { title: true } })
    )

    expect(result.title).toBe('Checkout button broken')
  })

  it('returns severity when features.severity is on', async () => {
    stubFetchSequence([openaiResponse('p1', 8)])

    const result = await applyLLM(
      samplePayload,
      makeOpenAIConfig({ features: { severity: true } })
    )

    expect(result.severity).toBe('p1')
    expect(result.tokensUsed).toBe(8)
  })

  it('returns reproSteps when features.repro is on', async () => {
    const fetchMock = stubFetchSequence([
      openaiResponse(
        '["Open checkout", "Click pay button", "Observe nothing happens"]',
        40
      ),
    ])

    const result = await applyLLM(
      samplePayload,
      makeOpenAIConfig({ features: { repro: true } })
    )

    expect(result.reproSteps).toEqual([
      'Open checkout',
      'Click pay button',
      'Observe nothing happens',
    ])

    // Repro user message must include console errors — they're often the
    // strongest reproduction signal.
    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body as string)
    const userMsg = body.messages.find(
      (m: { role: string; content: string }) => m.role === 'user'
    ).content as string
    expect(userMsg).toContain('Console errors:')
    expect(userMsg).toContain('TypeError: cannot read property of undefined at pay.js:42')
  })

  it('parses repro steps wrapped in a ```json fence', async () => {
    stubFetchSequence([
      openaiResponse('```json\n["step one", "step two"]\n```', 20),
    ])

    const result = await applyLLM(
      samplePayload,
      makeOpenAIConfig({ features: { repro: true } })
    )

    expect(result.reproSteps).toEqual(['step one', 'step two'])
  })
})

// ─── all features together ───────────────────────────────────────────────────

describe('applyLLM — multiple features', () => {
  it('runs all 3 features and sums tokens', async () => {
    const fetchMock = stubFetchSequence([
      openaiResponse('Checkout button broken', 30),
      openaiResponse('p1', 10),
      openaiResponse('["go to checkout", "click pay"]', 25),
    ])

    const result = await applyLLM(
      samplePayload,
      makeOpenAIConfig({ features: { title: true, severity: true, repro: true } })
    )

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(result.title).toBe('Checkout button broken')
    expect(result.severity).toBe('p1')
    expect(result.reproSteps).toEqual(['go to checkout', 'click pay'])
    expect(result.tokensUsed).toBe(65)
    expect(result.degraded).toBe(false)
  })
})

// ─── independent failure / degradation ───────────────────────────────────────

describe('applyLLM — degradation', () => {
  it('keeps running other features when one throws, marks degraded', async () => {
    // title call fails (500), severity + repro succeed
    const fetchMock = stubFetchSequence([
      { status: 500, body: { error: 'boom' } },
      openaiResponse('p2', 8),
      openaiResponse('["look", "see"]', 12),
    ])

    const result = await applyLLM(
      samplePayload,
      makeOpenAIConfig({ features: { title: true, severity: true, repro: true } })
    )

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(result.title).toBeUndefined()
    expect(result.severity).toBe('p2')
    expect(result.reproSteps).toEqual(['look', 'see'])
    expect(result.degraded).toBe(true)
    expect(result.warnings?.some(w => w.startsWith('title:'))).toBe(true)
  })

  it('handles transport errors (fetch rejects) without throwing out', async () => {
    stubFetchSequence([{ throws: new Error('ECONNREFUSED') }])

    const result = await applyLLM(
      samplePayload,
      makeOpenAIConfig({ features: { title: true } })
    )

    expect(result.title).toBeUndefined()
    expect(result.degraded).toBe(true)
    expect(result.warnings?.[0]).toMatch(/title: ECONNREFUSED/)
  })
})

// ─── budget enforcement ─────────────────────────────────────────────────────

describe('applyLLM — budget', () => {
  it('skips a feature when the budget is already exhausted, warns, but tries the next one', async () => {
    const budget = createBudgetTracker(40)
    // pre-consume to leave less than the per-call estimate (512)
    budget.record(40)

    const fetchMock = stubFetchSequence([openaiResponse('p0', 5)])

    const result = await applyLLM(
      samplePayload,
      makeOpenAIConfig({ features: { title: true, severity: true } }),
      { budget }
    )

    // First feature (title) skipped; second (severity) also skipped because
    // budget is still 0 remaining. Both should warn.
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.title).toBeUndefined()
    expect(result.severity).toBeUndefined()
    expect(result.degraded).toBe(true)
    expect(
      result.warnings?.some(w => w.includes('title') && w.includes('budget'))
    ).toBe(true)
    expect(
      result.warnings?.some(w => w.includes('severity') && w.includes('budget'))
    ).toBe(true)
  })

  it('records consumed tokens against the budget after each call', async () => {
    const budget = createBudgetTracker(10_000)
    stubFetchSequence([
      openaiResponse('A title', 100),
      openaiResponse('p1', 50),
    ])

    const result = await applyLLM(
      samplePayload,
      makeOpenAIConfig({ features: { title: true, severity: true } }),
      { budget }
    )

    expect(result.tokensUsed).toBe(150)
    expect(budget.used()).toBe(150)
  })
})

// ─── pre-LLM redaction ──────────────────────────────────────────────────────

describe('applyLLM — pre-LLM redaction', () => {
  it('redacts emails in payload.text before sending to provider', async () => {
    const fetchMock = stubFetchSequence([openaiResponse('Some title', 10)])

    const payloadWithEmail: FeedbackPayload = {
      ...samplePayload,
      text: 'Bug — please contact ananya@company.com about this',
      metadata: {
        viewport: '1440x900',
        userAgent: 'Mozilla/5.0',
        consoleErrors: [],
      },
    }

    await applyLLM(
      payloadWithEmail,
      makeOpenAIConfig({
        features: { title: true },
        redactBeforeLLM: true,
      })
    )

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body as string)
    const userMsg = body.messages.find(
      (m: { role: string; content: string }) => m.role === 'user'
    ).content as string

    expect(userMsg).toContain('[EMAIL]')
    expect(userMsg).not.toContain('ananya@company.com')
  })

  it('does NOT redact when redactBeforeLLM is false', async () => {
    const fetchMock = stubFetchSequence([openaiResponse('A title', 10)])

    const payloadWithEmail: FeedbackPayload = {
      ...samplePayload,
      text: 'Bug — please contact ananya@company.com about this',
    }

    await applyLLM(
      payloadWithEmail,
      makeOpenAIConfig({ features: { title: true }, redactBeforeLLM: false })
    )

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body as string)
    const userMsg = body.messages.find(
      (m: { role: string; content: string }) => m.role === 'user'
    ).content as string

    expect(userMsg).toContain('ananya@company.com')
  })
})
