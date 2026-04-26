'use client'

import { useCallback, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { FeedbackCategory } from 'snapfeed'
import { SavedViewsControl } from './saved-views'
import type {
  AdminFeedbackRecord,
  AdminFeedbackStatus,
  ListFeedbackOptions,
} from '../lib/data'

interface InboxProps {
  records: AdminFeedbackRecord[]
  campaigns: Array<{ id: string; name: string }>
  filters: ListFeedbackOptions
  filePath: string
}

const CATEGORIES: FeedbackCategory[] = [
  'bug',
  'idea',
  'question',
  'praise',
  'other',
]
const STATUSES: AdminFeedbackStatus[] = [
  'open',
  'triaged',
  'resolved',
  'wontfix',
]

const CATEGORY_COLOR: Record<FeedbackCategory, string> = {
  bug: '#DC2626',
  idea: '#D4714B',
  question: '#0EA5E9',
  praise: '#059669',
  other: '#6B7280',
}

const STATUS_COLOR: Record<AdminFeedbackStatus, string> = {
  open: '#D97706',
  triaged: '#0EA5E9',
  resolved: '#059669',
  wontfix: '#6B7280',
}

const PAGE_SIZE = 50

export function Inbox({ records, campaigns, filters, filePath }: InboxProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [busy, setBusy] = useState(false)
  // Local overrides applied immediately after a status save so the UI feels
  // snappy. These get superseded the next time the server round-trips.
  const [overrides, setOverrides] = useState<
    Record<string, Partial<AdminFeedbackRecord>>
  >({})

  const merged = useMemo(
    () =>
      records.map(r =>
        overrides[r.id] ? { ...r, ...overrides[r.id] } : r,
      ),
    [records, overrides],
  )

  const visible = merged.slice(0, visibleCount)
  const totalCount = merged.length

  const updateFilter = useCallback(
    (next: Record<string, string | undefined>) => {
      const params = new URLSearchParams()
      // Preserve existing filters first.
      for (const [k, v] of Object.entries(filters)) {
        if (v === undefined || v === null || v === '') continue
        if (typeof v === 'boolean') {
          params.set(k, v ? '1' : '0')
        } else {
          params.set(k, String(v))
        }
      }
      // Apply overrides.
      for (const [k, v] of Object.entries(next)) {
        if (v === undefined || v === '') params.delete(k)
        else params.set(k, v)
      }
      const qs = params.toString()
      startTransition(() => {
        router.replace(qs ? `/?${qs}` : '/')
      })
    },
    [filters, router, startTransition],
  )

  const replaceFilters = useCallback(
    (next: Record<string, string>) => {
      const params = new URLSearchParams()
      for (const [k, v] of Object.entries(next)) {
        if (v !== undefined && v !== '') params.set(k, v)
      }
      const qs = params.toString()
      startTransition(() => {
        router.replace(qs ? `/?${qs}` : '/')
      })
    },
    [router, startTransition],
  )

  const clearAll = () => replaceFilters({})

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAll = () => {
    setSelected(new Set(visible.map(r => r.id)))
  }

  const clearSelection = () => setSelected(new Set())

  const bulkSetStatus = async (status: AdminFeedbackStatus) => {
    if (selected.size === 0 || busy) return
    setBusy(true)
    try {
      const ids = Array.from(selected)
      const now = new Date().toISOString()
      const triageFields =
        status === 'triaged'
          ? { triagedAt: now }
          : status === 'resolved'
            ? { resolvedAt: now }
            : {}
      const local: Record<string, Partial<AdminFeedbackRecord>> = {}
      const failures: Array<{ id: string; status: number; reason?: string }> = []
      await Promise.all(
        ids.map(async id => {
          try {
            const res = await fetch(`/api/admin/feedback/${encodeURIComponent(id)}`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ status, ...triageFields }),
            })
            if (res.ok) {
              local[id] = { status, ...triageFields }
            } else {
              failures.push({ id, status: res.status })
            }
          } catch (err) {
            failures.push({
              id,
              status: 0,
              reason: err instanceof Error ? err.message : String(err),
            })
          }
        }),
      )
      setOverrides(prev => ({ ...prev, ...local }))
      clearSelection()
      // Soft refresh: pull the latest server view (which includes our writes).
      startTransition(() => router.refresh())

      // Surface bulk failures so the operator notices them. Toast / inline
      // banner can land in v0.6 — for v0.5 a console.error + alert is enough
      // to break the silent-failure footgun.
      if (failures.length > 0) {
        console.error(
          `[snapfeed-admin] bulk ${status}: ${failures.length}/${ids.length} record(s) failed`,
          failures,
        )
        if (typeof window !== 'undefined') {
          window.alert(
            `Bulk ${status} partially failed: ${failures.length} of ${ids.length} records ` +
              `couldn't be updated. See the browser console for details.`,
          )
        }
      }
    } finally {
      setBusy(false)
    }
  }

  const exportCsv = () => {
    const target =
      selected.size > 0 ? merged.filter(r => selected.has(r.id)) : merged
    const csv = toCsv(target)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `snapfeed-export-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const onStatusChangeForRow = async (
    id: string,
    nextStatus: AdminFeedbackStatus,
  ) => {
    setBusy(true)
    try {
      const now = new Date().toISOString()
      const triageFields =
        nextStatus === 'triaged'
          ? { triagedAt: now }
          : nextStatus === 'resolved'
            ? { resolvedAt: now }
            : {}
      const res = await fetch(`/api/admin/feedback/${encodeURIComponent(id)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: nextStatus, ...triageFields }),
      })
      if (res.ok) {
        setOverrides(prev => ({
          ...prev,
          [id]: { ...(prev[id] ?? {}), status: nextStatus, ...triageFields },
        }))
      }
    } finally {
      setBusy(false)
    }
  }

  const onSaveNotes = async (id: string, notes: string) => {
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/feedback/${encodeURIComponent(id)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ notes }),
      })
      if (res.ok) {
        setOverrides(prev => ({
          ...prev,
          [id]: { ...(prev[id] ?? {}), notes },
        }))
      }
    } finally {
      setBusy(false)
    }
  }

  const currentFilterMap = useMemo(() => {
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(filters)) {
      if (v === undefined || v === null || v === '') continue
      out[k] = typeof v === 'boolean' ? (v ? '1' : '0') : String(v)
    }
    return out
  }, [filters])

  return (
    <div>
      {/* ─── Filters ───────────────────────────────────────────────── */}
      <FiltersBar
        filters={filters}
        campaigns={campaigns}
        onChange={updateFilter}
        onClearAll={clearAll}
        onApplySaved={replaceFilters}
        currentFilterMap={currentFilterMap}
      />

      {/* ─── Bulk actions / counts ─────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          margin: '16px 0 8px',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ color: '#6B7280', fontSize: 13 }}>
          {selected.size > 0
            ? `${selected.size} selected · ${totalCount} total`
            : `${totalCount} item${totalCount === 1 ? '' : 's'}`}
          {isPending ? '  · loading…' : ''}
        </div>
        <div style={{ flex: 1 }} />
        {selected.size > 0 ? (
          <>
            <BulkBtn label="Mark triaged" onClick={() => bulkSetStatus('triaged')} disabled={busy} />
            <BulkBtn label="Mark resolved" onClick={() => bulkSetStatus('resolved')} disabled={busy} />
            <BulkBtn label="Mark wontfix" onClick={() => bulkSetStatus('wontfix')} disabled={busy} />
            <BulkBtn label="Export CSV" onClick={exportCsv} />
            <BulkBtn label="Clear selection" onClick={clearSelection} variant="ghost" />
          </>
        ) : (
          <BulkBtn label="Export CSV" onClick={exportCsv} />
        )}
      </div>

      {/* ─── Table ─────────────────────────────────────────────────── */}
      {totalCount === 0 ? (
        <EmptyState onClear={clearAll} />
      ) : (
        <div
          style={{
            background: '#fff',
            border: '1px solid #E5E7EB',
            borderRadius: 12,
            overflow: 'hidden',
          }}
        >
          <HeaderRow
            allChecked={
              visible.length > 0 && visible.every(r => selected.has(r.id))
            }
            onToggleAll={() =>
              visible.every(r => selected.has(r.id))
                ? clearSelection()
                : selectAll()
            }
          />

          {visible.map(r => (
            <Row
              key={r.id}
              record={r}
              expanded={expandedId === r.id}
              checked={selected.has(r.id)}
              onToggleCheck={() => toggleSelect(r.id)}
              onToggleExpand={() =>
                setExpandedId(expandedId === r.id ? null : r.id)
              }
              onStatusChange={s => onStatusChangeForRow(r.id, s)}
              onSaveNotes={n => onSaveNotes(r.id, n)}
              busy={busy}
            />
          ))}
        </div>
      )}

      {visible.length < totalCount ? (
        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <button
            type="button"
            onClick={() => setVisibleCount(c => c + PAGE_SIZE)}
            style={{
              padding: '8px 16px',
              border: '1px solid #D1D5DB',
              borderRadius: 8,
              background: '#fff',
              color: '#374151',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            Load more ({totalCount - visible.length} remaining)
          </button>
        </div>
      ) : null}

      <FilePathFooter filePath={filePath} />
    </div>
  )
}

// ─── Filters bar ──────────────────────────────────────────────────────────────

function FiltersBar({
  filters,
  campaigns,
  onChange,
  onClearAll,
  onApplySaved,
  currentFilterMap,
}: {
  filters: ListFeedbackOptions
  campaigns: Array<{ id: string; name: string }>
  onChange: (next: Record<string, string | undefined>) => void
  onClearAll: () => void
  onApplySaved: (next: Record<string, string>) => void
  currentFilterMap: Record<string, string>
}) {
  const hasAny = Object.values(filters).some(
    v => v !== undefined && v !== null && v !== '',
  )

  return (
    <section
      style={{
        background: '#fff',
        border: '1px solid #E5E7EB',
        borderRadius: 12,
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      {/* Top row: search + saved views + clear */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          key={`search:${filters.search ?? ''}`}
          type="text"
          defaultValue={filters.search ?? ''}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              onChange({ search: (e.target as HTMLInputElement).value || undefined })
            }
          }}
          onBlur={e => onChange({ search: e.target.value || undefined })}
          placeholder="Search text, page, reporter, notes… (Enter to apply)"
          style={{
            flex: '1 1 320px',
            padding: '8px 12px',
            border: '1px solid #D1D5DB',
            borderRadius: 8,
            fontSize: 14,
            background: '#fff',
          }}
        />
        <SavedViewsControl
          currentFilters={currentFilterMap}
          onApply={onApplySaved}
        />
        {hasAny ? (
          <button
            type="button"
            onClick={onClearAll}
            style={{
              padding: '6px 12px',
              border: '1px solid #D1D5DB',
              borderRadius: 8,
              background: '#fff',
              color: '#374151',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Clear filters
          </button>
        ) : null}
      </div>

      {/* Date range + reporter + page-url */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <FieldLabel>From</FieldLabel>
        <input
          type="date"
          value={filters.dateFrom ?? ''}
          onChange={e => onChange({ dateFrom: e.target.value || undefined })}
          style={dateInputStyle}
        />
        <FieldLabel>To</FieldLabel>
        <input
          type="date"
          value={filters.dateTo ?? ''}
          onChange={e => onChange({ dateTo: e.target.value || undefined })}
          style={dateInputStyle}
        />
        <input
          key={`reporter:${filters.reporter ?? ''}`}
          type="text"
          defaultValue={filters.reporter ?? ''}
          onBlur={e => onChange({ reporter: e.target.value || undefined })}
          placeholder="Reporter contains…"
          style={{ ...textInputStyle, flex: '1 1 160px' }}
        />
        <input
          key={`pageUrl:${filters.pageUrlContains ?? ''}`}
          type="text"
          defaultValue={filters.pageUrlContains ?? ''}
          onBlur={e =>
            onChange({ pageUrlContains: e.target.value || undefined })
          }
          placeholder="Page URL contains…"
          style={{ ...textInputStyle, flex: '1 1 160px' }}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#374151' }}>
          <input
            type="checkbox"
            checked={filters.hasScreenshot === true}
            onChange={e =>
              onChange({ hasScreenshot: e.target.checked ? '1' : undefined })
            }
          />
          Has screenshot
        </label>
      </div>

      {/* Category chips */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <FieldLabel>Category</FieldLabel>
        <Chip
          label="All"
          active={!filters.category}
          color="#374151"
          onClick={() => onChange({ category: undefined })}
        />
        {CATEGORIES.map(c => (
          <Chip
            key={c}
            label={c}
            active={filters.category === c}
            color={CATEGORY_COLOR[c]}
            onClick={() =>
              onChange({ category: filters.category === c ? undefined : c })
            }
          />
        ))}
      </div>

      {/* Status chips + campaign select */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <FieldLabel>Status</FieldLabel>
        <Chip
          label="Any"
          active={!filters.status}
          color="#374151"
          onClick={() => onChange({ status: undefined })}
        />
        {STATUSES.map(s => (
          <Chip
            key={s}
            label={s}
            active={filters.status === s}
            color={STATUS_COLOR[s]}
            onClick={() =>
              onChange({ status: filters.status === s ? undefined : s })
            }
          />
        ))}

        <div style={{ flex: 1 }} />

        <FieldLabel>Campaign</FieldLabel>
        <select
          value={filters.campaign ?? ''}
          onChange={e => onChange({ campaign: e.target.value || undefined })}
          style={{
            padding: '6px 8px',
            border: '1px solid #D1D5DB',
            borderRadius: 8,
            fontSize: 12,
            background: '#fff',
            color: '#374151',
            minWidth: 160,
          }}
        >
          <option value="">All campaigns</option>
          {campaigns.map(c => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
    </section>
  )
}

// ─── Table rows ───────────────────────────────────────────────────────────────

const COL_WIDTHS = '36px 90px 90px 1fr 160px 160px 130px'

function HeaderRow({
  allChecked,
  onToggleAll,
}: {
  allChecked: boolean
  onToggleAll: () => void
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: COL_WIDTHS,
        gap: 8,
        background: '#F9FAFB',
        borderBottom: '1px solid #E5E7EB',
        padding: '10px 14px',
        fontSize: 11,
        fontWeight: 600,
        color: '#6B7280',
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        alignItems: 'center',
      }}
    >
      <input
        type="checkbox"
        checked={allChecked}
        onChange={onToggleAll}
        aria-label={allChecked ? 'Deselect all visible' : 'Select all visible'}
      />
      <div>Category</div>
      <div>Status</div>
      <div>Text</div>
      <div>Page</div>
      <div>Reporter</div>
      <div>When</div>
    </div>
  )
}

function Row({
  record,
  expanded,
  checked,
  onToggleCheck,
  onToggleExpand,
  onStatusChange,
  onSaveNotes,
  busy,
}: {
  record: AdminFeedbackRecord
  expanded: boolean
  checked: boolean
  onToggleCheck: () => void
  onToggleExpand: () => void
  onStatusChange: (s: AdminFeedbackStatus) => void
  onSaveNotes: (notes: string) => void
  busy: boolean
}) {
  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={onToggleExpand}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onToggleExpand()
          }
        }}
        style={{
          display: 'grid',
          gridTemplateColumns: COL_WIDTHS,
          gap: 8,
          padding: '12px 14px',
          borderBottom: '1px solid #F3F4F6',
          fontSize: 13,
          cursor: 'pointer',
          background: expanded ? '#FAFAF7' : '#fff',
          alignItems: 'center',
        }}
      >
        <div onClick={e => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={checked}
            onChange={onToggleCheck}
            aria-label={`Select feedback ${record.id}`}
          />
        </div>
        <div>
          {record.category ? (
            <Pill
              label={record.category}
              color={CATEGORY_COLOR[record.category]}
            />
          ) : (
            <span style={{ color: '#9CA3AF' }}>—</span>
          )}
        </div>
        <div>
          <Pill label={record.status} color={STATUS_COLOR[record.status]} />
        </div>
        <div
          style={{
            color: '#111',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {truncate(record.text, 160)}
        </div>
        <div
          style={{
            color: '#374151',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={record.pageUrl}
        >
          {record.pageName || record.pageUrl || '—'}
        </div>
        <div
          style={{
            color: '#374151',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {record.user?.name ?? record.user?.email ?? '—'}
        </div>
        <div
          style={{
            color: '#6B7280',
            fontFamily: 'ui-monospace, Menlo, monospace',
            fontSize: 12,
          }}
        >
          {formatTimestamp(record.timestamp)}
        </div>
      </div>

      {expanded ? (
        <ExpandedPanel
          record={record}
          onStatusChange={onStatusChange}
          onSaveNotes={onSaveNotes}
          busy={busy}
        />
      ) : null}
    </div>
  )
}

function ExpandedPanel({
  record,
  onStatusChange,
  onSaveNotes,
  busy,
}: {
  record: AdminFeedbackRecord
  onStatusChange: (s: AdminFeedbackStatus) => void
  onSaveNotes: (notes: string) => void
  busy: boolean
}) {
  const [draftNotes, setDraftNotes] = useState(record.notes ?? '')
  const md = record.metadata
   
  const meta = md as any
  const buildId = meta?.buildId ?? meta?.build?.id
  const gitSha = meta?.gitSha ?? meta?.git?.sha ?? meta?.commit
  const env = meta?.env

  return (
    <div
      style={{
        padding: '16px 20px',
        background: '#FAFAF7',
        borderBottom: '1px solid #F3F4F6',
        fontSize: 13,
        color: '#1F2937',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}
    >
      <div>
        <Label>Full text</Label>
        <p style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{record.text}</p>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24 }}>
        <Field label="App" value={record.appName} />
        <Field label="Page URL" value={record.pageUrl} />
        <Field
          label="Reporter"
          value={
            record.user?.name || record.user?.email
              ? `${record.user?.name ?? ''}${
                  record.user?.email ? ` <${record.user.email}>` : ''
                }`
              : '—'
          }
        />
        {buildId ? <Field label="Build" value={String(buildId)} /> : null}
        {gitSha ? <Field label="Git SHA" value={String(gitSha)} /> : null}
        {env ? <Field label="Env" value={String(env)} /> : null}
        {record.campaigns && record.campaigns.length > 0 ? (
          <Field label="Campaigns" value={record.campaigns.join(', ')} />
        ) : null}
        {record.triagedAt ? (
          <Field
            label="Triaged"
            value={`${formatTimestamp(record.triagedAt)}${
              record.triagedBy ? ` · ${record.triagedBy}` : ''
            }`}
          />
        ) : null}
        {record.resolvedAt ? (
          <Field
            label="Resolved"
            value={`${formatTimestamp(record.resolvedAt)}${
              record.resolvedBy ? ` · ${record.resolvedBy}` : ''
            }`}
          />
        ) : null}
      </div>

      {md?.consoleErrors && md.consoleErrors.length > 0 ? (
        <div>
          <Label>Console errors ({md.consoleErrors.length})</Label>
          <pre
            style={{
              margin: '4px 0 0',
              background: '#1F2937',
              color: '#FCA5A5',
              padding: 10,
              borderRadius: 6,
              fontSize: 12,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
            }}
          >
            {md.consoleErrors.join('\n')}
          </pre>
        </div>
      ) : null}

      {md ? (
        <div>
          <Label>Metadata</Label>
          <pre
            style={{
              margin: '4px 0 0',
              background: '#fff',
              border: '1px solid #E5E7EB',
              padding: 10,
              borderRadius: 6,
              fontSize: 12,
              overflow: 'auto',
              maxHeight: 240,
            }}
          >
            {JSON.stringify(md, null, 2)}
          </pre>
        </div>
      ) : null}

      {record.screenshot?.base64 ? (
        <div>
          <Label>Screenshot</Label>
          <img
            src={`data:${record.screenshot.mimeType};base64,${record.screenshot.base64}`}
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

      <div>
        <Label>Notes</Label>
        <textarea
          value={draftNotes}
          onChange={e => setDraftNotes(e.target.value)}
          placeholder="Add triage notes, repro steps, owner…"
          rows={3}
          style={{
            display: 'block',
            width: '100%',
            marginTop: 4,
            padding: 8,
            border: '1px solid #D1D5DB',
            borderRadius: 6,
            fontSize: 13,
            fontFamily: 'inherit',
            background: '#fff',
            resize: 'vertical',
          }}
        />
        <div
          style={{
            display: 'flex',
            gap: 10,
            alignItems: 'center',
            marginTop: 8,
            flexWrap: 'wrap',
          }}
        >
          <button
            type="button"
            onClick={() => onSaveNotes(draftNotes)}
            disabled={busy || draftNotes === (record.notes ?? '')}
            style={{
              padding: '6px 12px',
              border: '1px solid #D4714B',
              background:
                busy || draftNotes === (record.notes ?? '')
                  ? '#FCD8C5'
                  : '#D4714B',
              color: '#fff',
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 600,
              cursor:
                busy || draftNotes === (record.notes ?? '')
                  ? 'not-allowed'
                  : 'pointer',
            }}
          >
            Save notes
          </button>

          <FieldLabel>Status</FieldLabel>
          <select
            value={record.status}
            disabled={busy}
            onChange={e =>
              onStatusChange(e.target.value as AdminFeedbackStatus)
            }
            style={{
              padding: '6px 8px',
              border: '1px solid #D1D5DB',
              borderRadius: 6,
              fontSize: 12,
              background: '#fff',
              color: '#374151',
            }}
          >
            {STATUSES.map(s => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  )
}

// ─── Bits ─────────────────────────────────────────────────────────────────────

function EmptyState({ onClear }: { onClear: () => void }) {
  return (
    <div
      style={{
        background: '#fff',
        border: '1px dashed #E5E7EB',
        borderRadius: 12,
        padding: '32px 20px',
        textAlign: 'center',
        color: '#6B7280',
      }}
    >
      <div style={{ fontSize: 14, marginBottom: 8 }}>
        No feedback matches these filters.
      </div>
      <button
        type="button"
        onClick={onClear}
        style={{
          padding: '6px 14px',
          border: '1px solid #D1D5DB',
          borderRadius: 8,
          background: '#fff',
          color: '#374151',
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        Clear filters
      </button>
    </div>
  )
}

function FilePathFooter({ filePath }: { filePath: string }) {
  return (
    <p
      style={{
        marginTop: 24,
        color: '#9CA3AF',
        fontSize: 11,
        fontFamily: 'ui-monospace, Menlo, monospace',
      }}
    >
      Reading from {filePath}
    </p>
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
        padding: '4px 10px',
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

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <span
      style={{
        background: `${color}1A`,
        color,
        padding: '2px 8px',
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.03em',
      }}
    >
      {label}
    </span>
  )
}

function BulkBtn({
  label,
  onClick,
  variant = 'primary',
  disabled,
}: {
  label: string
  onClick: () => void
  variant?: 'primary' | 'ghost'
  disabled?: boolean
}) {
  const base =
    variant === 'ghost'
      ? { background: '#fff', color: '#374151', border: '1px solid #D1D5DB' }
      : { background: '#fff', color: '#111', border: '1px solid #D1D5DB' }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '6px 12px',
        borderRadius: 8,
        fontSize: 12,
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        ...base,
      }}
    >
      {label}
    </button>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 600,
        color: '#6B7280',
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
      }}
    >
      {children}
    </span>
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

const dateInputStyle: React.CSSProperties = {
  padding: '6px 8px',
  border: '1px solid #D1D5DB',
  borderRadius: 8,
  fontSize: 12,
  background: '#fff',
  color: '#374151',
}

const textInputStyle: React.CSSProperties = {
  padding: '6px 8px',
  border: '1px solid #D1D5DB',
  borderRadius: 8,
  fontSize: 12,
  background: '#fff',
  color: '#374151',
}

// ─── CSV ──────────────────────────────────────────────────────────────────────

function toCsv(records: AdminFeedbackRecord[]): string {
  const headers = [
    'timestamp',
    'category',
    'status',
    'page',
    'reporter',
    'text',
    'build',
    'gitSha',
    'env',
  ]
  const rows = records.map(r => {
     
    const md = r.metadata as any
    return [
      r.timestamp,
      r.category ?? '',
      r.status,
      r.pageUrl ?? r.pageName ?? '',
      r.user?.email ?? r.user?.name ?? '',
      r.text,
      md?.buildId ?? md?.build?.id ?? '',
      md?.gitSha ?? md?.git?.sha ?? md?.commit ?? '',
      md?.env ?? '',
    ].map(csvField)
  })
  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
}

function csvField(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v)
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function truncate(s: string, n: number): string {
  if (!s) return ''
  if (s.length <= n) return s
  return s.slice(0, n - 1) + '…'
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}
