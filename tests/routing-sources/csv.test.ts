/**
 * Tests for src/routing-sources/csv.ts
 *
 * We write actual files to os.tmpdir() and clean up in afterAll. Each test
 * uses a unique path so concurrent runs don't collide.
 */

import { describe, it, expect, afterAll } from 'vitest'
import { writeFile, unlink } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { csvRoutingSource } from '../../src/routing-sources/csv'

const createdPaths: string[] = []
function tmpPath(label = 'snapfeed-csv'): string {
  const p = path.join(
    os.tmpdir(),
    `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}.csv`
  )
  createdPaths.push(p)
  return p
}

afterAll(async () => {
  for (const p of createdPaths) {
    try {
      await unlink(p)
    } catch {
      // best-effort cleanup
    }
  }
})

describe('csvRoutingSource', () => {
  it('reads a CSV with headers + 3 rows and returns RoutingConfig (2 routes + default)', async () => {
    const file = tmpPath()
    await writeFile(
      file,
      [
        'match,flag,category,team,slack,jira,linear,github,discord,sheet,assignee,labels',
        '/checkout/**,,,payments,#checkout,CHK,,,,,,bug;triage',
        ',new_onboarding,,growth,#growth,,GRW,,,,alice,',
        '*default*,,,platform,#bugs,,,,,,,',
      ].join('\n'),
      'utf8'
    )

    const source = csvRoutingSource({ path: file })
    expect(source.name).toBe('csv')

    const config = await source.fetch()
    expect(config).toBeDefined()
    expect(config!.routes).toHaveLength(2)
    expect(config!.routes[0]).toEqual({
      match: '/checkout/**',
      to: {
        team: 'payments',
        slack: '#checkout',
        jira: 'CHK',
        labels: ['bug', 'triage'],
      },
    })
    expect(config!.routes[1]).toEqual({
      flag: 'new_onboarding',
      to: {
        team: 'growth',
        slack: '#growth',
        linear: 'GRW',
        assignee: 'alice',
      },
    })
    expect(config!.default).toEqual({ team: 'platform', slack: '#bugs' })
  })

  it('treatDefaultRow: false keeps the *default* row as a regular route', async () => {
    const file = tmpPath()
    await writeFile(
      file,
      [
        'match,flag,category,team,slack,jira,linear,github,discord,sheet,assignee,labels',
        '*default*,,,platform,#bugs,,,,,,,',
      ].join('\n'),
      'utf8'
    )

    const source = csvRoutingSource({ path: file, treatDefaultRow: false })
    const config = await source.fetch()
    expect(config).toBeDefined()
    expect(config!.default).toBeUndefined()
    expect(config!.routes).toHaveLength(1)
    expect(config!.routes[0]).toEqual({
      match: '*default*',
      to: { team: 'platform', slack: '#bugs' },
    })
  })

  it('empty cells become undefined (not "")', async () => {
    const file = tmpPath()
    await writeFile(
      file,
      [
        'match,flag,category,team,slack,jira,linear,github,discord,sheet,assignee,labels',
        '/x,,,team-x,,,,,,,,',
      ].join('\n'),
      'utf8'
    )

    const source = csvRoutingSource({ path: file })
    const config = await source.fetch()
    const rule = config!.routes[0]!
    // Only `team` should be present in the destination.
    expect(rule.to).toEqual({ team: 'team-x' })
    expect('slack' in rule.to).toBe(false)
    expect('labels' in rule.to).toBe(false)
    // flag/category not present on the rule either
    expect(rule.flag).toBeUndefined()
    expect(rule.category).toBeUndefined()
  })

  it('parses quoted fields with embedded commas and escaped quotes', async () => {
    const file = tmpPath()
    await writeFile(
      file,
      [
        'match,flag,category,team,slack,jira,linear,github,discord,sheet,assignee,labels',
        // Quoted match contains comma; quoted assignee contains an escaped quote.
        '"/api/v1,beta",,,api,#api,,,,,,"O""Brien",bug',
      ].join('\n'),
      'utf8'
    )

    const source = csvRoutingSource({ path: file })
    const config = await source.fetch()
    const rule = config!.routes[0]!
    expect(rule.match).toBe('/api/v1,beta')
    expect(rule.to.assignee).toBe('O"Brien')
    expect(rule.to.labels).toEqual(['bug'])
  })

  it('returns undefined (no throw) when the file is missing', async () => {
    const source = csvRoutingSource({
      path: path.join(os.tmpdir(), 'snapfeed-csv-does-not-exist-xyz.csv'),
    })
    const config = await source.fetch()
    expect(config).toBeUndefined()
  })

  it('parses semicolon-separated labels into a string array', async () => {
    const file = tmpPath()
    await writeFile(
      file,
      [
        'match,flag,category,team,slack,jira,linear,github,discord,sheet,assignee,labels',
        '/x,,,team-x,,,,,,,,bug;triage',
      ].join('\n'),
      'utf8'
    )

    const source = csvRoutingSource({ path: file })
    const config = await source.fetch()
    expect(config!.routes[0]!.to.labels).toEqual(['bug', 'triage'])
  })
})
