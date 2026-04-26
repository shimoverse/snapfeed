/**
 * Tests for src/network-capture.ts
 *
 * We fake `window`, `window.fetch`, and `window.XMLHttpRequest` per test
 * via vi.stubGlobal. The XHR fake exposes addEventListener so the capturer
 * can hook `loadend`; tests trigger `loadend` manually after `send` is
 * called.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import {
  installNetworkCapture,
  type NetworkRequestRecord,
} from '../src/network-capture'

// ─── Fake XHR ────────────────────────────────────────────────────────────────

class FakeXHR {
  static instances: FakeXHR[] = []
  method: string = 'GET'
  url: string = ''
  status: number = 0
  private listeners: Record<string, Array<() => void>> = {}

  constructor() {
    FakeXHR.instances.push(this)
  }

  open(method: string, url: string) {
    this.method = method
    this.url = url
  }

  send(_body?: unknown) {
    // Test code triggers `loadend` manually via finish().
  }

  addEventListener(type: string, fn: () => void) {
    ;(this.listeners[type] ||= []).push(fn)
  }

  removeEventListener(type: string, fn: () => void) {
    const list = this.listeners[type]
    if (!list) return
    this.listeners[type] = list.filter(l => l !== fn)
  }

  /** Test helper: simulate the response coming back. */
  finish(status: number) {
    this.status = status
    for (const fn of this.listeners['loadend'] ?? []) fn()
  }
}

// ─── Setup helpers ───────────────────────────────────────────────────────────

function stubBrowser(opts: {
  fetch?: typeof fetch
  xhr?: typeof XMLHttpRequest
} = {}) {
  const fetchFn =
    opts.fetch ??
    (vi.fn(async (_input: RequestInfo | URL) =>
      new Response('ok', { status: 200 })
    ) as unknown as typeof fetch)
  const XHR = opts.xhr ?? (FakeXHR as unknown as typeof XMLHttpRequest)
  vi.stubGlobal('window', { fetch: fetchFn, XMLHttpRequest: XHR })
  vi.stubGlobal('XMLHttpRequest', XHR)
  return { fetch: fetchFn, XHR }
}

afterEach(() => {
  vi.unstubAllGlobals()
  FakeXHR.instances = []
})

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('installNetworkCapture — SSR no-op', () => {
  beforeEach(() => {
    vi.stubGlobal('window', undefined)
  })

  it('returns a NetworkCapture whose getRecent() is empty when window is undefined', () => {
    const cap = installNetworkCapture()
    expect(cap.getRecent()).toEqual([])
    // uninstall must not throw either
    expect(() => cap.uninstall()).not.toThrow()
  })
})

describe('installNetworkCapture — fetch', () => {
  it('records method, url, status, and durationMs after a fetch', async () => {
    stubBrowser()
    const cap = installNetworkCapture()
    await window.fetch('https://api.example.com/users', { method: 'POST' })

    const recent = cap.getRecent()
    expect(recent).toHaveLength(1)
    expect(recent[0]).toMatchObject<Partial<NetworkRequestRecord>>({
      method: 'POST',
      url: 'https://api.example.com/users',
      status: 200,
      source: 'fetch',
    })
    expect(typeof recent[0]!.durationMs).toBe('number')
    expect(recent[0]!.durationMs).toBeGreaterThanOrEqual(0)
    cap.uninstall()
  })

  it('ring buffer keeps only the last `maxRequests` entries', async () => {
    stubBrowser()
    const cap = installNetworkCapture({ maxRequests: 3 })
    for (let i = 0; i < 5; i++) {
      await window.fetch(`https://api.example.com/r/${i}`)
    }
    const recent = cap.getRecent()
    expect(recent).toHaveLength(3)
    expect(recent.map(r => r.url)).toEqual([
      'https://api.example.com/r/2',
      'https://api.example.com/r/3',
      'https://api.example.com/r/4',
    ])
    cap.uninstall()
  })

  it('ignoreUrls skips matching URLs (call still executes)', async () => {
    const fetchSpy = vi.fn(
      async () => new Response('ok', { status: 200 })
    ) as unknown as typeof fetch
    stubBrowser({ fetch: fetchSpy })
    const cap = installNetworkCapture({ ignoreUrls: ['/analytics'] })

    await window.fetch('https://api.example.com/analytics/event')
    await window.fetch('https://api.example.com/users')

    const recent = cap.getRecent()
    expect(recent).toHaveLength(1)
    expect(recent[0]!.url).toBe('https://api.example.com/users')
    // The ignored call must still have actually been made.
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    cap.uninstall()
  })

  it('redactOrigins replaces origin with [REDACTED] but keeps path/query', async () => {
    stubBrowser()
    const cap = installNetworkCapture({ redactOrigins: ['secret.example.com'] })
    await window.fetch('https://secret.example.com/v1/users?token=abc')
    await window.fetch('https://public.example.com/v1/posts')

    const recent = cap.getRecent()
    expect(recent[0]!.url).toBe('[REDACTED]/v1/users?token=abc')
    expect(recent[1]!.url).toBe('https://public.example.com/v1/posts')
    cap.uninstall()
  })

  it('records status=0 and error message when fetch rejects', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error('network down')
    }) as unknown as typeof fetch
    stubBrowser({ fetch: fetchSpy })
    const cap = installNetworkCapture()

    await expect(window.fetch('https://api.example.com/x')).rejects.toThrow(
      'network down'
    )

    const recent = cap.getRecent()
    expect(recent).toHaveLength(1)
    expect(recent[0]!.status).toBe(0)
    expect(recent[0]!.error).toBe('network down')
    cap.uninstall()
  })

  it('uninstall() restores the original window.fetch', async () => {
    const original = vi.fn(
      async () => new Response('ok', { status: 200 })
    ) as unknown as typeof fetch
    stubBrowser({ fetch: original })
    const cap = installNetworkCapture()
    expect(window.fetch).not.toBe(original)
    cap.uninstall()
    expect(window.fetch).toBe(original)
  })

  it('invokes onCapture for every record', async () => {
    stubBrowser()
    const onCapture = vi.fn()
    const cap = installNetworkCapture({ onCapture })
    await window.fetch('https://api.example.com/x')
    expect(onCapture).toHaveBeenCalledTimes(1)
    expect(onCapture.mock.calls[0]![0]).toMatchObject({
      method: 'GET',
      url: 'https://api.example.com/x',
      status: 200,
    })
    cap.uninstall()
  })
})

