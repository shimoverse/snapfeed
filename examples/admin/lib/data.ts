/**
 * snapfeed admin — Data layer
 *
 * Reads the immutable feedback JSONL written by `fileAdapter` and merges in a
 * sidecar JSONL of triage state ("status", "notes", "triagedBy", …). The
 * sidecar is append-only too, so a record's current state is the last sidecar
 * entry that matches its id. We never mutate the original feedback file.
 *
 * Concurrency caveat (acceptable for v0.4 — a real DB ships in v0.6):
 *   The sidecar is plain append. If two admins triage the same id within the
 *   same millisecond, the entry written second wins on the next read. We
 *   trade safety for zero deps; v0.6 moves to Postgres with row-level locks.
 *
 * Path config (env-driven):
 *   SNAPFEED_FEEDBACK_FILE        default ./feedback.jsonl
 *   SNAPFEED_AUDIT_LOG_FILE       default ./snapfeed-audit.jsonl
 *   SNAPFEED_FEEDBACK_STATUS_FILE default ./feedback-status.jsonl
 *
 * We stat-cache reads by file mtime: if the mtime hasn't moved since the last
 * parse, we serve the in-memory copy. Sidecar gets the same treatment. This
 * keeps the dashboard snappy while still picking up fresh adapter writes
 * without restarting the Next.js server.
 */

import { promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import type { FeedbackPayload } from 'snapfeed'
import type { AuditEvent } from 'snapfeed/audit-log'
import type { ReleaseCampaign } from 'snapfeed/campaigns'
import { isCampaignActive } from 'snapfeed/campaigns'

// ─── Public types ─────────────────────────────────────────────────────────────

export type AdminFeedbackStatus = 'open' | 'triaged' | 'resolved' | 'wontfix'

export interface AdminFeedbackRecord extends FeedbackPayload {
  /** Stable id (hash of timestamp + reporter + first 50 chars of text). */
  id: string
  /** Lifecycle status. */
  status: AdminFeedbackStatus
  /** Optional notes added by the triager. */
  notes?: string
  /** Who triaged. */
  triagedBy?: string
  triagedAt?: string
  resolvedBy?: string
  resolvedAt?: string
  /** Campaign ids whose date window contained this feedback. */
  campaigns?: string[]
}

export interface ListFeedbackOptions {
  dateFrom?: string
  dateTo?: string
  category?: string
  status?: AdminFeedbackStatus
  reporter?: string
  pageUrlContains?: string
  hasScreenshot?: boolean
  campaign?: string
  search?: string
}

export interface ListAuditEventsOptions {
  limit?: number
  type?: string
  sinceTs?: string
}

export interface FeedbackUpdatePatch {
  status?: AdminFeedbackStatus
  notes?: string
  triagedBy?: string
  triagedAt?: string
  resolvedBy?: string
  resolvedAt?: string
}

// ─── Path resolution ──────────────────────────────────────────────────────────

function feedbackPath(): string {
  return resolveEnvPath(
    process.env.SNAPFEED_FEEDBACK_FILE ?? './feedback.jsonl',
  )
}

function auditPath(): string {
  return resolveEnvPath(
    process.env.SNAPFEED_AUDIT_LOG_FILE ?? './snapfeed-audit.jsonl',
  )
}

function statusPath(): string {
  return resolveEnvPath(
    process.env.SNAPFEED_FEEDBACK_STATUS_FILE ?? './feedback-status.jsonl',
  )
}

function resolveEnvPath(p: string): string {
  return path.isAbsolute(p) ? p : path.join(process.cwd(), p)
}

export function getConfiguredPaths(): {
  feedback: string
  audit: string
  status: string
} {
  return { feedback: feedbackPath(), audit: auditPath(), status: statusPath() }
}

// ─── Id derivation ────────────────────────────────────────────────────────────

/**
 * Derive a stable id from `(timestamp, reporter, text-prefix)`. Same record
 * read twice always produces the same id; two genuinely different records
 * produced in the same millisecond by different reporters with different text
 * still get distinct ids.
 */
export function deriveFeedbackId(p: FeedbackPayload): string {
  const reporter = p.user?.email ?? p.user?.name ?? ''
  const textPrefix = (p.text ?? '').slice(0, 50)
  const seed = `${p.timestamp}|${reporter}|${textPrefix}`
  return createHash('sha256').update(seed).digest('hex').slice(0, 16)
}

// ─── Mtime-cached JSONL reader ────────────────────────────────────────────────

interface CacheEntry<T> {
  mtimeMs: number
  size: number
  parsed: T[]
}

const fileCache = new Map<string, CacheEntry<unknown>>()

async function readJsonl<T>(filePath: string): Promise<T[]> {
  let stat
  try {
    stat = await fs.stat(filePath)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw e
  }

  const cached = fileCache.get(filePath) as CacheEntry<T> | undefined
  if (
    cached &&
    cached.mtimeMs === stat.mtimeMs &&
    cached.size === stat.size
  ) {
    return cached.parsed
  }

  const raw = await fs.readFile(filePath, 'utf-8')
  const parsed: T[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      parsed.push(JSON.parse(trimmed) as T)
    } catch {
      // Skip malformed lines silently — surfacing them is the inbox page's
      // job, not the data layer's.
    }
  }
  fileCache.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, parsed })
  return parsed
}

