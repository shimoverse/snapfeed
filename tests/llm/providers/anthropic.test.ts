/**
 * Tests for src/llm/providers/anthropic.ts
 *
 * fetch is mocked. We assert request shape (URL, headers, body) and parse
 * the response into { text, tokensUsed } correctly.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { anthropicProvider } from '../../../src/llm/providers/anthropic'
import type { LLMConfig } from '../../../src/llm/types'

const baseConfig: LLMConfig = {
  enabled: true,
  provider: 'anthropic',
  apiKey: 'sk-ant-test',
}

function mockOk(body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )
  )
}

function mockStatus(status: number, body = ''): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(body, { status }))
  )
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('anthropicProvider', () => {
  it('POSTs to the default endpoint with x-api-key + anthropic-version headers', async () => {
    mockOk({
      content: [{ type: 'text', text: 'hello' }],
      usage: { input_tokens: 5, output_tokens: 7 },
    })
    const provider = anthropicProvider(baseConfig)
    await provider.complete({ system: 's', user: 'u' })

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers['x-api-key']).toBe('sk-ant-test')
    expect(headers['anthropic-version']).toBe('2023-06-01')
    expect(headers['content-type']).toBe('application/json')
  })

  it('respects a custom endpoint', async () => {
    mockOk({
      content: [{ text: 'ok' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    })
    const provider = anthropicProvider({
      ...baseConfig,
      endpoint: 'https://proxy.example.com/v1/messages',
    })
    await provider.complete({ system: 's', user: 'u' })

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    const [url] = fetchMock.mock.calls[0]
    expect(url).toBe('https://proxy.example.com/v1/messages')
  })

  it('uses the default model when none specified', async () => {
    mockOk({
      content: [{ text: 'ok' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    })
    const provider = anthropicProvider(baseConfig)
    await provider.complete({ system: 's', user: 'u' })

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body as string)
    expect(body.model).toBe('claude-haiku-4-5-20251001')
  })

  it('uses a custom model when provided', async () => {
    mockOk({
      content: [{ text: 'ok' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    })
    const provider = anthropicProvider({ ...baseConfig, model: 'claude-opus-4' })
    await provider.complete({ system: 's', user: 'u' })

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body as string)
    expect(body.model).toBe('claude-opus-4')
  })

  it('parses content[0].text correctly', async () => {
    mockOk({
      content: [{ type: 'text', text: 'the answer' }],
      usage: { input_tokens: 3, output_tokens: 4 },
    })
    const provider = anthropicProvider(baseConfig)
    const out = await provider.complete({ system: 's', user: 'u' })
    expect(out.text).toBe('the answer')
  })

  it('reports tokensUsed = input_tokens + output_tokens', async () => {
    mockOk({
      content: [{ text: 'x' }],
      usage: { input_tokens: 11, output_tokens: 22 },
    })
    const provider = anthropicProvider(baseConfig)
    const out = await provider.complete({ system: 's', user: 'u' })
    expect(out.tokensUsed).toBe(33)
  })

  it('throws on non-2xx so the runner can degrade', async () => {
    mockStatus(401, 'unauthorized')
    const provider = anthropicProvider(baseConfig)
    await expect(provider.complete({ system: 's', user: 'u' })).rejects.toThrow(
      /anthropic/
    )
  })

  it('sends the system + user message in the body', async () => {
    mockOk({
      content: [{ text: 'ok' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    })
    const provider = anthropicProvider(baseConfig)
    await provider.complete({ system: 'be brief', user: 'hi there' })

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body as string)
    expect(body.system).toBe('be brief')
    expect(body.messages).toEqual([{ role: 'user', content: 'hi there' }])
  })
})
