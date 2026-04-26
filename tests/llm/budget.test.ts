/**
 * Tests for src/llm/budget.ts
 *
 * Covers:
 *  - allow() before any record() returns true within budget
 *  - record() subtracts from remaining budget
 *  - day rollover (mock Date) resets the counter
 *  - dailyTokens=0 means nothing is ever allowed (fails closed)
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { createBudgetTracker } from '../../src/llm/budget'

describe('createBudgetTracker', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('allows tokens within budget before any record', () => {
    const b = createBudgetTracker(1000)
    expect(b.allow(100)).toBe(true)
    expect(b.allow(1000)).toBe(true)
    expect(b.allow(1001)).toBe(false)
    expect(b.used()).toBe(0)
  })

  it('record() subtracts from remaining budget', () => {
    const b = createBudgetTracker(1000)
    b.record(300)
    expect(b.used()).toBe(300)
    expect(b.allow(700)).toBe(true)
    expect(b.allow(701)).toBe(false)
    b.record(700)
    expect(b.used()).toBe(1000)
    expect(b.allow(1)).toBe(false)
  })

  it('resets when the UTC day rolls over', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-25T12:00:00Z'))

    const b = createBudgetTracker(500)
    b.record(500)
    expect(b.used()).toBe(500)
    expect(b.allow(1)).toBe(false)

    // Advance into the next UTC day
    vi.setSystemTime(new Date('2026-04-26T00:00:01Z'))

    expect(b.used()).toBe(0)
    expect(b.allow(500)).toBe(true)
    b.record(200)
    expect(b.used()).toBe(200)
  })

  it('fails closed when dailyTokens is 0', () => {
    const b = createBudgetTracker(0)
    expect(b.allow(0)).toBe(false)
    expect(b.allow(1)).toBe(false)
    expect(b.used()).toBe(0)
  })

  it('treats negative requested tokens as not-allowed', () => {
    const b = createBudgetTracker(100)
    expect(b.allow(-10)).toBe(false)
  })

  it('ignores negative or zero record() calls', () => {
    const b = createBudgetTracker(100)
    b.record(-50)
    b.record(0)
    expect(b.used()).toBe(0)
  })
})
