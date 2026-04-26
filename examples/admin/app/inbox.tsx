'use client'

import { useMemo, useState } from 'react'
import type { FeedbackPayload, FeedbackCategory } from 'snapfeed'

interface InboxProps {
  feedback: FeedbackPayload[]
}

const CATEGORIES: FeedbackCategory[] = ['bug', 'idea', 'question', 'praise', 'other']

const CATEGORY_COLOR: Record<FeedbackCategory, string> = {
  bug: '#DC2626',
  idea: '#D4714B',
  question: '#0EA5E9',
  praise: '#059669',
  other: '#6B7280',
}

export function Inbox({ feedback }: InboxProps) {
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState<FeedbackCategory | null>(null)
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [resolvedKeys, setResolvedKeys] = useState<Set<string>>(new Set())

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return feedback.filter(f => {
      if (activeCategory && f.category !== activeCategory) return false
      if (!q) return true
      const haystack = [
        f.text,
        f.pageName,
        f.user?.name,
        f.user?.email,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(q)
    })
  }, [feedback, search, activeCategory])

  if (feedback.length === 0) {
    return (
      <p style={{ color: '#6B7280', fontSize: 14 }}>
        Feedback file is empty. Submit some feedback from your app to populate the inbox.
      </p>
    )
  }

  return (
    <div>
      {/* Controls */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search text, page, reporter…"
          style={{
            flex: '1 1 240px',
            padding: '8px 12px',
            border: '1px solid #D1D5DB',
            borderRadius: 8,
            fontSize: 14,
            background: '#fff',
          }}
        />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Chip
            label="All"
            active={activeCategory === null}
            color="#374151"
            onClick={() => setActiveCategory(null)}
          />
          {CATEGORIES.map(c => (
            <Chip
              key={c}
              label={c}
              active={activeCategory === c}
              color={CATEGORY_COLOR[c]}
              onClick={() => setActiveCategory(c === activeCategory ? null : c)}
            />
          ))}
        </div>
      </div>

      <div style={{ color: '#6B7280', fontSize: 13, marginBottom: 8 }}>
        Showing {filtered.length} of {feedback.length}
      </div>

      {/* Table */}
      <div
        style={{
          background: '#fff',
          border: '1px solid #E5E7EB',
          borderRadius: 12,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '160px 90px 160px 160px 1fr 110px',
            gap: 0,
            background: '#F9FAFB',
            borderBottom: '1px solid #E5E7EB',
            padding: '10px 14px',
            fontSize: 12,
            fontWeight: 600,
            color: '#6B7280',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
        >
          <div>When</div>
          <div>Category</div>
          <div>Page</div>
          <div>Reporter</div>
          <div>Text</div>
          <div>Actions</div>
        </div>

        {filtered.map((f, i) => {
          const key = rowKey(f, i)
          const expanded = expandedKey === key
          const resolved = resolvedKeys.has(key)
          return (
            <div key={key}>
              <div
                onClick={() => setExpandedKey(expanded ? null : key)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '160px 90px 160px 160px 1fr 110px',
                  gap: 0,
                  padding: '12px 14px',
                  borderBottom: '1px solid #F3F4F6',
                  fontSize: 13,
                  cursor: 'pointer',
                  background: expanded ? '#FAFAF7' : '#fff',
                  opacity: resolved ? 0.55 : 1,
                  alignItems: 'center',
                }}
              >
                <div style={{ color: '#6B7280', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12 }}>
                  {formatTimestamp(f.timestamp)}
                </div>
                <div>
                  {f.category ? (
                    <span
                      style={{
                        background: `${CATEGORY_COLOR[f.category]}1A`,
                        color: CATEGORY_COLOR[f.category],
                        padding: '2px 8px',
                        borderRadius: 4,
                        fontSize: 11,
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        letterSpacing: '0.03em',
                      }}
                    >
                      {f.category}
                    </span>
                  ) : (
                    <span style={{ color: '#9CA3AF' }}>—</span>
                  )}
                </div>
                <div style={{ color: '#374151' }}>{f.pageName || '—'}</div>
                <div style={{ color: '#374151' }}>
                  {f.user?.name ?? f.user?.email ?? '—'}
                </div>
                <div style={{ color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {truncate(f.text, 100)}
                </div>
                <div onClick={e => e.stopPropagation()}>
                  <button
                    type="button"
                    onClick={() => toggleResolved(key, setResolvedKeys)}
                    style={{
                      padding: '4px 10px',
                      border: '1px solid #D1D5DB',
                      borderRadius: 6,
                      background: resolved ? '#D1FAE5' : '#fff',
                      color: resolved ? '#065F46' : '#374151',
                      cursor: 'pointer',
                      fontSize: 12,
                    }}
                  >
                    {resolved ? 'Resolved' : 'Mark resolved'}
                  </button>
                </div>
              </div>

              {expanded ? <ExpandedRow feedback={f} /> : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Subcomponents ────────────────────────────────────────────────────────────

function ExpandedRow({ feedback }: { feedback: FeedbackPayload }) {
  return (
    <div
      style={{
        padding: '16px 20px',
        background: '#FAFAF7',
        borderBottom: '1px solid #F3F4F6',
        fontSize: 13,
        color: '#1F2937',
      }}
    >
      <div style={{ marginBottom: 12 }}>
        <Label>Full text</Label>
        <p style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{feedback.text}</p>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, marginBottom: 12 }}>
        <Field label="App" value={feedback.appName} />
        <Field label="Page URL" value={feedback.pageUrl} />
        <Field
          label="Reporter"
          value={
            feedback.user?.name || feedback.user?.email
              ? `${feedback.user?.name ?? ''}${feedback.user?.email ? ` <${feedback.user.email}>` : ''}`
              : '—'
          }
        />
      </div>

      {feedback.metadata ? (
        <div style={{ marginBottom: 12 }}>
          <Label>Metadata</Label>
          <ul style={{ margin: '4px 0 0', padding: 0, listStyle: 'none', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12 }}>
            <li>viewport: {feedback.metadata.viewport}</li>
            <li style={{ wordBreak: 'break-all' }}>userAgent: {feedback.metadata.userAgent}</li>
            {feedback.metadata.consoleErrors && feedback.metadata.consoleErrors.length > 0 ? (
              <li>
                consoleErrors ({feedback.metadata.consoleErrors.length}):
                <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                  {feedback.metadata.consoleErrors.map((err, i) => (
                    <li key={i} style={{ color: '#DC2626' }}>{err}</li>
                  ))}
                </ul>
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}

      {feedback.screenshot?.base64 ? (
        <div>
          <Label>Screenshot</Label>
          <img
            src={`data:${feedback.screenshot.mimeType};base64,${feedback.screenshot.base64}`}
            alt="Screenshot from feedback submission"
            style={{
              display: 'block',
              marginTop: 4,
              maxWidth: '100%',
              border: '1px solid #E5E7EB',
              borderRadius: 6,
            }}
          />
        </div>
      ) : null}
    </div>
  )
}

function Chip({
  label,
  active,
  color,
  onClick,
}: {
  label: string
  active: boolean
  color: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '6px 12px',
        borderRadius: 999,
        border: `1px solid ${active ? color : '#D1D5DB'}`,
        background: active ? `${color}1A` : '#fff',
        color: active ? color : '#374151',
        fontSize: 12,
        fontWeight: 600,
        cursor: 'pointer',
        textTransform: 'capitalize',
      }}
    >
      {label}
    </button>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 600,
        color: '#6B7280',
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
      }}
    >
      {children}
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Label>{label}</Label>
      <div style={{ marginTop: 2, wordBreak: 'break-all' }}>{value}</div>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function rowKey(f: FeedbackPayload, i: number): string {
  return `${f.timestamp}-${i}`
}

function toggleResolved(key: string, setter: React.Dispatch<React.SetStateAction<Set<string>>>) {
  setter(prev => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s
  return s.slice(0, n - 1) + '…'
}

function formatTimestamp(iso: string): string {
  // Stable, locale-free format so server + client agree.
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}
