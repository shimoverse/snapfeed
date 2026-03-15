/**
 * snapfeed — Next.js App Router server helper
 *
 * Drop-in POST handler for Next.js App Router API routes.
 * Runs all adapters server-side (safe for service-role keys, tokens, etc.)
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
 * })
 */

import type { FeedbackHandlerConfig, FeedbackPayload } from '../types'

// We use a minimal type instead of importing from 'next/server' to avoid a hard dependency.
type NextRequest = {
  json(): Promise<unknown>
}

type NextResponse = {
  json(body: unknown, init?: { status?: number }): NextResponse
}

/**
 * Creates a Next.js App Router POST handler that runs your adapters.
 */
export function createFeedbackHandler(config: FeedbackHandlerConfig) {
  return async function POST(req: NextRequest): Promise<NextResponse> {
    // Dynamic import to keep next/server as a soft peer dep
    const { NextResponse: NR } = await import('next/server' as string) as {
      NextResponse: { json(body: unknown, init?: { status?: number }): NextResponse }
    }

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NR.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const payload = body as Partial<FeedbackPayload>

    if (!payload.text?.trim()) {
      return NR.json({ error: 'Feedback text is required' }, { status: 400 })
    }

    const normalized: FeedbackPayload = {
      text: payload.text.trim(),
      appName: payload.appName ?? 'App',
      pageUrl: payload.pageUrl ?? '',
      pageName: payload.pageName ?? '',
      timestamp: payload.timestamp ?? new Date().toISOString(),
      user: payload.user,
      metadata: payload.metadata,
      screenshot: payload.screenshot,
    }

    // Optional pre-receive hook
    if (config.onReceive) {
      const allowed = await config.onReceive(normalized)
      if (!allowed) {
        return NR.json({ error: 'Feedback rejected' }, { status: 403 })
      }
    }

    // Run all adapters
    const results = await Promise.allSettled(
      config.adapters.map(adapter => adapter.send(normalized))
    )

    const adapterResults = results.map((r, i) =>
      r.status === 'fulfilled'
        ? r.value
        : { ok: false, error: String(r.reason), name: config.adapters[i]?.name }
    )

    const anyOk = adapterResults.some(r => r.ok)
    const allFailed = !anyOk

    if (allFailed) {
      console.error('[devtools/feedback] All adapters failed:', adapterResults)
      return NR.json(
        { error: 'Could not deliver feedback. Please try again.' },
        { status: 503 }
      )
    }

    // Optional post-complete hook
    if (config.onComplete) {
      await config.onComplete(normalized, adapterResults)
    }

    return NR.json({
      success: true,
      results: adapterResults.map(r => ({ ok: r.ok, error: r.error })),
    })
  }
}
