/**
 * Edge-case coverage for src/llm/budget.ts (`createBudgetTracker`)
 * focused on clock manipulation and numeric corner cases.
 *
 * Day key = `new Date().toISOString().slice(0, 10)` — UTC ISO date.
 * Rollover happens lazily on the next allow/record/used call.
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { createBudgetTracker } from '../../src/llm/budget'

afterEach(() => {
  vi.useRealTimers()
})

describe('createBudgetTracker — UTC day boundary', () => {
  it('crosses 23:59:00 → 00:00:01 UTC and resets used() to 0', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-25T23:59:00Z'))

    const b = createBudgetTracker(500)
    b.record(100)
    expect(b.used()).toBe(100)
    expect(b.allow(401)).toBe(false)

    // Advance 61 seconds → next UTC day
    vi.setSystemTime(new Date('2026-04-26T00:00:01Z'))

    expect(b.used()).toBe(0)
    expect(b.allow(500)).toBe(true)
  })

  it('does NOT roll over within the same UTC day even after large jumps', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-25T00:00:01Z'))

    const b = createBudgetTracker(1000)
    b.record(400)
    expect(b.used()).toBe(400)

    // Jump 23 hours within the same UTC day
    vi.setSystemTime(new Date('2026-04-25T23:00:00Z'))

    expect(b.used()).toBe(400)
    expect(b.allow(600)).toBe(true)
    expect(b.allow(601)).toBe(false)
  })
})

describe('createBudgetTracker — negative tokens to record()', () => {
  it('record(negative) is silently ignored (used stays 0)', () => {
    // Source: `if (tokens > 0) consumed += tokens` — negatives drop on the floor.
    const b = createBudgetTracker(100)
    b.record(-50)
    b.record(-1_000_000)
    expect(b.used()).toBe(0)
  })

  it('record(negative) after a positive record does not subtract', () => {
    const b = createBudgetTracker(100)
    b.record(60)
    b.record(-30)
    expect(b.used()).toBe(60)
  })
})

describe('createBudgetTracker — concurrent records', () => {
  it('back-to-back awaited records all count; no race', async () => {
    const b = createBudgetTracker(10_000)

    await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        Promise.resolve().then(() => b.record(i + 1))
      )
    )

    // 1+2+...+50 = 1275
    expect(b.used()).toBe(1275)
  })

  it('parallel allow() + record() does not double-count', async () => {
    const b = createBudgetTracker(10_000)

    await Promise.all(
      Array.from({ length: 100 }, () =>
        Promise.resolve().then(() => {
          if (b.allow(10)) b.record(10)
        })
      )
    )

    // No real concurrency in JS single-thread — should land exactly at 1000.
    expect(b.used()).toBe(1000)
  })
})

describe('createBudgetTracker — Number.MAX_SAFE_INTEGER', () => {
  it('large dailyTokens does not overflow when allowing within range', () => {
    const b = createBudgetTracker(Number.MAX_SAFE_INTEGER)
    expect(b.allow(1_000_000)).toBe(true)
    expect(b.allow(Number.MAX_SAFE_INTEGER)).toBe(true)
    b.record(1_000_000)
    expect(b.used()).toBe(1_000_000)
    expect(b.allow(Number.MAX_SAFE_INTEGER - 1_000_000)).toBe(true)
  })

  it('large record values accumulate correctly', () => {
    const b = createBudgetTracker(Number.MAX_SAFE_INTEGER)
    b.record(1e15)
    b.record(1e15)
    expect(b.used()).toBe(2e15)
  })
})
