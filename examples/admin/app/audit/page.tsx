import { requireUser } from '../../lib/auth'
import { getConfiguredPaths, listAuditEvents } from '../../lib/data'
import { AuditView } from './audit-view'

interface SearchParams {
  type?: string | string[]
}

const KNOWN_TYPES = [
  'feedback.received',
  'adapter.dispatched',
  'llm.called',
  'config.changed',
  'rate_limit.hit',
] as const

export default async function AuditPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  requireUser()

  const typeRaw = Array.isArray(searchParams.type)
    ? searchParams.type[0]
    : searchParams.type
  const type = typeRaw && KNOWN_TYPES.includes(typeRaw as (typeof KNOWN_TYPES)[number])
    ? typeRaw
    : undefined

  const events = await listAuditEvents({ limit: 200, type })
  const paths = getConfiguredPaths()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <header>
        <h1 style={{ margin: 0, fontSize: 22 }}>Audit log</h1>
        <p
          style={{
            margin: '4px 0 0',
            color: '#6B7280',
            fontSize: 13,
          }}
        >
          Last 200 events. Read-only — the audit log is immutable. Reading from{' '}
          <code>{paths.audit}</code>.
        </p>
      </header>

      <AuditView
        events={events}
        types={[...KNOWN_TYPES]}
        activeType={type}
      />
    </div>
  )
}
