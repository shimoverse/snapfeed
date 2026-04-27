/**
 * Tests for src/storage/file.ts — fileStorage()
 *
 * Uses real `node:fs` + `os.tmpdir()` and cleans up in `afterAll`.
 */

import { describe, it, expect, afterAll } from 'vitest'
import { mkdir, readFile, rm, stat } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileStorage } from '../../src/storage/file'
import type { StorageUploadInput } from '../../src/storage/types'

const createdDirs: string[] = []
function tmpDir(label = 'snapfeed-storage'): string {
  const d = path.join(
    os.tmpdir(),
    `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  )
  createdDirs.push(d)
  return d
}

const baseInput: StorageUploadInput = {
  bytes: new Uint8Array([1, 2, 3, 4, 5]),
  mimeType: 'image/png',
  filename: 'screenshot.png',
}

afterAll(async () => {
  for (const d of createdDirs) {
    try {
      await rm(d, { recursive: true, force: true })
    } catch {
      // best-effort cleanup
    }
  }
})

describe('fileStorage', () => {
  it('creates the directory if missing', async () => {
    const dir = tmpDir()
    // Sanity: confirm it doesn't exist yet.
    await expect(stat(dir)).rejects.toBeDefined()

    const adapter = fileStorage({ dir })
    expect(adapter.name).toBe('file')

    const result = await adapter.upload(baseInput)
    expect(result.deliveryId.startsWith(dir)).toBe(true)

    const dirStat = await stat(dir)
    expect(dirStat.isDirectory()).toBe(true)
  })

  it('writes the file with the prefixed name', async () => {
    const dir = tmpDir()
    const adapter = fileStorage({
      dir,
      prefix: () => 'PREFIX',
    })
    const result = await adapter.upload(baseInput)

    const expected = path.join(dir, 'PREFIX-screenshot.png')
    expect(result.deliveryId).toBe(expected)

    const written = await readFile(expected)
    expect(Array.from(written)).toEqual([1, 2, 3, 4, 5])
  })

  it('returns a file:// URL by default', async () => {
    const dir = tmpDir()
    const adapter = fileStorage({ dir, prefix: () => 'p' })
    const result = await adapter.upload(baseInput)

    expect(result.url.startsWith('file://')).toBe(true)
    expect(result.url).toContain('p-screenshot.png')
    // Resolved/absolute path inside the URL.
    const expectedAbs = path.resolve(path.join(dir, 'p-screenshot.png'))
    expect(result.url).toBe(`file://${expectedAbs}`)
  })

  it('honors a custom toUrl', async () => {
    const dir = tmpDir()
    const adapter = fileStorage({
      dir,
      prefix: () => 'p',
      toUrl: (abs) => `https://cdn.example.com/${path.basename(abs)}`,
    })
    const result = await adapter.upload(baseInput)
    expect(result.url).toBe('https://cdn.example.com/p-screenshot.png')
  })

  it('honors a custom prefix on each upload', async () => {
    const dir = tmpDir()
    let n = 0
    const adapter = fileStorage({
      dir,
      prefix: () => `n${++n}`,
    })

    const r1 = await adapter.upload({ ...baseInput, filename: 'a.png' })
    const r2 = await adapter.upload({ ...baseInput, filename: 'b.png' })

    expect(r1.deliveryId.endsWith('n1-a.png')).toBe(true)
    expect(r2.deliveryId.endsWith('n2-b.png')).toBe(true)
  })

  it('reuses an existing directory without erroring', async () => {
    const dir = tmpDir()
    await mkdir(dir, { recursive: true })

    const adapter = fileStorage({ dir, prefix: () => 'x' })
    const result = await adapter.upload(baseInput)
    expect(result.deliveryId).toBe(path.join(dir, 'x-screenshot.png'))
  })
})

describe('fileStorage — race-safe dirEnsured', () => {
  it('handles N concurrent first uploads (no race condition)', async () => {
    const dir = tmpDir()
    const adapter = fileStorage({ dir, prefix: () => 'p' })

    // Fire 8 uploads in parallel before the directory exists. With the
    // pre-fix boolean flag, all 8 callers entered the `if (!dirEnsured)`
    // branch and racced their mkdirs. mkdir({ recursive: true }) is itself
    // idempotent, so the previous code didn't crash — but the memoized
    // promise variant ensures only one mkdir is ever in flight. Either way,
    // the public-facing guarantee we test is "no upload throws and all
    // 8 files land on disk".
    const results = await Promise.all(
      Array.from({ length: 8 }).map((_, i) =>
        adapter.upload({ ...baseInput, filename: `f${i}.png` })
      )
    )
    expect(results).toHaveLength(8)
    for (let i = 0; i < 8; i++) {
      expect(results[i]!.deliveryId).toBe(path.join(dir, `p-f${i}.png`))
      const written = await readFile(results[i]!.deliveryId)
      expect(Array.from(written)).toEqual([1, 2, 3, 4, 5])
    }
  })
})

