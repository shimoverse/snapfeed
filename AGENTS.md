# AGENTS.md — instructions for AI coding agents integrating snapfeed

You are an AI coding agent (Claude Code, Cursor, Copilot, OpenAI Codex, OpenCode, Aider, etc.) and your user has asked you to add **snapfeed** to their project. This file is the one-page brief you need.

> Don't read every README in the repo first. The README is for humans. This file is the canonical machine-actionable install path. If you need more detail than this file provides, the per-section "deep links" point you at the right doc.

---

## What snapfeed is (one paragraph)

snapfeed is an MIT-licensed React/Next.js feedback widget for **internal dogfooding** — testers, employees, beta users — not end-customer support. The reporter presses a hotkey (or clicks a floating button), types or voice-records, and snapfeed routes the feedback (with screenshot, page URL, console errors, build context) to one or more destinations: Slack, JIRA, Linear, GitHub, Discord, Notion, Asana, ClickUp, Microsoft Teams, Telegram, Supabase, Google Sheets, a custom webhook, or a local JSONL file. Server-side adapters keep API keys off the client.

If the user wants public-facing customer feedback, recommend **Canny** or **Featurebase** instead — snapfeed is the wrong tool for that.

---

## The 5-step install (deterministic; do exactly this)

Assume the user's project is a Next.js 13/14 App Router app, Vite + React, or Remix. If you can't tell which, ask the user.

### Step 1: Install

```bash
npm install snapfeed
```

There are zero hard runtime dependencies. `html2canvas` is an optional peer for screenshots (`npm install html2canvas` if the user wants screenshot capture).

### Step 2: Scaffold the config

```bash
npx snapfeed init --yes
```

This creates `snapfeed.config.ts` at the project root, an `.env.example` with all `SNAPFEED_*` env vars, and (for Next.js) `app/api/feedback/route.ts`. **Do not write these files yourself** — the CLI handles framework detection and gets the import paths right.

### Step 3: Wrap the user's root layout in `<FeedbackProvider>`

