/**
 * Tests for src/gdpr.ts — `deleteByUserId(reporter, { auditLog, storage })`.
 *
 * Drives the helper with an in-memory fake AuditLog (yields a fixed event
 * list from readAll) and a fake StorageAdapter (records delete calls).
 * Real fileAuditLog + fileStorage roundtrip covered by the integration
 * test at the bottom — that one writes a real JSONL file + real fs uploads
 * to a tmp dir.
 */

import { describe, it, expect, vi, afterAll } from 'vitest'
import { mkdir, readFile, rm } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { deleteByUserId } from '../src/gdpr'
import { fileAuditLog, type AuditEvent, type AuditLog } from '../src/audit-log'
import { fileStorage } from '../src/storage/file'
import type {
  StorageAdapter,
  StorageDeleteResult,
} from '../src/storage/types'

// ─── Fakes ─────────────────────────────────────────────────────────────────

function fakeAuditLog(events: AuditEvent[]): AuditLog & {
  recorded: AuditEvent[]
} {
  const recorded: AuditEvent[] = []
  return {
    recorded,
    async record(event: AuditEvent): Promise<void> {
      recorded.push(event)
    },
    async *readAll(): AsyncIterable<AuditEvent> {
      for (const e of events) yield e
    },
  } as AuditLog & { recorded: AuditEvent[] }
}

function fakeStorage(opts: {
  deleteFn?: (id: string) => Promise<StorageDeleteResult>
} = {}): StorageAdapter & { deleteCalls: string[] } {
  const deleteCalls: string[] = []
  return {
    name: 'fake',
    deleteCalls,
    async upload() {
      throw new Error('not used')
    },
    async delete(id: string) {
      deleteCalls.push(id)
      return opts.deleteFn ? await opts.deleteFn(id) : { deleted: true }
    },
  } as StorageAdapter & { deleteCalls: string[] }
}

// ─── Unit tests ────────────────────────────────────────────────────────────

