/**
 * snapfeed — Network Capture
 *
 * Browser-side network log capturer. Patches `window.fetch` and
 * `XMLHttpRequest` to record the last N requests with status codes and
 * timing. v0.4 records only method + url + status + duration; request
 * body and headers are intentionally NOT captured. A future version can
 * opt in to body capture with masking.
 *
 * Sensitive parts of the URL (origin) can be redacted via `redactOrigins`,
 * and entire requests can be skipped via `ignoreUrls` (e.g. analytics
 * endpoints that would otherwise drown the buffer).
 *
 * No-ops on the server (`typeof window === 'undefined'`).
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NetworkRequestRecord {
  /** Sequential id assigned at capture time. */
  id: number
  /** ISO timestamp of when the request started. */
  startedAt: string
  /** HTTP method. */
  method: string
  /** Full URL with origin (origin redacted if `redactOrigins` matches). */
  url: string
  /** Response status code, or 0 on network error. */
  status: number
  /** Time from start to response received, in ms. */
  durationMs: number
  /** Set when the request never completed (network error, abort, timeout). */
  error?: string
  /** Source: 'fetch' | 'xhr'. */
  source: 'fetch' | 'xhr'
}

export interface NetworkCaptureOptions {
  /** Ring buffer size. @default 20 */
  maxRequests?: number
  /** Redact (replace with `[REDACTED]`) the origin of URLs matching these patterns. */
  redactOrigins?: (string | RegExp)[]
  /** Skip requests to URLs matching these patterns entirely (e.g. analytics endpoints). */
  ignoreUrls?: (string | RegExp)[]
  /** Hook called for every captured request. */
  onCapture?: (record: NetworkRequestRecord) => void
}

export interface NetworkCapture {
  /** Returns a snapshot of the buffer (oldest to newest). */
  getRecent(): NetworkRequestRecord[]
  /** Restore original fetch/XHR. Call when unmounting. */
  uninstall(): void
}

// ─── Public API ───────────────────────────────────────────────────────────────

const DEFAULT_MAX_REQUESTS = 20

/**
 * Patch window.fetch and XMLHttpRequest to record outgoing HTTP traffic.
 * Returns a NetworkCapture handle. Call uninstall() to restore originals.
 *
 * No-ops on the server (typeof window === 'undefined').
 */
