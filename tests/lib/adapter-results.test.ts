/**
 * Tests for src/lib/adapter-results.ts
 *
 * The dispatch result summarizer used by FeedbackProvider to decide:
 *   - whether to throw (only when ALL adapters fail)
 *   - whether to warn about partial failures (when some, but not all, fail)
 *
 * This was previously inline in FeedbackProvider with a misleading
 * variable name (`anyFailed` actually meant "allFailed"). Extracting
 * to a pure function lets us test the decision without React.
 */

import { describe, it, expect } from 'vitest'
import { summarizeAdapterResults } from '../../src/lib/adapter-results'
import type { FeedbackAdapterResult } from '../../src/types'

type Settled = PromiseSettledResult<FeedbackAdapterResult>

const ok = (deliveryId?: string): Settled => ({
  status: 'fulfilled',
  value: { ok: true, deliveryId },
})

const failedValue = (error: string): Settled => ({
  status: 'fulfilled',
  value: { ok: false, error },
})

const rejected = (reason: string): Settled => ({
  status: 'rejected',
  reason: new Error(reason),
})

describe('summarizeAdapterResults', () => {
  it('returns allFailed=false and no failures when all adapters succeeded', () => {
    const r = summarizeAdapterResults([ok('id-1'), ok('id-2')])
    expect(r.allFailed).toBe(false)
    expect(r.someFailed).toBe(false)
    expect(r.failures).toEqual([])
  })

  it('returns allFailed=true when every adapter failed (mix of rejected and ok=false)', () => {
    const r = summarizeAdapterResults([
      failedValue('webhook 503'),
      rejected('network'),
    ])
    expect(r.allFailed).toBe(true)
    expect(r.someFailed).toBe(true)
    expect(r.failures.length).toBe(2)
    expect(r.failures[0].error).toBe('webhook 503')
    expect(r.failures[1].error).toContain('network')
  })

  it('returns someFailed=true but allFailed=false on partial failure', () => {
    const r = summarizeAdapterResults([
      ok('jira-123'),
      failedValue('slack rate limited'),
    ])
    expect(r.allFailed).toBe(false)
    expect(r.someFailed).toBe(true)
    expect(r.failures.length).toBe(1)
    expect(r.failures[0].error).toBe('slack rate limited')
  })

  it('handles an empty results array gracefully', () => {
    const r = summarizeAdapterResults([])
    // No adapters configured = nothing to fail
    expect(r.allFailed).toBe(false)
    expect(r.someFailed).toBe(false)
    expect(r.failures).toEqual([])
  })

  it('preserves the failed adapter index in failures', () => {
    const r = summarizeAdapterResults([
      ok('a'),
      failedValue('b broke'),
      ok('c'),
      rejected('d crashed'),
    ])
    expect(r.failures.map(f => f.index)).toEqual([1, 3])
  })
})