describe('deleteByUserId', () => {
  it('correlates feedback.received events for the user with their adapter.dispatched uploads', async () => {
    const events: AuditEvent[] = [
      // Three submissions, two by the target user, one by another.
      { type: 'feedback.received', ts: '2026-04-26T00:00:01Z', payloadSize: 100, pageUrl: '/a', reporter: 'ananya@example.com', feedbackId: 'fbk_1' },
      { type: 'adapter.dispatched', ts: '2026-04-26T00:00:02Z', adapter: 's3', ok: true, durationMs: 5, deliveryId: 's3:upload-1', feedbackId: 'fbk_1' },
      { type: 'feedback.received', ts: '2026-04-26T00:00:03Z', payloadSize: 200, pageUrl: '/b', reporter: 'someone-else@example.com', feedbackId: 'fbk_2' },
      { type: 'adapter.dispatched', ts: '2026-04-26T00:00:04Z', adapter: 's3', ok: true, durationMs: 5, deliveryId: 's3:upload-2', feedbackId: 'fbk_2' },
      { type: 'feedback.received', ts: '2026-04-26T00:00:05Z', payloadSize: 150, pageUrl: '/c', reporter: 'ananya@example.com', feedbackId: 'fbk_3' },
      { type: 'adapter.dispatched', ts: '2026-04-26T00:00:06Z', adapter: 's3', ok: true, durationMs: 5, deliveryId: 's3:upload-3', feedbackId: 'fbk_3' },
    ]
    const log = fakeAuditLog(events)
    const storage = fakeStorage()

    const result = await deleteByUserId('ananya@example.com', { auditLog: log, storage })

    // Should have deleted exactly upload-1 and upload-3 (NOT upload-2).
    expect(storage.deleteCalls.sort()).toEqual(['s3:upload-1', 's3:upload-3'])
    expect(result.feedbackEventCount).toBe(2)
    expect(result.deletedUploads).toBe(2)
    expect(result.failedUploads).toBe(0)
  })

  it('writes a feedback.redacted event to the audit log on success', async () => {
    const events: AuditEvent[] = [
      { type: 'feedback.received', ts: '2026-04-26T00:00:01Z', payloadSize: 100, pageUrl: '/a', reporter: 'ananya@example.com', feedbackId: 'fbk_1' },
      { type: 'adapter.dispatched', ts: '2026-04-26T00:00:02Z', adapter: 's3', ok: true, durationMs: 5, deliveryId: 's3:up-1', feedbackId: 'fbk_1' },
    ]
    const log = fakeAuditLog(events)
    const storage = fakeStorage()

    await deleteByUserId('ananya@example.com', { auditLog: log, storage })

    expect(log.recorded).toHaveLength(1)
    const written = log.recorded[0]!
    expect(written.type).toBe('feedback.redacted')
    if (written.type === 'feedback.redacted') {
      expect(written.reporter).toBe('ananya@example.com')
      expect(written.feedbackEventCount).toBe(1)
      expect(written.uploadCount).toBe(1)
    }
  })

  it('matches by reporter EXACTLY (no fuzzy / case-insensitive match — surprise factor)', async () => {
    const events: AuditEvent[] = [
      { type: 'feedback.received', ts: '2026-04-26T00:00:01Z', payloadSize: 100, pageUrl: '/a', reporter: 'Ananya@Example.com', feedbackId: 'fbk_1' },
    ]
    const log = fakeAuditLog(events)
    const storage = fakeStorage()

    const result = await deleteByUserId('ananya@example.com', { auditLog: log, storage })
    expect(result.feedbackEventCount).toBe(0)
  })

  it('returns zeros when no feedback.received events match the reporter', async () => {
    const events: AuditEvent[] = [
      { type: 'feedback.received', ts: '2026-04-26T00:00:01Z', payloadSize: 100, pageUrl: '/a', reporter: 'someone-else@example.com', feedbackId: 'fbk_1' },
    ]
    const log = fakeAuditLog(events)
    const storage = fakeStorage()

    const result = await deleteByUserId('ananya@example.com', { auditLog: log, storage })
    expect(result.feedbackEventCount).toBe(0)
    expect(result.deletedUploads).toBe(0)
    expect(storage.deleteCalls).toEqual([])
    expect(log.recorded).toEqual([]) // no feedback.redacted event written when nothing matched
  })

  it('handles a feedback.received with no feedbackId (legacy event) by counting it but skipping uploads', async () => {
    // Pre-v0.7 events have no feedbackId, so we can't correlate uploads.
    // We still report the count of matched feedback.received events so the
    // caller sees that legacy data was matched.
    const events: AuditEvent[] = [
      { type: 'feedback.received', ts: '2026-04-26T00:00:01Z', payloadSize: 100, pageUrl: '/a', reporter: 'ananya@example.com' },
    ]
    const log = fakeAuditLog(events)
    const storage = fakeStorage()

    const result = await deleteByUserId('ananya@example.com', { auditLog: log, storage })
    expect(result.feedbackEventCount).toBe(1)
    expect(result.deletedUploads).toBe(0)
    expect(result.legacyEventsWithoutFeedbackId).toBe(1)
  })

  it('counts upload deletes that fail (delete throws) but does not abort the run', async () => {
    const events: AuditEvent[] = [
      { type: 'feedback.received', ts: '2026-04-26T00:00:01Z', payloadSize: 100, pageUrl: '/a', reporter: 'ananya@example.com', feedbackId: 'fbk_1' },
      { type: 'adapter.dispatched', ts: '2026-04-26T00:00:02Z', adapter: 's3', ok: true, durationMs: 5, deliveryId: 's3:up-1', feedbackId: 'fbk_1' },
      { type: 'adapter.dispatched', ts: '2026-04-26T00:00:03Z', adapter: 's3', ok: true, durationMs: 5, deliveryId: 's3:up-bad', feedbackId: 'fbk_1' },
      { type: 'adapter.dispatched', ts: '2026-04-26T00:00:04Z', adapter: 's3', ok: true, durationMs: 5, deliveryId: 's3:up-3', feedbackId: 'fbk_1' },
    ]
    const log = fakeAuditLog(events)
    const storage = fakeStorage({
      deleteFn: async (id) => {
        if (id === 's3:up-bad') throw new Error('s3: 500')
        return { deleted: true }
      },
    })

    const result = await deleteByUserId('ananya@example.com', { auditLog: log, storage })
    expect(result.deletedUploads).toBe(2)
    expect(result.failedUploads).toBe(1)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]!.deliveryId).toBe('s3:up-bad')
    expect(result.errors[0]!.error).toMatch(/s3: 500/)
  })

  it('deduplicates upload deliveryIds (same upload referenced by two adapter dispatches is deleted once)', async () => {
    // Edge case: a future change could fan out the same upload to multiple
    // adapters. We don't want to call delete twice for the same id.
    const events: AuditEvent[] = [
      { type: 'feedback.received', ts: '2026-04-26T00:00:01Z', payloadSize: 100, pageUrl: '/a', reporter: 'ananya@example.com', feedbackId: 'fbk_1' },
      { type: 'adapter.dispatched', ts: '2026-04-26T00:00:02Z', adapter: 's3', ok: true, durationMs: 5, deliveryId: 's3:shared', feedbackId: 'fbk_1' },
      { type: 'adapter.dispatched', ts: '2026-04-26T00:00:03Z', adapter: 's3-mirror', ok: true, durationMs: 5, deliveryId: 's3:shared', feedbackId: 'fbk_1' },
    ]
    const log = fakeAuditLog(events)
    const storage = fakeStorage()

    const result = await deleteByUserId('ananya@example.com', { auditLog: log, storage })
    expect(storage.deleteCalls).toEqual(['s3:shared'])
    expect(result.deletedUploads).toBe(1)
  })

  it('does NOT delete uploads from adapter.dispatched events where ok=false (nothing was uploaded)', async () => {
    const events: AuditEvent[] = [
      { type: 'feedback.received', ts: '2026-04-26T00:00:01Z', payloadSize: 100, pageUrl: '/a', reporter: 'ananya@example.com', feedbackId: 'fbk_1' },
      { type: 'adapter.dispatched', ts: '2026-04-26T00:00:02Z', adapter: 's3', ok: false, durationMs: 5, deliveryId: undefined, error: 'ECONNREFUSED', feedbackId: 'fbk_1' },
    ]
    const log = fakeAuditLog(events)
    const storage = fakeStorage()

    const result = await deleteByUserId('ananya@example.com', { auditLog: log, storage })
    expect(storage.deleteCalls).toEqual([])
    expect(result.deletedUploads).toBe(0)
    expect(result.feedbackEventCount).toBe(1)
  })

  it('throws a clear error when the audit log does not implement readAll', async () => {
    const writeOnlyLog: AuditLog = {
      record: vi.fn(async () => undefined),
      // no readAll
    }
    const storage = fakeStorage()
    await expect(
      deleteByUserId('ananya@example.com', { auditLog: writeOnlyLog, storage })
    ).rejects.toThrow(/readAll/)
  })

  it('throws a clear error when the storage adapter does not implement delete', async () => {
    const events: AuditEvent[] = [
      { type: 'feedback.received', ts: '2026-04-26T00:00:01Z', payloadSize: 100, pageUrl: '/a', reporter: 'ananya@example.com', feedbackId: 'fbk_1' },
      { type: 'adapter.dispatched', ts: '2026-04-26T00:00:02Z', adapter: 's3', ok: true, durationMs: 5, deliveryId: 's3:up-1', feedbackId: 'fbk_1' },
    ]
    const log = fakeAuditLog(events)
    const partialStorage: StorageAdapter = {
      name: 'partial',
      async upload() { throw new Error('not used') },
      // no delete
    }
    await expect(
      deleteByUserId('ananya@example.com', { auditLog: log, storage: partialStorage })
    ).rejects.toThrow(/delete/)
  })

  it('respects an injected logger for per-deletion progress', async () => {
    const events: AuditEvent[] = [
      { type: 'feedback.received', ts: '2026-04-26T00:00:01Z', payloadSize: 100, pageUrl: '/a', reporter: 'ananya@example.com', feedbackId: 'fbk_1' },
      { type: 'adapter.dispatched', ts: '2026-04-26T00:00:02Z', adapter: 's3', ok: true, durationMs: 5, deliveryId: 's3:up-1', feedbackId: 'fbk_1' },
    ]
    const log = fakeAuditLog(events)
    const storage = fakeStorage()
    const logger = vi.fn()

    await deleteByUserId('ananya@example.com', { auditLog: log, storage, log: logger })

    expect(logger).toHaveBeenCalledWith(expect.objectContaining({ event: 'deleted', deliveryId: 's3:up-1' }))
  })
})

