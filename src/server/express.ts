/**
 * snapfeed — Express middleware
 *
 * Drop-in POST handler for Express and Express-compatible frameworks.
 *
 * Includes built-in:
 * - Rate limiting (in-memory by default, pluggable store for Redis/Upstash)
 * - Payload size validation (text + screenshot)
 * - Origin allowlist enforcement
 * - Console error sanitization (strips tokens/secrets/JWTs)
 *
 * @example
 * import express from 'express'
 * import { feedbackMiddleware } from 'snapfeed/server/express'
 * import { supabaseAdapter, telegramAdapter } from 'snapfeed/adapters'
 *
 * const app = express()
 * app.use(express.json({ limit: '10mb' }))
 *
 * app.post('/api/feedback', feedbackMiddleware({
 *   adapters: [
 *     supabaseAdapter({ url: process.env.SUPABASE_URL!, serviceKey: process.env.SUPABASE_SERVICE_KEY! }),
 *     telegramAdapter({ botToken: process.env.TELEGRAM_BOT_TOKEN!, chatId: process.env.TELEGRAM_CHAT_ID! }),
 *   ],
 *   rateLimit: { max: 10, windowMs: 60_000 },       // 10 requests/min per IP
 *   maxScreenshotBytes: 5 * 1024 * 1024,            // 5MB screenshot cap
 *   allowedOrigins: ['https://myapp.com'],           // optional origin allowlist
 * }))
 */

import type { FeedbackHandlerConfig, FeedbackAdapterResult } from '../types'
import {
  checkRateLimit,
  validatePayload,
  checkOrigin,
  normalizePayload,
} from './security'

// Minimal typings — avoid a hard express dependency
type Request = {
  body: unknown
  ip?: string
  headers: Record<string, string | string[] | undefined>
}

type Response = {
  status(code: number): Response
  json(body: unknown): void
  set(header: string, value: string): Response
}

type NextFn = (err?: unknown) => void

type ExpressMiddleware = (req: Request, res: Response, next: NextFn) => void | Promise<void>

/**
 * Creates an Express middleware that runs your adapters on POST,
 * with built-in rate limiting, payload validation, and origin checking.
 */
