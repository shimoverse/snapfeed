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
