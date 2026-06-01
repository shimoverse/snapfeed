# Indie quickstart — Slack in 5 minutes

**Persona:** Solo dev, hackathon team, side project, OSS maintainer running a staging deploy.
**Goal:** Press a hotkey in your app, write a sentence, see it land in a Slack channel you already own.
**Time budget:** 5 minutes.
**snapfeed version:** v0.6.0

This is the simplest possible setup: one Slack incoming webhook, one env var, one provider wrapper. No database, no admin UI, no Docker.

---

## 1. Make sure you have a Next.js (or React) app

If you already have one, skip ahead. If not, scaffold a fresh Next.js app:

```bash
npx create-next-app@latest snapfeed-test
cd snapfeed-test
```

Pick the defaults (App Router, TypeScript). The rest of this guide assumes the App Router.

## 2. Install snapfeed

```bash
npm install snapfeed
```

## 3. Run the init scaffolder

```bash
npx snapfeed init --yes
```

`--yes` accepts the defaults: cloud-relayed mode, `file` + `console` destinations, `ctrl+shift+f` hotkey. It creates three files:

- `snapfeed.config.ts` — routing config stub (we won't need it for this guide)
- `.env.example` — env var template you can copy
- `app/api/feedback/route.ts` — the Next.js API route that adapters dispatch from

The route uses `autoAdapters()` — it reads `SNAPFEED_*` env vars at boot and wires the matching adapters automatically. That's how the next step works without any code changes.

## 4. Get a Slack incoming webhook URL

In the Slack workspace where you want feedback to land:

1. Go to https://api.slack.com/apps and click **Create New App** → **From scratch**.
2. Name it (e.g. "snapfeed") and pick the workspace.
3. In the left nav, click **Incoming Webhooks** and toggle **Activate Incoming Webhooks** on.
4. Scroll down, click **Add New Webhook to Workspace**, and pick the channel you want.
5. Copy the webhook URL — it looks like `https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXX`.

Slack's official walkthrough lives at https://api.slack.com/messaging/webhooks if you get stuck.

## 5. Add the webhook to `.env.local`

```bash
echo 'SNAPFEED_SLACK_WEBHOOK=https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXX' >> .env.local
```

(Substitute the real URL you copied.) `.env.local` is the file Next.js reads in development; it's gitignored by default in `create-next-app`.

## 6. Wrap your root layout in `<FeedbackProvider>`

Edit `app/layout.tsx` and add the provider. The provider is a client component, so put it in its own `'use client'` file and import it from the layout:

Create `app/snapfeed-client.tsx`:

```tsx
'use client'

import type { ReactNode } from 'react'
import { FeedbackProvider } from 'snapfeed'

export function SnapfeedClient({ children }: { children: ReactNode }) {
  return (
    <FeedbackProvider appName="My App" hotkey="ctrl+shift+f" apiUrl="/api/feedback">
      {children}
    </FeedbackProvider>
  )
}
```

Then edit `app/layout.tsx` to wrap your tree:

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

## 7. Run the dev server and send your first feedback

```bash
npm run dev
```

Open http://localhost:3000, then:

1. Press **Ctrl+Shift+F** (Windows/Linux) or **Cmd+Shift+F** also works on macOS — the widget listens for both.
2. The widget overlay opens. Type "first feedback".
3. Click **Send**.

## Verify it works

Within 1–2 seconds:

- The widget shows a "Sent" confirmation and closes.
- A new message appears in your Slack channel. The message has:
  - A header `🔧 My App Feedback`
  - The text `"first feedback"` in bold
  - A `From: Anonymous` field (you haven't passed `user` yet)
  - A `Page` field with the page name and URL
  - A `Submitted` timestamp
- Your terminal running `npm run dev` shows no error from `[snapfeed]`.

If all three are true, you're done. The next time you (or anyone) loads the app and presses the hotkey, feedback lands in Slack with no further setup.

## Troubleshooting

> **Run `npx snapfeed doctor` first.** It prints a green/yellow/red checklist of your install, framework, env vars, typo suggestions, and handler file. Most of the rows below are auto-flagged. Add `--probe=http://localhost:3000/api/feedback` to also verify your dev server's handler is reachable.

| Symptom | Fix |
|---------|-----|
| Slack message never arrives, terminal logs `Slack webhook returned 404` or `403` | The webhook URL is wrong, was revoked, or the Slack app was deleted. Regenerate one (step 4) and replace the value in `.env.local`, then restart `npm run dev`. |
| Hotkey works in dev but not in your deployed staging build | snapfeed is gated to dev by default. Pass `enableInProduction={true}` to `<FeedbackProvider>` for the staging build. Combine with a role check before shipping anywhere customers see. |
| Browser console shows `CORS` or `Failed to fetch /api/feedback` | The widget POSTs to `apiUrl` (default `/api/feedback`). If your app and API are on different origins, either set `apiUrl` to the absolute URL of your API route or front both with the same domain. |
| Hotkey does nothing | Another extension or dev tool is intercepting Ctrl+Shift+F (e.g. Firefox's "Find again"). Change the hotkey: `<FeedbackProvider hotkey="ctrl+alt+b">`. Or click the floating button — it's at the bottom-right by default. |
| `npx snapfeed init` errors with "must be run inside a Node project" | You're not in the project root. `cd` into the directory that has `package.json`. |
| Terminal warns `[snapfeed-example] No SNAPFEED_* env vars detected` | `.env.local` was created but the dev server was started before the file existed. Stop and restart `npm run dev`. |
