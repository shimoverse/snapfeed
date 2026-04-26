/**
 * snapfeed admin — Saved views (localStorage)
 *
 * A saved view is a named bag of filter query-string params. We persist them
 * client-side only (no server round-trip) because the inbox URL already
 * encodes filters — saved views are just bookmarks with a friendlier name.
 *
 * Schema is deliberately loose so adding a new filter doesn't require a
 * migration: we store everything as `Record<string, string>`. The inbox is
 * responsible for ignoring unknown keys.
 *
 * All functions return immediately if `window` is undefined so they're safe
 * to import from server components (where they'll just no-op).
 */

const STORAGE_KEY = 'snapfeed-admin:saved-views/v1'

export interface SavedView {
  /** Stable id (slug derived from name on first save). */
  id: string
  name: string
  /** Filter param map (the same shape `URLSearchParams.entries()` would yield). */
  filters: Record<string, string>
  /** ISO timestamp of last update — handy for sorting "recent". */
  updatedAt: string
}

function safeStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    // Touch storage to trip the SecurityError thrown in private modes.
    window.localStorage.getItem(STORAGE_KEY)
    return window.localStorage
  } catch {
    return null
  }
}

function readAll(): SavedView[] {
  const s = safeStorage()
  if (!s) return []
  const raw = s.getItem(STORAGE_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isSavedView)
  } catch {
    return []
  }
}

function writeAll(views: SavedView[]): void {
  const s = safeStorage()
  if (!s) return
  try {
    s.setItem(STORAGE_KEY, JSON.stringify(views))
  } catch {
    // Quota or otherwise — caller can retry with fewer views.
  }
}

function isSavedView(x: unknown): x is SavedView {
  if (!x || typeof x !== 'object') return false
  const v = x as Record<string, unknown>
  return (
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    v.filters !== null &&
    typeof v.filters === 'object'
  )
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || `view-${Date.now()}`
  )
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function listSavedViews(): SavedView[] {
  return readAll().sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
}

export function saveView(
  name: string,
  filters: Record<string, string>,
): SavedView {
  const views = readAll()
  const trimmed = name.trim()
  if (!trimmed) throw new Error('Saved view name cannot be empty.')
  const id = slugify(trimmed)
  const now = new Date().toISOString()
  const idx = views.findIndex(v => v.id === id)
  const next: SavedView = { id, name: trimmed, filters, updatedAt: now }
  if (idx >= 0) views[idx] = next
  else views.push(next)
  writeAll(views)
  return next
}

export function deleteView(id: string): void {
  const views = readAll().filter(v => v.id !== id)
  writeAll(views)
}

export function renameView(id: string, name: string): SavedView | null {
  const views = readAll()
  const idx = views.findIndex(v => v.id === id)
  if (idx < 0) return null
  const trimmed = name.trim()
  if (!trimmed) throw new Error('Saved view name cannot be empty.')
  const updated: SavedView = {
    ...views[idx],
    name: trimmed,
    updatedAt: new Date().toISOString(),
  }
  views[idx] = updated
  writeAll(views)
  return updated
}
