/**
 * snapfeed — CSV Routing Source (Tier 2, Node-only)
 *
 * Reads a routing CSV from disk and assembles a `RoutingConfig`. The CSV is
 * the lowest-friction way to let a non-engineer edit routing without touching
 * code: drop a `routing.csv` in the repo, have ops update it via PR.
 *
 * Expected columns (header row required, case-insensitive):
 *   match, flag, category, team, slack, jira, linear, github, discord, sheet,
 *   assignee, labels
 *
 * `labels` is `;`-separated (we use `;` because `,` is the CSV delimiter and
 * forcing users to quote every multi-label cell would be hostile).
 *
 * Default-row convention: a row whose `match` cell is exactly `*default*`
 * (case-insensitive) populates `RoutingConfig.default` instead of becoming a
 * route. This keeps the fallback destination editable in the same file.
 */

import type { RoutingConfig, RoutingDestination, RoutingRule } from '../routing'
import type { RoutingSource } from './types'

export interface CsvRoutingSourceOptions {
  /** Absolute or relative file path. */
  path: string
  /**
   * If a row's `match` column is `*default*`, treat it as the default
   * destination instead of a route.
   * @default true
   */
  treatDefaultRow?: boolean
}

const EXPECTED_COLUMNS = [
  'match',
  'flag',
  'category',
  'team',
  'slack',
  'jira',
  'linear',
  'github',
  'discord',
  'sheet',
  'assignee',
  'labels',
] as const

type ColumnName = (typeof EXPECTED_COLUMNS)[number]

const DEFAULT_SENTINEL = '*default*'

export function csvRoutingSource(options: CsvRoutingSourceOptions): RoutingSource {
  const { path, treatDefaultRow = true } = options

  return {
    name: 'csv',
    async fetch(): Promise<RoutingConfig | undefined> {
      let text: string
      try {
        const { readFile } = await import('node:fs/promises')
        text = await readFile(path, 'utf8')
      } catch {
        // Missing file or read error → transient. Caller falls back.
        return undefined
      }

      const rows = parseCsv(text)
      if (rows.length === 0) {
        return { routes: [] }
      }

      const headerCells = rows[0]!.map((c) => c.trim().toLowerCase())
      const columnIndex: Partial<Record<ColumnName, number>> = {}
      for (const col of EXPECTED_COLUMNS) {
        const idx = headerCells.indexOf(col)
        if (idx !== -1) columnIndex[col] = idx
      }

      const routes: RoutingRule[] = []
      let defaultDest: RoutingDestination | undefined

      for (let r = 1; r < rows.length; r++) {
        const row = rows[r]!
        // Skip wholly blank lines (a trailing newline produces one).
        if (row.length === 0 || row.every((c) => c.trim() === '')) continue

        const get = (name: ColumnName): string | undefined => {
          const idx = columnIndex[name]
          if (idx === undefined) return undefined
          const raw = row[idx]
          if (raw === undefined) return undefined
          const trimmed = raw.trim()
          return trimmed === '' ? undefined : trimmed
        }

        const match = get('match')
        const dest: RoutingDestination = {
          team: get('team'),
          slack: get('slack'),
          jira: get('jira'),
          linear: get('linear'),
          github: get('github'),
          discord: get('discord'),
          sheet: get('sheet'),
          assignee: get('assignee'),
          labels: parseLabels(get('labels')),
        }
        // Strip undefined keys so consumers can do `if (dest.team)` without
        // worrying about explicit-undefined vs missing.
        for (const key of Object.keys(dest) as (keyof RoutingDestination)[]) {
          if (dest[key] === undefined) delete dest[key]
        }

        if (
          treatDefaultRow &&
          match !== undefined &&
          match.toLowerCase() === DEFAULT_SENTINEL
        ) {
          defaultDest = dest
          continue
        }

        const rule: RoutingRule = { to: dest }
        if (match !== undefined) rule.match = match
        const flag = get('flag')
        if (flag !== undefined) rule.flag = flag
        const category = get('category')
        if (category !== undefined) rule.category = category

        routes.push(rule)
      }

      const config: RoutingConfig = { routes }
      if (defaultDest) config.default = defaultDest
      return config
    },
  }
}

function parseLabels(raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined
  const parts = raw
    .split(';')
    .map((p) => p.trim())
    .filter((p) => p !== '')
  return parts.length === 0 ? undefined : parts
}

// ─── Minimal CSV parser ───────────────────────────────────────────────────────
// Handles: quoted fields, embedded commas inside quotes, double-quote escaping
// (`""` → `"`), CRLF or LF line endings. Does NOT handle backslash escapes —
// CSV doesn't, and supporting it would mask malformed quoting bugs.

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0

  while (i < text.length) {
    const ch = text[i]!

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          // Escaped quote inside a quoted field.
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i += 1
        continue
      }
      field += ch
      i += 1
      continue
    }

    // Not in quotes
    if (ch === '"') {
      inQuotes = true
      i += 1
      continue
    }
    if (ch === ',') {
      row.push(field)
      field = ''
      i += 1
      continue
    }
    if (ch === '\r') {
      // Treat CRLF as one line terminator.
      if (text[i + 1] === '\n') i += 1
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i += 1
      continue
    }
    if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i += 1
      continue
    }

    field += ch
    i += 1
  }

  // Flush the final field/row if file doesn't end with a newline.
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows
}
