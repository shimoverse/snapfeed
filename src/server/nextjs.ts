/**
 * snapfeed — Next.js App Router server helper
 *
 * Drop-in POST handler for Next.js App Router API routes.
 * Runs all adapters server-side (safe for service-role keys, tokens, etc.)
 *
 * Includes built-in:
 * - Rate limiting (in-memory by default, pluggable store for Redis/Upstash)
 * - Payload size validation (text + screenshot)
 * - Origin allowlist enforcement
 * - Console error sanitization (strips tokens/secrets/JWTs)
 *
 * @example
 * // app/api/feedback/route.ts
 * import { createFeedbackHandler } from 'snapfeed/server/nextjs'
 * import { supabaseAdapter, telegramAdapter } from 'snapfeed/adapters'
 *
 * export const POST = createFeedbackHandler({
 *   adapters: [
 *     supabaseAdapter({ url: process.env.SUPABASE_URL!, serviceKey: process.env.SUPABASE_SERVICE_KEY! }),
 *     telegramAdapter({ botToken: process.env.TELEGRAM_BOT_TOKEN!, chatId: process.env.TELEGRAM_CHAT_ID! }),
 *   ],
 *   rateLimit: { max: 10, windowMs: 60000 },         // 10 requests/min per IP
 *   maxScreenshotBytes: 5 * 1024 * 1024,            // 5MB screenshot cap
 *   allowedOrigins: ['https://myapp.com'],           // optional origin allowlist
 * })
 */

import type { FeedbackHandlerConfig, FeedbackAdapterResult } from '../types'
import {
  checkRateLimit,
  validatePayload,
  checkOrigin,
  normalizePayload,
} from './security'

// We deliberately type the handler input as the standard web `Request` and
// the output as the standard web `Response`. Next 14's App Router route
// validator accepts `Request | NextRequest` for the input and
// `Response | Promise<Response>` for the return — so widening to the standard
// types keeps consumers' `next build` green without forcing a hard dependency
// on `next/server`. At runtime, Next's `NextResponse` extends `Response`, so
// the actual returned object satisfies both shapes.
//
// Vercel still injects `req.ip` at runtime; we read it via a small cast.
type NextServerModule = {
  NextResponse: {
    json(
      body: unknown,
      init?: { status?: number; headers?: Record<string, string> }
    ): Response
  }
}

// Module-scoped cache for the dynamically imported `next/server` module.
// Without this, every request paid for a fresh `await import(...)` round-trip
// and the resolution-cache lookup it implies. Cached as the resolved promise
// so concurrent first-requests share the same in-flight import.
let nextServerPromise: Promise<NextServerModule> | undefined

async function loadNextServer(): Promise<NextServerModule> {
  if (nextServerPromise) return nextServerPromise
  nextServerPromise = (async () => {
    try {
      return (await import('next/server' as string)) as NextServerModule
    } catch (err) {
      // Reset so a future request can retry (useful in tests / hot reload).
      nextServerPromise = undefined
      throw new Error(
        'createFeedbackHandler requires Next.js. Install next or use ' +
          'feedbackMiddleware from snapfeed/server/express. ' +
          `(underlying error: ${err instanceof Error ? err.message : String(err)})`
      )
    }
  })()
  return nextServerPromise
}

/**
 * Creates a Next.js App Router POST handler that runs your adapters
 * with built-in rate limiting, payload validation, and origin checking.
 */