/** Drops the in-process cache entry for a path (after we append, so the next
 *  read sees the new line even if mtime resolution is coarse). */
function invalidate(filePath: string): void {
  fileCache.delete(filePath)
}

// ─── Sidecar (status) ─────────────────────────────────────────────────────────

interface SidecarEntry extends FeedbackUpdatePatch {
  id: string
  ts: string
}

async function loadSidecarMap(): Promise<Map<string, FeedbackUpdatePatch>> {
  const entries = await readJsonl<SidecarEntry>(statusPath())
  // Last-write-wins: iterate in order and overwrite.
  const merged = new Map<string, FeedbackUpdatePatch>()
  for (const e of entries) {
    if (!e || typeof e.id !== 'string') continue
    const prev = merged.get(e.id) ?? {}
    merged.set(e.id, { ...prev, ...stripMeta(e) })
  }
  return merged
}

function stripMeta(e: SidecarEntry): FeedbackUpdatePatch {
  const { id: _id, ts: _ts, ...rest } = e
  return rest
}

async function appendSidecar(entry: SidecarEntry): Promise<void> {
  const p = statusPath()
  await ensureDirFor(p)
  await fs.appendFile(p, JSON.stringify(entry) + '\n', 'utf8')
  invalidate(p)
}

async function ensureDirFor(filePath: string): Promise<void> {
  const dir = path.dirname(filePath)
  if (dir && dir !== '.' && dir !== '') {
    await fs.mkdir(dir, { recursive: true })
  }
}

// ─── Campaigns ────────────────────────────────────────────────────────────────

/**
 * Campaigns can be configured via `SNAPFEED_CAMPAIGNS_FILE` (JSON array of
 * `ReleaseCampaign`). If unset or missing, returns []. We deliberately don't
 * `import` a TS file from the consumer's app — keeping this loader file-based
 * means the admin can be deployed independently.
 */
export async function listCampaigns(): Promise<ReleaseCampaign[]> {
  const envPath = process.env.SNAPFEED_CAMPAIGNS_FILE
  if (!envPath) return []
  const abs = resolveEnvPath(envPath)
  try {
    const raw = await fs.readFile(abs, 'utf-8')
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isReleaseCampaign)
  } catch {
    return []
  }
}

function isReleaseCampaign(x: unknown): x is ReleaseCampaign {
  if (!x || typeof x !== 'object') return false
  const c = x as Record<string, unknown>
  return (
    typeof c.id === 'string' &&
    typeof c.name === 'string' &&
    typeof c.startsAt === 'string' &&
    typeof c.endsAt === 'string'
  )
}

