/**
 * snapfeed — Time-based retention helper for StorageAdapters.
 *
 * Walks the configured storage with `listOlderThan(cutoff)` and calls
 * `delete(deliveryId)` for each result. Used by self-hosted operators who
 * want to enforce a fixed retention window on uploaded media (screenshots,
 * voice clips) without standing up a separate cron / Lambda.
 *
 * Scope (v0.6): time-based pruning of storage objects. NOT a GDPR
 * "delete by user" — that requires correlating audit-log records back to
 * uploads and is on the v0.7 roadmap.
 */

import type { StorageAdapter } from './types'

/** Result of a single `pruneOlderThan` run. */
export interface PruneResult {
  /** Number of objects whose `delete` returned `{ deleted: true }`. */
  deletedUploads: number
  /** Number of objects whose `delete` threw or — if `failOnMissing` — returned `deleted: false`. */
  failedUploads: number
  /** Number of objects whose `delete` returned `{ deleted: false }`. Counted separately by default. */
  notFoundUploads: number
  /** Per-failure detail. Only populated for thrown errors and (with `failOnMissing`) for not-found cases. */
  errors: Array<{ deliveryId: string; error: string }>
}

export interface PruneOptions {
  storage: StorageAdapter
  /**
   * If true, treat `delete -> { deleted: false }` as a failure (counted in
   * `failedUploads` and recorded in `errors`). Default behavior (false)
   * counts these in `notFoundUploads` and treats them as idempotent
   * successes — the object is gone, which is the intent.
   */
  failOnMissing?: boolean
  /**
   * Optional progress callback fired once per delete attempt. Useful for
   * wiring into the audit log (`{ event: 'deleted', deliveryId, ts }`) or
   * a CLI progress bar.
   */
  log?: (entry: PruneLogEntry) => void
}

export type PruneLogEntry =
  | { event: 'deleted'; deliveryId: string; uploadedAt: number }
  | { event: 'not-found'; deliveryId: string; uploadedAt: number }
  | { event: 'failed'; deliveryId: string; uploadedAt: number; error: string }

/** Either an absolute cutoff (epoch ms) or a relative `retentionDays`. */
export type PruneCutoff = number | { retentionDays: number }

/**
 * Delete every storage object older than the given cutoff.
 *
 * @param cutoff Either an epoch-ms timestamp or `{ retentionDays: N }` (the
 *               cutoff is `Date.now() - N * 86_400_000`).
 *
 * @example
 *   // Self-hosted nightly cron — keep 30 days of feedback media.
 *   await pruneOlderThan({ retentionDays: 30 }, { storage })
 */
export async function pruneOlderThan(
  cutoff: PruneCutoff,
  opts: PruneOptions
): Promise<PruneResult> {
  const { storage, failOnMissing = false, log } = opts

  if (typeof storage.listOlderThan !== 'function') {
    throw new Error(
      `pruneOlderThan: storage adapter "${storage.name}" does not implement listOlderThan() — required for retention`
    )
  }
  if (typeof storage.delete !== 'function') {
    throw new Error(
      `pruneOlderThan: storage adapter "${storage.name}" does not implement delete() — required for retention`
    )
  }

  const cutoffMs =
    typeof cutoff === 'number'
      ? cutoff
      : Date.now() - cutoff.retentionDays * 24 * 60 * 60 * 1000

  const entries = await storage.listOlderThan(cutoffMs)

  const result: PruneResult = {
    deletedUploads: 0,
    failedUploads: 0,
    notFoundUploads: 0,
    errors: [],
  }

  for (const entry of entries) {
    try {
      const { deleted } = await storage.delete(entry.deliveryId)
      if (deleted) {
        result.deletedUploads += 1
        log?.({ event: 'deleted', deliveryId: entry.deliveryId, uploadedAt: entry.uploadedAt })
      } else if (failOnMissing) {
        result.failedUploads += 1
        result.errors.push({
          deliveryId: entry.deliveryId,
          error: 'object not found at delete time',
        })
        log?.({
          event: 'failed',
          deliveryId: entry.deliveryId,
          uploadedAt: entry.uploadedAt,
          error: 'object not found at delete time',
        })
      } else {
        result.notFoundUploads += 1
        log?.({ event: 'not-found', deliveryId: entry.deliveryId, uploadedAt: entry.uploadedAt })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      result.failedUploads += 1
      result.errors.push({ deliveryId: entry.deliveryId, error: message })
      log?.({
        event: 'failed',
        deliveryId: entry.deliveryId,
        uploadedAt: entry.uploadedAt,
        error: message,
      })
    }
  }

  return result
}