export function feedbackMiddleware(config: FeedbackHandlerConfig): ExpressMiddleware {
  // One-time production warning when the origin allowlist is effectively
  // disabled. Emitted at middleware-construction time, not per-request.
  warnIfOriginsOpenInProd(config)

  return async function handler(req: Request, res: Response, next: NextFn) {
    // Surface a clear diagnostic when the consumer forgot to wire
    // `express.json()` upstream — without it `req.body` is `undefined`
    // and validation rejects with a confusing "Invalid request body".
    if (req.body === undefined) {
      res.status(500).json({
        error:
          'feedbackMiddleware requires express.json() middleware upstream',
      })
      return
    }
    // v0.7: Per-submission correlation ID. Stamped on the `feedback.received`
    // event AND every `adapter.dispatched` event for this request, so the
    // GDPR `deleteByUserId` helper can correlate uploads back to the
    // user who submitted them.
    const feedbackId = generateFeedbackId()

    // Audit log helper. Failures are caught and logged via `console.error` —
    // audit logging never breaks the request flow.
    const recordAudit = async (event: { type: string; [key: string]: unknown }) => {
      if (!config.auditLog) return
      try {
        await config.auditLog.record({ ts: new Date().toISOString(), ...event })
      } catch (e) {
        console.error('[snapfeed] audit log failure:', e)
      }
    }

    // Pull client IP — prefer the LAST hop in `x-forwarded-for` (the trusted
    // proxy), not the first (attacker-controlled).
    const forwardedFor = req.headers['x-forwarded-for']
    const xff = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor
    const lastHop = xff ? xff.split(',').pop()?.trim() : undefined
    const realIpHeader = req.headers['x-real-ip']
    const realIp = Array.isArray(realIpHeader) ? realIpHeader[0] : realIpHeader
    const ip = req.ip ?? lastHop ?? realIp ?? 'unknown'

    try {
      // ── Origin check ────────────────────────────────────────────────────────
      const origin = Array.isArray(req.headers['origin'])
        ? req.headers['origin'][0]
        : req.headers['origin'] ?? null

      if (!checkOrigin(origin, config.allowedOrigins)) {
        res.status(403).json({ error: 'Origin not allowed' })
        return
      }

      // ── Rate limiting ──────────────────────────────────────────────────────
      if (config.rateLimit) {
        const { allowed, remaining, resetAt } = await checkRateLimit(ip, config)
        void remaining

        if (!allowed) {
          await recordAudit({ type: 'rate_limit.hit', ip, key: ip })
          res
            .status(429)
            .set('Retry-After', String(Math.ceil((resetAt - Date.now()) / 1000)))
            .set('X-RateLimit-Remaining', '0')
            .json({ error: 'Too many feedback submissions. Please wait a moment.' })
          return
        }
      }

      // ── Validate payload ───────────────────────────────────────────────────
      const validation = validatePayload(req.body, config)
      if (!validation.valid) {
        res.status(400).json({ error: validation.error })
        return
      }

      const normalized = normalizePayload(req.body)

      await recordAudit({
        type: 'feedback.received',
        ip,
        payloadSize: JSON.stringify(normalized).length,
        pageUrl: normalized.pageUrl,
        reporter: normalized.user?.email ?? normalized.user?.name,
        category: normalized.category,
        feedbackId,
      })

      // ── Optional pre-receive hook ──────────────────────────────────────────
      if (config.onReceive) {
        const allowed = await config.onReceive(normalized)
        if (!allowed) {
          res.status(403).json({ error: 'Feedback rejected' })
          return
        }
      }

      // ── Run all adapters ───────────────────────────────────────────────────
      const adapterStarts = config.adapters.map(() => Date.now())
      const results = await Promise.allSettled(
        config.adapters.map(adapter => adapter.send(normalized))
      )

      const adapterResults: FeedbackAdapterResult[] = results.map((r) =>
        r.status === 'fulfilled' ? r.value : { ok: false, error: String(r.reason) }
      )

      await Promise.all(
        config.adapters.map((adapter, i) =>
          recordAudit({
            type: 'adapter.dispatched',
            adapter: adapter.name,
            ok: adapterResults[i]?.ok ?? false,
            durationMs: Date.now() - (adapterStarts[i] ?? Date.now()),
            deliveryId: adapterResults[i]?.deliveryId,
            error: adapterResults[i]?.error,
            warningsCount: adapterResults[i]?.warnings?.length ?? 0,
            feedbackId,
          })
        )
      )

      const anyOk = adapterResults.some(r => r.ok)

      if (!anyOk) {
        console.error('[snapfeed] All adapters failed:', adapterResults)
        res.status(503).json({ error: 'Could not deliver feedback. Please try again.' })
        return
      }

      // ── Optional post-complete hook ────────────────────────────────────────
      if (config.onComplete) {
        await config.onComplete(normalized, adapterResults)
      }

      res.status(200).json({
        success: true,
        results: adapterResults.map(r => ({ ok: r.ok, error: r.error })),
      })
    } catch (err) {
      next(err)
    }
  }
}

/**
 * Emit a one-time `console.warn` if the middleware is constructed in
 * production with no `allowedOrigins` allowlist. An empty allowlist is
 * treated as allow-all (see `checkOrigin` in `./security`) — useful in
 * development but dangerous as a production default.
 */
function warnIfOriginsOpenInProd(config: FeedbackHandlerConfig): void {
  if (typeof process === 'undefined') return
  if (process.env?.NODE_ENV !== 'production') return
  if (config.allowedOrigins && config.allowedOrigins.length > 0) return
  console.warn(
    '[snapfeed] allowedOrigins is empty in production — origin allowlist is ' +
      'effectively disabled (allow-all). Set allowedOrigins to lock down ' +
      'accepted browser origins.'
  )
}

/**
 * Generate a feedback correlation ID. Same shape and rationale as the
 * Next.js handler — see src/server/nextjs.ts for the full doc. Used to
 * correlate `feedback.received` with its `adapter.dispatched` events for
 * the GDPR `deleteByUserId` flow.
 *
 * @internal
 */
function generateFeedbackId(): string {
  const cryptoObj = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (cryptoObj?.randomUUID) return `fbk_${cryptoObj.randomUUID()}`
  return `fbk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}
