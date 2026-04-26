/**
 * Tests for src/llm/providers/openai.ts
 *
 * fetch is mocked. We assert request shape (URL, Authorization header,
 * messages body) and parse the response into { text, tokensUsed } correctly.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { openaiProvider } from '../../../src/llm/providers/openai'
import type { LLMConfig } from '../../../src/llm/types'

const baseConfig: LLMConfig = {
  enabled: true,
  provider: 'openai',
  apiKey: 'sk-test',
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

describe('openaiProvider', () => {
  it('POSTs to the default endpoint with Bearer auth', async () => {
    mockOk({
      choices: [{ message: { content: 'hi' } }],
      usage: { total_tokens: 10 },
    })
    const provider = openaiProvider(baseConfig)
    await provider.complete({ system: 's', user: 'u' })

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.openai.com/v1/chat/completions')
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers['authorization']).toBe('Bearer sk-test')
    expect(headers['content-type']).toBe('application/json')
  })

  it('respects a custom endpoint (e.g. Azure deployment URL)', async () => {
    mockOk({
      choices: [{ message: { content: 'ok' } }],
      usage: { total_tokens: 1 },
    })
    const provider = openaiProvider({
      ...baseConfig,
      endpoint: 'https://my-azure.openai.azure.com/v1/chat/completions',
    })
    await provider.complete({ system: 's', user: 'u' })

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    const [url] = fetchMock.mock.calls[0]
    expect(url).toBe('https://my-azure.openai.azure.com/v1/chat/completions')
  })

  it('uses the default model when none specified', async () => {
    mockOk({
      choices: [{ message: { content: 'ok' } }],
      usage: { total_tokens: 1 },
    })
    const provider = openaiProvider(baseConfig)
    await provider.complete({ system: 's', user: 'u' })

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body as string)
    expect(body.model).toBe('gpt-4o-mini')
  })

  it('passes through custom headers (e.g. OpenAI-Organization)', async () => {
    mockOk({
      choices: [{ message: { content: 'ok' } }],
      usage: { total_tokens: 1 },
    })
    const provider = openaiProvider({
      ...baseConfig,
      headers: { 'OpenAI-Organization': 'org-abc' },
    })
    await provider.complete({ system: 's', user: 'u' })

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    const [, init] = fetchMock.mock.calls[0]
    const headers = init.headers as Record<string, string>
    expect(headers['OpenAI-Organization']).toBe('org-abc')
  })

  it('parses choices[0].message.content correctly', async () => {
    mockOk({
      choices: [{ message: { content: 'the answer' } }],
      usage: { total_tokens: 12 },
    })
    const provider = openaiProvider(baseConfig)
    const out = await provider.complete({ system: 's', user: 'u' })
    expect(out.text).toBe('the answer')
  })

  it('reports tokensUsed = usage.total_tokens', async () => {
    mockOk({
      choices: [{ message: { content: 'x' } }],
      usage: { total_tokens: 99 },
    })
    const provider = openaiProvider(baseConfig)
    const out = await provider.complete({ system: 's', user: 'u' })
    expect(out.tokensUsed).toBe(99)
  })

  it('sends system + user as separate messages', async () => {
    mockOk({
      choices: [{ message: { content: 'ok' } }],
      usage: { total_tokens: 1 },
    })
    const provider = openaiProvider(baseConfig)
    await provider.complete({ system: 'be brief', user: 'hi there' })

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body as string)
    expect(body.messages).toEqual([
      { role: 'system', content: 'be brief' },
      { role: 'user', content: 'hi there' },
    ])
  })

  it('throws on non-2xx so the runner can degrade', async () => {
    mockStatus(429, 'rate limited')
    const provider = openaiProvider(baseConfig)
    await expect(provider.complete({ system: 's', user: 'u' })).rejects.toThrow(
      /openai/
    )
  })
})
