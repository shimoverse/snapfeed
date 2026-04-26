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

// We use a minimal type instead of importing from 'next/server' to avoid a hard dependency.
type NextRequest = {
  json(): Promise<unknown>
  headers: { get(name: string): string | null }
  ip?: string
}

type NextResponse = {
  json(body: unknown, init?: { status?: number; headers?: Record<string, string> }): NextResponse
}

/**
 * Creates a Next.js App Router POST handler that runs your adapters
 * with built-in rate limiting, payload validation, and origin checking.
 */
export function createFeedbackHandler(config: FeedbackHandlerConfig) {
  return async function POST(req: NextRequest): Promise<NextResponse> {
    // Dynamic import to keep next/server as a soft peer dep
    const { NextResponse: NR } = await import('next/server' as string) as {
      NextResponse: {
        json(
          body: unknown,
          init?: { status?: number; headers?: Record<string, string> }
        ): NextResponse
      }
    }

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
    // proxy), not the first (attacker-controlled). When `req.ip` is set by
    // the platform (Vercel, etc.) it's the most trustworthy source.
    const xff = req.headers.get('x-forwarded-for')
    const lastHop = xff ? xff.split(',').pop()?.trim() : undefined
    const ip = req.ip ?? lastHop ?? req.headers.get('x-real-ip') ?? 'unknown'

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
