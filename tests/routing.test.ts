/**
 * Tests for src/routing.ts
 *
 * Conventions:
 *   - matchUrl strips origin and query string before matching
 *   - `*` matches a single path segment
 *   - `**` matches any remaining path
 *   - `?` is NOT a glob meta-character; patterns containing `?` won't match
 *   - resolveRoute requires ALL conditions on a rule (match + flag + category)
 *   - resolveRoute signature is (payload, config) where payload has pageUrl/category/metadata.flags
 *   - mergeDestinations REPLACES array fields (e.g. labels), it does not concat
 */

import { describe, it, expect } from 'vitest'
import {
  matchUrl,
  resolveRoute,
  defineRouting,
  mergeDestinations,
  type RoutingConfig,
} from '../src/routing'

// ─── matchUrl ────────────────────────────────────────────────────────────────

describe('matchUrl', () => {
  it('matches single segment with /*', () => {
    expect(matchUrl('/checkout/*', '/checkout/cart')).toBe(true)
  })

  it('does NOT match multiple segments with /*', () => {
    expect(matchUrl('/checkout/*', '/checkout/cart/items')).toBe(false)
  })

  it('matches multiple segments with /**', () => {
    expect(matchUrl('/checkout/**', '/checkout/cart/items')).toBe(true)
  })

  it('also matches a single segment with /**', () => {
    expect(matchUrl('/checkout/**', '/checkout/cart')).toBe(true)
  })

  it('strips origin and query string before matching', () => {
    expect(
      matchUrl('/checkout/*', 'https://x.com/checkout/cart?a=1')
    ).toBe(true)
  })

  it('"*" alone matches anything', () => {
    expect(matchUrl('*', 'anything')).toBe(true)
    expect(matchUrl('*', '/a/b/c')).toBe(false) // single * doesn't cross /
    expect(matchUrl('**', '/a/b/c')).toBe(true)
  })

  it('does NOT support `?` glob — returns false', () => {
    expect(matchUrl('/api/v?/users', '/api/v1/users')).toBe(false)
  })

  it('returns false on a clear mismatch', () => {
    expect(matchUrl('/checkout/*', '/account/settings')).toBe(false)
  })
})

// ─── resolveRoute ────────────────────────────────────────────────────────────

describe('resolveRoute', () => {
  it("returns the first matching rule's `to`", () => {
    const config: RoutingConfig = {
      routes: [
        { match: '/checkout/*', to: { slack: '#checkout' } },
        { match: '/account/*', to: { slack: '#account' } },
      ],
    }
    const r = resolveRoute({ pageUrl: '/checkout/cart' }, config)
    expect(r.slack).toBe('#checkout')
  })

  it('returns the default when no rules match', () => {
    const config: RoutingConfig = {
      routes: [{ match: '/checkout/*', to: { slack: '#checkout' } }],
      default: { slack: '#bugs' },
    }
    const r = resolveRoute({ pageUrl: '/account/settings' }, config)
    expect(r.slack).toBe('#bugs')
  })

  it('returns {} when no rules match and no default', () => {
    const config: RoutingConfig = {
      routes: [{ match: '/checkout/*', to: { slack: '#checkout' } }],
    }
    const r = resolveRoute({ pageUrl: '/account/settings' }, config)
    expect(r).toEqual({})
  })

  it('requires ALL conditions on a rule (match + flag + category)', () => {
    const config: RoutingConfig = {
      routes: [
        {
          match: '/checkout/*',
          flag: 'beta',
          category: 'bug',
          to: { slack: '#checkout-beta-bugs' },
        },
      ],
      default: { slack: '#default' },
    }
    // url matches, flag/category missing
    expect(
      resolveRoute({ pageUrl: '/checkout/cart' }, config).slack
    ).toBe('#default')
    // url + flag match, category missing
    expect(
      resolveRoute(
        { pageUrl: '/checkout/cart', metadata: { flags: ['beta'] } },
        config
      ).slack
    ).toBe('#default')
    // All three match
    expect(
      resolveRoute(
        {
          pageUrl: '/checkout/cart',
          category: 'bug',
          metadata: { flags: ['beta'] },
        },
        config
      ).slack
    ).toBe('#checkout-beta-bugs')
  })

  it('returns first match when multiple rules could match', () => {
    const config: RoutingConfig = {
      routes: [
        { match: '/checkout/*', to: { slack: '#first' } },
        { match: '/checkout/cart', to: { slack: '#second' } },
      ],
    }
    expect(
      resolveRoute({ pageUrl: '/checkout/cart' }, config).slack
    ).toBe('#first')
  })

  it('matches a rule with only a category condition', () => {
    const config: RoutingConfig = {
      routes: [{ category: 'praise', to: { slack: '#kudos' } }],
      default: { slack: '#bugs' },
    }
    expect(
      resolveRoute({ pageUrl: '/x', category: 'praise' }, config).slack
    ).toBe('#kudos')
    expect(
      resolveRoute({ pageUrl: '/x', category: 'bug' }, config).slack
    ).toBe('#bugs')
  })
})

// ─── defineRouting ───────────────────────────────────────────────────────────

describe('defineRouting', () => {
  it('is the identity function (returns input unchanged)', () => {
    const config: RoutingConfig = {
      routes: [{ match: '/x', to: { slack: '#x' } }],
      default: { slack: '#bugs' },
    }
    const result = defineRouting(config)
    expect(result).toBe(config)
  })
})

// ─── mergeDestinations ───────────────────────────────────────────────────────

describe('mergeDestinations', () => {
  it('overrides take precedence over base', () => {
    const merged = mergeDestinations(
      { slack: '#base' },
      { slack: '#override' }
    )
    expect(merged.slack).toBe('#override')
  })

  it('REPLACES `labels` array (does NOT concat) — documented choice', () => {
    const merged = mergeDestinations(
      { labels: ['bug', 'triage'] },
      { labels: ['urgent'] }
    )
    expect(merged.labels).toEqual(['urgent'])
  })

  it('keeps base fields when overrides do not specify them', () => {
    const merged = mergeDestinations(
      { slack: '#base', labels: ['bug'] },
      { labels: ['urgent'] }
    )
    expect(merged.slack).toBe('#base')
    expect(merged.labels).toEqual(['urgent'])
  })

  it('returns a fresh object (does not mutate base)', () => {
    const base = { slack: '#base' }
    const merged = mergeDestinations(base, { slack: '#override' })
    expect(base.slack).toBe('#base')
    expect(merged).not.toBe(base)
  })
})
