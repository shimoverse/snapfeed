'use client'

import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
} from 'react'
import type { FeedbackCategory } from './types'

// ─── Types ────────────────────────────────────────────────────────────────────

interface FeedbackRow {
  id: string
  created_at: string
  app_name: string
  text: string
  page_name: string | null
  page_url: string | null
  sender: string | null
  sender_email: string | null
  image_base64: string | null
  image_mime_type: string | null
  metadata: {
    viewport?: string
    userAgent?: string
    consoleErrors?: string[]
  } | null
  delivered: boolean
  delivery_channel: string | null
  delivery_id: string | null
  category: FeedbackCategory | null
  resolved: boolean
}

type SortOrder = 'newest' | 'oldest'

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 25

const CATEGORY_EMOJIS: Record<FeedbackCategory, string> = {
  bug: '🐛',
  idea: '💡',
  question: '❓',
  praise: '🙌',
  other: '📝',
}

const CATEGORIES: Array<{ id: FeedbackCategory; label: string }> = [
  { id: 'bug', label: 'Bug' },
  { id: 'idea', label: 'Idea' },
  { id: 'question', label: 'Question' },
  { id: 'praise', label: 'Praise' },
  { id: 'other', label: 'Other' },
]

// ─── Theme helpers ────────────────────────────────────────────────────────────

function getInboxColors(isDark: boolean, accentColor: string) {
  return {
    background: isDark ? '#1C1C1E' : '#FFFFFF',
    surface: isDark ? '#2C2C2E' : '#F5F3EF',
    surfaceHover: isDark ? '#3A3A3C' : '#EDE9E3',
    border: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.10)',
    text: isDark ? '#F2F2F7' : '#1A1A1A',
    textMuted: isDark ? '#AEAEB2' : '#6B6560',
    textPlaceholder: isDark ? '#636366' : '#9B9590',
    accent: accentColor,
    accentBg: `${accentColor}16`,
    error: isDark ? '#FF6B6B' : '#D64545',
    errorBg: isDark ? 'rgba(255,107,107,0.12)' : 'rgba(214,69,69,0.08)',
    success: isDark ? '#30D158' : '#2D9D6F',
    successBg: isDark ? 'rgba(48,209,88,0.12)' : 'rgba(45,157,111,0.1)',
    inputBg: isDark ? '#2C2C2E' : '#F5F3EF',
    shadow: isDark
      ? '0 4px 24px rgba(0,0,0,0.5)'
      : '0 4px 24px rgba(0,0,0,0.1)',
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function CategoryBadge({
  category,
  colors,
}: {
  category: FeedbackCategory | null
  colors: ReturnType<typeof getInboxColors>
}) {
  if (!category) return null
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '3px',
        padding: '2px 7px',
        borderRadius: '10px',
        fontSize: '11px',
        fontWeight: 500,
        background: colors.accentBg,
        color: colors.accent,
        border: `1px solid ${colors.accent}28`,
        whiteSpace: 'nowrap',
      }}
    >
      {CATEGORY_EMOJIS[category]} {category}
    </span>
  )
}

