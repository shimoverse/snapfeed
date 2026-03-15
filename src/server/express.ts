/**
 * snapfeed — Express middleware
 *
 * Drop-in POST handler for Express and Express-compatible frameworks.
 *
 * @example
 * import express from 'express'
 * import { feedbackMiddleware } from 'snapfeed/server/express'
 * import { supabaseAdapter, telegramAdapter } from 'snapfeed/adapters'
 *
 * const app = express()
 * app.use(express.json())
 *
 * app.post('/api/feedback', feedbackMiddleware({
 *   adapters: [
 *     supabaseAdapter({ url: process.env.SUPABASE_URL!, serviceKey: process.env.SUPABASE_SERVICE_KEY! }),
 *     telegramAdapter({ botToken: process.env.TELEGRAM_BOT_TOKEN!, chatId: process.env.TELEGRAM_CHAT_ID! }),
 *   ],
 * }))
 */

import type { FeedbackHandlerConfig, FeedbackPayload } from '../types'

// Minimal typings — avoid a hard express dependency
type Request = {
  body: unknown
}

type Response = {
  status(code: number): Response
  json(body: unknown): void
}

type NextFn = (err?: unknown) => void

type ExpressMiddleware = (req: Request, res: Response, next: NextFn) => void | Promise<void>

/**
 * Creates an Express middleware that runs your adapters on POST.
 */
export function feedbackMiddleware(config: FeedbackHandlerConfig): ExpressMiddleware {
  return async function handler(req: Request, res: Response, next: NextFn) {
    try {
      const body = req.body as Partial<FeedbackPayload>

      if (!body?.text?.trim()) {
        res.status(400).json({ error: 'Feedback text is required' })
        return
      }

      const normalized: FeedbackPayload = {
        text: body.text.trim(),
        appName: body.appName ?? 'App',
        pageUrl: body.pageUrl ?? '',
        pageName: body.pageName ?? '',
        timestamp: body.timestamp ?? new Date().toISOString(),
        user: body.user,
        metadata: body.metadata,
        screenshot: body.screenshot,
      }

      // Optional pre-receive hook
      if (config.onReceive) {
        const allowed = await config.onReceive(normalized)
        if (!allowed) {
          res.status(403).json({ error: 'Feedback rejected' })
          return
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

      if (!anyOk) {
        console.error('[devtools/feedback] All adapters failed:', adapterResults)
        res.status(503).json({ error: 'Could not deliver feedback. Please try again.' })
        return
      }

      // Optional post-complete hook
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
