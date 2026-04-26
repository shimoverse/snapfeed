/**
 * Pure summarizer for adapter dispatch results.
 *
 * Used by FeedbackProvider to decide whether to throw (only when ALL
 * adapters fail) and whether to surface a partial-failure warning
 * (some, but not all, failed).
 *
 * Why extracted: the previous inline logic in FeedbackProvider used a
 * variable named `anyFailed` that actually meant "every failed". The
 * naming was misleading and partial failures were silently swallowed.
 */

import type { FeedbackAdapterResult } from '../types'

export interface AdapterFailure {
  /** Index in the original results array */
  index: number
  /** Best-effort failure description */
  error: string
}

export interface AdapterResultsSummary {
  /** True only if every result is a failure (rejected or `ok: false`). */
  allFailed: boolean
  /** True if any result is a failure. */
  someFailed: boolean
  /** Detail per failed adapter, in original order. */
  failures: AdapterFailure[]
}

export function summarizeAdapterResults(
  results: PromiseSettledResult<FeedbackAdapterResult>[]
): AdapterResultsSummary {
  const failures: AdapterFailure[] = []

  results.forEach((r, index) => {
    if (r.status === 'rejected') {
      const reason = r.reason
      const message =
        reason instanceof Error
          ? reason.message
          : typeof reason === 'string'
            ? reason
            : String(reason)
      failures.push({ index, error: message })
      return
    }
    if (!r.value.ok) {
      failures.push({ index, error: r.value.error ?? 'unknown adapter failure' })
    }
  })

  const someFailed = failures.length > 0
  const allFailed = results.length > 0 && failures.length === results.length

  return { allFailed, someFailed, failures }
}
