/**
 * Tests for src/campaigns.ts
 */

import { describe, it, expect } from 'vitest'
import {
  defineCampaign,
  isCampaignActive,
  getCampaignTags,
  getCampaignRouting,
  campaignShareUrl,
  type ReleaseCampaign,
} from '../src/campaigns'

// ─── defineCampaign ──────────────────────────────────────────────────────────

describe('defineCampaign', () => {
  it('is the identity function', () => {
    const c: ReleaseCampaign = {
      id: 'x',
      name: 'X',
      startsAt: '2026-04-01',
      endsAt: '2026-04-30',
    }
    expect(defineCampaign(c)).toBe(c)
  })
})

// ─── isCampaignActive ────────────────────────────────────────────────────────

describe('isCampaignActive', () => {
  const c: ReleaseCampaign = {
    id: 'beta',
    name: 'Beta',
    startsAt: '2026-04-01',
    endsAt: '2026-04-30',
  }

  it('returns true within the date window', () => {
    expect(isCampaignActive(c, new Date('2026-04-15T12:00:00Z'))).toBe(true)
  })

  it('returns false before the start', () => {
    expect(isCampaignActive(c, new Date('2026-03-31T22:00:00Z'))).toBe(false)
  })

  it('returns false after the end', () => {
    expect(isCampaignActive(c, new Date('2026-05-01T01:00:00Z'))).toBe(false)
  })

  it('treats the start date as inclusive (UTC midnight on YYYY-MM-DD)', () => {
    expect(isCampaignActive(c, new Date('2026-04-01T00:00:00Z'))).toBe(true)
  })

  it('treats the end date as inclusive through end-of-day UTC', () => {
    expect(isCampaignActive(c, new Date('2026-04-30T23:59:59Z'))).toBe(true)
  })

  it('accepts a number timestamp for `now`', () => {
    const ts = Date.parse('2026-04-15T00:00:00Z')
    expect(isCampaignActive(c, ts)).toBe(true)
  })
})

// ─── getCampaignTags ─────────────────────────────────────────────────────────

describe('getCampaignTags', () => {
  const now = new Date('2026-04-15T12:00:00Z')

  it("includes `release:<id>` and the campaign's tags when active", () => {
    const c = defineCampaign({
      id: 'checkout-v2',
      name: 'Checkout v2',
      startsAt: '2026-04-01',
      endsAt: '2026-04-30',
      tags: ['checkout', 'beta'],
    })
    expect(getCampaignTags([c], {}, now)).toEqual([
      'release:checkout-v2',
      'checkout',
      'beta',
    ])
  })

  it('returns [] when no campaign is in window', () => {
    const c = defineCampaign({
      id: 'old',
      name: 'Old',
      startsAt: '2025-01-01',
      endsAt: '2025-01-31',
      tags: ['x'],
    })
    expect(getCampaignTags([c], {}, now)).toEqual([])
  })

  it('filters by flag — excludes campaign whose flag is not on the payload', () => {
    const c = defineCampaign({
      id: 'flagged',
      name: 'Flagged',
      flag: 'new_onboarding',
      startsAt: '2026-04-01',
      endsAt: '2026-04-30',
      tags: ['onboarding'],
    })
    expect(getCampaignTags([c], { metadata: { flags: [] } }, now)).toEqual([])
    expect(
      getCampaignTags(
        [c],
        { metadata: { flags: ['new_onboarding'] } },
        now
      )
    ).toEqual(['release:flagged', 'onboarding'])
  })

  it('merges tags from multiple active campaigns and dedupes', () => {
    const a = defineCampaign({
      id: 'a',
      name: 'A',
      startsAt: '2026-04-01',
      endsAt: '2026-04-30',
      tags: ['shared', 'a-only'],
    })
    const b = defineCampaign({
      id: 'b',
      name: 'B',
      startsAt: '2026-04-01',
      endsAt: '2026-04-30',
      tags: ['shared', 'b-only'],
    })
    const tags = getCampaignTags([a, b], {}, now)
    expect(tags).toEqual([
      'release:a',
      'shared',
      'a-only',
      'release:b',
      'b-only',
    ])
  })
})

// ─── getCampaignRouting ──────────────────────────────────────────────────────

describe('getCampaignRouting', () => {
  const now = new Date('2026-04-15T12:00:00Z')

  it('returns the first active campaign with a routing override', () => {
    const a = defineCampaign({
      id: 'a',
      name: 'A',
      startsAt: '2026-04-01',
      endsAt: '2026-04-30',
      // no routing
    })
    const b = defineCampaign({
      id: 'b',
      name: 'B',
      startsAt: '2026-04-01',
      endsAt: '2026-04-30',
      routing: { slack: '#b' },
    })
    const c = defineCampaign({
      id: 'c',
      name: 'C',
      startsAt: '2026-04-01',
      endsAt: '2026-04-30',
      routing: { slack: '#c' },
    })
    expect(getCampaignRouting([a, b, c], {}, now)).toEqual({ slack: '#b' })
  })

  it('returns undefined when no campaigns match', () => {
    const c = defineCampaign({
      id: 'old',
      name: 'Old',
      startsAt: '2025-01-01',
      endsAt: '2025-01-31',
      routing: { slack: '#nope' },
    })
    expect(getCampaignRouting([c], {}, now)).toBeUndefined()
  })

  it('respects the flag filter', () => {
    const c = defineCampaign({
      id: 'flagged',
      name: 'Flagged',
      flag: 'new_onboarding',
      startsAt: '2026-04-01',
      endsAt: '2026-04-30',
      routing: { slack: '#onboarding' },
    })
    expect(
      getCampaignRouting([c], { metadata: { flags: [] } }, now)
    ).toBeUndefined()
    expect(
      getCampaignRouting(
        [c],
        { metadata: { flags: ['new_onboarding'] } },
        now
      )
    ).toEqual({ slack: '#onboarding' })
  })
})

// ─── campaignShareUrl ────────────────────────────────────────────────────────

describe('campaignShareUrl', () => {
  const c: ReleaseCampaign = {
    id: 'checkout-v2-beta',
    name: 'Checkout v2 beta',
    startsAt: '2026-04-01',
    endsAt: '2026-04-30',
  }

  it('produces `${baseUrl}/c/${id}`', () => {
    expect(campaignShareUrl(c, 'https://app.example.com')).toBe(
      'https://app.example.com/c/checkout-v2-beta'
    )
  })

  it('strips a trailing slash on baseUrl', () => {
    expect(campaignShareUrl(c, 'https://app.example.com/')).toBe(
      'https://app.example.com/c/checkout-v2-beta'
    )
  })

  it('strips multiple trailing slashes', () => {
    expect(campaignShareUrl(c, 'https://app.example.com///')).toBe(
      'https://app.example.com/c/checkout-v2-beta'
    )
  })
})
