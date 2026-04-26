'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { AuditEvent } from 'snapfeed/audit-log'

interface Props {
  events: AuditEvent[]
  types: string[]
  activeType?: string
}

export function AuditView({ events, types, activeType }: Props) {
  const router = useRouter()
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null)

  const setType = (t: string | undefined) => {
    if (!t) router.replace('/audit')
    else router.replace(`/audit?type=${encodeURIComponent(t)}`)
  }

  const grouped = useMemo(() => {
    const counts = new Map<string, number>()
    for (const e of events) counts.set(e.type, (counts.get(e.type) ?? 0) + 1)
    return counts
  }, [events])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Type filter */}
      <div
        style={{
          display: 'flex',
          gap: 6,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <FilterChip
          label={`All (${events.length})`}
          active={!activeType}
          onClick={() => setType(undefined)}
        />
        {types.map(t => (
          <FilterChip
            key={t}
            label={`${t}${grouped.get(t) ? ` (${grouped.get(t)})` : ''}`}
            active={activeType === t}
            onClick={() => setType(activeType === t ? undefined : t)}
          />
        ))}
      </div>

      {/* List */}
      {events.length === 0 ? (
        <div
          style={{
            background: '#fff',
            border: '1px dashed #E5E7EB',
            borderRadius: 12,
            padding: 24,
            color: '#6B7280',
            fontSize: 13,
            textAlign: 'center',
          }}
        >
          No audit events to show.
        </div>
      ) : (
        <div
          style={{
            background: '#fff',
            border: '1px solid #E5E7EB',
            borderRadius: 12,
            overflow: 'hidden',
          }}
        >
          {events.map((e, i) => {
            const expanded = expandedIdx === i
            return (
              <div key={`${e.ts}-${i}`}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setExpandedIdx(expanded ? null : i)}
                  onKeyDown={ev => {
                    if (ev.key === 'Enter' || ev.key === ' ') {
                      ev.preventDefault()
                      setExpandedIdx(expanded ? null : i)
                    }
                  }}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '180px 180px 1fr',
                    gap: 12,
                    padding: '10px 14px',
                    borderBottom: '1px solid #F3F4F6',
                    fontSize: 13,
                    cursor: 'pointer',
                    background: expanded ? '#FAFAF7' : '#fff',
                    alignItems: 'center',
                  }}
                >
                  <div
                    style={{
                      color: '#6B7280',
                      fontFamily: 'ui-monospace, Menlo, monospace',
                      fontSize: 12,
                    }}
                  >
                    {formatTimestamp(e.ts)}
                  </div>
                  <div
                    style={{
                      color: typeColor(e.type),
                      fontFamily: 'ui-monospace, Menlo, monospace',
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    {e.type}
                  </div>
                  <div
                    style={{
                      color: '#374151',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {summarize(e)}
                  </div>
                </div>
                {expanded ? (
                  <pre
                    style={{
                      margin: 0,
                      padding: 16,
                      background: '#F9FAFB',
                      borderBottom: '1px solid #F3F4F6',
                      fontSize: 12,
                      overflow: 'auto',
                      maxHeight: 320,
                    }}
                  >
                    {JSON.stringify(e, null, 2)}
                  </pre>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '4px 10px',
        borderRadius: 999,
        border: `1px solid ${active ? '#D4714B' : '#D1D5DB'}`,
        background: active ? '#D4714B1A' : '#fff',
        color: active ? '#D4714B' : '#374151',
        fontSize: 12,
        fontWeight: 600,
        cursor: 'pointer',
        fontFamily: 'ui-monospace, Menlo, monospace',
      }}
    >
      {label}
    </button>
  )
}

function summarize(e: AuditEvent): string {
  switch (e.type) {
    case 'feedback.received':
      return `${e.category ?? 'uncategorised'} from ${e.reporter ?? 'anonymous'} on ${e.pageUrl} (${e.payloadSize}B)`
    case 'adapter.dispatched':
      return `${e.adapter} → ${e.ok ? 'ok' : 'fail'} in ${e.durationMs}ms${
        e.error ? ` · ${e.error}` : ''
      }`
    case 'llm.called':
      return `${e.provider}/${e.feature} · ${e.tokensUsed} tokens${e.degraded ? ' · degraded' : ''}`
    case 'config.changed':
      return `${e.section}: ${e.summary}`
    case 'rate_limit.hit':
      return `${e.key}${e.ip ? ` from ${e.ip}` : ''}`
    default:
      return ''
  }
}

function typeColor(t: string): string {
  switch (t) {
    case 'feedback.received':
      return '#0EA5E9'
    case 'adapter.dispatched':
      return '#059669'
    case 'llm.called':
      return '#D4714B'
    case 'config.changed':
      return '#7C3AED'
    case 'rate_limit.hit':
      return '#DC2626'
    default:
      return '#6B7280'
  }
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
}