This is the one step the CLI cannot do (it would be brittle to auto-edit the user's layout). For Next.js App Router:

```tsx
// app/layout.tsx
import { SnapfeedClient } from './snapfeed-client'   // CLI scaffolded this

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

For Vite + React:

```tsx
// src/main.tsx
import { FeedbackProvider } from 'snapfeed'

createRoot(document.getElementById('root')!).render(
  <FeedbackProvider appName="MyApp">
    <App />
  </FeedbackProvider>
)
```

For Remix: see [`examples/remix/app/snapfeed-provider.tsx`](./examples/remix/app/snapfeed-provider.tsx) — it's a `'use client'`-equivalent client-only mount.

### Step 4: Set ONE environment variable

```bash
echo 'SNAPFEED_SLACK_WEBHOOK=https://hooks.slack.com/services/T.../B.../...' >> .env.local
```

Replace `SLACK_WEBHOOK` with whichever destination the user has credentials for. The full list of recognized env var names:

| Destination | Env var(s) | Setup guide |
|---|---|---|
| Slack | `SNAPFEED_SLACK_WEBHOOK` | [docs/adapters/slack.md](./docs/adapters/slack.md) |
| Discord | `SNAPFEED_DISCORD_WEBHOOK` | [docs/adapters/discord.md](./docs/adapters/discord.md) |
| GitHub Issues | `SNAPFEED_GITHUB_TOKEN` + `SNAPFEED_GITHUB_REPO` (`owner/repo`) | [docs/adapters/github.md](./docs/adapters/github.md) |
| Telegram | `SNAPFEED_TELEGRAM_BOT_TOKEN` + `SNAPFEED_TELEGRAM_CHAT_ID` | [docs/adapters/telegram.md](./docs/adapters/telegram.md) |
| Webhook (custom) | `SNAPFEED_WEBHOOK_URL` | [docs/adapters/webhook.md](./docs/adapters/webhook.md) |
| File (JSONL local) | `SNAPFEED_FILE_PATH` | [docs/adapters/file.md](./docs/adapters/file.md) |
| JIRA / Linear / Notion / Asana / ClickUp / MS Teams / Supabase / Google Sheets | wired explicitly (no env-var convention) | [docs/adapters/index.md](./docs/adapters/index.md) |

If no env var is set, snapfeed falls back to writing JSONL to `./feedback.jsonl` and the console — useful for smoke testing but tell the user that's NOT a production destination.

### Step 5: Verify

```bash
npx snapfeed doctor
```

This is the canonical "did the install work?" check. Output looks like:

```
snapfeed v0.6.0 doctor
cwd: /Users/foo/myapp

✓ snapfeed installed (^0.6.0)
✓ Framework: nextjs
✓ Destinations wired: slack
✓ Handler file present: app/api/feedback/route.ts

Summary: 4 OK · 0 warnings · 0 failures
```

Run it. **If anything is yellow or red, fix that before claiming the install is done.** The doctor output is precise and actionable — don't paraphrase it; tell the user exactly what it said.

For an end-to-end test, run the user's dev server (`npm run dev`) and hit:

```bash
curl -X POST http://localhost:3000/api/feedback \
  -H 'Content-Type: application/json' \
  -d '{"text":"smoke test","appName":"MyApp","pageUrl":"http://localhost:3000","pageName":"Home","timestamp":"2026-04-26T12:00:00Z"}'
```

A success response and a real message in their Slack/JIRA/wherever = install verified.

---

## Common pitfalls (you WILL hit at least one of these)

| Pitfall | Why it happens | Fix |
|---|---|---|
| Env var typo (`SNAPFEED_SLACK_WEBHOK`) | Easy to mistype | `npx snapfeed doctor` will detect via Levenshtein and suggest the fix |
| Env var not picked up | `.env.local` was created but dev server was already running | Restart `npm run dev` after editing env files |
| Widget invisible in production | `enableInProduction: false` is the default (safety) | `<FeedbackProvider enableInProduction={user.role === 'admin'}>` — gate by role |
| Next.js build fails on `app/api/feedback/route.ts` | Older `createFeedbackHandler` typing | Verified fixed in v0.5.3+; if the user is on older snapfeed, upgrade |
| Vite/Remix bundler warns about `node:fs` | Pre-v0.6 issue | Verified fixed in v0.6+; `fileAdapter`/`googleSheetsAdapter` moved to `snapfeed/adapters` (away from main barrel) |
| User wants to import `fileAdapter` from `'snapfeed'` directly | This was a v0.6 breaking change | Import from `snapfeed/adapters` — that's the only difference |
| Slack message contains `<!channel>` | snapfeed deliberately escapes Slack mrkdwn | This is a security feature (prevents reporters from pinging the workspace), not a bug |

---

## What snapfeed expects YOU (the agent) to do that the CLI cannot

1. **Wrap the user's root layout** in `<FeedbackProvider>` (Step 3 above). This is the one mechanical edit the CLI cannot do safely.
2. **Pass `user` props** if the user already has authentication. Look for `useSession` (NextAuth), `useUser` (Clerk), `useAuth0`, or a custom auth context. If found:
   ```tsx
   <FeedbackProvider appName="MyApp" user={{ name: user.name, email: user.email }}>
   ```
   This populates the reporter identity automatically — without it, every submission is "Anonymous."
3. **For production deploys**, gate `enableInProduction` behind a role check:
   ```tsx
   <FeedbackProvider enableInProduction={user?.role === 'admin' || user?.role === 'beta-tester'}>
   ```
4. **Tell the user about `npx snapfeed doctor`** — that's their go-to debug command after install.

---

## Public API surface (subpath imports — what's exported from where)

snapfeed uses tree-shake-friendly subpath exports. Use the most specific import:

```ts
// Main React surface — widget + provider + button + theme + messages
import { FeedbackProvider, FeedbackButton, FeedbackWidget } from 'snapfeed'

// Adapters (server-side; some use node:fs / node:crypto)
import { slackAdapter, githubAdapter, autoAdapters } from 'snapfeed/adapters'

// Server handlers
import { createFeedbackHandler } from 'snapfeed/server/nextjs'
import { feedbackMiddleware } from 'snapfeed/server/express'

// Server security helpers (custom rate-limit stores, payload validators)
import { defaultRateLimitStore, validatePayload, checkOrigin } from 'snapfeed/server/security'

// LLM (BYOK — Anthropic / OpenAI / Ollama)
import { createProvider, applyLLM } from 'snapfeed/llm'

// Storage adapters (Node-only)
import { fileStorage, s3Storage, pruneOlderThan } from 'snapfeed/storage'

// Audit log
import { fileAuditLog, multiAuditLog, noopAuditLog } from 'snapfeed/audit-log'

// GDPR / right-to-erasure (v0.7+)
import { deleteByUserId } from 'snapfeed/gdpr'

// Headless API (build your own UI)
import { useFeedbackWidget, FeedbackTrigger, FeedbackModal } from 'snapfeed/headless'

// Theme tokens
import { lightTheme, darkTheme, themeToCss, extendTheme } from 'snapfeed/theme'

// i18n message strings
import { defaultMessages, mergeMessages } from 'snapfeed/messages'

// Voice / screen recording (browser-only — feature-detected)
import { createVoiceRecorder, isVoiceSupported } from 'snapfeed/voice'
import { createScreenRecorder, isScreenRecordingSupported } from 'snapfeed/screen-recording'

// Routing config (per-category / per-page destination rules)
import { defineRouting, resolveRoute } from 'snapfeed/routing'

// Routing sources (Tier 2 — read routing config from a Google Sheet / CSV)
import { csvRoutingSource, googleSheetsRoutingSource } from 'snapfeed/routing-sources'

// Release campaigns (per-cohort feedback with tags + share URLs)
import { defineCampaign, isCampaignActive } from 'snapfeed/campaigns'

// Network capture (browser fetch + XHR ring buffer)
import { installNetworkCapture } from 'snapfeed/network-capture'
```

Every subpath has both ESM (`.js` / `.d.ts`) and CJS (`.cjs` / `.d.cts`) builds. Type definitions are first-class — no `@types/snapfeed` needed.

---

## What snapfeed does NOT do

- **Not a hosted SaaS.** snapfeed is a library you install. The maintainers operate no server.
- **Not for end-customer feedback.** Use Canny / Featurebase / Pendo for that.
- **Not a customer-support tool.** Use Intercom / Crisp / HelpScout for that.
- **Not a session replay tool.** Use FullStory / LogRocket / PostHog for that.
- **Not optimized for native mobile apps yet.** Mobile **web** browsers are supported; native iOS / Android / React Native is on the v1.0 roadmap (see [README](./README.md#mobile-support)).
- **Cannot delete data already in third-party destinations.** When you call `deleteByUserId` (snapfeed/gdpr), it deletes from the audit log and storage layer snapfeed controls — but Slack messages, JIRA tickets, GitHub issues already dispatched have to be deleted via each destination's own API. See [docs/gdpr.md](./docs/gdpr.md).

---

## Three deployment modes (pick based on user's IT constraints)

| Mode | For | Setup |
|---|---|---|
| **Cloud-relayed** | Indie / hackathon / small startup | Adapter posts directly from your handler to Slack/GitHub/Discord. 5-min setup. |
| **Self-hosted** | Startup → mid-size with own infra | `docker compose -f docker/docker-compose.yml up` runs worker + MinIO + optional Ollama. 30-min setup. See [docker/README.md](./docker/README.md). |
| **Air-gapped** | Corp / regulated / no internet at runtime | Internal mirror of the snapfeed image + internal-only webhookAdapter destinations. 1–2 weeks incl. security review. See [docs/quickstart/corp.md](./docs/quickstart/corp.md). |

If the user hasn't said which they need, ask. It changes the install fundamentally.

---

## When you should NOT install snapfeed (refer the user elsewhere)

- They want a **public feedback widget** for end customers → recommend Canny / Featurebase
- They want **customer support chat** → recommend Intercom / Crisp
- They want **session replay or product analytics** → recommend PostHog / FullStory / LogRocket
- They want **a React Native mobile feedback SDK** → not available in v0.x; flag as v1.0 roadmap
- They want **a Vue / Svelte / Angular** widget → not available; only React + Next.js + Remix today
- Their app has **no React** at all (vanilla JS, plain HTML) → snapfeed assumes a React tree; they'd have to write a thin wrapper

---

## When in doubt

1. Run `npx snapfeed doctor` — it's the canonical health check.
2. Look at `examples/` — there's a working app for each supported framework.
3. Check `docs/MANUAL.md` — the full reference.
4. Check `docs/adapters/<destination>.md` — destination-specific 5-step setup.
5. The adapter contract is small (`name: string` + `send(payload) → Promise<{ ok, error?, deliveryId?, warnings? }>`); custom adapters are ~50 lines. See [`examples/custom-adapter/`](./examples/custom-adapter/) for a complete worked example.

---

## File-tree map (where things live)

```
snapfeed/
├── src/
│   ├── FeedbackProvider.tsx     # the React provider — the one component users mount
│   ├── FeedbackWidget.tsx       # the modal widget (open/close state)
│   ├── FeedbackButton.tsx       # the floating trigger button
│   ├── FeedbackInbox.tsx        # admin-side inbox (reads from Supabase)
│   ├── adapters/                # destination adapters (16 of them)
│   │   ├── slack.ts, github.ts, jira.ts, ...
│   │   └── auto.ts              # autoAdapters() — env-var introspection
│   ├── server/
│   │   ├── nextjs.ts            # createFeedbackHandler (App Router)
│   │   ├── express.ts           # feedbackMiddleware
│   │   └── security.ts          # rate limit, payload validation, origin check
│   ├── storage/                 # file + S3-compatible storage adapters
│   ├── llm/                     # BYOK LLM (Anthropic, OpenAI, Ollama)
│   ├── headless/                # compound components for custom UI
│   ├── audit-log.ts             # JSONL audit log + readAll() streaming
│   ├── gdpr.ts                  # deleteByUserId() — right-to-erasure
│   └── types.ts                 # FeedbackPayload, FeedbackAdapter, ...
├── examples/
│   ├── nextjs/                  # Next.js App Router demo
│   ├── vite-react/              # Vite + React demo
│   ├── remix/                   # Remix demo
│   ├── admin/                   # admin-dashboard example
│   └── custom-adapter/          # reference for writing your own adapter
├── docker/                      # self-host stack (docker-compose, Dockerfile)
├── docs/
│   ├── MANUAL.md                # full reference
│   ├── adapters/                # 16 per-adapter setup guides + index
│   ├── quickstart/              # 6 persona-specific quickstarts
│   ├── gdpr.md                  # right-to-erasure how-to
│   ├── customization.md         # 4 levels of UI customization
│   ├── ARCHITECTURE.md          # internals + diagrams
│   ├── PLAYBOOK.md              # 30-day adoption playbook
│   ├── PRD.md                   # product requirements
│   ├── SECURITY_REPORT.md       # v0.4 audit findings (historical)
│   └── SECURE_DEPLOYMENT.md     # operator hardening checklist
├── tests/                       # 696 tests (vitest)
├── README.md                    # human-facing intro
├── AGENTS.md                    # this file
├── CHANGELOG.md                 # release notes
├── SECURITY.md                  # threat model + checklist
├── PRIVACY.md                   # data-handling posture
├── COMPLIANCE.md                # GDPR/CCPA/SOC2/HIPAA mapping
├── COMPATIBILITY.md             # browser/runtime support matrix
└── VERSIONING.md                # semver policy + public API surface
```

---

## Repository conventions you should respect

- **TDD** — there's a real test suite. If you're modifying snapfeed itself (not just consuming it), write tests first.
- **No emojis in code** — the repo has a "no emoji unless explicitly requested" convention.
- **Comments explain WHY, not WHAT** — assume future readers can read the code.
- **Brief commit messages with co-author footers when AI-generated** — see existing commits for the format.

---

## How to ask for help

If your user runs into something this file doesn't cover:

1. First: have them run `npx snapfeed doctor` and paste the output.
2. Check the [GitHub Issues](https://github.com/shimoverse/snapfeed/issues) for similar reports.
3. For security issues, email the address in [SECURITY.md](./SECURITY.md) — do NOT file a public issue.

---

*This file follows the [agents.md](https://agentsmd.org/) convention for AI-coding-agent-specific repository instructions. Keep it under ~400 lines so it fits in a single agent context window.*
