# Startup quickstart — Slack + Linear with routing in 30 minutes

**Persona:** Founder, PM, or early-stage engineer at a 5–50 person startup. Stack: Next.js, Slack, Linear, GitHub.
**Goal:** Every piece of feedback fans out to Slack for awareness AND auto-creates a Linear issue. Routing rules send checkout-area feedback to the payments person and dashboard feedback to the platform person, so nothing sits in a generic queue.
**Time budget:** 30 minutes (most of it is creating the Linear API key and finding your team ID).
**snapfeed version:** v0.4.0

---

## 1. Install snapfeed and scaffold

In your existing Next.js app:

```bash
npm install snapfeed
npx snapfeed init --yes
```

This creates `snapfeed.config.ts`, `.env.example`, and `app/api/feedback/route.ts`. We'll edit all three.

## 2. Get a Slack incoming webhook

Same as the indie guide: https://api.slack.com/messaging/webhooks. You'll want webhooks (or a single multi-channel app) for at least these channels:

- `#checkout-feedback`
- `#platform-feedback`
- `#bugs` (catch-all)

If your Slack plan only allows one webhook per app, the simplest path is a single workspace-default webhook and use the `channel` override per-route. The snapfeed Slack adapter supports a `channel` field — see the routing handler in step 6.

## 3. Get a Linear API key and find your team key

1. In Linear, click your avatar (bottom-left) → **Settings** → **API** → **Personal API keys** → **Create key**. Give it a label like "snapfeed".
2. Copy the key — it starts with `lin_api_`.
3. Find your **team ID**, not the human-readable team key like `CHK`. The Linear adapter takes a UUID-style team ID (the GraphQL `Team.id`). The easiest way to grab it:
   - Open Linear in the browser, go to your team's settings.
   - The URL contains the team key (e.g. `/team/CHK/`), but the API needs the UUID.
   - Run this in your terminal once you have the API key:

```bash
curl -s https://api.linear.app/graphql \
  -H "Authorization: $SNAPFEED_LINEAR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"{ teams { nodes { id key name } } }"}'
```

Pick the `id` whose `key` matches your team. That UUID is what you pass as `teamId`.

Linear's docs on personal keys: https://linear.app/developers/graphql#authentication

## 4. Set both env vars

Edit `.env.local` (create it if needed):

```bash
SNAPFEED_SLACK_WEBHOOK=https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXX
SNAPFEED_LINEAR_TOKEN=lin_api_xxxxxxxxxxxxxxxxxxxx
SNAPFEED_LINEAR_TEAM_PAYMENTS=team_uuid_for_payments
SNAPFEED_LINEAR_TEAM_PLATFORM=team_uuid_for_platform
```

Note: `autoAdapters()` only knows the keys listed in `src/adapters/auto.ts` (Slack, Discord, GitHub, Telegram, webhook, file). It does **not** auto-wire Linear today. We'll wire Linear explicitly in the route handler in step 6.

## 5. Create the routing config

Replace the contents of `snapfeed.config.ts` (created by `init`) with your route table:

```ts
// snapfeed.config.ts
import { defineRouting } from 'snapfeed/routing'

export default defineRouting({
  routes: [
    {
      match: '/checkout/**',
      to: { team: 'payments', slack: '#checkout-feedback', linear: 'CHK' },
    },
    {
      match: '/dashboard/**',
      to: { team: 'platform', slack: '#platform-feedback' },
    },
  ],
  default: { team: 'platform', slack: '#bugs' },
})
```

Glob primer (from `src/routing.ts`):
- `*` matches a single path segment (no `/`)
- `**` matches any depth (zero or more segments)
- Pattern is anchored to the full pathname; query and origin are stripped before matching

So `/checkout/**` matches `/checkout`, `/checkout/cart`, and `/checkout/cart/items`. `/checkout/*` would match `/checkout/cart` but NOT `/checkout/cart/items`.

## 6. Wire the API route

`autoAdapters()` handles Slack, but Linear needs explicit wiring (and we want per-route channel + team selection). Replace `app/api/feedback/route.ts` with:

