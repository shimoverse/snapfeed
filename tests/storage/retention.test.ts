/**
 * Tests for src/storage/retention.ts — pruneOlderThan() helper.
 *
 * Uses an in-memory fake StorageAdapter (the helper only depends on
 * `listOlderThan` + `delete`, so we don't need real fs/S3 here).
 */

import { describe, it, expect, vi } from 'vitest'
import { pruneOlderThan } from '../../src/storage/retention'
import type {
  StorageAdapter,
  StorageEntry,
  StorageDeleteResult,
} from '../../src/storage/types'

function fakeStorage(opts: {
  entries: StorageEntry[]
  deleteFn?: (id: string) => Promise<StorageDeleteResult>
}): StorageAdapter & {
  deleteCalls: string[]
  listCalls: number[]
} {
  const deleteCalls: string[] = []
  const listCalls: number[] = []
  return {
    name: 'fake',
    async upload() {
      throw new Error('not used in retention tests')
    },
    async listOlderThan(cutoffMs: number) {
      listCalls.push(cutoffMs)
      return opts.entries.filter((e) => e.uploadedAt <= cutoffMs)
    },
    async delete(id: string) {
      deleteCalls.push(id)
      return opts.deleteFn ? await opts.deleteFn(id) : { deleted: true }
    },
    deleteCalls,
    listCalls,
  } as StorageAdapter & { deleteCalls: string[]; listCalls: number[] }
}

describe('pruneOlderThan', () => {
  it('lists with the cutoff and deletes every returned entry', async () => {
    const cutoff = Date.parse('2026-04-01T00:00:00Z')
    const storage = fakeStorage({
      entries: [
        { deliveryId: 'a.png', uploadedAt: Date.parse('2026-01-01T00:00:00Z') },
        { deliveryId: 'b.png', uploadedAt: Date.parse('2026-02-01T00:00:00Z') },
        { deliveryId: 'c.png', uploadedAt: Date.parse('2026-05-01T00:00:00Z') }, // newer than cutoff
      ],
    })

    const result = await pruneOlderThan(cutoff, { storage })

    expect(result.deletedUploads).toBe(2)
    expect(result.failedUploads).toBe(0)
    // listOlderThan filters by cutoff in our fake
    expect(storage.deleteCalls.sort()).toEqual(['a.png', 'b.png'])
    expect(storage.listCalls).toEqual([cutoff])
  })

  it('counts an entry as failed when delete returns deleted=false (already gone) only when failOnMissing is true', async () => {
    const cutoff = Date.now()
    const storage = fakeStorage({
      entries: [{ deliveryId: 'a.png', uploadedAt: cutoff - 1000 }],
      deleteFn: async () => ({ deleted: false }),
    })

    // Default: deleted=false counts as a no-op success (idempotent).
    const r1 = await pruneOlderThan(cutoff, { storage })
    expect(r1.deletedUploads).toBe(0)
    expect(r1.failedUploads).toBe(0)
    expect(r1.notFoundUploads).toBe(1)

    // failOnMissing=true: count it as failed.
    const r2 = await pruneOlderThan(cutoff, { storage, failOnMissing: true })
    expect(r2.failedUploads).toBe(1)
  })

  it('counts a thrown delete as failed and continues with the rest', async () => {
    const cutoff = Date.now()
    const storage = fakeStorage({
      entries: [
        { deliveryId: 'a.png', uploadedAt: cutoff - 1000 },
        { deliveryId: 'b.png', uploadedAt: cutoff - 1000 },
        { deliveryId: 'c.png', uploadedAt: cutoff - 1000 },
      ],
      deleteFn: async (id) => {
        if (id === 'b.png') throw new Error('s3: 500')
        return { deleted: true }
      },
    })

    const result = await pruneOlderThan(cutoff, { storage })
    expect(result.deletedUploads).toBe(2)
    expect(result.failedUploads).toBe(1)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]!.deliveryId).toBe('b.png')
    expect(result.errors[0]!.error).toMatch(/s3: 500/)
  })

  it('returns zeros when nothing is older than the cutoff', async () => {
    const cutoff = Date.parse('2026-01-01T00:00:00Z')
    const storage = fakeStorage({
      entries: [
        { deliveryId: 'a.png', uploadedAt: Date.parse('2026-04-01T00:00:00Z') },
      ],
    })
    const result = await pruneOlderThan(cutoff, { storage })
    expect(result).toEqual({
      deletedUploads: 0,
      failedUploads: 0,
      notFoundUploads: 0,
      errors: [],
    })
    expect(storage.deleteCalls).toEqual([])
  })

  it('throws a clear error when the storage adapter does not support listOlderThan', async () => {
    const partialStorage: StorageAdapter = {
      name: 'partial',
      async upload() {
        throw new Error('not used')
      },
      // no listOlderThan, no delete
    }
    await expect(pruneOlderThan(Date.now(), { storage: partialStorage })).rejects.toThrow(
      /listOlderThan/
    )
  })

  it('throws a clear error when the storage adapter does not support delete', async () => {
    const partialStorage: StorageAdapter = {
      name: 'partial',
      async upload() {
        throw new Error('not used')
      },
      async listOlderThan() {
        return [{ deliveryId: 'a.png', uploadedAt: 1 }]
      },
      // no delete
    }
    await expect(pruneOlderThan(Date.now(), { storage: partialStorage })).rejects.toThrow(
      /delete/
    )
  })

  it('respects an injected logger for per-deletion progress', async () => {
    const logger = vi.fn()
    const cutoff = Date.now()
    const storage = fakeStorage({
      entries: [
        { deliveryId: 'a.png', uploadedAt: cutoff - 1000 },
        { deliveryId: 'b.png', uploadedAt: cutoff - 1000 },
      ],
    })
    await pruneOlderThan(cutoff, { storage, log: logger })
    expect(logger).toHaveBeenCalledWith(expect.objectContaining({ event: 'deleted', deliveryId: 'a.png' }))
    expect(logger).toHaveBeenCalledWith(expect.objectContaining({ event: 'deleted', deliveryId: 'b.png' }))
  })
})

describe('pruneOlderThan with retentionDays helper signature', () => {
  it('accepts a retentionDays input by computing the cutoff from now', async () => {
    // Provide entries: one 10 days old, one 1 hour old. retentionDays=7 →
    // delete the 10-day-old, keep the 1-hour-old.
    const tenDaysAgo = Date.now() - 10 * 24 * 60 * 60 * 1000
    const oneHourAgo = Date.now() - 60 * 60 * 1000
    const storage = fakeStorage({
      entries: [
        { deliveryId: 'old.png', uploadedAt: tenDaysAgo },
        { deliveryId: 'fresh.png', uploadedAt: oneHourAgo },
      ],
    })
    const { deletedUploads } = await pruneOlderThan(
      { retentionDays: 7 },
      { storage }
    )
    expect(deletedUploads).toBe(1)
    expect(storage.deleteCalls).toEqual(['old.png'])
  })
})
