/**
 * snapfeed example — feedback API route.
 *
 * Uses autoAdapters() to read SNAPFEED_* env vars (set in .env.local).
 * If none are set, falls back to consoleAdapter() so the example still
 * "works" out of the box: submissions print to the dev server stdout.
 */

import { createFeedbackHandler } from 'snapfeed/server/nextjs'
import { autoAdapters, consoleAdapter } from 'snapfeed/adapters'

const detected = autoAdapters()

// autoAdapters() returns a 2-element [console, file] fallback when no
// SNAPFEED_* env vars are set, so a length===0 check is enough — there's
// no separate "only console" sentinel branch to handle.
if (detected.length === 0) {
  console.warn(
    '[snapfeed-example] No SNAPFEED_* env vars detected — falling back to consoleAdapter(). ' +
      'Set one in .env.local (see .env.example) to wire a real destination.'
  )
}

export const POST = createFeedbackHandler({
  adapters: detected.length > 0 ? detected : [consoleAdapter()],
  // Lock to the deployed origin in production; leave undefined in dev so
  // localhost:3000 ↔ 127.0.0.1:3000 etc. don't trip the allowlist.
  allowedOrigins:
    process.env.NODE_ENV === 'production' && process.env.NEXT_PUBLIC_SITE_ORIGIN
      ? [process.env.NEXT_PUBLIC_SITE_ORIGIN]
      : undefined,
  onComplete(payload, results) {
    console.log(
      '[snapfeed-example] received feedback from',
      payload.appName,
      '-',
      payload.pageName,
      '· results:',
      results.map(r => (r.ok ? 'ok' : `fail(${r.error})`)).join(', ')
    )
  },
})
