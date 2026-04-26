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