```ts
// app/api/feedback/route.ts
import { createFeedbackHandler } from 'snapfeed/server/nextjs'
import { slackAdapter, linearAdapter } from 'snapfeed/adapters'
import { resolveRoute } from 'snapfeed/routing'
import routing from '../../../snapfeed.config'

const TEAM_IDS: Record<string, string> = {
  payments: process.env.SNAPFEED_LINEAR_TEAM_PAYMENTS!,
  platform: process.env.SNAPFEED_LINEAR_TEAM_PLATFORM!,
}

export const POST = createFeedbackHandler({
  // Single Slack webhook is enough — the channel override per-message
  // selects where each piece of feedback lands.
  adapters: [
    {
      name: 'slack-routed',
      async send(payload) {
        const dest = resolveRoute(payload, routing)
        return slackAdapter({
          webhookUrl: process.env.SNAPFEED_SLACK_WEBHOOK!,
          channel: dest.slack,
        }).send(payload)
      },
    },
    {
      name: 'linear-routed',
      async send(payload) {
        const dest = resolveRoute(payload, routing)
        const teamId = dest.team ? TEAM_IDS[dest.team] : undefined
        if (!teamId) return { ok: true, error: 'no team mapped, skipped' }
        return linearAdapter({
          apiKey: process.env.SNAPFEED_LINEAR_TOKEN!,
          teamId,
        }).send(payload)
      },
    },
  ],
})
```

Two things worth knowing:

- `resolveRoute()` returns the first matching rule's `to` block, or `default` if nothing matches. It does NOT merge with the default — see `mergeDestinations()` in `snapfeed/routing` if you want overlay behavior.
- The `linear: 'CHK'` field in the route table is a human-readable hint for your team. The adapter still needs the UUID — that's why `TEAM_IDS` maps the `team` name (`payments`, `platform`) to the UUID env var.

## 7. Wrap your app and pass reporter identity

Create `app/snapfeed-client.tsx` (or edit yours):

```tsx
'use client'

import type { ReactNode } from 'react'
import { FeedbackProvider } from 'snapfeed'
import { useUser } from '@/lib/auth' // your auth hook — replace with whatever you use

export function SnapfeedClient({ children }: { children: ReactNode }) {
  const user = useUser() // shape: { name: string; email: string } | null

  return (
    <FeedbackProvider
      appName="Acme"
      apiUrl="/api/feedback"
      user={user ? { name: user.name, email: user.email } : undefined}
      autoScreenshot
    >
      {children}
    </FeedbackProvider>
  )
}
```

Then in `app/layout.tsx`:

```tsx
import { SnapfeedClient } from './snapfeed-client'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SnapfeedClient>{children}</SnapfeedClient>
      </body>
    </html>
  )
}
```

The reporter name + email flow into Slack's `From:` field and Linear's issue body — so when something breaks, the engineer knows who to ping.

## 8. Test it

```bash
npm run dev
```

Open http://localhost:3000/checkout/cart, press Ctrl+Shift+F, type "Cart total ignores promo code", click Send.

## Verify it works

- A message appears in Slack `#checkout-feedback` (not `#bugs`, not `#platform-feedback`).
- The Slack message's `From:` field shows your real name and email (assuming you're signed in).
- A new Linear issue appears in the payments team's queue, titled `[Feedback] Cart total ignores promo code`.
- The Linear issue body has a `## Context` section with the URL `/checkout/cart`, the viewport, and the user agent.
- Now hit `/dashboard/billing`, send another piece of feedback. It lands in `#platform-feedback`, with no Linear issue (no `linear:` mapping for the dashboard route — that's intentional in our example).
- Hit `/about`, send something. It lands in `#bugs` (the default).

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Linear returns `Entity not found` or 400 with `teamId` | You passed the team key (`CHK`) instead of the UUID. Re-run the GraphQL `teams` query in step 3, copy the `id` field, replace the `SNAPFEED_LINEAR_TEAM_*` env vars. |
| Linear returns `Authentication failed` | The API key is invalid, expired, or you forgot the `lin_api_` prefix. Generate a fresh personal key in Linear settings. |
| All feedback lands in `#bugs` regardless of URL | Your routes don't match. Common causes: pattern is `/checkout/*` (single segment) but URL is `/checkout/cart/items` (multiple segments) — use `/checkout/**`. Also confirm the URL the widget sees: log `payload.pageUrl` from inside the route handler to debug. |
| Slack message says `From: Anonymous` | Your `useUser()` hook returns `null` at the time the widget mounts. Either gate the provider on the user being loaded, or pass `user` from a server component prop down to the client wrapper. |
| Linear issue created but routed to the wrong team | The `team` field in `routes[].to.team` doesn't match a key in `TEAM_IDS`. They're case-sensitive. |
| Both routes match a path | First match wins. Order routes from most-specific to least-specific in `routes[]`. |
