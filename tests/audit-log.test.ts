/**
 * Tests for src/audit-log.ts
 *
 * Uses real temp files; cleans up in afterAll. We assert JSONL format,
 * directory auto-creation, reporter hashing, and multi-log composition.
 */

import { describe, it, expect, afterAll, vi } from 'vitest'
import { readFile, unlink, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  fileAuditLog,
  noopAuditLog,
  multiAuditLog,
  type AuditEvent,
  type AuditLog,
} from '../src/audit-log'

const createdPaths: string[] = []
const createdDirs: string[] = []

function tmpFile(label = 'snapfeed-audit'): string {
  const p = path.join(
    os.tmpdir(),
    `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`
  )
  createdPaths.push(p)
  return p
}

function tmpNestedFile(label = 'snapfeed-audit-nested'): string {
  const dir = path.join(
    os.tmpdir(),
    `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    'a',
    'b',
    'c'
  )
  // Track the top-level dir for cleanup.
  createdDirs.push(path.dirname(path.dirname(path.dirname(dir))))
  return path.join(dir, 'audit.jsonl')
}

const sampleReceived: AuditEvent = {
  type: 'feedback.received',
  ts: '2026-04-25T00:00:00.000Z',
  ip: '127.0.0.1',
  payloadSize: 123,
  pageUrl: 'https://example.com/page',
  reporter: 'alice@example.com',
  category: 'bug',
}

const sampleDispatched: AuditEvent = {
  type: 'adapter.dispatched',
  ts: '2026-04-25T00:00:01.000Z',
  adapter: 'slack',
  ok: true,
  durationMs: 42,
  deliveryId: 'msg-1',
}

afterAll(async () => {
  for (const p of createdPaths) {
    try {
      await unlink(p)
    } catch {
      // best-effort
    }
  }
  for (const d of createdDirs) {
    try {
      await rm(d, { recursive: true, force: true })
    } catch {
      // best-effort
    }
  }
})

describe('fileAuditLog', () => {
  it('appends one JSONL line per event; each line is valid JSON', async () => {
    const file = tmpFile()
    const log = fileAuditLog({ path: file })

    await log.record(sampleReceived)
    await log.record(sampleDispatched)

    const text = await readFile(file, 'utf8')
    const lines = text.trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0]!)).toEqual(sampleReceived)
    expect(JSON.parse(lines[1]!)).toEqual(sampleDispatched)
  })

  it('auto-creates the parent directory', async () => {
    const file = tmpNestedFile()
    const log = fileAuditLog({ path: file })

    await log.record(sampleReceived)

    const text = await readFile(file, 'utf8')
    expect(text.trim().split('\n')).toHaveLength(1)
    expect(JSON.parse(text.trim())).toEqual(sampleReceived)
  })

  it('hashReporter: true replaces reporter with a 12-char SHA-256 prefix', async () => {
    const file = tmpFile()
    const log = fileAuditLog({ path: file, hashReporter: true })

    await log.record(sampleReceived)

    const text = await readFile(file, 'utf8')
    const event = JSON.parse(text.trim()) as Extract<
      AuditEvent,
      { type: 'feedback.received' }
    >
    const expectedHash = createHash('sha256')
      .update('alice@example.com')
      .digest('hex')
      .slice(0, 12)
    expect(event.reporter).toBe(expectedHash)
    expect(event.reporter).not.toBe('alice@example.com')
    expect(event.reporter!.length).toBe(12)
    // Other fields preserved
    expect(event.pageUrl).toBe('https://example.com/page')
    expect(event.category).toBe('bug')
  })

  it('hashReporter: true is a no-op for events without a reporter field', async () => {
    const file = tmpFile()
    const log = fileAuditLog({ path: file, hashReporter: true })

    await log.record(sampleDispatched)

    const text = await readFile(file, 'utf8')
    expect(JSON.parse(text.trim())).toEqual(sampleDispatched)
  })
})

describe('noopAuditLog', () => {
  it('does not throw and performs no I/O', async () => {
    const log = noopAuditLog()
    // We can't easily assert "no I/O" in a Node test, but we can assert it
    // resolves without error for any event shape.
    await expect(log.record(sampleReceived)).resolves.toBeUndefined()
    await expect(log.record(sampleDispatched)).resolves.toBeUndefined()
  })
})

describe('fileAuditLog — write failures never break the request flow', () => {
  it('swallows EACCES on appendFile and logs to console.error', async () => {
    // Point at a path that mkdir cannot create (e.g. under /dev/null/...) so
    // the entire write pipeline fails. We assert the promise resolves rather
    // than rejecting, and that console.error fired.
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const log = fileAuditLog({ path: '/dev/null/cant-write/audit.jsonl' })
      await expect(log.record(sampleReceived)).resolves.toBeUndefined()
      expect(errSpy).toHaveBeenCalled()
      const firstCall = errSpy.mock.calls[0]!
      expect(String(firstCall[0])).toMatch(/audit-log write failed/i)
    } finally {
      errSpy.mockRestore()
    }
  })

  it('swallows the failure even when ensureDir fails on a readonly parent', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      // /proc on Linux and a non-existent root path on macOS both produce a
      // permission/ENOENT error from mkdir. The log must not throw.
      const log = fileAuditLog({
        path: '/dev/null/snapfeed-readonly/nested/audit.jsonl',
      })
      await expect(log.record(sampleDispatched)).resolves.toBeUndefined()
      expect(errSpy).toHaveBeenCalled()
    } finally {
      errSpy.mockRestore()
    }
  })
})

describe('multiAuditLog', () => {
  it('forwards every event to all sub-logs in parallel', async () => {
    const a: AuditLog = { record: vi.fn(async () => undefined) }
    const b: AuditLog = { record: vi.fn(async () => undefined) }
    const c: AuditLog = { record: vi.fn(async () => undefined) }

    const log = multiAuditLog(a, b, c)
    await log.record(sampleReceived)

    expect(a.record).toHaveBeenCalledWith(sampleReceived)
    expect(b.record).toHaveBeenCalledWith(sampleReceived)
    expect(c.record).toHaveBeenCalledWith(sampleReceived)
  })

  it('continues to call other sub-logs when one throws', async () => {
    const good1: AuditLog = { record: vi.fn(async () => undefined) }
    const bad: AuditLog = {
      record: vi.fn(async () => {
        throw new Error('disk full')
      }),
    }
    const good2: AuditLog = { record: vi.fn(async () => undefined) }

    const log = multiAuditLog(good1, bad, good2)
    await expect(log.record(sampleReceived)).resolves.toBeUndefined()

    expect(good1.record).toHaveBeenCalledTimes(1)
    expect(bad.record).toHaveBeenCalledTimes(1)
    expect(good2.record).toHaveBeenCalledTimes(1)
  })
})

// ─── v0.7: GDPR foundations ─────────────────────────────────────────────────

describe('AuditEvent — feedbackId field (v0.7)', () => {
  // Background: GDPR delete-by-user needs to correlate "this user submitted
  // feedback X" (feedback.received) with "feedback X had upload Y on
  // adapter Z" (adapter.dispatched). The link is a feedbackId field added
  // to BOTH event types.

  it('feedback.received accepts an optional feedbackId field', () => {
    const event: AuditEvent = {
      type: 'feedback.received',
      ts: '2026-04-26T00:00:00Z',
      payloadSize: 100,
      pageUrl: 'http://example.com',
      feedbackId: 'fbk_abc123',
    }
    expect(event.feedbackId).toBe('fbk_abc123')
  })

  it('adapter.dispatched accepts an optional feedbackId field', () => {
    const event: AuditEvent = {
      type: 'adapter.dispatched',
      ts: '2026-04-26T00:00:00Z',
      adapter: 'slack',
      ok: true,
      durationMs: 12,
      deliveryId: 'slack-msg-456',
      feedbackId: 'fbk_abc123',
    }
    expect(event.feedbackId).toBe('fbk_abc123')
  })

  it('feedbackId persists through fileAuditLog roundtrip', async () => {
    const filePath = tmpFile()
    const log = fileAuditLog({ path: filePath })
    await log.record({
      type: 'feedback.received',
      ts: '2026-04-26T00:00:00Z',
      payloadSize: 100,
      pageUrl: 'http://example.com',
      feedbackId: 'fbk_xyz789',
    })
    const written = JSON.parse((await readFile(filePath, 'utf8')).trim())
    expect(written.feedbackId).toBe('fbk_xyz789')
  })

  it('feedbackId is preserved by hashReporter (only reporter is hashed)', async () => {
    const filePath = tmpFile()
    const log = fileAuditLog({ path: filePath, hashReporter: true })
    await log.record({
      type: 'feedback.received',
      ts: '2026-04-26T00:00:00Z',
      payloadSize: 100,
      pageUrl: 'http://example.com',
      reporter: 'ananya@example.com',
      feedbackId: 'fbk_persists_through_hash',
    })
    const written = JSON.parse((await readFile(filePath, 'utf8')).trim())
    expect(written.feedbackId).toBe('fbk_persists_through_hash')
    expect(written.reporter).not.toBe('ananya@example.com')
    expect(written.reporter).toHaveLength(12)
  })
})

describe('AuditEvent — feedback.redacted event (v0.7)', () => {
  // Written by the deleteByUserId helper after a successful redaction so
  // the audit log is itself a record of the GDPR action. The original
  // feedback.received line stays in place (audit logs are append-only),
  // but the redacted event signals "this user's data has been removed."

  it('accepts a feedback.redacted event with reporter + counts', () => {
    const event: AuditEvent = {
      type: 'feedback.redacted',
      ts: '2026-04-26T00:00:00Z',
      reporter: 'ananya@example.com',
      feedbackEventCount: 3,
      uploadCount: 7,
    }
    expect(event.type).toBe('feedback.redacted')
    expect(event.feedbackEventCount).toBe(3)
    expect(event.uploadCount).toBe(7)
  })

  it('hashReporter applies to feedback.redacted too', async () => {
    const filePath = tmpFile()
    const log = fileAuditLog({ path: filePath, hashReporter: true })
    await log.record({
      type: 'feedback.redacted',
      ts: '2026-04-26T00:00:00Z',
      reporter: 'ananya@example.com',
      feedbackEventCount: 2,
      uploadCount: 5,
    })
    const written = JSON.parse((await readFile(filePath, 'utf8')).trim())
    expect(written.reporter).not.toBe('ananya@example.com')
    expect(written.reporter).toHaveLength(12)
  })
})

describe('fileAuditLog.readAll() — streaming read API (v0.7)', () => {
  // GDPR delete needs to walk historical events. fileAuditLog gains a
  // streaming readAll() that yields one event per JSONL line.
  // Optional on the AuditLog interface so existing implementations
  // (noopAuditLog, custom) don't break.

  it('streams every event from the file in order', async () => {
    const filePath = tmpFile()
    const log = fileAuditLog({ path: filePath })

    await log.record({
      type: 'feedback.received',
      ts: '2026-04-26T00:00:01Z',
      payloadSize: 100,
      pageUrl: 'http://example.com/a',
      feedbackId: 'fbk_one',
    })
    await log.record({
      type: 'adapter.dispatched',
      ts: '2026-04-26T00:00:02Z',
      adapter: 'slack',
      ok: true,
      durationMs: 5,
      deliveryId: 'slk_1',
      feedbackId: 'fbk_one',
    })
    await log.record({
      type: 'feedback.received',
      ts: '2026-04-26T00:00:03Z',
      payloadSize: 200,
      pageUrl: 'http://example.com/b',
      feedbackId: 'fbk_two',
    })

    const out: AuditEvent[] = []
    if (typeof log.readAll !== 'function') throw new Error('readAll not implemented')
    for await (const e of log.readAll()) {
      out.push(e)
    }

    expect(out).toHaveLength(3)
    expect(out[0]?.type).toBe('feedback.received')
    expect(out[1]?.type).toBe('adapter.dispatched')
    expect(out[2]?.type).toBe('feedback.received')
  })

  it('returns nothing when the audit file does not exist yet', async () => {
    const filePath = tmpFile()
    const log = fileAuditLog({ path: filePath })
    if (typeof log.readAll !== 'function') throw new Error('readAll not implemented')

    const out: AuditEvent[] = []
    for await (const e of log.readAll()) out.push(e)
    expect(out).toEqual([])
  })

  it('skips blank lines + malformed JSON lines without throwing', async () => {
    const filePath = tmpFile()
    const log = fileAuditLog({ path: filePath })
    await log.record({
      type: 'feedback.received',
      ts: '2026-04-26T00:00:01Z',
      payloadSize: 1,
      pageUrl: 'http://x',
      feedbackId: 'fbk_a',
    })
    const { appendFile } = await import('node:fs/promises')
    await appendFile(filePath, '\n', 'utf8')
    await appendFile(filePath, 'not-json{\n', 'utf8')
    await log.record({
      type: 'feedback.received',
      ts: '2026-04-26T00:00:02Z',
      payloadSize: 1,
      pageUrl: 'http://y',
      feedbackId: 'fbk_b',
    })

    if (typeof log.readAll !== 'function') throw new Error('readAll not implemented')
    const out: AuditEvent[] = []
    for await (const e of log.readAll()) out.push(e)

    expect(out).toHaveLength(2)
    expect((out[0] as { feedbackId: string }).feedbackId).toBe('fbk_a')
    expect((out[1] as { feedbackId: string }).feedbackId).toBe('fbk_b')
  })
})
