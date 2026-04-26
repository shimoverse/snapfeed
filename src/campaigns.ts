/**
 * snapfeed — Release Campaigns
 *
 * A "campaign" represents a time-bound dogfooding session for a feature:
 * a name, a date window, an optional feature flag, owners, optional
 * routing override, and tags that get auto-applied to feedback during
 * the campaign window.
 *
 * Campaigns are pure data + helper functions. Wiring them into the
 * provider (auto-tag from URL, override routing) lives in higher-level
 * modules; this file is the primitive.
 *
 * @example
 * ```ts
 * import { defineCampaign } from 'snapfeed/campaigns'
 *
 * export const checkoutBeta = defineCampaign({
 *   id: 'checkout-v2-beta',
 *   name: 'Checkout v2 beta',
 *   flag: 'checkout_v2',
 *   startsAt: '2026-04-20',
 *   endsAt: '2026-05-04',
 *   owners: ['mohit@shimoverse.com'],
 *   routing: { slack: '#checkout-beta' },
 *   tags: ['checkout', 'beta'],
 * })
 * ```
 */

import type { RoutingDestination } from './routing'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReleaseCampaign {
  /** Slug used in URLs and tags, e.g. 'checkout-v2-beta'. */
  id: string
  /** Human-readable name. */
  name: string
  /** Optional feature flag name. When set, payloads with this flag in metadata get tagged with the campaign. */
  flag?: string
  /** ISO start date (inclusive) and end date (inclusive). */
  startsAt: string
  endsAt: string
  /** Owners (user identifiers, not enforced — informational). */
  owners?: string[]
  /** Optional routing override applied to feedback during the campaign window. */
  routing?: RoutingDestination
  /** Tags automatically added to feedback during the campaign window. */
  tags?: string[]
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Identity function for type inference. Use from your campaigns config so
 * you get IntelliSense without a separate type annotation.
 */
export function defineCampaign(c: ReleaseCampaign): ReleaseCampaign {
  return c
}

/**
 * Returns true if `now` falls within [startsAt, endsAt] inclusive.
 * `now` defaults to Date.now() but is injectable for testing.
 *
 * Date strings are parsed as JS Date — bare `YYYY-MM-DD` is treated as
 * UTC midnight. The end of the day on `endsAt` is included by snapping
 * the comparison to end-of-day (23:59:59.999) when `endsAt` looks like
 * a date-only string.
 */
export function isCampaignActive(
  c: ReleaseCampaign,
  now?: Date | number
): boolean {
  const t = toMs(now ?? Date.now())
  const start = parseStart(c.startsAt)
  const end = parseEnd(c.endsAt)
  if (start === null || end === null) return false
  return t >= start && t <= end
}

/**
 * Returns the tags that should be applied to a payload, given the active
 * campaigns. A campaign contributes its tags + a `release:<id>` tag.
 *
 * Filters by date window AND (if `flag` is set) by whether the payload's
 * `metadata.flags` includes the campaign's flag. Result is de-duplicated
 * but order-stable: `release:<id>` first per campaign, then its `tags`.
 */
export function getCampaignTags(
  campaigns: ReleaseCampaign[],
  payload: { metadata?: { flags?: string[] } },
  now?: Date | number
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const flags = payload.metadata?.flags ?? []

  for (const c of campaigns) {
    if (!isCampaignActive(c, now)) continue
    if (c.flag !== undefined && !flags.includes(c.flag)) continue

    const releaseTag = `release:${c.id}`
    if (!seen.has(releaseTag)) {
      seen.add(releaseTag)
      out.push(releaseTag)
    }
    for (const t of c.tags ?? []) {
      if (!seen.has(t)) {
        seen.add(t)
        out.push(t)
      }
    }
  }
  return out
}

/**
 * Returns the routing destinations from active campaigns, in priority order
 * (first matching campaign wins). Returns undefined if no campaign matched
 * or if no matching campaign declared a `routing` override.
 */
export function getCampaignRouting(
  campaigns: ReleaseCampaign[],
  payload: { metadata?: { flags?: string[] } },
  now?: Date | number
): RoutingDestination | undefined {
  const flags = payload.metadata?.flags ?? []
  for (const c of campaigns) {
    if (!isCampaignActive(c, now)) continue
    if (c.flag !== undefined && !flags.includes(c.flag)) continue
    if (c.routing) return c.routing
  }
  return undefined
}

/**
 * Generates a stable shareable URL for a campaign, given a base URL.
 * Format: `${baseUrl}/c/${campaign.id}` — opens the app with a path
 * that the FeedbackProvider can pick up to auto-tag (the picker is out
 * of scope for this file).
 *
 * Trailing slashes on `baseUrl` are normalized away.
 */
export function campaignShareUrl(c: ReleaseCampaign, baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/u, '')
  return `${trimmed}/c/${c.id}`
}

// ─── Internals ────────────────────────────────────────────────────────────────

function toMs(t: Date | number): number {
  return t instanceof Date ? t.getTime() : t
}

function parseStart(s: string): number | null {
  const ms = Date.parse(s)
  return Number.isNaN(ms) ? null : ms
}

/**
 * For end dates, if the caller passed a bare `YYYY-MM-DD`, treat the end
 * as end-of-day UTC so the window is truly inclusive. If they passed a
 * full ISO timestamp, respect it as-is.
 */
function parseEnd(s: string): number | null {
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/u.test(s)
  if (isDateOnly) {
    const ms = Date.parse(`${s}T23:59:59.999Z`)
    return Number.isNaN(ms) ? null : ms
  }
  const ms = Date.parse(s)
  return Number.isNaN(ms) ? null : ms
}