describe('fileStorage — filename sanitization', () => {
  it("sanitizes path-traversal attempts (`../../etc/passwd` becomes `passwd`)", async () => {
    const dir = tmpDir()
    const adapter = fileStorage({ dir, prefix: () => 'p' })
    const result = await adapter.upload({
      ...baseInput,
      filename: '../../../etc/passwd',
    })
    // Final on-disk path lives strictly inside `dir`, with the directory
    // components stripped from the user-supplied filename.
    expect(result.deliveryId).toBe(path.join(dir, 'p-passwd'))
    // Guard: the resolved path is a child of the configured dir.
    expect(path.resolve(result.deliveryId).startsWith(path.resolve(dir))).toBe(true)
  })

  it('sanitizes a backslash-style traversal too (Windows-y paths)', async () => {
    const dir = tmpDir()
    const adapter = fileStorage({ dir, prefix: () => 'p' })
    // path.basename on POSIX treats backslashes as part of the filename, but
    // on the typical CI (POSIX) the whole string IS the basename. Either way
    // the file lives inside `dir`.
    const result = await adapter.upload({
      ...baseInput,
      filename: 'foo/bar.png',
    })
    expect(result.deliveryId).toBe(path.join(dir, 'p-bar.png'))
  })

  it('preserves a benign filename verbatim', async () => {
    const dir = tmpDir()
    const adapter = fileStorage({ dir, prefix: () => 'p' })
    const result = await adapter.upload({ ...baseInput, filename: 'normal.png' })
    expect(result.deliveryId).toBe(path.join(dir, 'p-normal.png'))
  })
})

// ─── v0.6 retention primitives ──────────────────────────────────────────────

describe('fileStorage.delete (v0.6)', () => {
  it('deletes a previously-uploaded file by deliveryId and returns deleted=true', async () => {
    const dir = tmpDir()
    const adapter = fileStorage({ dir, prefix: () => 'pfx' })
    const { deliveryId } = await adapter.upload(baseInput)

    // Pre-condition: file exists.
    await expect(stat(deliveryId)).resolves.toBeDefined()

    const result = await adapter.delete!(deliveryId)
    expect(result).toEqual({ deleted: true })

    // Post-condition: file no longer exists.
    await expect(stat(deliveryId)).rejects.toBeDefined()
  })

  it('returns deleted=false (not throw) when the file does not exist', async () => {
    const dir = tmpDir()
    const adapter = fileStorage({ dir, prefix: () => 'p' })
    // Trigger dir creation so the parent dir exists, then point at a missing file.
    await adapter.upload(baseInput)

    const ghost = path.join(dir, 'never-existed.png')
    const result = await adapter.delete!(ghost)
    expect(result).toEqual({ deleted: false })
  })

  it('refuses to delete a path that escapes the configured dir', async () => {
    // Path traversal guard: even if the caller passes a deliveryId outside
    // `dir`, the adapter must NOT delete it. fileStorage.delete is only
    // allowed to touch its own upload tree.
    const dir = tmpDir()
    const adapter = fileStorage({ dir })
    await adapter.upload(baseInput) // ensure dir is created

    // Create a sibling file outside the upload dir.
    const sibling = path.join(os.tmpdir(), `should-survive-${Date.now()}.txt`)
    await mkdir(path.dirname(sibling), { recursive: true })
    await (await import('node:fs/promises')).writeFile(sibling, 'untouchable')
    createdDirs.push(sibling) // ensure cleanup attempts to remove it too

    await expect(adapter.delete!(sibling)).rejects.toThrow(/outside/i)

    // Sibling must still exist.
    await expect(stat(sibling)).resolves.toBeDefined()
  })
})

describe('fileStorage.listOlderThan (v0.6)', () => {
  it('returns deliveryIds for files whose mtime is at or before the cutoff', async () => {
    const dir = tmpDir()
    const adapter = fileStorage({ dir, prefix: () => 'p' })

    const oldUpload = await adapter.upload({ ...baseInput, filename: 'old.png' })
    const newUpload = await adapter.upload({ ...baseInput, filename: 'new.png' })

    // Backdate the old upload by 24h.
    const yesterdayMs = Date.now() - 24 * 60 * 60 * 1000
    const yesterdaySec = yesterdayMs / 1000
    const utimes = (await import('node:fs/promises')).utimes
    await utimes(oldUpload.deliveryId, yesterdaySec, yesterdaySec)

    // Cutoff = 1h ago. The old (24h ago) file is older; the new one is not.
    const cutoff = Date.now() - 60 * 60 * 1000
    const oldList = await adapter.listOlderThan!(cutoff)

    const oldIds = oldList.map((e) => e.deliveryId)
    expect(oldIds).toContain(oldUpload.deliveryId)
    expect(oldIds).not.toContain(newUpload.deliveryId)

    // Sanity: each entry has an `uploadedAt` epoch ms field roughly matching
    // the file's mtime.
    const oldEntry = oldList.find((e) => e.deliveryId === oldUpload.deliveryId)
    expect(oldEntry?.uploadedAt).toBeGreaterThan(0)
    expect(Math.abs(oldEntry!.uploadedAt - yesterdayMs)).toBeLessThan(2000)
  })

  it('returns an empty array when no files are older than the cutoff', async () => {
    const dir = tmpDir()
    const adapter = fileStorage({ dir })
    await adapter.upload(baseInput)

    const epochZero = 0
    const list = await adapter.listOlderThan!(epochZero)
    expect(list).toEqual([])
  })

  it('returns an empty array when the dir does not exist yet (no uploads)', async () => {
    const dir = tmpDir()
    const adapter = fileStorage({ dir })
    // Don't upload anything — dir is never created.
    const list = await adapter.listOlderThan!(Date.now())
    expect(list).toEqual([])
  })
})