describe('installNetworkCapture — XHR', () => {
  it('monkey-patches open/send and records the request after loadend', () => {
    stubBrowser()
    const cap = installNetworkCapture()

    const xhr = new (window as unknown as { XMLHttpRequest: typeof XMLHttpRequest })
      .XMLHttpRequest()
    xhr.open('GET', 'https://api.example.com/things')
    xhr.send()

    // Nothing recorded yet — waiting for loadend.
    expect(cap.getRecent()).toHaveLength(0)

    const fake = FakeXHR.instances[FakeXHR.instances.length - 1]!
    fake.finish(201)

    const recent = cap.getRecent()
    expect(recent).toHaveLength(1)
    expect(recent[0]).toMatchObject({
      method: 'GET',
      url: 'https://api.example.com/things',
      status: 201,
      source: 'xhr',
    })
    cap.uninstall()
  })

  it('uninstall() restores the original XHR.open and XHR.send', () => {
    stubBrowser()
    const originalOpen = FakeXHR.prototype.open
    const originalSend = FakeXHR.prototype.send
    const cap = installNetworkCapture()
    expect(FakeXHR.prototype.open).not.toBe(originalOpen)
    expect(FakeXHR.prototype.send).not.toBe(originalSend)
    cap.uninstall()
    expect(FakeXHR.prototype.open).toBe(originalOpen)
    expect(FakeXHR.prototype.send).toBe(originalSend)
  })
})

// ─── Cooperation with downstream patches ────────────────────────────────────

describe('installNetworkCapture — overlapping patches (cooperation)', () => {
  it('uninstall() does NOT clobber a downstream fetch wrapper installed AFTER snapfeed', async () => {
    const original = vi.fn(
      async () => new Response('ok', { status: 200 })
    ) as unknown as typeof fetch
    stubBrowser({ fetch: original })

    const cap = installNetworkCapture()
    const snapfeedWrapper = window.fetch
    expect(snapfeedWrapper).not.toBe(original)

    // Now a downstream library wraps on top of snapfeed (e.g. analytics).
    const downstream: typeof window.fetch = (input, init) =>
      snapfeedWrapper(input, init)
    window.fetch = downstream

    cap.uninstall()

    // Snapfeed left the chain alone — `downstream` is still the live fetch.
    // Restoring `original` here would have silently broken the downstream
    // library's instrumentation.
    expect(window.fetch).toBe(downstream)
  })

  it('uninstall() DOES restore when our wrapper is still the live window.fetch', async () => {
    const original = vi.fn(
      async () => new Response('ok', { status: 200 })
    ) as unknown as typeof fetch
    stubBrowser({ fetch: original })

    const cap = installNetworkCapture()
    expect(window.fetch).not.toBe(original)
    cap.uninstall()
    expect(window.fetch).toBe(original)
  })

  it('uninstall() does NOT clobber a downstream XHR.open/send wrap installed AFTER snapfeed', () => {
    stubBrowser()
    const cap = installNetworkCapture()
    const snapfeedOpen = FakeXHR.prototype.open
    const snapfeedSend = FakeXHR.prototype.send

    // Downstream library wraps on top of snapfeed.
    const downstreamOpen = function (
      this: XMLHttpRequest,
      ...args: unknown[]
    ) {
      return (snapfeedOpen as unknown as (...a: unknown[]) => unknown).apply(
        this,
        args
      )
    } as unknown as typeof FakeXHR.prototype.open
    const downstreamSend = function (
      this: XMLHttpRequest,
      ...args: unknown[]
    ) {
      return (snapfeedSend as unknown as (...a: unknown[]) => unknown).apply(
        this,
        args
      )
    } as unknown as typeof FakeXHR.prototype.send
    FakeXHR.prototype.open = downstreamOpen
    FakeXHR.prototype.send = downstreamSend

    cap.uninstall()

    expect(FakeXHR.prototype.open).toBe(downstreamOpen)
    expect(FakeXHR.prototype.send).toBe(downstreamSend)
  })
})
