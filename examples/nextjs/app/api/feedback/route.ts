/**
 * Example Next.js App Router feedback API route.
 *
 * Copy this file to your app's /app/api/feedback/route.ts
 * and replace the env var placeholders.
 */

import { createFeedbackHandler } from 'snapfeed/server/nextjs'
import { supabaseAdapter, telegramAdapter, consoleAdapter } from 'snapfeed/adapters'

export const POST = createFeedbackHandler({
  adapters: [
    // Persist to Supabase (use service role key on the server)
    supabaseAdapter({
      url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
      table: 'feedback',
    }),

    // Notify via Telegram
    telegramAdapter({
      botToken: process.env.TELEGRAM_BOT_TOKEN!,
      chatId: process.env.TELEGRAM_CHAT_ID!,
    }),

    // Also log to console in development
    ...(process.env.NODE_ENV === 'development' ? [consoleAdapter()] : []),
  ],

  // Optional: log all results
  onComplete(payload, results) {
    console.log('[feedback] received:', payload.appName, '-', payload.pageName)
    console.log('[feedback] adapter results:', results.map(r => `${r.ok ? '✓' : '✗'}`).join(' '))
  },
})