export function createFeedbackHandler(config: FeedbackHandlerConfig) {
  // One-time production warning when the origin allowlist is effectively
  // disabled. Emitted at handler-construction time, not per-request.
  warnIfOriginsOpenInProd(config)

  return async function POST(req: Request): Promise<Response> {
    const { NextResponse: NR } = await loadNextServer()

    // v0.7: Per-submission correlation ID. Stamped on the `feedback.received`
    // event AND every `adapter.dispatched` event for this request, so the
    // GDPR `deleteByUserId` helper can correlate uploads back to the
    // user who submitted them. crypto.randomUUID is available in Node 18+,
    // edge runtimes, and modern browsers — no polyfill needed.
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
    // proxy), not the first (attacker-controlled). On Vercel and similar
    // platforms, `NextRequest` adds an `ip` field; we read it via a structural
    // cast so we don't depend on the `next/server` types at compile time.
    const xff = req.headers.get('x-forwarded-for')
    const lastHop = xff ? xff.split(',').pop()?.trim() : undefined
    const platformIp = (req as unknown as { ip?: string }).ip
    const ip = platformIp ?? lastHop ?? req.headers.get('x-real-ip') ?? 'unknown'

    // ── Origin check ──────────────────────────────────────────────────────────
    const origin = req.headers.get('origin')
    if (!checkOrigin(origin, config.allowedOrigins)) {
      return NR.json({ error: 'Origin not allowed' }, { status: 403 })
    }

    // ── Rate limiting ─────────────────────────────────────────────────────────
    if (config.rateLimit) {
      const { allowed, remaining, resetAt } = await checkRateLimit(ip, config)

      if (!allowed) {
        await recordAudit({ type: 'rate_limit.hit', ip, key: ip })
        return NR.json(
          { error: 'Too many feedback submissions. Please wait a moment.' },
          {
            status: 429,
            headers: {
              'Retry-After': String(Math.ceil((resetAt - Date.now()) / 1000)),
              'X-RateLimit-Remaining': '0',
            },
          }
        )
      }

      // Attach remaining count to response later if needed
      void remaining
    }

    // ── Parse body ────────────────────────────────────────────────────────────
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NR.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    // ── Validate payload ──────────────────────────────────────────────────────
    const validation = validatePayload(body, config)
    if (!validation.valid) {
      return NR.json({ error: validation.error }, { status: 400 })
    }

    const normalized = normalizePayload(body)

    await recordAudit({
      type: 'feedback.received',
      ip,
      payloadSize: JSON.stringify(normalized).length,
      pageUrl: normalized.pageUrl,
      reporter: normalized.user?.email ?? normalized.user?.name,
      category: normalized.category,
      feedbackId,
    })

    // ── Optional pre-receive hook ─────────────────────────────────────────────
    if (config.onReceive) {
      const allowed = await config.onReceive(normalized)
      if (!allowed) {
        return NR.json({ error: 'Feedback rejected' }, { status: 403 })
      }
    }

    // ── Run all adapters ──────────────────────────────────────────────────────
    const adapterStarts = config.adapters.map(() => Date.now())
    const results = await Promise.allSettled(
      config.adapters.map(adapter => adapter.send(normalized))
    )

    const adapterResults: FeedbackAdapterResult[] = results.map((r) =>
      r.status === 'fulfilled' ? r.value : { ok: false, error: String(r.reason) }
    )

    // Emit one adapter.dispatched event per adapter, in parallel, fail-safe.
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
      return NR.json(
        { error: 'Could not deliver feedback. Please try again.' },
        { status: 503 }
      )
    }

    // ── Optional post-complete hook ───────────────────────────────────────────
    if (config.onComplete) {
      await config.onComplete(normalized, adapterResults)
    }

    return NR.json({
      success: true,
      results: adapterResults.map(r => ({ ok: r.ok, error: r.error })),
    })
  }
}

/**
 * Emit a one-time `console.warn` if the handler is constructed in production
 * with no `allowedOrigins` allowlist. An empty allowlist is treated as
 * allow-all (see `checkOrigin` in `./security`) — useful in development but
 * dangerous as a production default.
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
 * Generate a feedback correlation ID. Prefers `crypto.randomUUID` (Node 18+,
 * edge runtimes, modern browsers); falls back to a Math.random-based ID for
 * the rare runtime that lacks it. Used to correlate `feedback.received`
 * with its `adapter.dispatched` events for the GDPR `deleteByUserId` flow.
 *
 * @internal
 */
function generateFeedbackId(): string {
  const cryptoObj = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (cryptoObj?.randomUUID) return `fbk_${cryptoObj.randomUUID()}`
  return `fbk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

/** Test-only: reset the cached `next/server` import. */
export function __resetNextServerCacheForTesting(): void {
  nextServerPromise = undefined
}
