/**
 * snapfeed — File System Storage Adapter (Node only)
 *
 * Writes uploaded bytes to a local directory and returns a `file://` URL.
 * Useful for self-hosted dev setups, integration tests, and any deployment
 * where assets live next to the app instead of in object storage.
 *
 * **Node only.** Throws a clear error in browsers / edge runtimes.
 */

import type { StorageAdapter, StorageUploadInput, StorageUploadResult } from './types'

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
  }
}
