/**
 * snapfeed — Audit Log
 *
 * Per SECURITY.md, every config change, adapter dispatch, and LLM call should
 * be auditable. This module is the v0.4 landing for that requirement.
 *
 * Design choices:
 *   - The `AuditLog` interface is intentionally minimal (`record(event)`) so
 *     consumers can plug in Postgres, CloudWatch Logs, OpenTelemetry, etc.
 *     The default implementation is a JSONL file appender (Node-only) — good
 *     enough for self-hosted single-instance deployments and easy to grep.
 *   - Events are a discriminated union so consumers and dashboards can switch
 *     on `type` without losing payload shape.
 *   - LLM event records `tokensUsed` only — never the prompt or completion
 *     content. This is the "with token counts but redacted content" line in
 *     SECURITY.md.
 *   - `hashReporter` lets you ship the log off-host (e.g. to a SIEM) without
 *     leaking reporter emails. We use a truncated SHA-256 — long enough to
 *     correlate the same reporter across events, short enough to feel
 *     non-reversible at a glance.
 */

import type { FeedbackPayload, FeedbackAdapterResult } from './types'

// ─── Event union ──────────────────────────────────────────────────────────────

export type AuditEvent =
  | {
      type: 'feedback.received'
      ts: string
      ip?: string
      payloadSize: number
      pageUrl: string
      reporter?: string
      category?: string
      /**
       * v0.7: Stable ID for this feedback submission. Same value appears on
       * the corresponding `adapter.dispatched` events so a consumer can
       * correlate "this user submitted feedback X" with "feedback X had
       * upload Y on adapter Z." Used by the GDPR `deleteByUserId` helper.
       */
      feedbackId?: string
    }
  | {
      type: 'adapter.dispatched'
      ts: string
      adapter: string
      ok: boolean
      durationMs: number
      deliveryId?: string
      error?: string
      warningsCount?: number
      /** v0.7: Same value as the corresponding `feedback.received` event. */
      feedbackId?: string
    }
  | {
      type: 'llm.called'
      ts: string
      provider: string
      feature: string
      tokensUsed: number
      degraded: boolean
    }
  | {
      type: 'config.changed'
      ts: string
      section: string
      summary: string
    }
  | {
      type: 'rate_limit.hit'
      ts: string
      ip?: string
      key: string
    }
  | {
      /**
       * v0.7: Written by `deleteByUserId(reporter, ...)` after a successful
       * GDPR redaction so the audit log itself records the action. The
       * original `feedback.received` lines stay in place (audit logs are
       * append-only); this event signals "data for this reporter has been
       * removed from storage." Pair with `hashReporter: true` in production
       * to keep the redacted event from re-leaking the email it removed.
       */
      type: 'feedback.redacted'
      ts: string
      reporter: string
      /** Number of `feedback.received` events matched for this reporter. */
      feedbackEventCount: number
      /** Number of upload `deliveryId`s deleted from storage. */
      uploadCount: number
    }

// Re-export so consumers wiring the handler don't need a separate import.
export type { FeedbackPayload, FeedbackAdapterResult }

// ─── Public API ───────────────────────────────────────────────────────────────

export interface AuditLog {
  record(event: AuditEvent): Promise<void>
  /**
   * v0.7: Optional streaming read of historical events. Implementations that
   * cannot read back (e.g. fire-and-forget SIEM forwarders, `noopAuditLog`)
   * should leave this undefined; callers that depend on it (e.g.
   * `deleteByUserId`) check for its presence and surface a clear error
   * when the audit log is write-only.
   */
  readAll?(): AsyncIterable<AuditEvent>
}

export interface FileAuditLogOptions {
  /**
   * File path.
   * @default './snapfeed-audit.jsonl'
   */
  path?: string
  /**
   * Redact reporter (replace with a 12-char SHA-256 prefix) so the log is
   * safer to ship off-host. Applies to events that have a `reporter` field.
   * @default false
   */
  hashReporter?: boolean
}

const DEFAULT_PATH = './snapfeed-audit.jsonl'

export function fileAuditLog(options: FileAuditLogOptions = {}): AuditLog {
  const { path: filePath = DEFAULT_PATH, hashReporter = false } = options

  // Track whether we've ensured the parent dir exists; cheaper than mkdir on
  // every write.
  let dirEnsured = false

  const ensureDir = async (): Promise<void> => {
    if (dirEnsured) return
    const { mkdir } = await import('node:fs/promises')
    const { dirname } = await import('node:path')
    const dir = dirname(filePath)
    if (dir && dir !== '.' && dir !== '') {
      await mkdir(dir, { recursive: true })
    }
    dirEnsured = true
  }

  return {
    async record(event: AuditEvent): Promise<void> {
      // Audit failures must NEVER break the request flow. Wrap the entire
      // write path in try/catch and surface failures via console.error only.
      try {
        const toWrite = hashReporter ? await redactReporter(event) : event
        await ensureDir()
        const { appendFile } = await import('node:fs/promises')
        await appendFile(filePath, JSON.stringify(toWrite) + '\n', 'utf8')
      } catch (err) {
        console.error('[snapfeed] audit-log write failed:', err)
      }
    },

    /**
     * v0.7: Stream every event from the JSONL file in order. Yields one
     * `AuditEvent` per non-blank line; silently skips malformed JSON
     * (e.g. a partial write from a crashed process). Returns nothing if
     * the file does not exist yet — that's the cold-start case.
     *
     * Memory: line-by-line via readline; safe against arbitrarily large
     * audit files. Caller is responsible for `for await ... break` if it
     * wants to stop early.
     */
    async *readAll(): AsyncIterable<AuditEvent> {
      const { existsSync, createReadStream } = await import('node:fs')
      if (!existsSync(filePath)) return

      const { createInterface } = await import('node:readline')
      const stream = createReadStream(filePath, { encoding: 'utf8' })
      const rl = createInterface({ input: stream, crlfDelay: Infinity })
      try {
        for await (const rawLine of rl) {
          const line = rawLine.trim()
          if (!line) continue
          try {
            yield JSON.parse(line) as AuditEvent
          } catch {
            // Malformed line (partial write, manual edit, log rotation
            // mid-line). Skip — don't poison the iterator.
            continue
          }
        }
      } finally {
        rl.close()
        stream.destroy()
      }
    },
  }
}

export function noopAuditLog(): AuditLog {
  return {
    async record(): Promise<void> {
      // intentional no-op
    },
  }
}

export function multiAuditLog(...logs: AuditLog[]): AuditLog {
  return {
    async record(event: AuditEvent): Promise<void> {
      // Run all sub-logs in parallel; if one rejects, the others still run.
      // We swallow rejections here because audit logging must never break the
      // request flow that triggered it. Individual logs should surface their
      // own errors if they care.
      await Promise.all(
        logs.map(async (log) => {
          try {
            await log.record(event)
          } catch {
            // intentionally swallowed
          }
        })
      )
    },
  }
}

// ─── Internals ────────────────────────────────────────────────────────────────

async function redactReporter(event: AuditEvent): Promise<AuditEvent> {
  // Both `feedback.received` and (v0.7) `feedback.redacted` carry a
  // `reporter` field. Adding an event type with a reporter? Extend this
  // switch.
  if (event.type !== 'feedback.received' && event.type !== 'feedback.redacted') {
    return event
  }
  const reporter = event.reporter
  if (reporter === undefined || reporter === '') return event
  const { createHash } = await import('node:crypto')
  const hashed = createHash('sha256').update(reporter).digest('hex').slice(0, 12)
  return { ...event, reporter: hashed }
}
