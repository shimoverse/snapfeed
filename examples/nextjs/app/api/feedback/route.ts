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

if (detected.length === 0 || (detected.length === 1 && detected[0]?.name === 'console')) {
  console.warn(
    '[snapfeed-example] No SNAPFEED_* env vars detected — falling back to consoleAdapter(). ' +
      'Set one in .env.local (see .env.example) to wire a real destination.'
  )
}

export const POST = createFeedbackHandler({
  adapters: detected.length > 0 ? detected : [consoleAdapter()],
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
