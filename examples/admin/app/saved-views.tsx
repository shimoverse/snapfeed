'use client'

import { useEffect, useState } from 'react'
import {
  deleteView,
  listSavedViews,
  saveView,
  type SavedView,
} from '../lib/saved-views'

interface Props {
  /** Current filter param map (only non-empty values please). */
  currentFilters: Record<string, string>
  /** Apply a saved view by replacing the URL query string. */
  onApply: (filters: Record<string, string>) => void
}

export function SavedViewsControl({ currentFilters, onApply }: Props) {
  const [views, setViews] = useState<SavedView[]>([])
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [draftName, setDraftName] = useState('')

  useEffect(() => {
    setViews(listSavedViews())
  }, [])

  const refresh = () => setViews(listSavedViews())

  const handleSave = () => {
    const name = draftName.trim()
    if (!name) return
    saveView(name, currentFilters)
    setDraftName('')
    setCreating(false)
    refresh()
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        style={{
          padding: '6px 12px',
          borderRadius: 8,
          border: '1px solid #D1D5DB',
          background: '#fff',
          color: '#374151',
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        Saved views {views.length > 0 ? `(${views.length})` : ''} ▾
      </button>

      {open ? (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            zIndex: 20,
            minWidth: 240,
            background: '#fff',
            border: '1px solid #E5E7EB',
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)',
            padding: 6,
          }}
        >
          {views.length === 0 ? (
            <div
              style={{
                padding: '10px 12px',
                fontSize: 12,
                color: '#6B7280',
              }}
            >
              No saved views yet.
            </div>
          ) : (
            views.map(v => (
              <div
                key={v.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 6px',
                }}
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onApply(v.filters)
                    setOpen(false)
                  }}
                  style={{
                    flex: 1,
                    textAlign: 'left',
                    padding: '6px 8px',
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    fontSize: 13,
                    color: '#111',
                    borderRadius: 4,
                  }}
                >
                  {v.name}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    deleteView(v.id)
                    refresh()
                  }}
                  aria-label={`Delete saved view ${v.name}`}
                  title="Delete saved view"
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: '#9CA3AF',
                    cursor: 'pointer',
                    fontSize: 14,
                    padding: '2px 6px',
                  }}
                >
                  ×
                </button>
              </div>
            ))
          )}

          <div
            style={{
              borderTop: '1px solid #F3F4F6',
              marginTop: 6,
              paddingTop: 6,
            }}
          >
            {creating ? (
              <div style={{ display: 'flex', gap: 6, padding: '4px 6px' }}>
                <input
                  type="text"
                  value={draftName}
                  onChange={e => setDraftName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleSave()
                    if (e.key === 'Escape') {
                      setCreating(false)
                      setDraftName('')
                    }
                  }}
                  placeholder="View name…"
                  autoFocus
                  style={{
                    flex: 1,
                    padding: '6px 8px',
                    border: '1px solid #D1D5DB',
                    borderRadius: 6,
                    fontSize: 13,
                  }}
                />
                <button
                  type="button"
                  onClick={handleSave}
                  style={{
                    padding: '6px 10px',
                    border: '1px solid #D4714B',
                    background: '#D4714B',
                    color: '#fff',
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Save
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setCreating(true)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '6px 12px',
                  border: 'none',
                  background: 'transparent',
                  color: '#D4714B',
                  fontWeight: 600,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                + Save current filters as view
              </button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
