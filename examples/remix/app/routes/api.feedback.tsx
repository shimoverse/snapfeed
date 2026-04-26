import { json, type ActionFunctionArgs } from '@remix-run/node'
import {
  autoAdapters,
  consoleAdapter,
  type FeedbackAdapter,
  type FeedbackPayload,
} from 'snapfeed'

/**
 * Remix resource route — POST /api/feedback.
 *
 * No UI; just an action. We deliberately don't use the Express
 * middleware (Remix's request shape is the standard fetch Request, not
 * Express's req/res) — instead we call autoAdapters() directly and run
 * them with Promise.allSettled. For production deployments you'll want
 * to add origin checks, rate limiting, and payload validation.
 */

let cachedAdapters: FeedbackAdapter[] | null = null

function getAdapters(): FeedbackAdapter[] {
  if (cachedAdapters) return cachedAdapters

  const detected = autoAdapters()
  if (detected.length === 0) {
    console.warn(
      '[snapfeed-example] No SNAPFEED_* env vars detected — falling back to consoleAdapter(). ' +
        'Set one in .env (see .env.example) to wire a real destination.',
    )
    cachedAdapters = [consoleAdapter()]
  } else {
    console.log(
      '[snapfeed-example] adapters detected:',
      detected.map(a => a.name).join(', '),
    )
    cachedAdapters = detected
  }
  return cachedAdapters
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Minimal payload shape check. For production, layer in size limits
  // and an origin allowlist.
  if (
    !body ||
    typeof body !== 'object' ||
    typeof (body as FeedbackPayload).text !== 'string' ||
    !(body as FeedbackPayload).text.trim()
  ) {
    return json({ error: 'Missing or empty `text` field' }, { status: 400 })
  }

  const payload = body as FeedbackPayload

  const adapters = getAdapters()
  const settled = await Promise.allSettled(
    adapters.map(a => a.send(payload)),
  )

  const results = settled.map((r, i) =>
    r.status === 'fulfilled'
      ? r.value
      : { ok: false, error: String(r.reason), name: adapters[i]?.name },
  )

  const anyOk = results.some(r => r.ok)

  console.log(
    '[snapfeed-example] received feedback from',
    payload.appName,
    '-',
    payload.pageName,
    '· results:',
    results.map(r => (r.ok ? 'ok' : `fail(${r.error})`)).join(', '),
  )

  if (!anyOk) {
    return json(
      { error: 'Could not deliver feedback. Please try again.' },
      { status: 503 },
    )
  }

  return json({
    success: true,
    results: results.map(r => ({ ok: r.ok, error: r.error })),
  })
}

/** Loaders block GET requests with a clear message. */
export function loader() {
  return json(
    { error: 'POST only — this is the snapfeed feedback endpoint.' },
    { status: 405 },
  )
}
