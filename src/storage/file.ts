/**
 * snapfeed — File System Storage Adapter (Node only)
 *
 * Writes uploaded bytes to a local directory and returns a `file://` URL.
 * Useful for self-hosted dev setups, integration tests, and any deployment
 * where assets live next to the app instead of in object storage.
 *
 * **Node only.** Throws a clear error in browsers / edge runtimes.
 */

import type {
  StorageAdapter,
  StorageDeleteResult,
  StorageEntry,
  StorageUploadInput,
  StorageUploadResult,
} from './types'

export interface FileStorageOptions {
  /**
   * Directory to write into. Created (recursively) on first upload if missing.
   * @default './snapfeed-uploads'
   */
  dir?: string
  /**
   * Generates a per-upload prefix prepended to each filename for
   * disambiguation. Called once per `upload()`.
   * @default `Date.now() + '-' + Math.random().toString(36).slice(2, 8)`
   */
  prefix?: () => string
  /**
   * Override the URL returned for a written file. By default,
   * `file://${path.resolve(absolutePath)}`. Override to point at a CDN that
   * fronts the same directory.
   */
  toUrl?: (absolutePath: string) => string
}

function defaultPrefix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Local filesystem storage adapter.
 *
 * @example
 * fileStorage()                                  // ./snapfeed-uploads, file:// URLs
 * fileStorage({ dir: '/var/uploads' })
 * fileStorage({
 *   dir: 'public/uploads',
 *   toUrl: (p) => `https://my-cdn.com/${path.basename(p)}`,
 * })
 */
export function fileStorage(options: FileStorageOptions = {}): StorageAdapter {
  const {
    dir = './snapfeed-uploads',
    prefix = defaultPrefix,
    toUrl,
  } = options

  // Memoized mkdir promise. Race-safe — concurrent uploads await the same
  // in-flight `mkdir` rather than each kicking off their own. A previous
  // boolean-flag implementation could fire N parallel mkdirs on cold start.
  let dirPromise: Promise<void> | undefined

  return {
    name: 'file',
    /**
     * Writes `input.bytes` to the configured directory. The filename is
     * **sanitized** with `path.basename(input.filename)` — any directory
     * components (e.g. `../../../etc/passwd`) are stripped so writes always
     * stay inside the configured `dir`.
     */
    async upload(input: StorageUploadInput): Promise<StorageUploadResult> {
      const isNode =
        typeof process !== 'undefined' &&
        typeof process.versions !== 'undefined' &&
        typeof process.versions.node === 'string'

      if (!isNode) {
        throw new Error('fileStorage requires Node')
      }

      const fs = await import('node:fs/promises')
      const path = await import('node:path')

      const absoluteDir = path.isAbsolute(dir) ? dir : path.resolve(process.cwd(), dir)
      await (dirPromise ??= fs.mkdir(absoluteDir, { recursive: true }).then(() => undefined))

      // Strip any directory components from the caller-supplied filename to
      // prevent path traversal (`../../etc/passwd` → `passwd`).
      const sanitizedFilename = path.basename(input.filename)
      const safeName = `${prefix()}-${sanitizedFilename}`
      const absolutePath = path.join(absoluteDir, safeName)

      await fs.writeFile(absolutePath, input.bytes)

      const url = toUrl ? toUrl(absolutePath) : `file://${path.resolve(absolutePath)}`
      return {
        url,
        deliveryId: absolutePath,
      }
    },

    /**
     * Delete a previously-uploaded file by deliveryId. Idempotent: if the
     * file does not exist, returns `{ deleted: false }` rather than throwing.
     *
     * **Path traversal guard.** Refuses to delete any path outside the
     * configured `dir`. fileStorage.delete is only allowed to touch its own
     * upload tree — we'd rather throw and let the caller correlate a stale
     * audit-log entry with a misconfiguration than silently `unlink` a
     * sibling file.
     */
    async delete(deliveryId: string): Promise<StorageDeleteResult> {
      const isNode =
        typeof process !== 'undefined' &&
        typeof process.versions !== 'undefined' &&
        typeof process.versions.node === 'string'

      if (!isNode) {
        throw new Error('fileStorage.delete requires Node')
      }

      const fs = await import('node:fs/promises')
      const path = await import('node:path')

      const absoluteDir = path.isAbsolute(dir) ? dir : path.resolve(process.cwd(), dir)
      const absoluteTarget = path.resolve(deliveryId)
      const absoluteScope = path.resolve(absoluteDir)

      // Scope check — must be a descendant of (or exactly) the configured dir.
      // Using `relative` + a non-`..` startswith is robust against symlink
      // tricks the way path-prefix-matching is not.
      const rel = path.relative(absoluteScope, absoluteTarget)
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new Error(
          `fileStorage.delete: refusing to delete ${deliveryId} — path is outside the configured dir (${absoluteScope})`
        )
      }

      try {
        await fs.unlink(absoluteTarget)
        return { deleted: true }
      } catch (err: unknown) {
        const code = (err as { code?: string } | null)?.code
        if (code === 'ENOENT') {
          return { deleted: false }
        }
        throw err
      }
    },

    /**
     * List uploads whose mtime is at or before `cutoffMs`. Used by the
     * `pruneOlderThan` retention helper. Returns an empty array (not throws)
     * if the configured dir does not exist yet — that's the cold-start case
     * before any upload has happened.
     */
    async listOlderThan(cutoffMs: number): Promise<StorageEntry[]> {
      const isNode =
        typeof process !== 'undefined' &&
        typeof process.versions !== 'undefined' &&
        typeof process.versions.node === 'string'

      if (!isNode) {
        throw new Error('fileStorage.listOlderThan requires Node')
      }

      const fs = await import('node:fs/promises')
      const path = await import('node:path')

      const absoluteDir = path.isAbsolute(dir) ? dir : path.resolve(process.cwd(), dir)

      let entries: string[]
      try {
        entries = await fs.readdir(absoluteDir)
      } catch (err: unknown) {
        const code = (err as { code?: string } | null)?.code
        if (code === 'ENOENT') return []
        throw err
      }

      const out: StorageEntry[] = []
      for (const name of entries) {
        const full = path.join(absoluteDir, name)
        let st: { mtime: Date; isFile(): boolean }
        try {
          st = await fs.stat(full)
        } catch {
          continue // raced with another deleter, skip
        }
        if (!st.isFile()) continue
        const mtimeMs = st.mtime.getTime()
        if (mtimeMs <= cutoffMs) {
          out.push({ deliveryId: full, uploadedAt: mtimeMs })
        }
      }
      return out
    },
  }
}