// ─── Integration test: real fileAuditLog + real fileStorage ────────────────

const createdDirs: string[] = []
const createdPaths: string[] = []

afterAll(async () => {
  for (const d of createdDirs) {
    await rm(d, { recursive: true, force: true }).catch(() => undefined)
  }
  for (const p of createdPaths) {
    await rm(p, { force: true }).catch(() => undefined)
  }
})

describe('deleteByUserId — integration with fileAuditLog + fileStorage', () => {
  it('end-to-end: real JSONL log + real upload dir; user data deleted; redacted event written', async () => {
    const tmpAuditPath = path.join(
      os.tmpdir(),
      `snapfeed-gdpr-audit-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`
    )
    const tmpUploadDir = path.join(
      os.tmpdir(),
      `snapfeed-gdpr-uploads-${Date.now()}-${Math.random().toString(36).slice(2)}`
    )
    createdPaths.push(tmpAuditPath)
    createdDirs.push(tmpUploadDir)
    await mkdir(tmpUploadDir, { recursive: true })

    const auditLog = fileAuditLog({ path: tmpAuditPath })
    const storage = fileStorage({ dir: tmpUploadDir, prefix: () => 'pfx' })

    // Simulate two submissions by the target user, one by another.
    const ananyaUpload1 = await storage.upload({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: 'image/png',
      filename: 'shot1.png',
    })
    await auditLog.record({
      type: 'feedback.received',
      ts: '2026-04-26T00:00:01Z',
      payloadSize: 100,
      pageUrl: '/a',
      reporter: 'ananya@example.com',
      feedbackId: 'fbk_1',
    })
    await auditLog.record({
      type: 'adapter.dispatched',
      ts: '2026-04-26T00:00:02Z',
      adapter: 'file',
      ok: true,
      durationMs: 1,
      deliveryId: ananyaUpload1.deliveryId,
      feedbackId: 'fbk_1',
    })

    const otherUpload = await storage.upload({
      bytes: new Uint8Array([9, 8, 7]),
      mimeType: 'image/png',
      filename: 'shot2.png',
    })
    await auditLog.record({
      type: 'feedback.received',
      ts: '2026-04-26T00:00:03Z',
      payloadSize: 100,
      pageUrl: '/b',
      reporter: 'someone-else@example.com',
      feedbackId: 'fbk_2',
    })
    await auditLog.record({
      type: 'adapter.dispatched',
      ts: '2026-04-26T00:00:04Z',
      adapter: 'file',
      ok: true,
      durationMs: 1,
      deliveryId: otherUpload.deliveryId,
      feedbackId: 'fbk_2',
    })

    const ananyaUpload2 = await storage.upload({
      bytes: new Uint8Array([4, 5, 6]),
      mimeType: 'image/png',
      filename: 'shot3.png',
    })
    await auditLog.record({
      type: 'feedback.received',
      ts: '2026-04-26T00:00:05Z',
      payloadSize: 100,
      pageUrl: '/c',
      reporter: 'ananya@example.com',
      feedbackId: 'fbk_3',
    })
    await auditLog.record({
      type: 'adapter.dispatched',
      ts: '2026-04-26T00:00:06Z',
      adapter: 'file',
      ok: true,
      durationMs: 1,
      deliveryId: ananyaUpload2.deliveryId,
      feedbackId: 'fbk_3',
    })

    // Pre-condition: all 3 uploads on disk.
    const fs = await import('node:fs/promises')
    await expect(fs.stat(ananyaUpload1.deliveryId)).resolves.toBeDefined()
    await expect(fs.stat(otherUpload.deliveryId)).resolves.toBeDefined()
    await expect(fs.stat(ananyaUpload2.deliveryId)).resolves.toBeDefined()

    // Run the GDPR delete.
    const result = await deleteByUserId('ananya@example.com', { auditLog, storage })

    expect(result.feedbackEventCount).toBe(2)
    expect(result.deletedUploads).toBe(2)
    expect(result.failedUploads).toBe(0)

    // Post-condition: ananya's uploads gone, other user's untouched.
    await expect(fs.stat(ananyaUpload1.deliveryId)).rejects.toBeDefined()
    await expect(fs.stat(ananyaUpload2.deliveryId)).rejects.toBeDefined()
    await expect(fs.stat(otherUpload.deliveryId)).resolves.toBeDefined()

    // The audit log itself should have a feedback.redacted event appended.
    const lines = (await readFile(tmpAuditPath, 'utf8')).trim().split('\n')
    const redactedLine = lines.find((l) => JSON.parse(l).type === 'feedback.redacted')
    expect(redactedLine).toBeDefined()
    const redacted = JSON.parse(redactedLine!)
    expect(redacted.reporter).toBe('ananya@example.com')
    expect(redacted.feedbackEventCount).toBe(2)
    expect(redacted.uploadCount).toBe(2)
  })
})
