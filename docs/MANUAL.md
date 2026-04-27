# snapfeed reference manual

> The canonical reference for snapfeed v0.5. Beyond the [quickstart guides](./quickstart/index.md), this document is "how to do anything in snapfeed." Long form, structured so you can jump to a section.

Last updated: 2026-04-26 (snapfeed v0.5.3)

---

## Table of contents

1. [Concepts](#1-concepts)
2. [Installation](#2-installation)
3. [Configuration cookbook](#3-configuration-cookbook)
4. [Adapter cookbook](#4-adapter-cookbook)
5. [Routing recipes](#5-routing-recipes)
6. [LLM (BYOK) cookbook](#6-llm-byok-cookbook)
7. [Voice and screen recording](#7-voice-and-screen-recording)
8. [Server handler](#8-server-handler)
9. [Customization](#9-customization)
10. [Deployment](#10-deployment)
11. [Operations](#11-operations)
12. [Migration and upgrades](#12-migration-and-upgrades)
13. [Troubleshooting encyclopedia](#13-troubleshooting-encyclopedia)
14. [FAQ](#14-faq)
15. [Glossary](#15-glossary)
16. [Reference](#16-reference)

---

## 1. Concepts

### 1.1 Feedback payload anatomy

Every submission flowing through snapfeed is a `FeedbackPayload`. The shape is defined in `src/types.ts` and is intentionally narrow — adding fields requires a versioned change.

| Field | Type | Required | Notes |
|---|---|---|---|
| `text` | `string` | yes | The feedback message. Free-form. Hard cap of 64,000 characters; soft cap (`maxPayloadBytes`) defaults to 10 KB. |
| `appName` | `string` | yes | Set via `<FeedbackProvider appName="…">`. Static; never user input. Surfaced in adapter notifications. |
| `pageUrl` | `string` | yes | `window.location.href` at submission. May contain query strings. Sanitize on your side if URLs carry secrets. |
| `pageName` | `string` | yes | Human-readable label for the screen. |
| `timestamp` | `string` | yes | ISO 8601 at submission. |
| `category` | `'bug' \| 'idea' \| 'question' \| 'praise' \| 'other'` | no | Optional; reporter-picked. |
| `user.name` | `string` | no | Consumer-provided via `user={…}`. |
| `user.email` | `string` | no | Same. Subject to `redactBeforeLLM` when LLM is enabled. |
| `metadata.viewport` | `string` | auto | e.g. `"1440x900"`. |
| `metadata.userAgent` | `string` | auto | `navigator.userAgent`. |
| `metadata.consoleErrors` | `string[]` | auto | Last N captured `console.error` calls. Server runs `sanitizeConsoleError` against `SECRET_PATTERNS` before any adapter sees it. |
| `screenshot.base64` | `string` | no | Raw base64 (no `data:` prefix). 5 MB cap by default. |
| `screenshot.mimeType` | `string` | no | `image/png` or `image/jpeg`. |

### 1.2 Adapters

An **adapter** is a function with a tiny contract:

```ts
interface FeedbackAdapter {
  name: string
  send(payload: FeedbackPayload): Promise<FeedbackAdapterResult>
}

interface FeedbackAdapterResult {
  ok: boolean
  error?: string
  deliveryId?: string
  warnings?: string[]
}
```

Adapters can run **client-side** (the widget calls `send()` directly — bad idea for any adapter that needs an API token) or **server-side** (the widget POSTs to your `apiUrl`, the handler runs adapters server-side with secrets read from `process.env`). Use server-side for anything that touches a real destination. The CLI scaffolder, the README examples, and the Docker stack all use the server-side pattern.

### 1.3 Routing

Routing decides *which* adapters / destinations a given payload goes to. Two tiers ship in v0.4:

- **Tier 1 — file config** (`snapfeed/routing`). `defineRouting({ routes, default })`. Matches by URL glob, feature flag, and category. Pure data; evaluated server-side via `resolveRoute(payload, config)`.
- **Tier 2 — remote source** (`snapfeed/routing-sources`). Same shape, fetched from a CSV or Google Sheet (so a PM can edit without a deploy). Wrap with `cacheRoutingSource` for polling + last-known-good fallback.

LLM-*suggested* routing (a model picks the destination) is not shipped. The `severity` LLM feature suggests P0/P1/P2/nit; the human / config decides where it goes.

### 1.4 Modes

snapfeed has one widget and three deployment modes. Pick by what your security team will approve:

- **Cloud-relayed.** Widget → consumer's Next.js / Express handler → adapters call third-party APIs directly. Zero new infra. Works in 5 minutes.
- **Self-hosted.** Widget → consumer's Docker stack (`docker/docker-compose.yml`) → adapters + MinIO + optional Ollama. Runs in the consumer's VPC.
- **Air-gapped.** Same Docker stack with no outbound egress. Use `webhookAdapter` pointed at internal trackers; use `provider: 'ollama'` for in-tenant LLM.

### 1.5 LLM features and degradation

The LLM module (`snapfeed/llm`) is opt-in. With LLM enabled, snapfeed can generate a clean ticket title, infer severity, and extract repro steps. Without LLM, every feature falls back to a deterministic non-LLM behavior. The fallbacks are documented in the README's [LLM degradation table](../README.md#llm-byok-optional).

Per-feature toggles:

| Toggle | With LLM | Without LLM |
|---|---|---|
| `features.title` | Generated 6–12 word title | First 80 chars of `text` |
| `features.severity` | Inferred `p0`/`p1`/`p2`/`nit` | Reporter-picked `category` or default |
| `features.repro` | Extracted numbered steps | Raw text + journey trail |

> An LLM-driven `features.redact` second-pass was advertised in early v0.4 drafts but never landed. Use `redactBeforeLLM: true` (regex + entropy sweep) for outbound payload redaction. A second-pass redact feature is on the v0.6 roadmap.

Budget gating: if `budget.allow(EST_TOKENS)` returns false, the feature degrades; the run returns `degraded: true` with a `warnings[]` entry like `"title: skipped (budget exhausted)"`.

---

## 2. Installation

### 2.1 Per package manager

```bash
npm install snapfeed
# or
pnpm add snapfeed
# or
yarn add snapfeed
# or
bun add snapfeed
```

Optional peer for screenshots:

```bash
npm install html2canvas
```

### 2.2 Per framework

#### Next.js (App Router) — first-class
Recommended path. Use `snapfeed/server/nextjs`. Runnable example at `examples/nextjs/`.

```ts
// app/api/feedback/route.ts
import { createFeedbackHandler } from 'snapfeed/server/nextjs'
import { autoAdapters } from 'snapfeed/adapters'

export const POST = createFeedbackHandler({ adapters: autoAdapters() })
```

```tsx
// app/layout.tsx
import { FeedbackProvider } from 'snapfeed'

export default function RootLayout({ children }) {
  return (
    <html><body>
      <FeedbackProvider appName="MyApp" apiUrl="/api/feedback">
        {children}
      </FeedbackProvider>
    </body></html>
  )
}
```

#### Next.js (Pages Router) — works
Pass `createFeedbackHandler` through an `api/` route. The handler returns a `Response`; adapt to the `(req, res)` shape if your codebase requires it.

#### Remix — works in principle
Use the `snapfeed/server/express`-style handler in a Remix `action`. First-class example planned for v0.5.

#### Vite + React — works
Client-only setup; pair with any Node backend for the handler. First-class example planned for v0.5.

#### Express — first-class
Use `snapfeed/server/express`'s `feedbackMiddleware`.

#### Vanilla / no framework
Mount `<FeedbackProvider>` inside any React tree. Run `createFeedbackHandler` in any Node http server (the Docker `worker.cjs` does exactly this).

### 2.3 Per runtime

| Runtime | Status | Notes |
|---|---|---|
| Node 18 LTS | minimum | Required for native `fetch` and Web Streams used by `s3Storage` SigV4 |
| Node 20 LTS | recommended | Pinned in `.nvmrc`; CI baseline |
| Node 22 | works | Tested ad-hoc |
| Bun ≥ 1.0 | works | Node-only adapters work; edge-runtime-only deployments don't apply |
| Deno | works | `import { … } from 'npm:snapfeed'`; needs `--allow-net` |
| Cloudflare Workers / Vercel Edge | edge-safe adapters only | Node-only adapters (`fileAdapter`, `googleSheetsAdapter`, `s3Storage`) won't run on edge |

Cross-runtime UTF-8 byte length is handled by `utf8ByteLength` in `src/server/security.ts` (TextEncoder-first, Buffer fallback).

---

## 3. Configuration cookbook

### 3.1 Hotkey customization

```tsx
<FeedbackProvider hotkey="meta+k">{children}</FeedbackProvider>
```

Format: `"ctrl+shift+f"`, `"meta+k"`, `"ctrl+alt+b"`. The keyboard handler is registered on `window` and competes with browser shortcuts — pick a chord that doesn't collide with browser-reserved combos (Ctrl+T, Ctrl+W, Ctrl+N).

### 3.2 Multiple hotkeys

snapfeed supports a single `hotkey` prop. To bind a second one, listen for it in your own code and call the imperative API:

```tsx
import { useDevFeedback } from 'snapfeed'

function HotkeyExtra() {
  const { open } = useDevFeedback()
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.shiftKey && e.key === '?') open()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
  return null
}
```

### 3.3 Position presets

```tsx
<FeedbackProvider position="bottom-left">{children}</FeedbackProvider>
```

`position` accepts `"bottom-right"` (default), `"bottom-left"`, `"top-right"`, `"top-left"`. Arbitrary positioning is not exposed as a prop — for that, use the headless layer (`snapfeed/headless`) and lay out the trigger yourself.

### 3.4 Theme

```tsx
<FeedbackProvider theme="dark" accentColor="#7c3aed">{children}</FeedbackProvider>
```

`theme`: `"auto"` (default; follows `prefers-color-scheme`), `"light"`, `"dark"`. `accentColor`: any CSS color string. The default `#B85A36` is ~4.7:1 against white and meets WCAG AA on the default light theme; consumer-supplied colors are not contrast-checked.

### 3.5 Identifying the reporter (sync auth)

```tsx
<FeedbackProvider user={{ name: session.user.name, email: session.user.email }}>
  {children}
</FeedbackProvider>
```

### 3.6 Identifying the reporter (async auth)

When auth resolves after first render, conditionally mount the provider:

```tsx
const { user, isLoading } = useAuth()
if (isLoading) return <SkeletonShell>{children}</SkeletonShell>
return (
  <FeedbackProvider user={user ? { name: user.name, email: user.email } : undefined}>
    {children}
  </FeedbackProvider>
)
```

### 3.7 Build context

`buildId`, `gitSha`, and `env` are not yet first-class top-level props (planned for v0.5). Until then, attach via the `user` field or your own metadata layer:

```tsx
<FeedbackProvider
  user={{
    name: session.user.name,
    email: session.user.email,
  }}
  // build context surfaced inside text appName for now
  appName={`Checkout (${process.env.NEXT_PUBLIC_GIT_SHA?.slice(0,7) ?? 'dev'})`}
>
  {children}
</FeedbackProvider>
```

### 3.8 Multi-tenant: scoping the widget to specific routes

Mount `<FeedbackProvider>` inside the route subtree where it should be active:

```tsx
// app/(internal)/layout.tsx — only mounts under /internal/*
<FeedbackProvider appName="Internal Dashboard" apiUrl="/api/feedback">
  {children}
</FeedbackProvider>
```

Outside this subtree the widget is not present at all; no hotkey, no trigger.

---

## 4. Adapter cookbook

Each subsection: 2-line description → options → auth setup → caveats → worked example.

### 4.1 `slackAdapter`
Posts a message to a Slack incoming webhook with optional screenshot upload.

| Option | Default | Description |
|---|---|---|
| `webhookUrl` | required | `https://hooks.slack.com/services/T.../B.../X...` |
| `username` | none | Override post author |
| `iconEmoji` | none | e.g. `:speech_balloon:` |

**Auth.** Create an Incoming Webhook in your Slack workspace (Apps → Incoming Webhooks → Add to Slack → pick channel → copy webhook URL).
**Caveats.** Slack rate-limits roughly 1 message per second per webhook. Webhook URLs are themselves credentials — keep them server-side.

```ts
import { slackAdapter } from 'snapfeed/adapters'
slackAdapter({ webhookUrl: process.env.SNAPFEED_SLACK_WEBHOOK! })
```

### 4.2 `jiraAdapter`
Creates an issue in JIRA Cloud via REST v3 with ADF body and optional screenshot attachment. Edge-runtime-safe Basic auth.

| Option | Default | Description |
|---|---|---|
| `host` | required | `your-org.atlassian.net` |
| `email` | required | Atlassian account email |
| `apiToken` | required | Atlassian API token |
| `projectKey` | required | e.g. `CHK` |
| `issueType` | `'Task'` | `'Bug'`, `'Story'`, etc. |
| `attachScreenshot` | `true` | Multipart attach when present |
| `labelsByCategory` | none | e.g. `{ bug: ['from-snapfeed'] }` |

**Auth.** [Generate an Atlassian API token](https://id.atlassian.com/manage-profile/security/api-tokens). Pair with the email of the account that owns the token.
**Caveats.** ADF is Atlassian Document Format — the adapter renders the markdown into ADF for you. Custom fields are not supported in v0.4 (PRs welcome).

### 4.3 `linearAdapter`
Creates an issue in Linear via GraphQL with markdown description and inline screenshot data URI.

| Option | Default | Description |
|---|---|---|
| `apiKey` | required | Linear personal API key (`lin_api_...`) |
| `teamId` | required | Linear team UUID |
| `priority` | `0` | 0 (none), 1 (urgent), 2 (high), 3 (medium), 4 (low) |
| `labels` | none | Array of label names (must already exist) |

**Auth.** Linear → Settings → API → Personal API keys.
**Caveats.** `teamId` is a UUID, not a slug. Find it in the Linear web app URL or via the GraphQL `teams` query.

### 4.4 `githubAdapter`
Creates a GitHub Issue with optional screenshot via attached comment.

| Option | Default | Description |
|---|---|---|
| `token` | required | PAT with `repo` scope (or `public_repo` for OSS) |
| `repo` | required | `owner/name` |
| `labels` | none | Array of label names (must already exist) |
| `assignees` | none | Array of GitHub usernames |

**Auth.** [Generate a PAT](https://github.com/settings/tokens/new) with `repo` scope.
**Caveats.** GitHub does not support file attachment via REST — the adapter posts the screenshot as base64 inside a follow-up comment. Avoid for repos with many submissions; the comment can grow large.

### 4.5 `asanaAdapter`
Creates an Asana task in a project, attaches screenshot via multipart.

| Option | Default | Description |
|---|---|---|
| `accessToken` | required | Asana personal access token |
| `projectId` | required | Numeric Asana project id |
| `workspaceId` | none | Required for some token types |

**Auth.** Asana → My Profile Settings → Apps → Manage Developer Apps → Personal access tokens.
**Caveats.** Asana's REST API has separate task and attachment endpoints; the adapter does both in sequence. Free tier rate limits are moderate but not generous — watch for 429s.

### 4.6 `clickUpAdapter`
Creates a ClickUp task in a list with per-category priority.

| Option | Default | Description |
|---|---|---|
| `apiKey` | required | ClickUp personal API key |
| `listId` | required | Numeric ClickUp list id |
| `priorityByCategory` | sensible defaults | e.g. `{ bug: 'urgent', idea: 'normal' }` |

**Auth.** ClickUp → Profile → Apps → API → Personal API key.
**Caveats.** Priority values: `urgent` (1), `high` (2), `normal` (3), `low` (4). ClickUp API frequently adds optional fields — the adapter passes through what it knows.

### 4.7 `notionAdapter`
Creates a Notion page in a database with title / category / status select properties; embeds screenshot ≤1 MB as a data-URI image block.

| Option | Default | Description |
|---|---|---|
| `apiKey` | required | Notion integration secret |
| `databaseId` | required | UUID of the target database |
| `titleProperty` | `'Name'` | Title-property name in the DB |
| `categoryProperty` | none | Select-property name; values must match `FeedbackCategory` |
| `statusProperty` | none | Select-property name; default new-issue status |

**Auth.** Notion → Settings → Integrations → Develop or manage integrations → New internal integration. Share the target database with the integration.
**Caveats.** Screenshots >1 MB are skipped (Notion's image-block size cap). Database properties must exist before the first dispatch — the adapter does not create properties.

### 4.8 `msTeamsAdapter`
Posts an Adaptive Card to a Teams incoming webhook with per-category accents and optional AAD user mentions.

| Option | Default | Description |
|---|---|---|
| `webhookUrl` | required | Teams Incoming Webhook URL |
| `mentionUsers` | none | Array of `{ name, aadId }` to @-mention |

**Auth.** Teams channel → ⋯ → Connectors → Incoming Webhook → configure → copy URL.
**Caveats.** Teams' Adaptive Card schema is strict — the adapter pre-validates the card before POST.

### 4.9 `discordAdapter`
Posts feedback as a colored embed with optional role mention and multipart screenshot.

| Option | Default | Description |
|---|---|---|
| `webhookUrl` | required | Discord webhook URL |
| `roleId` | none | Role to mention (`<@&...>`) |

**Auth.** Discord channel → Edit Channel → Integrations → Webhooks → New Webhook.
**Caveats.** Discord's image upload supports up to 8 MB on free servers. Mentions only fire if `roleId` is set.

### 4.10 `googleSheetsAdapter`
Appends a row to a Sheets v4 spreadsheet using a service account.

| Option | Default | Description |
|---|---|---|
| `spreadsheetId` | required | From the Sheets URL |
| `sheetName` | `'Feedback'` | Tab name |
| `serviceAccountEmail` | required | `...@...iam.gserviceaccount.com` |
| `serviceAccountKey` | required | PEM private key string |

**Auth.** Google Cloud → IAM → Service accounts → create → keys → JSON. Share the sheet with the service account email.
**Caveats.** Node-only (uses `node:crypto` for RS256 JWT signing). Sheets API quota: 60 read + 60 write per user per minute.

### 4.11 `telegramAdapter`
Sends a message via Telegram Bot API with optional screenshot.

| Option | Default | Description |
|---|---|---|
| `botToken` | required | From [@BotFather](https://t.me/botfather) |
| `chatId` | required | Numeric chat id; use `getUpdates` to find |

**Auth.** `/newbot` to BotFather → copy token. Add the bot to a chat or group; send a message; call `https://api.telegram.org/bot<TOKEN>/getUpdates` to find the chat id.
**Caveats.** Bots cannot DM users who haven't initiated a chat first.

### 4.12 `webhookAdapter`
Sends the JSON payload to any HTTPS URL.

| Option | Default | Description |
|---|---|---|
| `url` | required | Your endpoint |
| `headers` | none | Extra headers, e.g. `{ Authorization: 'Bearer ...' }` |
| `transform` | none | `(payload) => bodyObject` to reshape before send |

**Auth.** Your endpoint's auth.
**Caveats.** No retry, no DLQ — the consumer's endpoint is responsible for durability.

### 4.13 `supabaseAdapter`
Inserts a row into a Supabase Postgres `feedback` table using the service key.

| Option | Default | Description |
|---|---|---|
| `url` | required | Supabase project URL |
| `serviceKey` | required | Service role key (server-only!) |
| `table` | `'feedback'` | Override table name |

**Auth.** Supabase → Project Settings → API → service_role key.
**Caveats.** Service key bypasses RLS — keep it server-side. Schema must exist.

### 4.14 `fileAdapter`
Appends a JSONL line to a local file. Node-only.

| Option | Default | Description |
|---|---|---|
| `path` | required | File path; parent dirs auto-created |
| `redactScreenshot` | `true` | Replace base64 with a marker to keep the file small |

**Caveats.** No automatic rotation — pair with `logrotate` (Linux) or your own. Don't log to a path mounted on a tmpfs you'll lose on reboot.

### 4.15 `consoleAdapter`
Logs the payload to `console.log`. For local dev / debugging only.

| Option | Default | Description |
|---|---|---|
| `pretty` | `true` | Pretty-print JSON |

### 4.16 `autoAdapters`
Reads `SNAPFEED_*` env vars and returns the right adapter set automatically. The recognized env vars are exported as `AutoEnvKeys`. In dev with no env vars, falls back to `[fileAdapter, consoleAdapter]`. In production with no env vars, returns `[]` and warns once.

```ts
import { autoAdapters } from 'snapfeed/adapters'
const adapters = autoAdapters() // wired entirely from env
```

---

## 5. Routing recipes

### 5.1 Tier 1 — file config (most common)

```ts
// snapfeed.config.ts
import { defineRouting } from 'snapfeed/routing'

export default defineRouting({
  routes: [
    { match: '/checkout/**', to: { team: 'payments', slack: '#checkout-feedback', jira: 'CHK' } },
    { flag: 'new_onboarding', to: { team: 'growth', linear: 'GRW' } },
    { category: 'praise', to: { slack: '#kudos' } },
  ],
  default: { team: 'platform', slack: '#bugs' },
})
```

`resolveRoute(payload, config)` returns the *first* matching rule's `to`. No merging with the default.

### 5.2 Tier 2 — Sheet-backed (PM-editable)

```ts
import { googleSheetsRoutingSource, cacheRoutingSource } from 'snapfeed/routing-sources'

const source = cacheRoutingSource(
  googleSheetsRoutingSource({
    spreadsheetId: process.env.ROUTING_SHEET_ID!,
    serviceAccountEmail: process.env.GOOGLE_SA_EMAIL!,
    serviceAccountKey: process.env.GOOGLE_SA_KEY!,
  }),
  {
    pollMs: 60_000,
    onError: (err) => console.warn('routing fetch failed, using last-known-good', err),
    onUpdate: (cfg) => console.log('routing reloaded', cfg.routes.length, 'rules'),
  },
)

const config = await source.get()
```

The sheet has columns `match | flag | category | team | slack | jira | linear | github | discord | sheet | assignee | labels`. PM edits the sheet; the worker polls; bad rows are skipped with a warning.

### 5.3 Per-URL routing

```ts
{ match: '/admin/**', to: { slack: '#admin-bugs', jira: 'ADM' } }
```

Glob: `*` matches a single path segment, `**` matches zero or more segments. Anchored to the full pathname.

### 5.4 Per-flag routing

```ts
{ flag: 'checkout_v2_beta', to: { slack: '#checkout-beta' } }
```

The widget passes `metadata.flags` if you wire it. A rule with `flag` only fires when that flag is in the array.

### 5.5 Per-category routing

```ts
{ category: 'praise', to: { slack: '#kudos' } }
{ category: 'idea', to: { sheet: 'IDEAS_SHEET_ID' } }
```

### 5.6 Combining tiers with fallback

```ts
const tier2 = await tier2Source.get().catch(() => null)
const config = tier2 ?? tier1Config
```

`cacheRoutingSource` already does this internally — it keeps the last successful fetch as last-known-good and returns it on subsequent fetch errors.

### 5.7 Testing routing config locally

```ts
import { resolveRoute, defineRouting } from 'snapfeed/routing'

const config = defineRouting({ routes: [...], default: {...} })
const dest = resolveRoute({ pageUrl: '/checkout/cart', category: 'bug' }, config)
console.log(dest) // → the destination object
```

`matchUrl(pattern, url)` is exposed for unit tests of glob behavior. `mergeDestinations(base, override)` is a shallow merge with override-wins semantics, useful when overlaying a Tier 2 config on top of a Tier 1 default.

---

## 6. LLM (BYOK) cookbook

### 6.1 Anthropic

```ts
import { applyLLM } from 'snapfeed/llm'

const result = await applyLLM(payload, {
  enabled: true,
  provider: 'anthropic',
  apiKey: process.env.ANTHROPIC_API_KEY!,
  model: 'claude-haiku-4-5', // pick the smallest model that gets the job done
  features: { title: true, severity: true },
  redactBeforeLLM: true,
  budget: { dailyTokens: 50_000 },
})
```

### 6.2 OpenAI

```ts
{ provider: 'openai', apiKey: process.env.OPENAI_API_KEY!, model: 'gpt-4o-mini' }
```

### 6.3 Azure OpenAI

The OpenAI provider serves Azure when `endpoint` and the `api-key` header are passed:

```ts
{
  provider: 'azure-openai',
  endpoint: 'https://YOUR-RESOURCE.openai.azure.com/openai/deployments/YOUR-DEPLOY/chat/completions?api-version=2024-02-15-preview',
  headers: { 'api-key': process.env.AZURE_OPENAI_KEY! },
  model: 'gpt-4o-mini',
}
```

### 6.4 Bedrock
Reserved (`'bedrock'` accepted as a `provider` name); not implemented in v0.4. Returns `null` from `createProvider` so the runner degrades cleanly. Plan: implement in a later release using `@aws-sdk/client-bedrock-runtime`. Until then, fall back to Anthropic / OpenAI / Ollama.

### 6.5 Ollama (in-tenant / air-gapped)

```ts
{
  provider: 'ollama',
  endpoint: 'http://localhost:11434/api/generate',
  model: 'llama3',
}
```

The Docker stack ships an `--profile llm` that runs Ollama in-tenant. Pull the model once: `docker exec -it snapfeed-ollama ollama pull llama3`.

### 6.6 Per-feature toggles

```ts
features: {
  title: true,
  severity: true,
  repro: false,   // off — falls back to raw text
}
```

> `features.redact` (LLM second-pass redaction) is **not shipped** — the toggle in early v0.4 drafts was a no-op and has been removed from the public type. For outbound redaction, use `redactBeforeLLM: true` (regex + entropy sweep, see §6.7). A real LLM redaction feature is planned for v0.6.

Each feature degrades independently. If `title` errors but `severity` succeeds, the result has `title: undefined` + `severity: 'p1'` + `degraded: true` + `warnings: ['title: ...']`.

### 6.7 Pre-LLM redaction

`redactForLLM(text)` strips:
- email addresses,
- credit-card-shaped 13–19 digit groups (`CC_PATTERN`),
- JWTs (`<header>.<payload>.<signature>` shape),
- high-entropy tokens (≥40 chars, mixed case + digits).

Set `redactBeforeLLM: true` to apply it before any prompt is sent. Recommended for any non-Ollama provider.

### 6.8 Token budget tuning

```ts
import { createBudgetTracker } from 'snapfeed/llm'

const budget = createBudgetTracker({ dailyTokens: 50_000 })
await applyLLM(payload, config, { budget })
```

The runner gates each feature with `budget.allow(ESTIMATED_MAX_TOKENS_PER_CALL)` (512). When the budget is exhausted, the feature is skipped with a warning. The budget resets at midnight host-local time.

### 6.9 Cost estimation

A rough order-of-magnitude estimate for `title` + `severity` per submission:

| Provider / model | Input tokens | Output tokens | Cost per 1k submissions (approx) |
|---|---|---|---|
| Anthropic Claude Haiku 4.5 | ~300 | ~30 | $0.30–$0.60 |
| OpenAI GPT-4o mini | ~300 | ~30 | $0.05–$0.10 |
| Ollama (local) | unmetered | unmetered | electricity only |

Numbers are illustrative. Real numbers depend on payload size and current provider pricing. Always use a `budget` cap.

### 6.10 Air-gapped LLM via Ollama

```bash
docker compose -f docker/docker-compose.yml --profile llm up
docker exec -it snapfeed-ollama ollama pull llama3
```

Recommended models for our use case (small, fast, English-tuned): `llama3` (8B), `mistral` (7B), `phi3` (3.8B). Bigger models (70B) are wasted on title generation.

---

## 7. Voice and screen recording

### 7.1 Browser support matrix

| Feature | Chrome 88+ | Firefox 90+ | Safari 14+ | iOS Safari |
|---|---|---|---|---|
| Voice (`MediaRecorder` + `getUserMedia`) | yes | yes | 14.1+ | 14.5+ (gesture-required) |
| Screen recording (`getDisplayMedia`) | yes | yes | 13+ | **not supported** |

Use `isVoiceSupported()` and `isScreenRecordingSupported()` to detect at runtime; the widget hides the relevant UI when unsupported.

### 7.2 Permission UX

The browser owns the permission dialog — snapfeed cannot pre-grant or skin it. Educate the reporter:

> When you tap the mic / screen-record button, your browser will ask for permission. Click **Allow**. We only record while you're holding the button.

For corporate-managed devices, mic/screen-record permission can be policy-set at the OS / browser-policy layer; if your tester taps the button and nothing happens, that's the cause.

### 7.3 Storage: when base64 vs external storage

By default, voice and screen-recording clips ride along inside the payload as base64. That works for small clips (the widget caps voice at 60s, screen at 30s by default). For larger clips:

```ts
import { s3Storage } from 'snapfeed/storage'

const storage = s3Storage({
  endpoint: 'https://s3.amazonaws.com',
  bucket: 'snapfeed-media',
  region: 'us-east-1',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
})
const { url } = await storage.upload({ key: 'clip-123.webm', contentType: 'audio/webm', body: clip.bytes })
// store `url` in your tracker; do NOT inline the bytes
```

Works against AWS S3, Cloudflare R2, Backblaze B2, MinIO. Pure `node:crypto` SigV4 signing.

### 7.4 iOS Safari quirks

- **No screen recording.** `getDisplayMedia` is not implemented on iOS. The button is hidden.
- **Voice requires a user gesture.** Tapping the mic button counts; programmatic `start()` does not.
- **Background-tab throttling.** Long captures can be paused or terminated when the tab loses focus.

---

## 8. Server handler

### 8.1 `createFeedbackHandler` (Next.js)

```ts
// app/api/feedback/route.ts
import { createFeedbackHandler } from 'snapfeed/server/nextjs'
import { slackAdapter, jiraAdapter } from 'snapfeed/adapters'

export const POST = createFeedbackHandler({
  adapters: [
    slackAdapter({ webhookUrl: process.env.SNAPFEED_SLACK_WEBHOOK! }),
    jiraAdapter({ /* ... */ }),
  ],
  rateLimit: { max: 10, windowMs: 60_000 },
  maxPayloadBytes: 10_000,
  maxScreenshotBytes: 5 * 1024 * 1024,
  allowedOrigins: ['https://staging.myapp.com', /\.myapp\.com$/],
})
```

### 8.2 `feedbackMiddleware` (Express)

```ts
import express from 'express'
import { feedbackMiddleware } from 'snapfeed/server/express'

const app = express()
app.post('/api/feedback', feedbackMiddleware({ adapters: [...], rateLimit: {...} }))
```

### 8.3 Custom handler patterns

The handler is plain logic over `Request` / `Response` semantics. For Cloudflare Workers, Deno, or Bun, wrap your runtime's request shape and call into `validatePayload` / `checkOrigin` / `checkRateLimit` from `src/server/security.ts`. The Docker `worker.cjs` is a 100-line example of doing this against Node's raw `http` module.

### 8.4 Rate limiting

In-memory by default (`defaultRateLimitStore`). For multi-instance deployments, implement `RateLimitStore`:

```ts
interface RateLimitStore {
  increment(key: string, windowMs: number): Promise<{ count: number; resetAt: number }>
}
```

A Redis / Upstash example:

```ts
const redisStore: RateLimitStore = {
  async increment(key, windowMs) {
    const count = await redis.incr(key)
    if (count === 1) await redis.pexpire(key, windowMs)
    const ttl = await redis.pttl(key)
    return { count, resetAt: Date.now() + ttl }
  },
}
```

### 8.5 Origin allowlist

```ts
allowedOrigins: ['https://myapp.com', /\.myapp\.com$/, 'https://staging.myapp.com']
```

When set, requests with non-matching `Origin:` headers return 403. Strings match exactly; RegExp tests run against the full origin.

### 8.6 Body size caps

`maxPayloadBytes` (default 10 KB) caps text + metadata. `maxScreenshotBytes` (default 5 MB) caps the screenshot base64-decoded byte length. Oversized payloads return 413.

### 8.7 `onReceive` / `onComplete` hooks

```ts
createFeedbackHandler({
  adapters: [...],
  onReceive: async (payload) => {
    if (payload.text.length < 5) return false // reject very short
    return true
  },
  onComplete: async (payload, results) => {
    // log to your APM, audit log, etc.
  },
})
```

`onReceive` returning `false` (or rejecting) cancels the dispatch with 400. `onComplete` runs after all adapters; failures inside it are swallowed so they cannot break the request.

### 8.8 Audit log integration

```ts
import { fileAuditLog } from 'snapfeed/audit-log'

const audit = fileAuditLog({ path: '/var/log/snapfeed/audit.jsonl', hashReporter: true })

createFeedbackHandler({
  adapters: [...],
  onReceive: async (payload) => {
    await audit.record({
      type: 'feedback.received',
      ts: new Date().toISOString(),
      payloadSize: JSON.stringify(payload).length,
      pageUrl: payload.pageUrl,
      reporter: payload.user?.email,
      category: payload.category,
    })
    return true
  },
  onComplete: async (payload, results) => {
    for (const r of results) {
      await audit.record({
        type: 'adapter.dispatched',
        ts: new Date().toISOString(),
        adapter: r.deliveryId ?? 'unknown',
        ok: r.ok,
        durationMs: 0,
        deliveryId: r.deliveryId,
        error: r.error,
        warningsCount: r.warnings?.length,
      })
    }
  },
})
```

For multi-sink, wrap with `multiAuditLog(fileLog, siemLog, ...)`.

---

## 9. Customization

> Full customization document: see [`customization.md`](./customization.md).

Three levels:

1. **Props.** `theme`, `accentColor`, `position`, `hotkey`. Cheap, contained.
2. **CSS variables.** The widget exposes design tokens (e.g. `--snapfeed-radius`, `--snapfeed-bg`) that override the visual style without forking the component tree.
3. **Headless mode.** `snapfeed/headless` exposes the raw form state, submit handler, compound components (`<FeedbackTrigger>`, `<FeedbackModal>`, `<FeedbackTextarea>`, `<FeedbackCategorySelect>`, `<FeedbackScreenshotPreview>`, `<FeedbackSubmitButton>`, `<FeedbackError>`, `<FeedbackSuccess>`), a render-prop (`<FeedbackHeadless>`), and a slot-based provider (`<FeedbackComponentsProvider>`). Use this when you want full control over the widget UI.

---

## 10. Deployment

### 10.1 Cloud-relayed (Vercel / Netlify / Cloudflare Pages)

Drop `app/api/feedback/route.ts` (or equivalent) into your existing app. The handler runs on the host's serverless / edge runtime. Edge-runtime caveat: avoid Node-only adapters (`fileAdapter`, `googleSheetsAdapter`, `s3Storage`); use HTTP-only adapters (`slackAdapter`, `webhookAdapter`, `discordAdapter`, `githubAdapter`).

### 10.2 Self-hosted Docker

See [`docker/README.md`](../docker/README.md). Five-step quickstart: clone, copy `.env`, `docker compose up`, `curl /healthz`, post a sample.

### 10.3 Air-gapped

Same Docker stack with no outbound egress. Use `webhookAdapter` pointed at internal trackers; `provider: 'ollama'` for in-tenant LLM. Pin image digests yourself (v0.4 uses named tags; pinning ships in v0.5). Mirror images to your internal registry.

### 10.4 Kubernetes manifest skeleton

```yaml
apiVersion: apps/v1
kind: Deployment
metadata: { name: snapfeed-worker }
spec:
  replicas: 1   # in-memory rate limiter — keep at 1 until v0.6 Redis store
  selector: { matchLabels: { app: snapfeed-worker } }
  template:
    metadata: { labels: { app: snapfeed-worker } }
    spec:
      containers:
        - name: worker
          image: ghcr.io/your-org/snapfeed-worker@sha256:...   # pin yourself
          ports: [{ containerPort: 8787 }]
          env:
            - { name: SNAPFEED_SLACK_WEBHOOK, valueFrom: { secretKeyRef: { name: snapfeed-secrets, key: slack } } }
            - { name: ALLOWED_ORIGINS, value: "https://staging.example.com" }
          readinessProbe: { httpGet: { path: /healthz, port: 8787 } }
          volumeMounts: [{ name: audit, mountPath: /data/audit }]
      volumes: [{ name: audit, persistentVolumeClaim: { claimName: snapfeed-audit } }]
---
apiVersion: v1
kind: Service
metadata: { name: snapfeed-worker }
spec:
  selector: { app: snapfeed-worker }
  ports: [{ port: 80, targetPort: 8787 }]
```

### 10.5 Reverse-proxy SSO pattern

Until the admin app ships SSO/SAML in v0.5, put the read-only admin example behind an existing SSO reverse proxy (`oauth2-proxy`, `Pomerium`, your corp's HTTP front door). The widget's `apiUrl` does not need SSO — it uses the consumer's existing same-origin auth.

---

## 11. Operations

### 11.1 Monitoring — what to alert on

- **4xx rate** (especially 403 from origin allowlist, 413 from payload size, 429 from rate limit). Spike = attacker probing or a misconfigured client.
- **5xx rate** on `/feedback`. Spike = adapter outage (provider down) or worker crash.
- **p99 latency** on `/feedback`. Slow adapters drag the whole request; SLO your handler at <2s p99 with healthy adapters.
- **Audit log gaps.** A `feedback.received` event with no matching `adapter.dispatched` events within 60s = the dispatch hung.

### 11.2 Common log patterns

| Log line | Cause |
|---|---|
| `Origin not allowed` | `allowedOrigins` doesn't include the caller's origin |
| `Too many feedback submissions` | Rate-limit hit; tune `max` / `windowMs` or wire Redis |
| `Payload too large` | `maxPayloadBytes` exceeded; raise cap or trim metadata |
| `adapter X failed: ...` | `FeedbackAdapterResult.error` from the adapter |
| `LLM call skipped (budget exhausted)` | Daily token budget hit; dispatch still succeeded with degraded output |

### 11.3 Backup

Three things to back up in self-hosted mode:
- **Audit log.** `/data/audit/snapfeed.jsonl` (gitignored in the Docker stack). Standard log-rotation or ship-to-SIEM.
- **Status sidecar.** If you wired a status sidecar (e.g. Postgres-tracking which items are resolved), back up that DB.
- **Uploads.** `/data/uploads/` if using `fileStorage`; bucket lifecycle if using `s3Storage`.

### 11.4 Disaster recovery

- **Worker recreation.** The worker is stateless except for the in-memory rate-limit table. `docker compose down && docker compose up` recreates from the image with no data loss.
- **State recovery.** Restore audit JSONL + uploads from backup. Adapter destinations (Slack, JIRA, etc.) are the system of record — they survive worker loss.

### 11.5 Capacity planning

| Load | Recommended sizing |
|---|---|
| 10 req/min | 1 worker, 256 MB RAM, 0.1 vCPU. In-memory rate limit fine. |
| 100 req/min | 1 worker, 512 MB RAM, 0.5 vCPU. Watch p99 of slowest adapter. |
| 1000 req/min | 2+ workers + Redis-backed `RateLimitStore`. Postgres-backed inbox (v0.6) recommended over JSONL at this load. |

The worker is I/O-bound (adapter HTTP calls). CPU is rarely the bottleneck.

---

## 12. Migration and upgrades

### 12.1 Reading the CHANGELOG

[`CHANGELOG.md`](../CHANGELOG.md) follows [Keep a Changelog](https://keepachangelog.com/). Categories: `Added`, `Changed`, `Fixed`, `Removed`, `Security`. Read the latest version's `Changed` and `Removed` entries before upgrading.

### 12.2 Major version bump checklist

When v1.0 lands:
- Re-read `SECURITY.md` and `PRIVACY.md` for any change of posture.
- Re-test your routing config locally with `resolveRoute` in a unit test.
- Re-run your security review with the new SBOM.
- Bump pinned version + integrity hash in your lockfile.

### 12.3 Roll-back procedure

```bash
npm install snapfeed@<previous-version> --save-exact
```

snapfeed has no migrations, no schema, no remote state — roll-back is a version pin.

### 12.4 Data migration patterns when upgrading adapters

Adapter contracts (`FeedbackAdapter`) have not changed since v0.1. Adapter *options* sometimes gain new optional fields between minor versions. Read the per-adapter `Changed` entries in the CHANGELOG.

---

## 13. Troubleshooting encyclopedia

> **First-stop debug command: `npx snapfeed doctor`.** It prints a green/yellow/red checklist of your setup — install version, framework, destinations wired, env-var typos (with did-you-mean suggestions), Next.js handler file presence, and an optional `--probe=<url>` to verify your dev server's `/api/feedback` route is reachable. Most of the rows below are flagged automatically. Exits non-zero on failures so you can run it in CI.

```bash
npx snapfeed doctor
npx snapfeed doctor --probe=http://localhost:3000/api/feedback
```

| # | Symptom | Likely cause | Fix |
|---|---|---|---|
| 1 | Widget doesn't appear in production | `enableInProduction: false` (default) | Set `enableInProduction={user.role === 'admin'}` (role-gated) |
| 2 | Widget doesn't appear at all (any env) | `<FeedbackProvider>` not mounted in the React tree | Wrap your app's root with `<FeedbackProvider>` |
| 3 | Hotkey doesn't trigger | Browser shortcut conflict (e.g. `Ctrl+T`) | Pick a non-reserved combo (`ctrl+shift+f`) |
| 4 | Hotkey triggers in one tab not another | Page hasn't focused yet; window event listeners unbound | Click into the page once before pressing the hotkey |
| 5 | 401 from JIRA | API token wrong / expired | Regenerate at id.atlassian.com/manage-profile/security/api-tokens |
| 6 | 403 from JIRA | Token user lacks project permission | Grant the API-token user "Browse projects" + "Create issues" on the project |
| 7 | 401 from Linear | API key wrong | Linear → Settings → API → Personal API keys |
| 8 | 403 from GitHub adapter | PAT lacks `repo` scope | Regenerate with `repo` scope (or `public_repo` for OSS repos) |
| 9 | Slack webhook silently no-ops | Webhook URL wrong or revoked | Test with `curl -X POST -H 'Content-Type: application/json' -d '{"text":"hi"}' $URL` |
| 10 | Screenshot fails / blank | Cross-origin iframe in the page | Browser security; `html2canvas` cannot capture cross-origin frames |
| 11 | Screenshot fails entirely | `html2canvas` not installed | `npm install html2canvas` (it's an optional peer) |
| 12 | Screenshot too large | `maxScreenshotBytes` exceeded | Raise `maxScreenshotBytes`, or use `s3Storage` to externalize |
| 13 | Voice button doesn't appear | Browser doesn't support `MediaRecorder` | `isVoiceSupported()` returns false; nothing to do |
| 14 | Voice records silence | Mic permission denied | Re-grant in browser settings; on mac, also System Settings → Privacy → Microphone |
| 15 | Screen-record button missing on iOS | iOS Safari has no `getDisplayMedia` | Expected; documented in compatibility matrix |
| 16 | LLM doesn't generate title | `features.title: false` | Set to `true` in `LLMConfig.features` |
| 17 | LLM doesn't run at all | `enabled: false` | Set `enabled: true` |
| 18 | LLM degraded with `budget exhausted` | Daily token budget hit | Raise `budget.dailyTokens`, or wait for next-day reset |
| 19 | LLM degraded with network error | Upstream provider 5xx / timeout | Check provider status; retry on next submission |
| 20 | Routing rule doesn't match | URL glob syntax wrong | `*` = single segment, `**` = any depth; test with `matchUrl()` in a unit test |
| 21 | Routing routes everything to default | No rule's conditions all match | `resolveRoute` returns first all-match rule; check `match` + `flag` + `category` together |
| 22 | `fileAdapter` writes nothing | Path's parent dir not writable | `chown` the dir to the worker's user (`1000:1000` in Docker default) |
| 23 | `fileAdapter` writes giant base64 lines | `redactScreenshot: false` | Set to `true` (default) |
| 24 | Docker stack won't start | Port 8787 / 9000 / 9001 in use | Set `WORKER_PORT=9999` in `docker/.env` |
| 25 | MinIO healthcheck fails | First-boot race | Re-run `docker compose up`; check `docker compose logs minio` |
| 26 | EACCES on `/data/audit/...` | Bind-mounted host dir owned by another UID | `sudo chown -R 1000:1000 docker/data` |
| 27 | Origin rejected (403) | `allowedOrigins` set, header doesn't match | Add origin to allowlist + restart |
| 28 | Rate-limit hits in dev | `max: 10/min` default | Tune `rateLimit.max`, or disable for staging |
| 29 | Multi-instance rate limit doesn't share state | In-memory store | Implement `RateLimitStore` against Redis / Upstash |
| 30 | Sheets routing source returns empty | Sheet not shared with service account | Share with the `...iam.gserviceaccount.com` email |
| 31 | Sheets routing source returns stale data | `cacheRoutingSource` polling failed silently | Wire `onError` callback; check service-account quota |
| 32 | Audit JSONL fills disk | No log rotation | Add `logrotate` or ship to SIEM |
| 33 | Reporter email reversible from audit log | `hashReporter: false` | Set `hashReporter: true` on `fileAuditLog` |
| 34 | Console errors leak tokens | `consoleErrors` not redacted | Server runs `sanitizeConsoleError` automatically; verify by inspecting the dispatched payload |
| 35 | Network capture buffer overflows | Default `maxRequests: 20` too small for the page | Bump in `installNetworkCapture({ maxRequests: 50 })` |

---

## 14. FAQ

### Where does my data go?
Only to the destinations you configure as adapters, plus the optional LLM provider you chose. The snapfeed maintainers operate no servers and see no data. See [`PRIVACY.md`](../PRIVACY.md).

### Do I need a license to fork?
No. snapfeed is MIT, no CLA. Fork freely.

### Is there hosted snapfeed?
No. There is no hosted snapfeed and there will not be. See PRD §11.4 for why.

### Can I use this for end customers?
You *can*, but it's the wrong tool. snapfeed is shaped for signed-in internal testers. For anonymous end-customer feedback, use Canny / Userback / similar.

### How do I add a new adapter?
Implement the `FeedbackAdapter` interface (one method, `send(payload) → result`). See `src/adapters/slack.ts` for a 50-line reference. PRs welcome — see [`CONTRIBUTING.md`](../CONTRIBUTING.md).

### How do I bring my own LLM?
`provider: 'custom'` is reserved. Until it's wired in v0.5, the supported path is `provider: 'openai'` with `endpoint` pointed at an OpenAI-compatible proxy (vLLM, LiteLLM, OpenRouter, etc.).

### Does it work without React?
The widget is React-only today. The adapter runtime (`createFeedbackHandler`, all adapters) is framework-agnostic — you can POST any valid `FeedbackPayload` to the handler from any client.

### Does it work in React Server Components (RSC)?
The provider is a Client Component (`'use client'` at the top of `FeedbackProvider`). Mount it inside a Client boundary; the rest of your tree can stay RSC.

### How do I rate-limit per user instead of per IP?
Pass a custom `RateLimitStore` keyed on `user.email` instead of the IP. The default keyer uses IP from `x-forwarded-for`.

### How do I delete a user's submitted feedback (GDPR right to erasure)?
Today: manually, against each adapter destination (delete the JIRA tickets, the Slack messages, the Postgres rows). `deleteByUserId()` ships in v0.5.

### Does snapfeed work behind a corporate proxy?
Yes — adapters use `fetch`, which honors `HTTP_PROXY` / `HTTPS_PROXY` env vars in Node 20+. For non-fetch HTTP libraries inside an adapter, configure the proxy at the runtime level.

### Is snapfeed accessible (WCAG)?
The widget targets WCAG 2.1 AA. Full external audit + remediation is on the v0.5 roadmap. See [`COMPLIANCE.md`](../COMPLIANCE.md) for the current state.

### How do I localize the widget UI?
i18n is not yet first-class. The string set is small and lives inside the React components — a fork can swap them. First-class i18n is a v0.6+ candidate.

### What's the difference between Tier 1 and Tier 2 routing?
Tier 1 = file config, deploys with code, engineer-edits. Tier 2 = remote source (CSV/Sheet), polls at runtime, PM-edits. They share the same shape (`RoutingConfig`).

### What's a Release Campaign?
A time-bound dogfooding session for a feature. A campaign has a window, an optional flag, owners, optional routing override, and tags that get auto-applied to feedback during the window. See `snapfeed/campaigns`.

### Can I run snapfeed without internet?
Yes — `docker compose -f docker/docker-compose.yml up` runs offline. Use only `webhookAdapter` (pointed inside your network) + `fileAdapter` and `provider: 'ollama'` for LLM features.

### Does snapfeed compete with Sentry?
No. Sentry captures crashes and errors automatically; snapfeed captures human-typed feedback intentionally. Use both. snapfeed pulls Sentry-style data (`consoleErrors`, network log) into the human report.

---

## 15. Glossary

- **Adapter** — A function (`FeedbackAdapter`) that takes a `FeedbackPayload` and dispatches it to a destination (Slack, JIRA, etc.). Returns `FeedbackAdapterResult`.
- **Air-gapped** — Deployment with no outbound internet egress. snapfeed supports this via the Docker stack + Ollama profile + internal-only webhooks.
- **Audit log** — Append-only record of `feedback.received`, `adapter.dispatched`, `llm.called`, `config.changed`, `rate_limit.hit` events. `snapfeed/audit-log`.
- **BYOK** — Bring Your Own Key. snapfeed's LLM module never proxies through us; the consumer supplies the API key on their own server.
- **Cache routing source** — A polling wrapper (`cacheRoutingSource`) around any `RoutingSource` that adds last-known-good fallback on fetch error.
- **Campaign** — A `ReleaseCampaign` (`snapfeed/campaigns`) — time-bound dogfooding session with optional flag and routing override.
- **Cloud-relayed mode** — Deployment where the widget POSTs to the consumer's own serverless / Node handler, which dispatches to third-party APIs directly. No snapfeed-operated relay.
- **Dogfooding** — Internal use of one's own product, especially pre-release. snapfeed's primary use case.
- **Headless mode** — `snapfeed/headless` exposes form state and compound components for full UI control.
- **In-tenant LLM** — An LLM that runs inside the consumer's own infrastructure (Azure OpenAI in their Azure tenant, Bedrock in their AWS account, Ollama on their own host).
- **Mode** — One of `cloud-relayed`, `self-hosted`, `air-gapped`. The widget is identical; the deployment topology differs.
- **Payload** — A `FeedbackPayload` object. Defined in `src/types.ts`.
- **Phone-home** — Outbound call by a library back to the maintainer's servers. snapfeed has zero phone-home, by policy.
- **Redaction** — Stripping secrets / PII from a string before downstream handling. Two layers: `sanitizeConsoleError` (server-side, console errors) and `redactForLLM` (pre-LLM-call).
- **Routing** — Deciding which destinations a payload goes to. Tier 1 (file config) and Tier 2 (sheet / CSV).
- **Self-host** — Run the worker inside your own infrastructure, no third-party hosting.
- **Severity** — `p0` / `p1` / `p2` / `nit`. LLM-inferred when `features.severity: true`.
- **Sidecar** — A separate process that augments the worker (e.g. a status-tracking sidecar). snapfeed itself is not a sidecar architecture, but the audit log can ship to one.
- **Steward** — A named human responsible for triaging incoming feedback during rollout. See [`PLAYBOOK.md`](./PLAYBOOK.md).
- **Storage adapter** — A pluggable upload-and-return-URL surface for media (`StorageAdapter`); `fileStorage` and `s3Storage` ship in v0.4.
- **Subpath import** — Importing from a subpath of the package, e.g. `snapfeed/llm`, to keep the browser bundle slim and to enforce server-only modules.
- **Tier 1 routing** — File-based `defineRouting()` config. Engineer-edits, deploys with code.
- **Tier 2 routing** — Remote `RoutingSource` (Sheets, CSV). PM-edits, runtime-fetched, polled.
- **Worker** — The Node HTTP server in `docker/worker.cjs` that fronts `POST /feedback` in self-hosted mode.

---

## 16. Reference

Auto-export-style reference of every public symbol from the `package.json` `exports` map. Group by subpath. Signatures abbreviated; types live in the source.

### `snapfeed` (main entry)

| Symbol | Kind | Description |
|---|---|---|
| `FeedbackProvider` | component | Root provider; wires hotkey, context, and either `apiUrl` or client-side adapters |
| `FeedbackWidget` | component | The rendered widget shell (mounted inside the provider) |
| `FeedbackButton` | component | Floating trigger button; honors `position` |
| `FeedbackInbox` | component | Triage UI for Supabase-backed inboxes |
| `AnnotationCanvas` | component | Pen / rect / arrow / highlighter overlay |
| `useDevFeedback` | hook | `{ isOpen, open, close, toggle, submit }` |
| `consoleAdapter` | adapter | Local debug only |
| `webhookAdapter` | adapter | Generic HTTPS POST |
| `telegramAdapter` | adapter | Telegram Bot API |
| `slackAdapter` | adapter | Slack incoming webhook |
| `supabaseAdapter` | adapter | Supabase Postgres insert |
| `githubAdapter` | adapter | GitHub Issues |
| `fileAdapter` | adapter | Local JSONL append (Node) |
| `discordAdapter` | adapter | Discord webhook |
| `jiraAdapter` | adapter | JIRA Cloud REST v3 |
| `linearAdapter` | adapter | Linear GraphQL |
| `googleSheetsAdapter` | adapter | Sheets v4 append (Node, service account) |
| `msTeamsAdapter` | adapter | Teams Adaptive Card webhook |
| `asanaAdapter` | adapter | Asana REST v1 |
| `clickUpAdapter` | adapter | ClickUp REST v2 |
| `notionAdapter` | adapter | Notion REST page-in-DB |
| `autoAdapters` | factory | Reads `SNAPFEED_*` env vars, returns the right set |
| `AutoEnvKeys` | constant | Recognized env var keys |
| `defineCampaign` | factory | Identity function for `ReleaseCampaign` type inference |
| `isCampaignActive` | function | `(campaign, now?) → boolean` |
| `getCampaignTags` | function | Tags applied during the campaign window |
| `getCampaignRouting` | function | Routing override for the campaign window |
| `campaignShareUrl` | function | Shareable test URL |
| `defineRouting` | factory | Identity function for `RoutingConfig` |
| `matchUrl` | function | Glob match against pathname |
| `resolveRoute` | function | First-match-wins rule resolution |
| `mergeDestinations` | function | Shallow merge with override-wins |
| `captureScreenshot` | function | `html2canvas`-backed capture |
| `fileToScreenshot` | function | File → `FeedbackScreenshot` |
| `extractImageFromClipboard` | function | Clipboard → `FeedbackScreenshot` |
| `defaultRateLimitStore` | constant | In-memory `RateLimitStore` |
| **types** | | `FeedbackPayload`, `FeedbackUser`, `FeedbackMetadata`, `FeedbackScreenshot`, `FeedbackAdapter`, `FeedbackAdapterResult`, `FeedbackProviderConfig`, `FeedbackContextValue`, `FeedbackHandlerConfig`, `FeedbackPosition`, `FeedbackTheme`, `FeedbackCategory`, `RateLimitStore`, `ReleaseCampaign`, `RoutingConfig`, `RoutingRule`, `RoutingDestination` |

### `snapfeed/adapters`
All of the adapters above plus their per-adapter option types (e.g. `SlackAdapterOptions`, `JiraAdapterOptions`, `LinearAdapterOptions`, `NotionAdapterOptions`, etc.).

### `snapfeed/routing`

| Symbol | Kind | Description |
|---|---|---|
| `defineRouting` | factory | Identity function for `RoutingConfig` |
| `matchUrl` | function | Glob match (`*` = segment, `**` = any depth) |
| `resolveRoute` | function | First-match-wins resolution |
| `mergeDestinations` | function | Shallow merge with override-wins |
| `RoutingConfig`, `RoutingRule`, `RoutingDestination` | types | |

### `snapfeed/routing-sources`

| Symbol | Kind | Description |
|---|---|---|
| `csvRoutingSource` | factory | Reads a CSV file (Node `fs`) |
| `googleSheetsRoutingSource` | factory | Sheets v4 service-account read-only |
| `cacheRoutingSource` | factory | Polling wrapper with `onUpdate` / `onError` and last-known-good fallback |
| `RoutingSource`, `CachedRoutingSource`, `CachedRoutingSourceOptions` | types | |

### `snapfeed/llm`

| Symbol | Kind | Description |
|---|---|---|
| `applyLLM` | function | Main entrypoint; never throws; degrades per feature |
| `createProvider` | factory | Returns the right provider given `LLMConfig`, or `null` if disabled / unsupported |
| `createBudgetTracker` | factory | Daily-token budget tracker |
| `redactForLLM` | function | Pre-LLM regex+entropy redaction |
| `anthropicProvider` | provider | Messages API |
| `openaiProvider` | provider | Chat Completions; also serves Azure OpenAI |
| `ollamaProvider` | provider | Local `/api/generate` |
| `LLMConfig`, `LLMFeatureToggles`, `LLMRunResult`, `LLMProvider`, `LLMProviderName`, `BudgetTracker` | types | |

### `snapfeed/voice`

| Symbol | Kind | Description |
|---|---|---|
| `createVoiceRecorder` | factory | Browser-only `MediaRecorder` wrapper |
| `isVoiceSupported` | function | Runtime feature detect |
| `pickSupportedMimeType` | function | First mime in `preferredMimeTypes` that the browser supports |
| `VoiceClip`, `VoiceRecorder`, `VoiceRecorderOptions` | types | |

### `snapfeed/screen-recording`

| Symbol | Kind | Description |
|---|---|---|
| `createScreenRecorder` | factory | `getDisplayMedia` + `MediaRecorder` wrapper; default 30s cap |
| `isScreenRecordingSupported` | function | Runtime feature detect; false on iOS |
| `ScreenClip`, `ScreenRecorder`, `ScreenRecorderOptions` | types | |

### `snapfeed/storage`

| Symbol | Kind | Description |
|---|---|---|
| `fileStorage` | factory | Node JSONL/file fallback storage |
| `s3Storage` | factory | S3-compatible (AWS S3, R2, B2, MinIO); pure `node:crypto` SigV4 |
| `StorageAdapter`, `StorageUploadInput`, `StorageUploadResult`, `FileStorageOptions`, `S3StorageOptions` | types | |

### `snapfeed/audit-log`

| Symbol | Kind | Description |
|---|---|---|
| `fileAuditLog` | factory | JSONL append; optional `hashReporter` |
| `noopAuditLog` | factory | No-op sink |
| `multiAuditLog` | factory | Fan-out to N sinks; per-sink failures swallowed |
| `AuditEvent`, `AuditLog` | types | Discriminated union over `feedback.received`, `adapter.dispatched`, `llm.called`, `config.changed`, `rate_limit.hit` |

### `snapfeed/network-capture`

| Symbol | Kind | Description |
|---|---|---|
| `installNetworkCapture` | function | Patches `fetch` + `XMLHttpRequest`; returns a `NetworkCapture` handle |
| `NetworkRequestRecord`, `NetworkCapture`, `NetworkCaptureOptions` | types | |

### `snapfeed/campaigns`

| Symbol | Kind | Description |
|---|---|---|
| `defineCampaign` | factory | Identity function for `ReleaseCampaign` type inference |
| `isCampaignActive` | function | `(campaign, now?) → boolean` |
| `getCampaignTags` | function | Auto-tags during the campaign window |
| `getCampaignRouting` | function | Routing override during the window |
| `campaignShareUrl` | function | Shareable test URL |
| `ReleaseCampaign` | type | |

### `snapfeed/server/nextjs`

| Symbol | Kind | Description |
|---|---|---|
| `createFeedbackHandler` | factory | Returns a Next.js App Router `POST` handler |

### `snapfeed/server/express`

| Symbol | Kind | Description |
|---|---|---|
| `feedbackMiddleware` | factory | Returns an Express middleware function |

### `snapfeed/headless`

| Symbol | Kind | Description |
|---|---|---|
| `useFeedbackWidget` | hook | Form state + submit handler |
| `FeedbackRoot`, `FeedbackTrigger`, `FeedbackModal`, `FeedbackTextarea`, `FeedbackCategorySelect`, `FeedbackScreenshotPreview`, `FeedbackSubmitButton`, `FeedbackError`, `FeedbackSuccess` | components | Compound components for full-control UIs |
| `FeedbackHeadless` | component | Render-prop variant |
| `FeedbackComponentsProvider`, `FeedbackComponentsContext`, `useFeedbackComponents` | provider | Slot-based component swaps |
| `UseFeedbackResult`, `WidgetState`, `FeedbackFormState`, `FeedbackFormApi`, `FeedbackComponents` and all per-component prop types | types | |

---

> Document version: v0.5.3 / 2026-04-26. See [`CHANGELOG.md`](../CHANGELOG.md) for what changed.
