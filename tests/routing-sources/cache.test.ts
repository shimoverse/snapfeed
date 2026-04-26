/**
 * Tests for cacheRoutingSource (in src/routing-sources/types.ts).
 *
 * Uses vi.useFakeTimers() so we can advance the polling interval
 * deterministically. The initial fetch is async — we await `refresh()` (or
 * a microtask flush) to be sure the result is in cache before asserting.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { cacheRoutingSource } from '../../src/routing-sources/types'
import type {
  RoutingSource,
  CachedRoutingSourceOptions,
} from '../../src/routing-sources/types'
import type { RoutingConfig } from '../../src/routing'

const sampleConfig: RoutingConfig = {
  routes: [{ match: '/x', to: { team: 'team-x' } }],
}

const fallbackConfig: RoutingConfig = {
  routes: [],
  default: { team: 'fallback' },
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function makeSource(
  fetchImpl: () => Promise<RoutingConfig | undefined>
): RoutingSource {
  return { name: 'mock', fetch: fetchImpl }
}

describe('cacheRoutingSource', () => {
  it('current() returns the config after a successful initial fetch', async () => {
    const source = makeSource(async () => sampleConfig)
    const cached = cacheRoutingSource({ source })
    // Drive the initial fetch via refresh() so we can await it deterministically.
    await cached.refresh()
    expect(cached.current()).toEqual(sampleConfig)
    cached.stop()
  })

  it('current() returns last-known-good when a later fetch returns undefined', async () => {
    let call = 0
    const source = makeSource(async () => {
      call += 1
      return call === 1 ? sampleConfig : undefined
    })
    const onError = vi.fn()
    const cached = cacheRoutingSource({ source, onError })

    await cached.refresh() // call 1 → success
    expect(cached.current()).toEqual(sampleConfig)

    await cached.refresh() // call 2 → undefined
    // Still last-known-good.
    expect(cached.current()).toEqual(sampleConfig)
    expect(onError).toHaveBeenCalled()
    cached.stop()
  })

  it('falls back to the supplied fallback when there is no last-known-good', async () => {
    const source = makeSource(async () => undefined)
    const cached = cacheRoutingSource({ source, fallback: fallbackConfig })
    await cached.refresh()
    expect(cached.current()).toEqual(fallbackConfig)
    cached.stop()
  })

  it('returns undefined when there is neither last-known-good nor fallback', async () => {
    const source = makeSource(async () => undefined)
    const cached = cacheRoutingSource({ source })
    await cached.refresh()
    expect(cached.current()).toBeUndefined()
    cached.stop()
  })

  it('calls onUpdate on every successful fetch', async () => {
    const onUpdate = vi.fn()
    const source = makeSource(async () => sampleConfig)
    const cached = cacheRoutingSource({ source, onUpdate })
    // The constructor kicks off an initial tick. Wait for it + an explicit refresh.
    await cached.refresh()
    await cached.refresh()
    // Initial tick + 2 refreshes = 3, but the timing of the initial tick
    // relative to refresh() is non-deterministic — we just need at least 2.
    expect(onUpdate.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(onUpdate).toHaveBeenLastCalledWith(sampleConfig)
    cached.stop()
  })

  it('calls onError when the source throws', async () => {
    const onError = vi.fn()
    const source = makeSource(async () => {
      throw new Error('boom')
    })
    const cached = cacheRoutingSource({
      source,
      onError,
      fallback: fallbackConfig,
    })
    await cached.refresh()
    // Initial tick may have also called onError; just assert at least once
    // and that the error message matches.
    expect(onError.mock.calls.length).toBeGreaterThanOrEqual(1)
    for (const [err] of onError.mock.calls) {
      expect(err.message).toBe('boom')
    }
    expect(cached.current()).toEqual(fallbackConfig)
    cached.stop()
  })

  it('refresh() triggers an immediate re-fetch', async () => {
    const fetchSpy = vi.fn(async () => sampleConfig)
    const source = makeSource(fetchSpy)
    const cached = cacheRoutingSource({ source, pollMs: 60_000 })
    // Allow the constructor's initial tick microtask to run.
    await Promise.resolve()
    await cached.refresh()
    await cached.refresh()
    // Initial tick + 2 explicit refreshes = 3 (we don't depend on whether the
    // initial tick has resolved by the time refresh is called; we just assert
    // the count is at least the explicit refreshes).
    expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(2)
    cached.stop()
  })

  it('stop() halts the polling interval', async () => {
    vi.useFakeTimers()
    const fetchSpy = vi.fn(async () => sampleConfig)
    const source = makeSource(fetchSpy)

    const cached = cacheRoutingSource({ source, pollMs: 1000 })
    // Let the initial tick land + the first schedule() be queued.
    await vi.advanceTimersByTimeAsync(0)
    cached.stop()

    const callsBefore = fetchSpy.mock.calls.length
    // Advance well past several intervals; no further fetch should fire.
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fetchSpy.mock.calls.length).toBe(callsBefore)
  })

  it('polls again after pollMs', async () => {
    vi.useFakeTimers()
    const fetchSpy = vi.fn(async () => sampleConfig)
    const source = makeSource(fetchSpy)
    const cached = cacheRoutingSource({ source, pollMs: 1000 })

    // Let the immediate initial tick resolve.
    await vi.advanceTimersByTimeAsync(0)
    const initialCalls = fetchSpy.mock.calls.length
    expect(initialCalls).toBeGreaterThanOrEqual(1)

    // Trigger a poll cycle.
    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(initialCalls)

    cached.stop()
  })
})

// ─── Exponential backoff on consecutive failures ────────────────────────────

describe('cacheRoutingSource — exponential backoff', () => {
  it('keeps polling at pollMs while failures stay at the threshold (3)', async () => {
    vi.useFakeTimers()
    let calls = 0
    const fetchSpy = vi.fn(async () => {
      calls += 1
      // Calls 1, 2, 3 fail; call 4 succeeds. Through call 3 we're AT the
      // threshold but haven't crossed it, so the interval stays at pollMs.
      if (calls <= 3) return undefined
      return sampleConfig
    })
    const source = makeSource(fetchSpy)
    const cached = cacheRoutingSource({ source, pollMs: 1000 })

    // Initial tick → call 1 (fail #1).
    await vi.advanceTimersByTimeAsync(0)
    expect(calls).toBe(1)

    // Tick at pollMs → call 2 (fail #2).
    await vi.advanceTimersByTimeAsync(1000)
    expect(calls).toBe(2)

    // Tick at pollMs → call 3 (fail #3, AT threshold). Next interval still pollMs.
    await vi.advanceTimersByTimeAsync(1000)
    expect(calls).toBe(3)

    // Tick at pollMs → call 4 (success), resets counter.
    await vi.advanceTimersByTimeAsync(1000)
    expect(calls).toBe(4)

    cached.stop()
  })

  it('doubles the interval after the 4th consecutive failure (capped at maxPollMs)', async () => {
    vi.useFakeTimers()
    const fetchSpy = vi.fn(async () => undefined) // always fails
    const source = makeSource(fetchSpy)
    const cached = cacheRoutingSource({
      source,
      pollMs: 1000,
      maxPollMs: 8000,
    })

    // Initial tick (fail #1).
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    // Calls 2, 3, 4 fire at pollMs each (still no backoff during/at threshold).
    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchSpy).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchSpy).toHaveBeenCalledTimes(4) // fail #4 → next interval doubles to 2000

    // 1000ms is no longer enough — wait should be 2000ms.
    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchSpy).toHaveBeenCalledTimes(4)
    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchSpy).toHaveBeenCalledTimes(5) // fail #5 → next 4000

    // 4000ms wait now.
    await vi.advanceTimersByTimeAsync(3999)
    expect(fetchSpy).toHaveBeenCalledTimes(5)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchSpy).toHaveBeenCalledTimes(6) // fail #6 → next 8000 (cap)

    // 8000ms cap.
    await vi.advanceTimersByTimeAsync(7999)
    expect(fetchSpy).toHaveBeenCalledTimes(6)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchSpy).toHaveBeenCalledTimes(7)

    // Already capped — another full 8000ms → call 8.
    await vi.advanceTimersByTimeAsync(8000)
    expect(fetchSpy).toHaveBeenCalledTimes(8)

    cached.stop()
  })

  it('resets backoff back to pollMs on first success', async () => {
    vi.useFakeTimers()
    let calls = 0
    const fetchSpy = vi.fn(async () => {
      calls += 1
      // Calls 1..5 fail, call 6 succeeds, then keep failing.
      if (calls === 6) return sampleConfig
      return undefined
    })
    const source = makeSource(fetchSpy)
    const cached = cacheRoutingSource({
      source,
      pollMs: 1000,
      maxPollMs: 8000,
    })

    // Drive failures 1..4 to cross the threshold.
    await vi.advanceTimersByTimeAsync(0)        // call 1, fail
    await vi.advanceTimersByTimeAsync(1000)     // call 2, fail
    await vi.advanceTimersByTimeAsync(1000)     // call 3, fail (== threshold)
    await vi.advanceTimersByTimeAsync(1000)     // call 4, fail (> threshold → next 2000)
    expect(calls).toBe(4)

    // Now interval is 2000ms.
    await vi.advanceTimersByTimeAsync(2000)     // call 5, fail (next 4000)
    expect(calls).toBe(5)

    // Call 6 fires after 4000ms and succeeds.
    await vi.advanceTimersByTimeAsync(4000)
    expect(calls).toBe(6)

    // After success the next interval should be pollMs (1000) again.
    await vi.advanceTimersByTimeAsync(999)
    expect(calls).toBe(6)
    await vi.advanceTimersByTimeAsync(1)
    expect(calls).toBe(7)                       // back at pollMs cadence

    cached.stop()
  })
})
