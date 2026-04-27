/**
 * How to wire your custom adapter into a snapfeed feedback handler.
 *
 * The handler runs server-side (Next.js API route, Express middleware,
 * Cloudflare Worker, etc.). Your adapter is just one element in the
 * `adapters` array — alongside any built-in adapters you also want.
 *
 * This file is type-checked but not bundled — copy the relevant snippet
 * into your real handler file.
 */

import { createFeedbackHandler } from 'snapfeed/server/nextjs'
import { slackAdapter } from 'snapfeed/adapters'
import { mattermostAdapter } from './mattermost-adapter'

// Required env vars (validated at startup).
const MATTERMOST_WEBHOOK = process.env.MATTERMOST_WEBHOOK
const SLACK_WEBHOOK = process.env.SLACK_WEBHOOK

if (!MATTERMOST_WEBHOOK) {
  throw new Error('Set MATTERMOST_WEBHOOK before starting the handler')
}

// Compose the adapters list. The handler runs every adapter in parallel
// and returns success when ANY of them succeeds — so adding your custom
// adapter alongside built-ins gives you a graceful fallback for free.
const adapters = [
  mattermostAdapter({
    webhookUrl: MATTERMOST_WEBHOOK,
    channel: 'feedback',
    username: 'snapfeed',
  }),
  // Optional: also send to Slack for a public mirror.
  ...(SLACK_WEBHOOK ? [slackAdapter({ webhookUrl: SLACK_WEBHOOK })] : []),
]

export const POST = createFeedbackHandler({
  adapters,
  rateLimit: { max: 10, windowMs: 60_000 },
  // For production, restrict to your real origins:
  // allowedOrigins: ['https://staging.example.com', /\.example\.com$/],
})
