/**
 * Tests for src/adapters/console.ts — consoleAdapter
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { consoleAdapter } from '../../src/adapters/console'
import type { FeedbackPayload } from '../../src/types'

const samplePayload: FeedbackPayload = {
  text: 'something is broken',
  appName: 'TestApp',
  pageUrl: 'https://example.com/page',
  pageName: 'Page',
  timestamp: '2026-01-01T00:00:00.000Z',
}

describe('consoleAdapter', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("uses console.log by default with pretty-printed JSON", async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const adapter = consoleAdapter()
    const result = await adapter.send(samplePayload)

    expect(result).toEqual({ ok: true })
    expect(adapter.name).toBe('console')
    expect(spy).toHaveBeenCalledTimes(1)
    const [tag, body] = spy.mock.calls[0]!
    expect(tag).toBe('[devtools/feedback]')
    expect(typeof body).toBe('string')
    // Pretty JSON has newlines + indentation
    expect(body as string).toContain('\n')
    expect(body as string).toContain('  ')
    // And contains the payload text
    expect(body as string).toContain('something is broken')
  })

  it('uses console.info when level: "info"', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const adapter = consoleAdapter({ level: 'info' })

    const result = await adapter.send(samplePayload)
    expect(result).toEqual({ ok: true })
    expect(infoSpy).toHaveBeenCalledTimes(1)
    expect(logSpy).not.toHaveBeenCalled()
  })

  it('uses console.warn when level: "warn"', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const adapter = consoleAdapter({ level: 'warn' })
    await adapter.send(samplePayload)
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })

  it('uses console.debug when level: "debug"', async () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const adapter = consoleAdapter({ level: 'debug' })
    await adapter.send(samplePayload)
    expect(debugSpy).toHaveBeenCalledTimes(1)
  })

  it('passes the raw object (not stringified) when pretty: false', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const adapter = consoleAdapter({ pretty: false })
    await adapter.send(samplePayload)

    expect(spy).toHaveBeenCalledTimes(1)
    const [tag, body] = spy.mock.calls[0]!
    expect(tag).toBe('[devtools/feedback]')
    // Raw object, not a string
    expect(typeof body).toBe('object')
    expect(body).toBe(samplePayload)
  })

  it('returns { ok: true }', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const adapter = consoleAdapter()
    const result = await adapter.send(samplePayload)
    expect(result.ok).toBe(true)
  })
})