function campaignsForRecord(
  campaigns: ReleaseCampaign[],
  ts: string,
): string[] {
  const t = Date.parse(ts)
  if (Number.isNaN(t)) return []
  return campaigns.filter(c => isCampaignActive(c, t)).map(c => c.id)
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Read every feedback record + merge sidecar state. Filters are applied
 * in-memory (fine for the JSONL scale this admin targets — tens of thousands
 * of records, not millions). Records are returned newest-first.
 */
export async function listFeedback(
  options: ListFeedbackOptions = {},
): Promise<AdminFeedbackRecord[]> {
  const [payloads, sidecar, campaigns] = await Promise.all([
    readJsonl<FeedbackPayload>(feedbackPath()),
    loadSidecarMap(),
    listCampaigns(),
  ])

  const records: AdminFeedbackRecord[] = payloads.map(p => {
    const id = deriveFeedbackId(p)
    const patch = sidecar.get(id) ?? {}
    return {
      ...p,
      id,
      status: (patch.status as AdminFeedbackStatus) ?? 'open',
      notes: patch.notes,
      triagedBy: patch.triagedBy,
      triagedAt: patch.triagedAt,
      resolvedBy: patch.resolvedBy,
      resolvedAt: patch.resolvedAt,
      campaigns: campaignsForRecord(campaigns, p.timestamp),
    }
  })

  const filtered = records.filter(r => matchesFilters(r, options))
  filtered.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
  return filtered
}

export async function getFeedback(
  id: string,
): Promise<AdminFeedbackRecord | null> {
  const all = await listFeedback({})
  return all.find(r => r.id === id) ?? null
}

export async function updateFeedback(
  id: string,
  patch: FeedbackUpdatePatch,
): Promise<AdminFeedbackRecord | null> {
  // Trim the patch to known keys to avoid sidecar pollution.
  const allowed: (keyof FeedbackUpdatePatch)[] = [
    'status',
    'notes',
    'triagedBy',
    'triagedAt',
    'resolvedBy',
    'resolvedAt',
  ]
  const clean: FeedbackUpdatePatch = {}
  for (const k of allowed) {
    if (patch[k] !== undefined) {
       
      ;(clean as any)[k] = patch[k]
    }
  }
  const entry: SidecarEntry = { id, ts: new Date().toISOString(), ...clean }
  await appendSidecar(entry)
  return getFeedback(id)
}

export async function listAuditEvents(
  options: ListAuditEventsOptions = {},
): Promise<AuditEvent[]> {
  const all = await readJsonl<AuditEvent>(auditPath())
  let filtered = all
  if (options.type) {
    filtered = filtered.filter(e => e.type === options.type)
  }
  if (options.sinceTs) {
    const since = Date.parse(options.sinceTs)
    if (!Number.isNaN(since)) {
      filtered = filtered.filter(e => Date.parse(e.ts) >= since)
    }
  }
  // Newest first.
  filtered = [...filtered].sort((a, b) => (a.ts < b.ts ? 1 : -1))
  if (options.limit && options.limit > 0) {
    filtered = filtered.slice(0, options.limit)
  }
  return filtered
}

// ─── Filtering ────────────────────────────────────────────────────────────────

function matchesFilters(
  r: AdminFeedbackRecord,
  o: ListFeedbackOptions,
): boolean {
  if (o.status && r.status !== o.status) return false
  if (o.category && r.category !== o.category) return false
  if (o.hasScreenshot === true && !r.screenshot?.base64) return false
  if (o.hasScreenshot === false && r.screenshot?.base64) return false
  if (o.dateFrom) {
    const from = Date.parse(o.dateFrom)
    if (!Number.isNaN(from) && Date.parse(r.timestamp) < from) return false
  }
  if (o.dateTo) {
    // Treat `dateTo` as inclusive end-of-day if date-only.
    const toRaw = /^\d{4}-\d{2}-\d{2}$/u.test(o.dateTo)
      ? `${o.dateTo}T23:59:59.999Z`
      : o.dateTo
    const to = Date.parse(toRaw)
    if (!Number.isNaN(to) && Date.parse(r.timestamp) > to) return false
  }
  if (o.reporter) {
    const needle = o.reporter.toLowerCase()
    const hay = `${r.user?.name ?? ''} ${r.user?.email ?? ''}`.toLowerCase()
    if (!hay.includes(needle)) return false
  }
  if (o.pageUrlContains) {
    const needle = o.pageUrlContains.toLowerCase()
    const hay = (r.pageUrl ?? '').toLowerCase()
    if (!hay.includes(needle)) return false
  }
  if (o.campaign) {
    if (!r.campaigns?.includes(o.campaign)) return false
  }
  if (o.search) {
    const q = o.search.toLowerCase()
    const hay = [
      r.text,
      r.pageName,
      r.pageUrl,
      r.user?.name,
      r.user?.email,
      r.notes,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    if (!hay.includes(q)) return false
  }
  return true
}
