/**
 * snapfeed — JSONL File Adapter (Node only)
 *
 * Appends each feedback payload as a JSON line to a local file. Designed for
 * zero-config local development: with no options, it writes to `feedback.jsonl`
 * in the current working directory.
 *
 * **Node only.** Returns `{ ok: false, error: 'fileAdapter requires Node' }`
 * in browsers, edge runtimes, or any environment without `process.versions.node`.
 *
 * @example
 * import { fileAdapter } from 'snapfeed/adapters'
 *
 * // Default: writes to ./feedback.jsonl (one JSON object per line)
 * fileAdapter()
 *
 * // Custom path with pretty printing and screenshots preserved
 * fileAdapter({
 *   path: 'logs/feedback.jsonl',
 *   pretty: true,
 *   redactScreenshot: false,
 * })
 */

import type { FeedbackAdapter, FeedbackAdapterResult, FeedbackPayload } from './types'

export interface FileAdapterOptions {
  /**
   * Path (absolute or relative to cwd) of the file to append to.
   * Parent directories are auto-created if missing.
   * @default "feedback.jsonl"
   */
  path?: string
  /**
   * If true, write each payload as multi-line indented JSON separated by
   * `\n---\n`. Otherwise (default) write a single JSON line per payload (JSONL).
   * @default false
   */
  pretty?: boolean
  /**
   * Replace `screenshot.base64` with the literal string `[base64 omitted]`
   * before writing, so the file stays small and human-readable.
   * @default true
   */
  redactScreenshot?: boolean
}

function redact(payload: FeedbackPayload): FeedbackPayload {
  if (!payload.screenshot?.base64) return payload
  return {
    ...payload,
    screenshot: {
      ...payload.screenshot,
      base64: '[base64 omitted]',
    },
  }
}

/**
 * JSONL file adapter — appends each payload as a JSON line to a file.
 * Node-only. Useful for local development and ad-hoc capture in scripts.
 *
 * @example
 * fileAdapter({ path: 'feedback.jsonl' })
 */
export function fileAdapter(options: FileAdapterOptions = {}): FeedbackAdapter {
  const {
    path: filePath = 'feedback.jsonl',
    pretty = false,
    redactScreenshot = true,
  } = options

  return {
    name: 'file',
    async send(payload: FeedbackPayload): Promise<FeedbackAdapterResult> {
      // Node detection — guard against browsers and edge runtimes.
      const isNode =
        typeof process !== 'undefined' &&
        typeof process.versions !== 'undefined' &&
        typeof process.versions.node === 'string'

      if (!isNode) {
        return { ok: false, error: 'fileAdapter requires Node' }
      }

      try {
        const fs = await import('node:fs/promises')
        const path = await import('node:path')

        const absolutePath = path.isAbsolute(filePath)
          ? filePath
          : path.resolve(process.cwd(), filePath)

        // Auto-create parent directory if missing.
        const parentDir = path.dirname(absolutePath)
        await fs.mkdir(parentDir, { recursive: true })

        const data = redactScreenshot ? redact(payload) : payload
        const serialized = pretty
          ? `${JSON.stringify(data, null, 2)}\n---\n`
          : `${JSON.stringify(data)}\n`

        await fs.appendFile(absolutePath, serialized, 'utf8')

        return { ok: true, deliveryId: absolutePath }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { ok: false, error: `File adapter error: ${message}` }
      }
    },
  }
}
