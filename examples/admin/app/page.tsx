import { promises as fs } from 'node:fs'
import { Inbox } from './inbox'
import { requireUser } from '../lib/auth'
import {
  getConfiguredPaths,
  listCampaigns,
  listFeedback,
  type AdminFeedbackStatus,
  type ListFeedbackOptions,
} from '../lib/data'

interface SearchParams {
  [key: string]: string | string[] | undefined
}

/**
 * Server component. Reads filters from search params, queries the data layer,
 * and hands the results off to the client `<Inbox />`. Auth is enforced via
 * the placeholder shim in `lib/auth.ts`.
 */
export default async function AdminPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  requireUser()

  const filters = parseSearchParams(searchParams)
  const paths = getConfiguredPaths()

  const feedbackFileExists = await pathExists(paths.feedback)
  if (!feedbackFileExists) {
    return <EmptyFile filePath={paths.feedback} />
  }

  let records
  try {
    records = await listFeedback(filters)
  } catch (e) {
    return <LoadError filePath={paths.feedback} message={(e as Error).message} />
  }

  const campaigns = await listCampaigns()

  return (
    <Inbox
      records={records}
      campaigns={campaigns.map(c => ({ id: c.id, name: c.name }))}
      filters={filters}
      filePath={paths.feedback}
    />
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseSearchParams(sp: SearchParams): ListFeedbackOptions {
  const get = (k: string): string | undefined => {
    const v = sp[k]
    if (Array.isArray(v)) return v[0]
    return v
  }

  const status = get('status') as AdminFeedbackStatus | undefined
  const validStatus: AdminFeedbackStatus[] = [
    'open',
    'triaged',
    'resolved',
    'wontfix',
  ]
  const hasScreenshotRaw = get('hasScreenshot')

  return {
    dateFrom: get('dateFrom'),
    dateTo: get('dateTo'),
    category: get('category'),
    status: status && validStatus.includes(status) ? status : undefined,
    reporter: get('reporter'),
    pageUrlContains: get('pageUrlContains'),
    hasScreenshot:
      hasScreenshotRaw === '1'
        ? true
        : hasScreenshotRaw === '0'
          ? false
          : undefined,
    campaign: get('campaign'),
    search: get('search'),
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p)
    return true
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw e
  }
}

function EmptyFile({ filePath }: { filePath: string }) {
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
        The admin reads from a JSONL file written by{' '}
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
        Looking for: <code>{filePath}</code>
      </p>
    </section>
  )
}

function LoadError({
  filePath,
  message,
}: {
  filePath: string
  message: string
}) {
  return (
    <section
      style={{
        background: '#FEF2F2',
        border: '1px solid #FECACA',
        borderRadius: 12,
        padding: 20,
        fontSize: 14,
        color: '#991B1B',
      }}
    >
      <h2 style={{ margin: '0 0 8px', fontSize: 16 }}>
        Couldn{`'`}t load feedback file
      </h2>
      <p style={{ margin: '0 0 8px' }}>
        Tried <code>{filePath}</code>. Check{' '}
        <code>SNAPFEED_FEEDBACK_FILE</code> env.
      </p>
      <pre
        style={{
          background: '#fff',
          border: '1px solid #FECACA',
          borderRadius: 6,
          padding: 10,
          margin: '8px 0 0',
          color: '#7F1D1D',
          fontSize: 12,
          overflow: 'auto',
        }}
      >
        {message}
      </pre>
    </section>
  )
}
