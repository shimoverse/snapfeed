# snapfeed

> One-tap feedback for internal dogfooding. See it → tap → talk → done.

[![npm](https://img.shields.io/npm/v/snapfeed.svg)](https://www.npmjs.com/package/snapfeed)
[![license](https://img.shields.io/npm/l/snapfeed.svg)](./LICENSE)
[![CI](https://github.com/shimoverse/snapfeed/actions/workflows/ci.yml/badge.svg)](https://github.com/shimoverse/snapfeed/actions)
[![types](https://img.shields.io/badge/types-built--in-blue)](#)

snapfeed is the feedback widget for the people *inside* your build — testers, employees, peers, beta users. The kind who shouldn't have to pick a category, write a polished description, guess who owns the feature, choose between Slack and JIRA, and format a ticket properly. They press a hotkey, type or talk, hit send. snapfeed handles routing, formatting, and context attachment.

Not an end-customer feedback widget. If you want a public "tell us what you think" form, use Canny. If you want your own team to actually file bugs while they're testing — keep reading.

## Pick your mode

| Mode | For | Setup |
|------|-----|-------|
| 🚀 Cloud-relayed | Indie / hackathon / small startup | 5 min |
| 🏢 Self-hosted | Startup → mid-size | 30 min |
| 🔒 Air-gapped | Corp / regulated | 1-2 weeks (incl. security review) |

Same widget. Different backend topology. Pick based on what your IT will approve.

## 60-second quickstart (zero config)

```bash
npm install snapfeed
npx snapfeed init --yes
npm run dev
```

Press **Ctrl+Shift+F**. Feedback dumps to `./feedback.jsonl` and your browser console. No env vars, no adapters, no signup.

When you're ready to wire a real destination:

```bash
echo 'SNAPFEED_SLACK_WEBHOOK=https://hooks.slack.com/...' >> .env.local
```

Restart. Done. The auto-adapter detects the env var and routes there.

## What it does (the customer journey)

**Reporter — Ananya, designer reviewing a staging build.** She spots a confusing checkbox label on the payment step. Ctrl+Shift+F. Types one sentence, pastes a screenshot, draws a red arrow. Send. She never opened JIRA, never picked a project, never tagged a team.

**PM — Raj, owns checkout.** Two minutes later the bug shows up in `#checkout-feedback` on Slack with screenshot, URL, viewport, and build ID. The same item is a JIRA ticket in his project, pre-labeled `bug` and `checkout`. He didn't file it himself.

**Engineer — Mei, on-call for payments.** Her JIRA ticket already has the console error, the user agent (Firefox 121 / Windows), and a link to the build. No "what browser were you on?" round-trip. She reproduces in five minutes.

**Release manager — Kenji, shipping Friday.** He opens the admin page (or the Slack channel) and sees twelve items from this week's beta cohort. Filters by team, marks four resolved, exports the rest as CSV for the retro. The widget never appeared for end customers — `enableInProduction: false` plus a role check on his side.

## The three modes in detail

### 🚀 Cloud-relayed
For indies, hackathon teams, small startups who want zero infra. Browser → widget → adapter (Slack webhook / GitHub API / Discord webhook) directly. No snapfeed-operated relay. One `npm install`, one env var, restart.

```ts
// app/api/feedback/route.ts
import { createFeedbackHandler } from 'snapfeed/server/nextjs'
import { autoAdapters } from 'snapfeed/adapters'

export const POST = createFeedbackHandler({ adapters: autoAdapters() })
```

### 🏢 Self-hosted
For startups and mid-size teams that want their own database, their own LLM key, no third-party data path. v0.4 ships a Docker compose stack that boots a worker + MinIO (object store) + optional Ollama in one command:

```bash
cd docker
cp .env.example .env
docker compose up
```

Then point the widget at `http://<host>:8787/feedback`. Add `--profile llm` to also start a local Ollama. See [docker/README.md](./docker/README.md). Postgres-backed inbox + admin UI ship in **v0.6**.

For deployments where you'd rather host the worker yourself in your existing Node app:

```ts
// app/api/feedback/route.ts
import { createFeedbackHandler } from 'snapfeed/server/nextjs'
import { supabaseAdapter, slackAdapter } from 'snapfeed/adapters'

export const POST = createFeedbackHandler({
  adapters: [
    supabaseAdapter({
      url: process.env.SUPABASE_URL!,
      serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    }),
    slackAdapter({ webhookUrl: process.env.SLACK_WEBHOOK! }),
  ],
  rateLimit: { max: 10, windowMs: 60_000 },
  allowedOrigins: ['https://staging.myapp.com', /\.myapp\.com$/],
})
```

### 🔒 Air-gapped
For corporates and regulated industries where every new outbound domain needs a security review. v0.4 ships a self-hostable Docker stack: `docker compose -f docker/docker-compose.yml up` runs the worker + MinIO + optional Ollama (`--profile llm`) entirely inside your infrastructure. Pair with `webhookAdapter` pointed at your internal bug tracker, `fileAuditLog` to record every dispatch, and `redactForLLM` before any in-tenant LLM call. See [docker/README.md](./docker/README.md) for the install guide and [SECURITY.md](./SECURITY.md) for the corporate review checklist. Image-digest pinning + signed tarball + SSO/SAML for the admin app ship in **v0.5**.

## Persona picker

| Persona | Most likely destinations | Most likely mode |
|---------|--------------------------|------------------|
| Indie / OSS maintainer | GitHub Issues, Discord, file | Cloud-relayed |
| Startup founder/PM | Slack, Linear, Sheet | Cloud-relayed → Self-hosted |
| Mid-size eng manager | Slack, JIRA, Postgres | Self-hosted |
| Corp eng / QA lead | JIRA, ServiceNow, MS Teams | Air-gapped |
| Designer (any team) | Whatever their team set up | n/a — they just press the hotkey |

## Configuration

### Provider props

```tsx
import { FeedbackProvider } from 'snapfeed'

<FeedbackProvider appName="Checkout" hotkey="ctrl+shift+f">
  {children}
</FeedbackProvider>
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `appName` | `string` | `"App"` | Shown in UI and in adapter notifications |
| `hotkey` | `string` | `"ctrl+shift+f"` | Format: `"ctrl+shift+f"`, `"meta+k"`, `"ctrl+alt+b"` |
| `position` | `"bottom-right" \| "bottom-left" \| "top-right" \| "top-left"` | `"bottom-right"` | Floating trigger position |
| `theme` | `"auto" \| "light" \| "dark"` | `"auto"` | Color theme; `auto` follows system |
| `accentColor` | `string` | `"#D4714B"` | Accent color for buttons and focus rings |
| `adapters` | `FeedbackAdapter[]` | `[]` | Client-side adapters. Skipped when `apiUrl` is in use |
| `apiUrl` | `string` | `"/api/feedback"` | Server route the widget POSTs to (recommended for prod) |
| `collectMetadata` | `boolean` | `true` | Auto-collect viewport, UA, console errors |
| `autoScreenshot` | `boolean` | `false` | Capture screenshot on open via `html2canvas` |
| `enableInProduction` | `boolean` | `false` | Show widget in prod (off by default — safety rail) |
| `user` | `{ name?: string; email?: string }` | — | Reporter identity attached to every submission |
| `onSuccess` | `(payload) => void` | — | Called after successful submission |
| `onError` | `(error) => void` | — | Called when submission fails |

### Identifying the reporter

```tsx
<FeedbackProvider
  appName="Checkout"
  user={{ name: 'Ananya', email: 'ananya@company.com' }}
  buildId={process.env.BUILD_ID}
  gitSha={process.env.GIT_SHA}
  env={process.env.NODE_ENV}
>
  {children}
</FeedbackProvider>
```

> `buildId`, `gitSha`, `env` props remain planned. Today, pass build context inside `user` or via your own metadata layer; first-class top-level props land in **v0.5** alongside the SSO admin work.

### Routing config

Declarative routing lets a PM say "checkout bugs go to Slack #checkout + JIRA CHK; growth flag goes to Linear; praise goes to #kudos" without an engineer touching code per change.

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

> ✅ Shipped in **v0.4** — Tier 2 reads the same table from a Google Sheet / CSV so a PM can edit without a deploy. See `snapfeed/routing-sources`: `csvRoutingSource`, `googleSheetsRoutingSource`, `cacheRoutingSource` (polling wrapper with last-known-good fallback).

### LLM (BYOK, optional)

Every smart feature degrades cleanly without an LLM key. The library works fully without one.

| Feature | With LLM | Without LLM |
|---------|----------|-------------|
| Title write | Auto-generated from voice/text | First 80 chars of text |
| Severity | Inferred | Reporter picks or default |
| Dedup | Embedding similarity | Exact-match in last 7d |
| Repro steps | Extracted from voice + journey | Raw journey trail shown |

```ts
// Planned shape — ships in v0.4
import { defineLLM } from 'snapfeed/llm'

export default defineLLM({
  provider: 'anthropic', // 'anthropic' | 'openai' | 'azure-openai' | 'bedrock' | 'ollama' | 'custom'
  apiKey: process.env.ANTHROPIC_API_KEY!,
})
```

> ✅ Shipped in **v0.4** — `snapfeed/llm` exposes `applyLLM`, `createProvider`, `createBudgetTracker`, and `redactForLLM` with providers for Anthropic, OpenAI (which also covers Azure OpenAI via `endpoint` + `headers`), and Ollama. Voice capture ships at `snapfeed/voice`; screen recording at `snapfeed/screen-recording`.

## Adapters

```ts
import { slackAdapter } from 'snapfeed/adapters'
```

Built-in adapters (alphabetical):

| Adapter | Status | Use it for |
|---------|--------|------------|
| `asanaAdapter` | ✅ v0.4 | Asana task per submission, optional screenshot attachment |
| `autoAdapters` | ✅ v0.3 | Reads `SNAPFEED_*` env vars and wires automatically |
| `clickUpAdapter` | ✅ v0.4 | ClickUp task with per-category priority |
| `consoleAdapter` | ✅ shipped | Local dev, debugging |
| `discordAdapter` | ✅ v0.3 | Indie / community / OSS teams |
| `fileAdapter` | ✅ v0.3 | Local dev, audit log, Node-only |
| `githubAdapter` | ✅ shipped | Bug tracking when you live in GitHub |
| `googleSheetsAdapter` | ✅ v0.3 | Lightweight tracking, non-tech editing |
| `jiraAdapter` | ✅ v0.3 | Mid-size / corporate workflows |
| `linearAdapter` | ✅ v0.3 | Startup / product teams |
| `msTeamsAdapter` | ✅ v0.4 | Adaptive Card via Teams incoming webhook |
| `notionAdapter` | ✅ v0.4 | Notion page in a database, status + category select properties |
| `slackAdapter` | ✅ shipped | Real-time team awareness |
| `supabaseAdapter` | ✅ shipped | Postgres-backed inbox |
| `telegramAdapter` | ✅ shipped | Solo / lightweight notifications |
| `webhookAdapter` | ✅ shipped | Anything else (your own backend) |

### Writing a custom adapter

Adapters implement the `FeedbackAdapter` interface from `src/types.ts`:

```ts
import type { FeedbackAdapter } from 'snapfeed'

export const myAdapter: FeedbackAdapter = {
  name: 'my-adapter',
  async send(payload) {
    await fetch('https://internal.example.com/bugs', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
    return { ok: true, deliveryId: 'optional-id' }
  },
}
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for adapter guidelines and the test harness.

## Auto-adapter env vars

| Env var | Adapter |
|---------|---------|
| `SNAPFEED_SLACK_WEBHOOK` | Slack |
| `SNAPFEED_DISCORD_WEBHOOK` | Discord |
| `SNAPFEED_GITHUB_TOKEN` + `SNAPFEED_GITHUB_REPO` | GitHub Issues (`owner/repo`) |
| `SNAPFEED_TELEGRAM_BOT_TOKEN` + `SNAPFEED_TELEGRAM_CHAT_ID` | Telegram |
| `SNAPFEED_WEBHOOK_URL` | Generic webhook |
| `SNAPFEED_FILE_PATH` | JSONL file |

If none are set in dev, falls back to `[fileAdapter, consoleAdapter]`. In production, returns `[]` and warns once.

## Security

Threat model: "don't let our own widget become the leak." Defaults reflect that.

- Zero phone-home — no telemetry, no analytics, no relay
- Self-hostable, MIT, no CLA
- Secrets stay server-side (use `apiUrl` + `createFeedbackHandler`, not client-side adapters with tokens)
- LLM optional, BYOK only — never proxied through us
- Console-error sanitization strips tokens / keys / JWTs before transit
- Origin allowlist, payload caps, rate limit on the server handler
- See [SECURITY.md](./SECURITY.md) for the corporate review checklist

## Production safety

`enableInProduction` is `false` by default — the widget is a no-op in `NODE_ENV === 'production'` unless you opt in. When you enable it for a beta cohort, gate by role so end customers never see it (this is what Kenji from the journey above relies on):

```tsx
<FeedbackProvider
  enableInProduction={user?.role === 'admin' || user?.isBetaTester}
  user={{ name: user.name, email: user.email }}
  apiUrl="/api/feedback"
>
  {children}
</FeedbackProvider>
```

## Roadmap

| Phase | Cut as | Highlights |
|-------|--------|------------|
| v0.3 | shipped | Hygiene, file/auto/jira/linear/sheets/discord adapters, routing config, CLI, runnable Next.js example |
| v0.4 (this release) | now | MS Teams / Asana / ClickUp / Notion adapters; LLM (BYOK — Anthropic, OpenAI, Azure, Bedrock, Ollama); voice capture; screen recording; storage adapters (file, S3-compatible); spreadsheet-backed routing source (Sheets, CSV); audit log; network capture; Release Campaigns; Docker compose self-host stack; admin Next.js viewer |
| v0.5 |  | Docker compose stack, admin UI (embed + standalone), SSO/SAML, full air-gapped install guide |
| v1.0 |  | React Native SDK, screen recording rewind, network log capture, Release Campaigns, Vue/Svelte clients |

## Examples

- **Next.js**: `examples/nextjs/` — runnable with `npm install && npm run dev`. Uses `autoAdapters()` + env vars.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). We welcome adapters, accessibility fixes, framework ports, and translations.

## Code of conduct

See [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).

## License

MIT. See [LICENSE](./LICENSE).
