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
   * Upper bound for the exponential backoff applied after consecutive
   * failures. Once 3 fetches in a row have failed (returned undefined or
   * thrown), each subsequent failure doubles the next interval, capped at
   * `maxPollMs`. The cap resets to `pollMs` on the first success.
   * @default 60 * 60 * 1000 (1 hour)
   */
  maxPollMs?: number
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
const DEFAULT_MAX_POLL_MS = 60 * 60 * 1000
const BACKOFF_AFTER_N_FAILURES = 3

export function cacheRoutingSource(
  options: CachedRoutingSourceOptions
): CachedRoutingSource {
  const {
    source,
    pollMs = DEFAULT_POLL_MS,
    maxPollMs = DEFAULT_MAX_POLL_MS,
    fallback,
    onUpdate,
    onError,
  } = options

  let lastGood: RoutingConfig | undefined = undefined
  let stopped = false

  // Consecutive-failure counter drives the backoff. Once we've crossed
  // `BACKOFF_AFTER_N_FAILURES`, each further failure doubles the next
  // interval up to `maxPollMs`. Reset on first success.
  let consecutiveFailures = 0
  // Effective interval used to schedule the *next* tick. Resets to `pollMs`
  // on success.
  let currentIntervalMs = pollMs
  let timer: ReturnType<typeof setTimeout> | undefined

  const recordFailure = () => {
    consecutiveFailures += 1
    if (consecutiveFailures > BACKOFF_AFTER_N_FAILURES) {
      currentIntervalMs = Math.min(currentIntervalMs * 2, maxPollMs)
    }
  }

  const recordSuccess = () => {
    consecutiveFailures = 0
    currentIntervalMs = pollMs
  }

  const tick = async (): Promise<RoutingConfig | undefined> => {
    try {
      const next = await source.fetch()
      if (next === undefined) {
        // Transient failure — surface as an error so callers can log/alert.
        recordFailure()
        onError?.(new Error(`${source.name}: fetch returned undefined`))
        return lastGood ?? fallback
      }
      lastGood = next
      recordSuccess()
      onUpdate?.(next)
      return next
    } catch (err) {
      recordFailure()
      const error = err instanceof Error ? err : new Error(String(err))
      onError?.(error)
      return lastGood ?? fallback
    }
  }

  // Schedule the next tick using a recursive setTimeout so the interval can
  // grow with backoff. Compared to the previous setInterval-with-fixed-pollMs
  // approach, this lets us extend the gap when the source is unhealthy.
  const schedule = () => {
    if (stopped) return
    timer = setTimeout(async () => {
      if (stopped) return
      await tick()
      schedule()
    }, currentIntervalMs)
    // Don't keep the Node process alive just because we're polling.
    if (timer && typeof (timer as { unref?: () => void }).unref === 'function') {
      ;(timer as { unref: () => void }).unref()
    }
  }

  // Kick off the initial fetch immediately. We deliberately do NOT await it
  // here — `cacheRoutingSource` is synchronous so it can be used at module
  // scope. Callers who need the first value can `await refresh()`.
  void tick().then(() => schedule())

  return {
    current(): RoutingConfig | undefined {
      return lastGood ?? fallback
    },
    async refresh(): Promise<RoutingConfig | undefined> {
      return tick()
    },
    stop(): void {
      stopped = true
      if (timer) clearTimeout(timer)
    },
  }
}
