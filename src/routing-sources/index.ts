/**
 * snapfeed — Tier 2 Routing Sources, public surface.
 *
 * Tier 1 (`snapfeed/routing`) is a static config you import. Tier 2 fetches
 * the same shape from a remote source (CSV file, Google Sheet, etc.) so
 * non-engineers can edit routing without a deploy. Wrap any source with
 * `cacheRoutingSource` to get polling + last-known-good fallback.
 */

export type {
  RoutingSource,
  CachedRoutingSource,
  CachedRoutingSourceOptions,
} from './types'
export { cacheRoutingSource } from './types'
export { csvRoutingSource } from './csv'
export { googleSheetsRoutingSource } from './googleSheets'
