/**
 * snapfeed — LLM token budget tracker
 *
 * In-process daily budget. Day key uses UTC ISO date (YYYY-MM-DD), so the
 * budget rolls over at 00:00 UTC. When a new day is observed, the counter
 * resets to 0 before any further accounting.
 *
 * Fails closed: if `dailyTokens` is 0 (or negative), `allow()` always returns
 * false. Callers MUST check `allow()` before making the LLM call and only
 * call `record()` after a successful completion.
 *
 * Single-instance only. For multi-process deployments, swap in a Redis-backed
 * `BudgetTracker` implementation that satisfies the same interface.
 */

import type { BudgetTracker } from './types'

function todayKey(): string {
  return new Date().toISOString().slice(0, 10)
}

export function createBudgetTracker(dailyTokens: number): BudgetTracker {
  let day = todayKey()
  let consumed = 0

  function rollIfNewDay(): void {
    const now = todayKey()
    if (now !== day) {
      day = now
      consumed = 0
    }
  }

  return {
    allow(tokens: number): boolean {
      rollIfNewDay()
      if (dailyTokens <= 0) return false
      if (tokens < 0) return false
      return consumed + tokens <= dailyTokens
    },
    record(tokens: number): void {
      rollIfNewDay()
      if (tokens > 0) consumed += tokens
    },
    used(): number {
      rollIfNewDay()
      return consumed
    },
  }
}
