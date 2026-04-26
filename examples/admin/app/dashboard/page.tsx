import Link from 'next/link'
import { requireUser } from '../../lib/auth'
import {
  getConfiguredPaths,
  listCampaigns,
  listFeedback,
  type AdminFeedbackRecord,
  type AdminFeedbackStatus,
} from '../../lib/data'
import { BarChart, DonutChart, Sparkline } from '../../lib/charts'
import { isCampaignActive } from 'snapfeed/campaigns'

const CATEGORY_COLORS: Record<string, string> = {
  bug: '#DC2626',
  idea: '#D4714B',
  question: '#0EA5E9',
  praise: '#059669',
  other: '#6B7280',
}

const STATUS_COLORS: Record<AdminFeedbackStatus, string> = {
  open: '#D97706',
  triaged: '#0EA5E9',
  resolved: '#059669',
  wontfix: '#6B7280',
}

const DAY_MS = 24 * 60 * 60 * 1000

export default async function DashboardPage() {
  requireUser()

  const records = await listFeedback({})
  const campaigns = await listCampaigns()
  const paths = getConfiguredPaths()

  const now = Date.now()
  const oneWeekAgo = now - 7 * DAY_MS
  const twoWeeksAgo = now - 14 * DAY_MS
  const thirtyDaysAgo = now - 30 * DAY_MS

  const thisWeek = records.filter(r => parseTs(r.timestamp) >= oneWeekAgo)
  const lastWeek = records.filter(r => {
    const t = parseTs(r.timestamp)
    return t >= twoWeeksAgo && t < oneWeekAgo
  })
  const last30 = records.filter(r => parseTs(r.timestamp) >= thirtyDaysAgo)

  const byCategory = countBy(records, r => r.category ?? 'other')
  const byStatus = countBy(records, r => r.status)
  const topReporters = topN(
    records,
    r => r.user?.email ?? r.user?.name,
    5,
  ).filter(([k]) => Boolean(k))
  const topPages = topN(records, r => safePathname(r.pageUrl ?? r.pageName), 5)

  const triageWeekly = computeMeanTriageHoursByWeek(records, 8)
  const openItems = records.filter(r => r.status === 'open').slice(0, 10)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <header>
        <h1 style={{ margin: 0, fontSize: 22 }}>Dashboard</h1>
        <p style={{ margin: '4px 0 0', color: '#6B7280', fontSize: 13 }}>
          Snapshot of feedback across all time. Reading from{' '}
          <code>{paths.feedback}</code>.
        </p>
      </header>

      {/* ─── Top KPIs ──────────────────────────────────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 12,
        }}
      >
        <Kpi
          label="This week"
          value={thisWeek.length}
          delta={deltaPct(thisWeek.length, lastWeek.length)}
          sublabel={`${lastWeek.length} last week`}
        />
        <Kpi label="Last 30 days" value={last30.length} sublabel="all categories" />
        <Kpi
          label="Open"
          value={records.filter(r => r.status === 'open').length}
          sublabel="awaiting triage"
        />
        <Kpi
          label="Resolved"
          value={records.filter(r => r.status === 'resolved').length}
          sublabel="all time"
        />
      </div>

      {/* ─── Charts row ────────────────────────────────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 12,
        }}
      >
        <Card title="By category">
          <BarChart
            data={['bug', 'idea', 'question', 'praise', 'other'].map(c => ({
              label: c,
              value: byCategory[c] ?? 0,
            }))}
            color="#D4714B"
            height={200}
          />
        </Card>

        <Card title="By status">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-around',
              gap: 16,
            }}
          >
            <DonutChart
              data={(Object.keys(STATUS_COLORS) as AdminFeedbackStatus[]).map(
                s => ({
                  label: s,
                  value: byStatus[s] ?? 0,
                  color: STATUS_COLORS[s],
                }),
              )}
              size={160}
              centerLabel="total"
            />
            <Legend
              items={(Object.keys(STATUS_COLORS) as AdminFeedbackStatus[]).map(
                s => ({
                  label: s,
                  value: byStatus[s] ?? 0,
                  color: STATUS_COLORS[s],
                }),
              )}
            />
          </div>
        </Card>

        <Card title="Mean time to triage (weekly, hours)">
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <Sparkline
              values={triageWeekly.map(w => w.hours)}
              width={200}
              height={56}
              color="#0EA5E9"
            />
            <div style={{ fontSize: 12, color: '#6B7280' }}>
              {triageWeekly.length === 0 ? (
                'No triage data yet.'
              ) : (
                <>
                  Latest week:{' '}
                  <strong style={{ color: '#111' }}>
                    {triageWeekly.at(-1)?.hours.toFixed(1)} h
                  </strong>
                </>
              )}
            </div>
          </div>
        </Card>
      </div>

      {/* ─── Top lists ────────────────────────────────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 12,
        }}
      >
        <Card title="Top reporters">
          <RankList
            items={topReporters.map(([k, v]) => ({
              label: k ?? '—',
              value: v,
              href: `/?reporter=${encodeURIComponent(k ?? '')}`,
            }))}
            empty="No reporters yet."
          />
        </Card>

        <Card title="Top pages">
          <RankList
            items={topPages.map(([k, v]) => ({
              label: k ?? '/',
              value: v,
              href: `/?pageUrlContains=${encodeURIComponent(k ?? '')}`,
            }))}
            empty="No page data yet."
          />
        </Card>

        <Card title="Open items (latest 10)">
          {openItems.length === 0 ? (
            <p style={{ color: '#6B7280', fontSize: 13, margin: 0 }}>
              Nothing in the queue. Nice work.
            </p>
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              {openItems.map(o => (
                <li
                  key={o.id}
                  style={{
                    display: 'flex',
                    gap: 8,
                    fontSize: 12,
                    padding: '4px 0',
                    borderBottom: '1px solid #F3F4F6',
                  }}
                >
                  <span
                    style={{
                      color: CATEGORY_COLORS[o.category ?? 'other'],
                      fontWeight: 600,
                      minWidth: 60,
                      textTransform: 'uppercase',
                      letterSpacing: '0.03em',
                    }}
                  >
                    {o.category ?? 'other'}
                  </span>
                  <Link
                    href={`/?status=open`}
                    style={{
                      flex: 1,
                      color: '#111',
                      textDecoration: 'none',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {o.text.slice(0, 80)}
                  </Link>
                  <span style={{ color: '#9CA3AF' }}>
                    {formatDay(o.timestamp)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div style={{ marginTop: 8 }}>
            <Link
              href="/?status=open"
              style={{
                fontSize: 12,
                color: '#D4714B',
                fontWeight: 600,
                textDecoration: 'none',
              }}
            >
              See all open →
            </Link>
          </div>
        </Card>
      </div>

      {/* ─── Campaigns ─────────────────────────────────────────────── */}
      <Card title="Active release campaigns">
        {campaigns.length === 0 ? (
          <p style={{ color: '#6B7280', fontSize: 13, margin: 0 }}>
            No campaigns configured. Set <code>SNAPFEED_CAMPAIGNS_FILE</code>{' '}
            to a JSON array of campaigns.
          </p>
        ) : (
          <ul
            style={{
              margin: 0,
              padding: 0,
              listStyle: 'none',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            {campaigns.map(c => {
              const active = isCampaignActive(c, now)
              const count = records.filter(r =>
                r.campaigns?.includes(c.id),
              ).length
              return (
                <li
                  key={c.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '8px 10px',
                    background: '#F9FAFB',
                    borderRadius: 6,
                    fontSize: 13,
                  }}
                >
                  <span
                    style={{
                      padding: '2px 8px',
                      borderRadius: 999,
                      background: active ? '#D1FAE5' : '#E5E7EB',
                      color: active ? '#065F46' : '#6B7280',
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: '0.04em',
                      textTransform: 'uppercase',
                    }}
                  >
                    {active ? 'Live' : 'Past'}
                  </span>
                  <Link
                    href={`/?campaign=${encodeURIComponent(c.id)}`}
                    style={{
                      flex: 1,
                      color: '#111',
                      fontWeight: 600,
                      textDecoration: 'none',
                    }}
                  >
                    {c.name}
                  </Link>
                  <span style={{ color: '#6B7280', fontSize: 12 }}>
                    {c.startsAt} → {c.endsAt}
                  </span>
                  <span
                    style={{
                      color: '#111',
                      fontWeight: 600,
                      minWidth: 50,
                      textAlign: 'right',
                    }}
                  >
                    {count}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </div>
  )
}

// ─── Cards / building blocks ──────────────────────────────────────────────────

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      style={{
        background: '#fff',
        border: '1px solid #E5E7EB',
        borderRadius: 12,
        padding: 16,
      }}
    >
      <h2
        style={{
          margin: 0,
          fontSize: 12,
          fontWeight: 600,
          color: '#6B7280',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          marginBottom: 12,
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  )
}

function Kpi({
  label,
  value,
  sublabel,
  delta,
}: {
  label: string
  value: number
  sublabel?: string
  delta?: number | null
}) {
  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #E5E7EB',
        borderRadius: 12,
        padding: 16,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: '#6B7280',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 28,
          fontWeight: 700,
          color: '#111',
          marginTop: 4,
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: 12, color: '#6B7280', marginTop: 4 }}>
        {delta !== undefined && delta !== null ? (
          <span
            style={{
              color: delta >= 0 ? '#059669' : '#DC2626',
              fontWeight: 600,
              marginRight: 6,
            }}
          >
            {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(0)}%
          </span>
        ) : null}
        {sublabel ?? ''}
      </div>
    </div>
  )
}

function Legend({
  items,
}: {
  items: Array<{ label: string; value: number; color: string }>
}) {
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: 'none', fontSize: 12 }}>
      {items.map(i => (
        <li
          key={i.label}
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }}
        >
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: 2,
              background: i.color,
              display: 'inline-block',
            }}
          />
          <span style={{ color: '#374151', textTransform: 'capitalize', flex: 1 }}>
            {i.label}
          </span>
          <span style={{ color: '#111', fontWeight: 600 }}>{i.value}</span>
        </li>
      ))}
    </ul>
  )
}

