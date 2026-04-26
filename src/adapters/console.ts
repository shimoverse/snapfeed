import type { FeedbackAdapter, FeedbackAdapterResult, FeedbackPayload } from './types'

export interface ConsoleAdapterOptions {
  /** Log level to use. @default "log" */
  level?: 'log' | 'info' | 'debug' | 'warn'
  /** Whether to pretty-print the payload. @default true */
  pretty?: boolean
}

/**
 * Console adapter — logs feedback payloads to the browser/Node console.
 * Useful for local development and testing without any backend setup.
 *
 * @example
 * consoleAdapter()
 * consoleAdapter({ level: 'info' })
 */
export function consoleAdapter(options: ConsoleAdapterOptions = {}): FeedbackAdapter {
  const { level = 'log', pretty = true } = options

  return {
    name: 'console',
    async send(payload: FeedbackPayload): Promise<FeedbackAdapterResult> {
      const fn = console[level] ?? console.log
      // Wrapped so a consumer who monkey-patches console.log to throw cannot
      // crash the adapter pipeline.
      try {
        fn(
          '[devtools/feedback]',
          pretty ? JSON.stringify(payload, null, 2) : payload
        )
        return { ok: true }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { ok: false, error: `Console adapter error: ${message}` }
      }
    },
  }
}
