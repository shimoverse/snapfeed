/**
 * snapfeed — GDPR / right-to-erasure helpers.
 *
 * `deleteByUserId(reporter, { auditLog, storage })` walks the audit log,
 * finds every `feedback.received` event whose `reporter` matches the
 * given identity, follows each `feedbackId` to its `adapter.dispatched`
 * uploads, and deletes those uploads from the storage adapter.
 *
 * Scope (v0.7):
 *   - Time-correlated upload deletion via the v0.7 `feedbackId` field
 *     stamped on `feedback.received` and `adapter.dispatched`.
 *   - Writes a `feedback.redacted` audit event so the log itself records
 *     the action (audit logs are append-only — the original
 *     `feedback.received` lines stay).
 *
 * NOT in scope:
 *   - Modifying / removing the original `feedback.received` lines (audit
 *     logs are append-only). Pair `hashReporter: true` on `fileAuditLog`
 *     in production so reporter identifiers are stored as truncated
 *     SHA-256 hashes, not raw emails.
 *   - Removing data from third-party adapter destinations (Slack
 *     messages, JIRA tickets, GitHub issues). Those have their own
 *     deletion APIs; consult per-adapter docs at `docs/adapters/`. The
 *     storage layer (file / S3) is what snapfeed itself controls.
 *   - Pre-v0.7 events that lack `feedbackId`: counted in
 *     `legacyEventsWithoutFeedbackId` so the caller can decide whether
 *     to fall back to a manual cleanup.
 *
 * Server-side only.
 */

import type { AuditEvent, AuditLog } from './audit-log'
import type { StorageAdapter } from './storage/types'

/** Result of a single `deleteByUserId` run. */
export interface DeleteByUserIdResult {
  /** Count of `feedback.received` events matched for this reporter. */
  feedbackEventCount: number
  /** Count of pre-v0.7 events that matched but have no feedbackId to follow. */
  legacyEventsWithoutFeedbackId: number
  /** Number of unique upload `deliveryId`s successfully deleted. */
  deletedUploads: number
  /** Number of upload deletes that threw / errored. */
  failedUploads: number
  /** Per-failure detail. */
  errors: Array<{ deliveryId: string; error: string }>
}

export type DeleteByUserIdLogEntry =
  | { event: 'matched'; feedbackId: string }
  | { event: 'deleted'; deliveryId: string }
  | { event: 'failed'; deliveryId: string; error: string }
  | { event: 'redacted-event-written'; reporter: string }

export interface DeleteByUserIdOptions {
  auditLog: AuditLog
  storage: StorageAdapter
  /** Optional progress callback fired once per significant step. */
  log?: (entry: DeleteByUserIdLogEntry) => void
}

/**
 * Walk the audit log, find everything tied to `reporter`, and delete it
 * from storage. Writes a `feedback.redacted` event when at least one
 * `feedback.received` matched.
 *
 * Reporter matching is **exact string equality** — no case folding, no
 * trimming. Reporter strings come from the user's auth identity
 * (`payload.user.email ?? payload.user.name`); they should already be
 * normalized at submission time. Surprising fuzzy matching here would
 * risk deleting the wrong user's data.
 *
 * @example
 *   const result = await deleteByUserId('ananya@example.com', {
 *     auditLog: fileAuditLog({ path: '/data/audit.jsonl' }),
 *     storage: s3Storage({ ... }),
 *   })
 *   console.log(`deleted ${result.deletedUploads} uploads across ${result.feedbackEventCount} feedback events`)
 */
export async function deleteByUserId(
  reporter: string,
  opts: DeleteByUserIdOptions
): Promise<DeleteByUserIdResult> {
  const { auditLog, storage, log } = opts

  if (typeof auditLog.readAll !== 'function') {
    throw new Error(
      'deleteByUserId: audit log does not implement readAll() — required to walk historical events'
    )
  }
  if (typeof storage.delete !== 'function') {
    throw new Error(
      `deleteByUserId: storage adapter "${storage.name}" does not implement delete() — required to remove uploads`
    )
  }

  // Pass 1: collect feedbackIds for the matching reporter.
  const matchedFeedbackIds = new Set<string>()
  let feedbackEventCount = 0
  let legacyEventsWithoutFeedbackId = 0
  for await (const e of auditLog.readAll()) {
    if (e.type !== 'feedback.received') continue
    if (e.reporter !== reporter) continue
    feedbackEventCount += 1
    if (e.feedbackId) {
      matchedFeedbackIds.add(e.feedbackId)
      log?.({ event: 'matched', feedbackId: e.feedbackId })
    } else {
      legacyEventsWithoutFeedbackId += 1
    }
  }

  // Pass 2: collect upload deliveryIds for those feedbackIds.
  // We do a second walk rather than building a {feedbackId → uploads[]} map in
  // pass 1 because the typical audit log fits in stream memory but not always
  // a full in-memory index for huge multi-year logs.
  const uploadIds = new Set<string>()
  if (matchedFeedbackIds.size > 0) {
    for await (const e of auditLog.readAll()) {
      if (e.type !== 'adapter.dispatched') continue
      if (!e.ok) continue                     // failed dispatch = nothing was uploaded
      if (!e.deliveryId) continue
      if (!e.feedbackId) continue
      if (!matchedFeedbackIds.has(e.feedbackId)) continue
      uploadIds.add(e.deliveryId)
    }
  }

  // Pass 3: delete each upload, accumulate result.
  const result: DeleteByUserIdResult = {
    feedbackEventCount,
    legacyEventsWithoutFeedbackId,
    deletedUploads: 0,
    failedUploads: 0,
    errors: [],
  }

  for (const deliveryId of uploadIds) {
    try {
      const { deleted } = await storage.delete(deliveryId)
      // `deleted: false` means the upload was already gone — that's the
      // intended end-state, so we count it as a success.
      void deleted
      result.deletedUploads += 1
      log?.({ event: 'deleted', deliveryId })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      result.failedUploads += 1
      result.errors.push({ deliveryId, error: message })
      log?.({ event: 'failed', deliveryId, error: message })
    }
  }

  // Pass 4: append a feedback.redacted event when something matched, so
  // the audit log records the action. Skip when nothing matched (no point
  // logging "deleted nothing for an unknown reporter").
  if (feedbackEventCount > 0) {
    const redactedEvent: AuditEvent = {
      type: 'feedback.redacted',
      ts: new Date().toISOString(),
      reporter,
      feedbackEventCount,
      uploadCount: result.deletedUploads,
    }
    try {
      await auditLog.record(redactedEvent)
      log?.({ event: 'redacted-event-written', reporter })
    } catch (err) {
      // Audit log write failure is non-fatal — the storage deletes already
      // happened; we just couldn't record the action. Surface via the
      // logger so operators see it.
      log?.({
        event: 'failed',
        deliveryId: '<feedback.redacted audit event>',
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return result
}
