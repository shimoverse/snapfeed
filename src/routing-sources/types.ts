/**
 * snapfeed — Tier 2 Routing Sources
 *
 * Tier 1 (`src/routing.ts`) is a static config object you import. Tier 2 fetches
 * the same `RoutingConfig` shape from a remote source — a CSV file, a Google
 * Sheet, eventually Postgres / Notion / etc. — so non-engineers can edit
 * routing without a deploy.
 *
 * `RoutingSource` is the minimal contract every backend implements:
 *   - `name`: short identifier for logs / audit
 *   - `fetch()`: returns the latest config, or `undefined` on transient failure
 *
 * Implementations MUST NOT throw on transient failures (network blip, missing
 * file, auth glitch). Returning `undefined` lets `cacheRoutingSource` fall
 * back to last-known-good or the supplied file-based fallback. We only want
 * exceptions to bubble for genuinely unrecoverable bugs (bad input shape).
 *
 * `cacheRoutingSource` is the runtime wrapper: it polls the source, holds the
 * last good value in memory, and exposes a synchronous `current()` so request
 * handlers don't pay an I/O hop on every feedback dispatch.
 */

import type { RoutingConfig } from '../routing'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RoutingSource {
  name: string
  /**
   * Fetch the latest config. Implementations should NOT throw on transient
   * failures — they should return undefined and let the caller fall back to a
   * cached or file-based config.
   */
  fetch(): Promise<RoutingConfig | undefined>
}

export interface CachedRoutingSourceOptions {
  /** Underlying source to wrap. */
  source: RoutingSource
  /**
   * How often to poll, in ms.
   * @default 5 * 60 * 1000 (5 min)
   */
  pollMs?: number
  /**
   * Fallback used when fetch() returns undefined or throws. Last-known-good is
   * preferred over fallback.
   */
  fallback?: RoutingConfig
  /** Called after each successful fetch. */
  onUpdate?: (config: RoutingConfig) => void
  /** Called when fetch fails (transient or thrown). */
  onError?: (error: Error) => void
}

export interface CachedRoutingSource {
  /**
   * Returns the most recent config (last-known-good, or fallback, or
   * undefined). Synchronous — safe to call from a hot path.
   */
  current(): RoutingConfig | undefined
  /** Force an immediate re-fetch. */
  refresh(): Promise<RoutingConfig | undefined>
  /** Stop polling. */
  stop(): void
}

// ─── Public API ───────────────────────────────────────────────────────────────

const DEFAULT_POLL_MS = 5 * 60 * 1000

export function cacheRoutingSource(
  options: CachedRoutingSourceOptions
): CachedRoutingSource {
  const { source, pollMs = DEFAULT_POLL_MS, fallback, onUpdate, onError } = options

  let lastGood: RoutingConfig | undefined = undefined
  let stopped = false

  const tick = async (): Promise<RoutingConfig | undefined> => {
    try {
      const next = await source.fetch()
      if (next === undefined) {
        // Transient failure — surface as an error so callers can log/alert.
        onError?.(new Error(`${source.name}: fetch returned undefined`))
        return lastGood ?? fallback
      }
      lastGood = next
      onUpdate?.(next)
      return next
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      onError?.(error)
      return lastGood ?? fallback
    }
  }

  // Kick off the initial fetch immediately. We deliberately do NOT await it
  // here — `cacheRoutingSource` is synchronous so it can be used at module
  // scope. Callers who need the first value can `await refresh()`.
  void tick()

  const interval = setInterval(() => {
    if (stopped) return
    void tick()
  }, pollMs)

  // Don't keep the Node process alive just because we're polling.
  if (typeof (interval as { unref?: () => void }).unref === 'function') {
    ;(interval as { unref: () => void }).unref()
  }

  return {
    current(): RoutingConfig | undefined {
      return lastGood ?? fallback
    },
    async refresh(): Promise<RoutingConfig | undefined> {
      return tick()
    },
    stop(): void {
      stopped = true
      clearInterval(interval)
    },
  }
}