function StatusDot({
  delivered,
  resolved,
  colors,
}: {
  delivered: boolean
  resolved: boolean
  colors: ReturnType<typeof getInboxColors>
}) {
  const color = resolved
    ? colors.textPlaceholder
    : delivered
    ? colors.success
    : colors.error
  const title = resolved ? 'Resolved' : delivered ? 'Delivered' : 'Undelivered'
  return (
    <span
      title={title}
      style={{
        display: 'inline-block',
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        background: color,
        flexShrink: 0,
      }}
    />
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export interface FeedbackInboxProps {
  /** Supabase project URL */
  supabaseUrl: string
  /** Supabase anon or service role key */
  supabaseKey: string
  /**
   * Table name.
   * @default "feedback"
   */
  table?: string
  /**
   * Filter by app_name (optional).
   */
  appName?: string
  /**
   * Accent color for highlights.
   * @default "#B85A36"
   */
  accentColor?: string
  /**
   * Color theme.
   * @default "auto"
   */
  theme?: 'auto' | 'light' | 'dark'
  /**
   * CSS class name for the root container.
   */
  className?: string
}

export function FeedbackInbox({
  supabaseUrl,
  supabaseKey,
  table = 'feedback',
  appName,
  accentColor = '#B85A36',
  theme = 'auto',
  className,
}: FeedbackInboxProps) {
  // ─── Theme ──────────────────────────────────────────────────────────────────
  const isDark =
    theme === 'dark' ||
    (theme === 'auto' &&
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches)
  const colors = getInboxColors(isDark, accentColor)

  // ─── State ──────────────────────────────────────────────────────────────────
  const [rows, setRows] = useState<FeedbackRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest')
  const [filterCategory, setFilterCategory] = useState<FeedbackCategory | 'all'>('all')
  const [filterDelivered, setFilterDelivered] = useState<'all' | 'yes' | 'no'>('all')
  const [filterResolved, setFilterResolved] = useState<'all' | 'yes' | 'no'>('all')
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')
  const [searchText, setSearchText] = useState('')
  const [resolvingId, setResolvingId] = useState<string | null>(null)

  const baseUrl = supabaseUrl.replace(/\/$/, '')
  const apiBase = `${baseUrl}/rest/v1/${table}`
  const headers = {
    'apikey': supabaseKey,
    'Authorization': `Bearer ${supabaseKey}`,
    'Content-Type': 'application/json',
    'Prefer': 'count=exact',
  }

  // ─── Fetch ───────────────────────────────────────────────────────────────────
  const fetchRows = useCallback(async () => {
    setLoading(true)
    setError(null)

    const params = new URLSearchParams()

    // Filters
    if (appName) params.set('app_name', `eq.${appName}`)
    if (filterCategory !== 'all') params.set('category', `eq.${filterCategory}`)
    if (filterDelivered === 'yes') params.set('delivered', 'eq.true')
    if (filterDelivered === 'no') params.set('delivered', 'eq.false')
    if (filterResolved === 'yes') params.set('resolved', 'eq.true')
    if (filterResolved === 'no') params.set('resolved', 'eq.false')
    if (filterDateFrom) params.set('created_at', `gte.${filterDateFrom}`)
    if (filterDateTo) {
      // Date-to is end of day
      const to = new Date(filterDateTo)
      to.setHours(23, 59, 59, 999)
      params.set('created_at', `lte.${to.toISOString()}`)
    }
    if (searchText.trim()) {
      params.set('text', `ilike.*${searchText.trim()}*`)
    }

    // Sort
    params.set('order', sortOrder === 'newest' ? 'created_at.desc' : 'created_at.asc')

    // Pagination
    const offset = page * PAGE_SIZE
    params.set('offset', String(offset))
    params.set('limit', String(PAGE_SIZE))

    const url = `${apiBase}?${params.toString()}`

    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          ...headers,
          'Range-Unit': 'items',
          'Range': `${offset}-${offset + PAGE_SIZE - 1}`,
        },
      })

      if (!res.ok) {
        const text = await res.text().catch(() => '')
        setError(`Failed to load feedback (${res.status}): ${text.slice(0, 200)}`)
        return
      }

      const contentRange = res.headers.get('Content-Range') ?? ''
      // Content-Range: 0-24/100
      const totalMatch = contentRange.match(/\/(\d+)$/)
      if (totalMatch?.[1]) setTotal(parseInt(totalMatch[1], 10))

      const data = (await res.json()) as FeedbackRow[]
      setRows(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setLoading(false)
    }
  }, [
    apiBase,
    appName,
    filterCategory,
    filterDelivered,
    filterResolved,
    filterDateFrom,
    filterDateTo,
    searchText,
    sortOrder,
    page,
    supabaseKey,
  ])

  useEffect(() => {
    void fetchRows()
  }, [fetchRows])

  // Reset page when filters change
  const prevFiltersRef = useRef({
    filterCategory,
    filterDelivered,
    filterResolved,
    filterDateFrom,
    filterDateTo,
    searchText,
    sortOrder,
  })
  useEffect(() => {
    const prev = prevFiltersRef.current
    if (
      prev.filterCategory !== filterCategory ||
      prev.filterDelivered !== filterDelivered ||
      prev.filterResolved !== filterResolved ||
      prev.filterDateFrom !== filterDateFrom ||
      prev.filterDateTo !== filterDateTo ||
      prev.searchText !== searchText ||
      prev.sortOrder !== sortOrder
    ) {
      setPage(0)
      prevFiltersRef.current = {
        filterCategory,
        filterDelivered,
        filterResolved,
        filterDateFrom,
        filterDateTo,
        searchText,
        sortOrder,
      }
    }
  }, [filterCategory, filterDelivered, filterResolved, filterDateFrom, filterDateTo, searchText, sortOrder])

  // ─── Resolve toggle ──────────────────────────────────────────────────────────
  async function toggleResolved(row: FeedbackRow) {
    setResolvingId(row.id)
    const newValue = !row.resolved

    try {
      const res = await fetch(`${apiBase}?id=eq.${row.id}`, {
        method: 'PATCH',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ resolved: newValue }),
      })

      if (res.ok) {
        setRows(prev =>
          prev.map(r => (r.id === row.id ? { ...r, resolved: newValue } : r))
        )
      }
    } catch {
      // ignore
    } finally {
      setResolvingId(null)
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────
  function formatDate(iso: string) {
    try {
      return new Date(iso).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    } catch {
      return iso
    }
  }

  function truncate(str: string, max: number) {
    return str.length > max ? `${str.slice(0, max)}…` : str
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <div
      className={className}
      style={{
        fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
        background: colors.background,
        color: colors.text,
        minHeight: '400px',
        borderRadius: '16px',
        border: `1px solid ${colors.border}`,
        overflow: 'hidden',
        boxShadow: colors.shadow,
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '20px 24px 16px',
          borderBottom: `1px solid ${colors.border}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <div>
          <div style={{ fontWeight: 700, fontSize: '18px', color: colors.text }}>
            Feedback Inbox
          </div>
          {appName && (
            <div style={{ fontSize: '12px', color: colors.textMuted, marginTop: '2px' }}>
              {appName}
            </div>
          )}
        </div>
        <div style={{ fontSize: '13px', color: colors.textMuted }}>
          {total} submission{total !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Filters */}
      <div
        style={{
          padding: '12px 24px',
          borderBottom: `1px solid ${colors.border}`,
          display: 'flex',
          flexWrap: 'wrap',
          gap: '8px',
          alignItems: 'center',
          background: colors.surface,
        }}
      >
        {/* Search */}
        <input
          type="text"
          placeholder="Search feedback…"
          value={searchText}
          onChange={e => setSearchText(e.target.value)}
          style={{
            padding: '6px 10px',
            borderRadius: '8px',
            border: `1px solid ${colors.border}`,
            background: colors.inputBg,
            color: colors.text,
            fontSize: '13px',
            outline: 'none',
            minWidth: '160px',
            flex: '1 1 160px',
            fontFamily: 'inherit',
          }}
        />

        {/* Category filter */}
        <select
          value={filterCategory}
          onChange={e => setFilterCategory(e.target.value as FeedbackCategory | 'all')}
          style={{
            padding: '6px 10px',
            borderRadius: '8px',
            border: `1px solid ${colors.border}`,
            background: colors.inputBg,
            color: colors.text,
            fontSize: '13px',
            outline: 'none',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          <option value="all">All categories</option>
          {CATEGORIES.map(c => (
            <option key={c.id} value={c.id}>
              {CATEGORY_EMOJIS[c.id]} {c.label}
            </option>
          ))}
        </select>

        {/* Delivered filter */}
        <select
          value={filterDelivered}
          onChange={e => setFilterDelivered(e.target.value as 'all' | 'yes' | 'no')}
          style={{
            padding: '6px 10px',
            borderRadius: '8px',
            border: `1px solid ${colors.border}`,
            background: colors.inputBg,
            color: colors.text,
            fontSize: '13px',
            outline: 'none',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          <option value="all">All delivery</option>
          <option value="yes">Delivered</option>
          <option value="no">Undelivered</option>
        </select>

        {/* Resolved filter */}
        <select
          value={filterResolved}
          onChange={e => setFilterResolved(e.target.value as 'all' | 'yes' | 'no')}
          style={{
            padding: '6px 10px',
            borderRadius: '8px',
            border: `1px solid ${colors.border}`,
            background: colors.inputBg,
            color: colors.text,
            fontSize: '13px',
            outline: 'none',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          <option value="all">All status</option>
          <option value="no">Open</option>
          <option value="yes">Resolved</option>
        </select>

        {/* Date from */}
        <input
          type="date"
          value={filterDateFrom}
          onChange={e => setFilterDateFrom(e.target.value)}
          title="From date"
          style={{
            padding: '6px 10px',
            borderRadius: '8px',
            border: `1px solid ${colors.border}`,
            background: colors.inputBg,
            color: colors.text,
            fontSize: '13px',
            outline: 'none',
            fontFamily: 'inherit',
            colorScheme: isDark ? 'dark' : 'light',
          }}
        />

        {/* Date to */}
        <input
          type="date"
          value={filterDateTo}
          onChange={e => setFilterDateTo(e.target.value)}
          title="To date"
          style={{
            padding: '6px 10px',
            borderRadius: '8px',
            border: `1px solid ${colors.border}`,
            background: colors.inputBg,
            color: colors.text,
            fontSize: '13px',
            outline: 'none',
            fontFamily: 'inherit',
            colorScheme: isDark ? 'dark' : 'light',
          }}
        />

        {/* Sort */}
        <select
          value={sortOrder}
          onChange={e => setSortOrder(e.target.value as SortOrder)}
          style={{
            padding: '6px 10px',
            borderRadius: '8px',
            border: `1px solid ${colors.border}`,
            background: colors.inputBg,
            color: colors.text,
            fontSize: '13px',
            outline: 'none',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </select>
      </div>

      {/* Error */}
      {error && (
        <div
          style={{
            margin: '16px 24px 0',
            padding: '10px 14px',
            borderRadius: '8px',
            background: colors.errorBg,
            color: colors.error,
            fontSize: '13px',
          }}
        >
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div
          style={{
            padding: '32px',
            textAlign: 'center',
            color: colors.textPlaceholder,
            fontSize: '14px',
          }}
        >
          Loading…
        </div>
      )}

      {/* Empty state */}
      {!loading && rows.length === 0 && !error && (
        <div
          style={{
            padding: '48px 24px',
            textAlign: 'center',
            color: colors.textPlaceholder,
            fontSize: '14px',
          }}
        >
          No feedback found.
        </div>
      )}

      {/* Table */}
      {!loading && rows.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: '13px',
            }}
          >
            <thead>
              <tr
                style={{
                  background: colors.surface,
                  borderBottom: `1px solid ${colors.border}`,
                }}
              >
                {[
                  { label: '', width: '16px' }, // status dot
                  { label: 'Category', width: '80px' },
                  { label: 'Message', width: 'auto' },
                  { label: 'Page', width: '120px' },
                  { label: 'From', width: '100px' },
                  { label: 'Date', width: '140px' },
                  { label: 'Actions', width: '90px' },
                ].map((col, i) => (
                  <th
                    key={i}
                    style={{
                      padding: '8px 12px',
                      textAlign: 'left',
                      fontWeight: 600,
                      color: colors.textMuted,
                      fontSize: '11px',
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      width: col.width,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const isExpanded = expandedId === row.id
                return (
                  <React.Fragment key={row.id}>
                    {/* Summary row */}
                    <tr
                      onClick={() => setExpandedId(isExpanded ? null : row.id)}
                      style={{
                        borderBottom: `1px solid ${colors.border}`,
                        cursor: 'pointer',
                        background: row.resolved
                          ? isDark
                            ? 'rgba(255,255,255,0.02)'
                            : 'rgba(0,0,0,0.02)'
                          : 'transparent',
                        transition: 'background 0.1s',
                        opacity: row.resolved ? 0.65 : 1,
                      }}
                      onMouseEnter={e => {
                        ;(e.currentTarget as HTMLTableRowElement).style.background =
                          colors.surfaceHover
                      }}
                      onMouseLeave={e => {
                        ;(e.currentTarget as HTMLTableRowElement).style.background =
                          row.resolved
                            ? isDark
                              ? 'rgba(255,255,255,0.02)'
                              : 'rgba(0,0,0,0.02)'
                            : 'transparent'
                      }}
                    >
                      {/* Status dot */}
                      <td style={{ padding: '10px 8px 10px 16px', width: '16px' }}>
                        <StatusDot
                          delivered={row.delivered}
                          resolved={row.resolved}
                          colors={colors}
                        />
                      </td>
                      {/* Category */}
                      <td style={{ padding: '10px 12px' }}>
                        <CategoryBadge category={row.category} colors={colors} />
                      </td>
                      {/* Message */}
                      <td style={{ padding: '10px 12px', color: colors.text }}>
                        {truncate(row.text, 80)}
                      </td>
                      {/* Page */}
                      <td
                        style={{
                          padding: '10px 12px',
                          color: colors.textMuted,
                          maxWidth: '140px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {row.page_name ?? '—'}
                      </td>
                      {/* From */}
                      <td
                        style={{
                          padding: '10px 12px',
                          color: colors.textMuted,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {row.sender ?? 'Anon'}
                      </td>
                      {/* Date */}
                      <td
                        style={{
                          padding: '10px 12px',
                          color: colors.textMuted,
                          whiteSpace: 'nowrap',
                          fontSize: '12px',
                        }}
                      >
                        {formatDate(row.created_at)}
                      </td>
                      {/* Actions */}
                      <td
                        style={{ padding: '10px 12px 10px 8px', whiteSpace: 'nowrap' }}
                        onClick={e => e.stopPropagation()}
                      >
                        <button
                          onClick={() => void toggleResolved(row)}
                          disabled={resolvingId === row.id}
                          title={row.resolved ? 'Mark as open' : 'Mark as resolved'}
                          style={{
                            padding: '3px 8px',
                            borderRadius: '6px',
                            border: `1px solid ${colors.border}`,
                            background: row.resolved ? colors.surface : colors.successBg,
                            color: row.resolved ? colors.textMuted : colors.success,
                            cursor: resolvingId === row.id ? 'wait' : 'pointer',
                            fontSize: '11px',
                            fontFamily: 'inherit',
                            fontWeight: 500,
                            transition: 'background 0.12s',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {resolvingId === row.id
                            ? '…'
                            : row.resolved
                            ? '↩ Reopen'
                            : '✓ Resolve'}
                        </button>
                      </td>
                    </tr>

                    {/* Expanded detail row */}
                    {isExpanded && (
                      <tr
                        style={{
                          background: colors.surface,
                          borderBottom: `1px solid ${colors.border}`,
                        }}
                      >
                        <td colSpan={7} style={{ padding: '0' }}>
                          <div style={{ padding: '16px 24px' }}>
                            {/* Full text */}
                            <div
                              style={{
                                fontSize: '14px',
                                color: colors.text,
                                lineHeight: '1.6',
                                marginBottom: '12px',
                                padding: '12px',
                                background: colors.background,
                                borderRadius: '8px',
                                border: `1px solid ${colors.border}`,
                              }}
                            >
                              {row.text}
                            </div>

                            <div
                              style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                                gap: '12px',
                                fontSize: '12px',
                                color: colors.textMuted,
                                marginBottom: row.image_base64 ? '12px' : 0,
                              }}
                            >
                              {/* Page URL */}
                              {row.page_url && (
                                <div>
                                  <div
                                    style={{
                                      fontWeight: 600,
                                      color: colors.text,
                                      marginBottom: '2px',
                                    }}
                                  >
                                    Page URL
                                  </div>
                                  <a
                                    href={row.page_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{
                                      color: colors.accent,
                                      textDecoration: 'none',
                                      wordBreak: 'break-all',
                                    }}
                                  >
                                    {row.page_url}
                                  </a>
                                </div>
                              )}

                              {/* Sender email */}
                              {row.sender_email && (
                                <div>
                                  <div
                                    style={{
                                      fontWeight: 600,
                                      color: colors.text,
                                      marginBottom: '2px',
                                    }}
                                  >
                                    Email
                                  </div>
                                  {row.sender_email}
                                </div>
                              )}

                              {/* Delivery */}
                              <div>
                                <div
                                  style={{
                                    fontWeight: 600,
                                    color: colors.text,
                                    marginBottom: '2px',
                                  }}
                                >
                                  Delivery
                                </div>
                                <span
                                  style={{
                                    color: row.delivered ? colors.success : colors.error,
                                  }}
                                >
                                  {row.delivered ? '✓ Delivered' : '✗ Undelivered'}
                                </span>
                                {row.delivery_channel && (
                                  <span style={{ color: colors.textPlaceholder }}>
                                    {' '}
                                    via {row.delivery_channel}
                                  </span>
                                )}
                                {row.delivery_id && (
                                  <span style={{ color: colors.textPlaceholder }}>
                                    {' '}
                                    (#{row.delivery_id})
                                  </span>
                                )}
                              </div>

                              {/* Viewport */}
                              {row.metadata?.viewport && (
                                <div>
                                  <div
                                    style={{
                                      fontWeight: 600,
                                      color: colors.text,
                                      marginBottom: '2px',
                                    }}
                                  >
                                    Viewport
                                  </div>
                                  {row.metadata.viewport}
                                </div>
                              )}

                              {/* User agent */}
                              {row.metadata?.userAgent && (
                                <div style={{ gridColumn: '1 / -1' }}>
                                  <div
                                    style={{
                                      fontWeight: 600,
                                      color: colors.text,
                                      marginBottom: '2px',
                                    }}
                                  >
                                    User Agent
                                  </div>
                                  <span
                                    style={{
                                      fontFamily: 'monospace',
                                      fontSize: '11px',
                                      wordBreak: 'break-all',
                                    }}
                                  >
                                    {row.metadata.userAgent}
                                  </span>
                                </div>
                              )}

                              {/* Console errors */}
                              {row.metadata?.consoleErrors &&
                                row.metadata.consoleErrors.length > 0 && (
                                  <div style={{ gridColumn: '1 / -1' }}>
                                    <div
                                      style={{
                                        fontWeight: 600,
                                        color: colors.text,
                                        marginBottom: '4px',
                                      }}
                                    >
                                      Console Errors ({row.metadata.consoleErrors.length})
                                    </div>
                                    <div
                                      style={{
                                        background: colors.background,
                                        border: `1px solid ${colors.border}`,
                                        borderRadius: '6px',
                                        padding: '8px 10px',
                                        fontFamily: 'monospace',
                                        fontSize: '11px',
                                        color: colors.error,
                                        maxHeight: '100px',
                                        overflowY: 'auto',
                                        whiteSpace: 'pre-wrap',
                                        wordBreak: 'break-all',
                                      }}
                                    >
                                      {row.metadata.consoleErrors.join('\n')}
                                    </div>
                                  </div>
                                )}
                            </div>

                            {/* Screenshot */}
                            {row.image_base64 && (
                              <div style={{ marginTop: '12px' }}>
                                <div
                                  style={{
                                    fontWeight: 600,
                                    fontSize: '12px',
                                    color: colors.text,
                                    marginBottom: '6px',
                                  }}
                                >
                                  Screenshot
                                </div>
                                <img
                                  src={`data:${row.image_mime_type ?? 'image/png'};base64,${row.image_base64}`}
                                  alt={`Screenshot of ${row.page_name ?? row.page_url ?? 'feedback page'}`}
                                  style={{
                                    maxWidth: '100%',
                                    maxHeight: '300px',
                                    borderRadius: '8px',
                                    border: `1px solid ${colors.border}`,
                                    display: 'block',
                                    objectFit: 'contain',
                                  }}
                                />
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div
          style={{
            padding: '12px 24px',
            borderTop: `1px solid ${colors.border}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            flexWrap: 'wrap',
            background: colors.surface,
          }}
        >
          <div style={{ fontSize: '12px', color: colors.textMuted }}>
            Page {page + 1} of {totalPages} ({total} total)
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              onClick={() => setPage(0)}
              disabled={page === 0}
              style={paginationButtonStyle(page === 0, colors)}
            >
              «
            </button>
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              style={paginationButtonStyle(page === 0, colors)}
            >
              ‹ Prev
            </button>
            <button
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              style={paginationButtonStyle(page >= totalPages - 1, colors)}
            >
              Next ›
            </button>
            <button
              onClick={() => setPage(totalPages - 1)}
              disabled={page >= totalPages - 1}
              style={paginationButtonStyle(page >= totalPages - 1, colors)}
            >
              »
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function paginationButtonStyle(
  disabled: boolean,
  colors: ReturnType<typeof getInboxColors>
): React.CSSProperties {
  return {
    padding: '5px 10px',
    borderRadius: '6px',
    border: `1px solid ${colors.border}`,
    background: disabled ? 'transparent' : colors.background,
    color: disabled ? colors.textPlaceholder : colors.text,
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: '12px',
    fontFamily: 'inherit',
    transition: 'background 0.1s',
    opacity: disabled ? 0.5 : 1,
  }
}
