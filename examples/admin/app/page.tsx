import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { FeedbackPayload } from 'snapfeed'
import { Inbox } from './inbox'

/**
 * Server component. Reads SNAPFEED_FEEDBACK_FILE (default ./feedback.jsonl),
 * parses each non-empty line as a FeedbackPayload, and hands the array to
 * the <Inbox /> client island.
 *
 * If the file is missing, renders an empty-state with wiring instructions.
 */
export default async function AdminPage() {
  const filePath = process.env.SNAPFEED_FEEDBACK_FILE ?? './feedback.jsonl'
  const absolute = path.isAbsolute(filePath)
    ? filePath
    : path.join(process.cwd(), filePath)

  const result = await loadFeedback(absolute)

  if (!result.exists) {
    return (
      <section
        style={{
          background: '#fff',
          border: '1px dashed #E5E7EB',
          borderRadius: 12,
          padding: 24,
          fontSize: 14,
          lineHeight: 1.6,
          color: '#374151',
        }}
      >
        <h2 style={{ margin: '0 0 8px', fontSize: 16 }}>No feedback file yet</h2>
        <p style={{ margin: '0 0 12px' }}>
          The admin reads feedback from a JSONL file written by{' '}
          <code>snapfeed/adapters</code>{`'`} <code>fileAdapter</code>. Configure
          your app:
        </p>
        <pre
          style={{
            background: '#F3F4F6',
            border: '1px solid #E5E7EB',
            borderRadius: 6,
            padding: 12,
            overflow: 'auto',
            fontSize: 13,
            margin: 0,
          }}
        >
{`import { fileAdapter } from 'snapfeed/adapters'

export const adapters = [
  fileAdapter({ path: '${filePath}' }),
]`}
        </pre>
        <p style={{ margin: '12px 0 0', color: '#6B7280' }}>
          Looking for: <code>{absolute}</code>
        </p>
      </section>
    )
  }

  if (result.parseErrors > 0) {
    return (
      <>
        <ParseWarning
          parseErrors={result.parseErrors}
          fileLabel={filePath}
          totalLines={result.totalLines}
        />
        <Inbox feedback={result.feedback} />
      </>
    )
  }

  return <Inbox feedback={result.feedback} />
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

type LoadResult =
  | { exists: false }
  | {
      exists: true
      feedback: FeedbackPayload[]
      parseErrors: number
      totalLines: number
    }

async function loadFeedback(absolute: string): Promise<LoadResult> {
  let raw: string
  try {
    raw = await fs.readFile(absolute, 'utf-8')
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    if (err.code === 'ENOENT') return { exists: false }
    throw e
  }

  const lines = raw.split('\n').filter(l => l.trim().length > 0)
  const feedback: FeedbackPayload[] = []
  let parseErrors = 0

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as FeedbackPayload
      feedback.push(parsed)
    } catch {
      parseErrors++
    }
  }

  // Newest first
  feedback.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))

  return { exists: true, feedback, parseErrors, totalLines: lines.length }
}

function ParseWarning({
  parseErrors,
  fileLabel,
  totalLines,
}: {
  parseErrors: number
  fileLabel: string
  totalLines: number
}) {
  return (
    <div
      style={{
        background: '#FEF3C7',
        border: '1px solid #FCD34D',
        borderRadius: 8,
        padding: '10px 14px',
        fontSize: 13,
        marginBottom: 16,
        color: '#92400E',
      }}
    >
      Skipped {parseErrors} of {totalLines} line(s) in <code>{fileLabel}</code>{' '}
      that failed to parse as JSON.
    </div>
  )
}