export function installNetworkCapture(
  options: NetworkCaptureOptions = {}
): NetworkCapture {
  // SSR no-op — return an inert handle so callers don't have to guard.
  if (typeof window === 'undefined') {
    return {
      getRecent: () => [],
      uninstall: () => undefined,
    }
  }

  const maxRequests = options.maxRequests ?? DEFAULT_MAX_REQUESTS
  const ignoreUrls = options.ignoreUrls ?? []
  const redactOrigins = options.redactOrigins ?? []
  const onCapture = options.onCapture

  const buffer: NetworkRequestRecord[] = []
  let nextId = 1

  function shouldIgnore(url: string): boolean {
    return ignoreUrls.some(p => matches(p, url))
  }

  function processUrl(url: string): string {
    if (redactOrigins.length === 0) return url
    const matched = redactOrigins.some(p => matches(p, url))
    if (!matched) return url
    return redactOrigin(url)
  }

  function record(rec: NetworkRequestRecord) {
    buffer.push(rec)
    while (buffer.length > maxRequests) buffer.shift()
    if (onCapture) {
      try {
        onCapture(rec)
      } catch {
        // Never let a hook break the host page.
      }
    }
  }

  // ─── fetch ──────────────────────────────────────────────────────────────
  // Cooperation with other instrumentation: we wrap the *current* `window.fetch`
  // and only restore it on uninstall if it's still our wrapper. If a downstream
  // library has installed its own wrapper on top of ours, we leave the chain
  // alone — clobbering it would silently break analytics, observability tools,
  // mock-fetch helpers, etc. that wrapped after we did.
  const originalFetch = window.fetch
  const boundFetch = originalFetch ? originalFetch.bind(window) : undefined
  let wrappedFetch: typeof window.fetch | undefined

  if (originalFetch && boundFetch) {
    wrappedFetch = async (input, init) => {
      const method =
        (init?.method ?? (typeof input !== 'string' && 'method' in (input as Request)
          ? (input as Request).method
          : 'GET')) || 'GET'
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
          ? input.toString()
          : (input as Request).url

      if (shouldIgnore(url)) {
        return boundFetch(input as RequestInfo, init)
      }

      const id = nextId++
      const startedAt = new Date().toISOString()
      const start = nowMs()

      try {
        const res = await originalFetch(input as RequestInfo, init)
        record({
          id,
          startedAt,
          method: method.toUpperCase(),
          url: processUrl(url),
          status: res.status,
          durationMs: Math.round(nowMs() - start),
          source: 'fetch',
        })
        return res
      } catch (e) {
        const err = e as Error
        record({
          id,
          startedAt,
          method: method.toUpperCase(),
          url: processUrl(url),
          status: 0,
          durationMs: Math.round(nowMs() - start),
          error: err?.message ?? String(e),
          source: 'fetch',
        })
        throw e
      }
    }

    window.fetch = wrappedFetch
  }

  // ─── XHR ────────────────────────────────────────────────────────────────
  const XHR = window.XMLHttpRequest
  const originalOpen = XHR?.prototype.open
  const originalSend = XHR?.prototype.send

  // Symbol-keyed state on the XHR instance — avoids name collisions and
  // lets us do `delete xhr[k]` cleanly.
  type XhrState = {
    method: string
    url: string
    id: number
    startedAt: string
    start: number
    ignored: boolean
  }
  const STATE_KEY = '__snapfeedNetCapState__'

  // Same cooperation pattern as for fetch — only restore on uninstall if our
  // wrappers are still the live methods, otherwise leave the chain alone.
  let wrappedOpen: typeof XHR.prototype.open | undefined
  let wrappedSend: typeof XHR.prototype.send | undefined

  if (XHR && originalOpen && originalSend) {
    wrappedOpen = function patchedOpen(
      this: XMLHttpRequest,
      method: string,
      url: string | URL,
      ...rest: unknown[]
    ) {
      const urlStr = typeof url === 'string' ? url : url.toString()
      const state: XhrState = {
        method: (method || 'GET').toUpperCase(),
        url: urlStr,
        id: 0,
        startedAt: '',
        start: 0,
        ignored: shouldIgnore(urlStr),
      }
      ;(this as unknown as Record<string, XhrState>)[STATE_KEY] = state
      return (originalOpen as unknown as (
        this: XMLHttpRequest,
        ...args: unknown[]
      ) => void).call(this, method, url as string, ...rest)
    } as typeof XHR.prototype.open

    wrappedSend = function patchedSend(
      this: XMLHttpRequest,
      body?: Document | XMLHttpRequestBodyInit | null
    ) {
      const state = (this as unknown as Record<string, XhrState>)[STATE_KEY]
      if (state && !state.ignored) {
        state.id = nextId++
        state.startedAt = new Date().toISOString()
        state.start = nowMs()

        const onLoadEnd = () => {
          record({
            id: state.id,
            startedAt: state.startedAt,
            method: state.method,
            url: processUrl(state.url),
            status: this.status || 0,
            durationMs: Math.round(nowMs() - state.start),
            error: this.status === 0 ? 'network error' : undefined,
            source: 'xhr',
          })
          this.removeEventListener('loadend', onLoadEnd)
        }
        this.addEventListener('loadend', onLoadEnd)
      }
      return (originalSend as unknown as (
        this: XMLHttpRequest,
        body?: Document | XMLHttpRequestBodyInit | null
      ) => void).call(this, body ?? null)
    } as typeof XHR.prototype.send

    XHR.prototype.open = wrappedOpen
    XHR.prototype.send = wrappedSend
  }

  // ─── Handle ─────────────────────────────────────────────────────────────
  return {
    getRecent: () => buffer.slice(),
    uninstall: () => {
      // Cooperative uninstall: only restore the original if our wrapper is
      // still the live method. If a downstream library has wrapped on top of
      // ours (common with analytics/observability tools that compose), we
      // leave their chain intact rather than clobbering it.
      if (originalFetch && wrappedFetch && window.fetch === wrappedFetch) {
        window.fetch = originalFetch
      }
      if (XHR && originalOpen && wrappedOpen && XHR.prototype.open === wrappedOpen) {
        XHR.prototype.open = originalOpen
      }
      if (XHR && originalSend && wrappedSend && XHR.prototype.send === wrappedSend) {
        XHR.prototype.send = originalSend
      }
    },
  }
}

// ─── Internals ────────────────────────────────────────────────────────────────

function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now()
  }
  return Date.now()
}

function matches(pattern: string | RegExp, value: string): boolean {
  if (typeof pattern === 'string') return value.includes(pattern)
  return pattern.test(value)
}

/**
 * Replace the origin of a URL with `[REDACTED]`, preserving path + query.
 * Falls back to returning the input unchanged for unparseable URLs.
 */
function redactOrigin(url: string): string {
  try {
    const u = new URL(url)
    return `[REDACTED]${u.pathname}${u.search}${u.hash}`
  } catch {
    return url
  }
}
