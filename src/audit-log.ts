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

// Re-export so consumers wiring the handler don't need a separate import.
export type { FeedbackPayload, FeedbackAdapterResult }

// ─── Public API ───────────────────────────────────────────────────────────────

export interface AuditLog {
  record(event: AuditEvent): Promise<void>
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
      const toWrite = hashReporter ? await redactReporter(event) : event
      await ensureDir()
      const { appendFile } = await import('node:fs/promises')
      await appendFile(filePath, JSON.stringify(toWrite) + '\n', 'utf8')
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
  // Only `feedback.received` carries a `reporter` field today. Future events
  // can be added without touching callers.
  if (event.type !== 'feedback.received') return event
  if (event.reporter === undefined || event.reporter === '') return event
  const { createHash } = await import('node:crypto')
  const hashed = createHash('sha256').update(event.reporter).digest('hex').slice(0, 12)
  return { ...event, reporter: hashed }
}
