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

import type { FeedbackHandlerConfig } from '../types'
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

    // ── Origin check ──────────────────────────────────────────────────────────
    const origin = req.headers.get('origin')
    if (!checkOrigin(origin, config.allowedOrigins)) {
      return NR.json({ error: 'Origin not allowed' }, { status: 403 })
    }

    // ── Rate limiting ─────────────────────────────────────────────────────────
    if (config.rateLimit) {
      const ip =
        req.ip ??
        req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
        req.headers.get('x-real-ip') ??
        'unknown'

      const { allowed, remaining, resetAt } = await checkRateLimit(ip, config)

      if (!allowed) {
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

    // ── Optional pre-receive hook ─────────────────────────────────────────────
    if (config.onReceive) {
      const allowed = await config.onReceive(normalized)
      if (!allowed) {
        return NR.json({ error: 'Feedback rejected' }, { status: 403 })
      }
    }

    // ── Run all adapters ──────────────────────────────────────────────────────
    const results = await Promise.allSettled(
      config.adapters.map(adapter => adapter.send(normalized))
    )

    const adapterResults = results.map((r, i) =>
      r.status === 'fulfilled'
        ? r.value
        : { ok: false, error: String(r.reason), name: config.adapters[i]?.name }
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
