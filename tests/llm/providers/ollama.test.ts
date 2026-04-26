/**
 * Tests for src/llm/providers/ollama.ts
 *
 * fetch is mocked. Ollama is local — no auth header. Body uses the
 * `/api/chat` endpoint with a `messages` array (so each model's chat
 * template is applied) and `stream: false`. Response text comes back as
 * `message.content`; tokens as `eval_count + prompt_eval_count`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ollamaProvider } from '../../../src/llm/providers/ollama'
import type { LLMConfig } from '../../../src/llm/types'

const baseConfig: LLMConfig = {
  enabled: true,
  provider: 'ollama',
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

beforeEach(() => {
  vi.unstubAllGlobals()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ollamaProvider', () => {
  it('POSTs to the default localhost /api/chat endpoint with no auth header', async () => {
    mockOk({
      message: { role: 'assistant', content: 'hi' },
      eval_count: 4,
      prompt_eval_count: 6,
    })
    const provider = ollamaProvider(baseConfig)
    await provider.complete({ system: 's', user: 'u' })

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:11434/api/chat')
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers['authorization']).toBeUndefined()
    expect(headers['x-api-key']).toBeUndefined()
    expect(headers['content-type']).toBe('application/json')
  })

  it('sets stream: false in the request body', async () => {
    mockOk({
      message: { role: 'assistant', content: 'ok' },
      eval_count: 1,
      prompt_eval_count: 1,
    })
    const provider = ollamaProvider(baseConfig)
    await provider.complete({ system: 's', user: 'u' })

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body as string)
    expect(body.stream).toBe(false)
  })

  it('sends system + user as a role-tagged messages array (not a flat prompt)', async () => {
    mockOk({
      message: { role: 'assistant', content: 'ok' },
      eval_count: 1,
      prompt_eval_count: 1,
    })
    const provider = ollamaProvider(baseConfig)
    await provider.complete({ system: 'be brief', user: 'hi there' })

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body as string)
    expect(body.prompt).toBeUndefined()
    expect(body.messages).toEqual([
      { role: 'system', content: 'be brief' },
      { role: 'user', content: 'hi there' },
    ])
  })

  it('uses the default model when none specified', async () => {
    mockOk({
      message: { role: 'assistant', content: 'ok' },
      eval_count: 1,
      prompt_eval_count: 1,
    })
    const provider = ollamaProvider(baseConfig)
    await provider.complete({ system: 's', user: 'u' })

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body as string)
    expect(body.model).toBe('llama3')
  })

  it('parses message.content as text', async () => {
    mockOk({
      message: { role: 'assistant', content: 'the answer' },
      eval_count: 5,
      prompt_eval_count: 5,
    })
    const provider = ollamaProvider(baseConfig)
    const out = await provider.complete({ system: 's', user: 'u' })
    expect(out.text).toBe('the answer')
  })

  it('reports tokensUsed = eval_count + prompt_eval_count', async () => {
    mockOk({
      message: { role: 'assistant', content: 'x' },
      eval_count: 17,
      prompt_eval_count: 23,
    })
    const provider = ollamaProvider(baseConfig)
    const out = await provider.complete({ system: 's', user: 'u' })
    expect(out.tokensUsed).toBe(40)
  })

  it('respects a custom endpoint (e.g. remote Ollama in tenant)', async () => {
    mockOk({
      message: { role: 'assistant', content: 'ok' },
      eval_count: 1,
      prompt_eval_count: 1,
    })
    const provider = ollamaProvider({
      ...baseConfig,
      endpoint: 'http://ollama.internal:11434/api/chat',
    })
    await provider.complete({ system: 's', user: 'u' })

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    const [url] = fetchMock.mock.calls[0]
    expect(url).toBe('http://ollama.internal:11434/api/chat')
  })
})
