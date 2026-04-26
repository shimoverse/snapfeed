/**
 * snapfeed example — Vite + React backend.
 *
 * A tiny Express server that hosts the snapfeed feedback handler at
 * POST /api/feedback. Vite's dev server proxies /api/feedback here
 * (see vite.config.ts). In production, deploy this alongside your
 * own backend — or fold the middleware into an existing Express app.
 */

import 'dotenv/config'
import express from 'express'
import { feedbackMiddleware } from 'snapfeed/server/express'
import { autoAdapters, consoleAdapter } from 'snapfeed/adapters'

const PORT = Number(process.env.PORT ?? 8788)

const detected = autoAdapters()
const adapters =
  detected.length > 0 ? detected : [consoleAdapter()]

// autoAdapters() never returns undefined; the fallback path is purely the
// `length > 0` branch above. We log either side so operators can see what
// they wired up at boot.
if (detected.length === 0) {
  console.warn(
    '[snapfeed-example] No SNAPFEED_* env vars detected — falling back to consoleAdapter(). ' +
      'Set one in .env (see .env.example) to wire a real destination.',
  )
} else {
  console.log(
    '[snapfeed-example] adapters detected:',
    detected.map(a => a.name).join(', '),
  )
}

const app = express()

app.use(express.json({ limit: '11mb' }))

app.get('/healthz', (_req, res) => {
  res.json({ ok: true })
})

app.post(
  '/api/feedback',
  feedbackMiddleware({
    adapters,
    rateLimit: { max: 30, windowMs: 60_000 },
    // In production, restrict to the deployed origin. In dev the Vite
    // proxy forwards from 5173, so leaving this undefined is fine.
    allowedOrigins:
      process.env.NODE_ENV === 'production' && process.env.SITE_ORIGIN
        ? [process.env.SITE_ORIGIN]
        : undefined,
    onComplete(payload, results) {
      console.log(
        '[snapfeed-example] received feedback from',
        payload.appName,
        '-',
        payload.pageName,
        '· results:',
        results.map(r => (r.ok ? 'ok' : `fail(${r.error})`)).join(', '),
      )
    },
  }),
)

app.listen(PORT, () => {
  console.log(`[snapfeed-example] backend listening on http://localhost:${PORT}`)
})