function RankList({
  items,
  empty,
}: {
  items: Array<{ label: string; value: number; href?: string }>
  empty: string
}) {
  if (items.length === 0) {
    return <p style={{ color: '#6B7280', fontSize: 13, margin: 0 }}>{empty}</p>
  }
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
      {items.map(i => (
        <li
          key={i.label}
          style={{
            display: 'flex',
            gap: 8,
            padding: '6px 0',
            borderBottom: '1px solid #F3F4F6',
            fontSize: 13,
          }}
        >
          {i.href ? (
            <Link
              href={i.href}
              style={{
                flex: 1,
                color: '#111',
                textDecoration: 'none',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={i.label}
            >
              {i.label}
            </Link>
          ) : (
            <span
              style={{
                flex: 1,
                color: '#111',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={i.label}
            >
              {i.label}
            </span>
          )}
          <span style={{ color: '#6B7280', fontWeight: 600 }}>{i.value}</span>
        </li>
      ))}
    </ul>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseTs(s: string): number {
  const t = Date.parse(s)
  return Number.isNaN(t) ? 0 : t
}

function countBy<T>(items: T[], key: (x: T) => string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const i of items) {
    const k = key(i)
    out[k] = (out[k] ?? 0) + 1
  }
  return out
}

function topN<T>(
  items: T[],
  key: (x: T) => string | undefined,
  n: number,
): Array<[string | undefined, number]> {
  const counts = new Map<string | undefined, number>()
  for (const i of items) {
    const k = key(i)
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
}

function safePathname(s: string | undefined): string {
  if (!s) return '/'
  try {
    return new URL(s).pathname
  } catch {
    // Already a path or non-URL string — pass through.
    return s
  }
}

function deltaPct(now: number, prev: number): number | null {
  if (prev === 0) return now > 0 ? 100 : null
  return ((now - prev) / prev) * 100
}

function formatDay(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/**
 * Compute mean time-to-triage (in hours) per ISO week, going back `weeks`
 * weeks. Records that aren't triaged yet are skipped — we're looking at
 * latency, not coverage.
 */
function computeMeanTriageHoursByWeek(
  records: AdminFeedbackRecord[],
  weeks: number,
): Array<{ weekStartMs: number; hours: number }> {
  const now = Date.now()
  const buckets: Array<{ start: number; end: number; sum: number; n: number }> = []
  for (let i = weeks - 1; i >= 0; i--) {
    const end = now - i * 7 * DAY_MS
    const start = end - 7 * DAY_MS
    buckets.push({ start, end, sum: 0, n: 0 })
  }

  for (const r of records) {
    if (!r.triagedAt) continue
    const submitted = parseTs(r.timestamp)
    const triaged = parseTs(r.triagedAt)
    if (!submitted || !triaged || triaged < submitted) continue
    const hours = (triaged - submitted) / (60 * 60 * 1000)
    for (const b of buckets) {
      if (triaged >= b.start && triaged < b.end) {
        b.sum += hours
        b.n += 1
        break
      }
    }
  }

  return buckets.map(b => ({
    weekStartMs: b.start,
    hours: b.n > 0 ? b.sum / b.n : 0,
  }))
}
