# snapfeed — Product Requirements Document

| Field | Value |
|---|---|
| Title | snapfeed — internal-dogfooding feedback library |
| Version | v0.6.0 |
| Owner | shimoverse maintainers (snapfeed contributors) |
| Last updated | 2026-04-26 |
| Status | Shipped — v0.6.0 |
| Source repo | https://github.com/shimoverse/snapfeed |

> This is an internal-quality PRD describing what snapfeed *is*, why it exists, what shipped, and what is deliberately out of scope. It is the artifact a fork should read first, the artifact a security reviewer should read after the THREAT_MODEL, and the artifact a decision-maker should read when asking "why does this library exist and should we adopt it?"

---

## 1. Problem statement

Inside every product team there is a friction loop that quietly degrades the product. A colleague — a designer, a PM, a peer engineer, a beta tester — uses the build-in-progress, sees something off, and is now standing at a fork in the road. They can: (a) take a screenshot, (b) write a description that another human can act on, (c) decide who owns this part of the product, (d) open the right tool (JIRA, Linear, GitHub, Slack, a triage doc), (e) format the ticket so it lands in the right project with the right label, and (f) optionally tag in the right person. End-to-end this costs five to ten minutes per piece of feedback, even for someone who knows the tooling. For the people who *don't* know the tooling — designers without JIRA accounts, executives, contractors, fresh hires in their first week — it is a full block.

The dominant outcome of a five-to-ten-minute cost is that most of the feedback never gets filed. The colleague mutters "huh, that's weird," closes the tab, and moves on. The product team ships with strictly less feedback than it would have gotten if the cost of submitting a piece of feedback were thirty seconds.

snapfeed exists to collapse that loop. The reporter presses a hotkey, types one sentence, optionally annotates a screenshot, and hits send. Routing, contextualization (URL, viewport, console errors, build id, recent network requests), formatting, and dispatch to the right destination(s) (JIRA project, Slack channel, Linear team, etc.) happen after submit, server-side, deterministically. The reporter never picks a category, never picks a project, never picks an owner, never sees a ticketing UI. The receiver gets a fully-contextualized ticket in the tool they already live in.

---

## 2. Why now / why open source

The existing landscape of feedback widgets — Userback, Marker.io, Birdie, Feedbear, Canny, Sentry's user-feedback feature — is built primarily for **end-customer feedback**. Anonymous user submits "I don't understand this page", widget routes to a triage queue or back-channel email, support team picks it up. That is a different shape than internal dogfooding:

- **Identity is known.** Internal testers are signed in. The widget should attach `user.email` automatically; there is no "captcha and email confirmation" step.
- **GDPR doesn't apply** the same way. The data subjects are employees / contracted testers, not consumers; the lawful basis is legitimate interest in operating the product, not consent banners.
- **The destination is JIRA / Linear / Slack / GitHub Issues**, not a vendor-hosted inbox. Internal teams already triage in those tools. A new inbox is a new tool to ignore.
- **The receiver is engineering.** They want stack traces, console errors, viewport, build id, git sha — context an end-customer would never know how to provide. The widget should *collect that automatically*, not ask the reporter to type it.
- **Self-hosting is table stakes** for any company with a real security team. Cloud-only feedback vendors get blocked at the point where IT asks "where does the screenshot get stored?"

Existing tools force you to retrofit them for internal use: turn off the customer-facing flows you don't need, configure a webhook that approximates "JIRA ticket", explain to security why screenshots leave the building. snapfeed is shaped for the internal use case from the start.

The library is **open source (MIT)** for two reasons. First, adoption depends on security review, and proprietary code-can't-self-host vendors get blocked at corp. A library a security team can audit line-by-line removes that block. Second, no CLA, no enterprise tier, no upsell — the trust posture is "you can fork this and we lose nothing." That posture is the product. Anything that compromises it (a hosted relay, a telemetry endpoint, a paid-only feature) compromises the product.

---

## 3. Personas

Six personas. Two are *installers* (mid-size eng manager, corp eng/QA lead), one is a *founder-installer* (startup PM/founder), one is *both installer and primary user* (indie / OSS maintainer), one is a *consumer* (designer), and one is a *gatekeeper* (security engineer). Each is pulled from the matching quickstart guide.

### 3.1 Indie dev / OSS maintainer
- **Role.** Solo dev or two-person team shipping a side project, hackathon prototype, or OSS docs site.
- **Pains.** No infra budget. No DevOps. Doesn't want to operate yet another service. Needs *a way for early users to tell them about bugs without filing a GitHub issue*.
- **Success criteria.** `npm install snapfeed`, paste one env var (`SNAPFEED_GITHUB_TOKEN` + repo), `Ctrl+Shift+F` opens an issue. Five minutes total.
- **Quickstart.** [`docs/quickstart/indie.md`](./quickstart/indie.md).

### 3.2 Startup founder / PM
- **Role.** Founder or PM at a 5–50 person company. Ships weekly. Has a beta cohort of customers and an internal testing team.
- **Pains.** Pre-product-market-fit; every beta tester report counts. JIRA is overkill; Linear or a Slack channel is the actual triage surface. Wants different signals to land in different places (`/checkout/**` → payments, `/dashboard/**` → growth).
- **Success criteria.** Slack + Linear wired in 30 min. Routing config a PM can edit. No new infra to run.
- **Quickstart.** [`docs/quickstart/startup.md`](./quickstart/startup.md).

### 3.3 Mid-size eng manager
- **Role.** Engineering manager / staff engineer at a 50–500 person company. Owns "the dogfooding program."
- **Pains.** Needs JIRA, an audit log, an admin viewer, and a self-hosted backend their security team will sign off on. LLM features are interesting but only if BYOK and in-tenant. Needs to scale past five testers without losing triage.
- **Success criteria.** Self-hosted Docker stack runs in their VPC; routing wired per-team; SLA + steward in place; LLM-generated titles + severity if budget allows.
- **Quickstart.** [`docs/quickstart/midsize.md`](./quickstart/midsize.md).

### 3.4 Corp eng / QA lead
- **Role.** Engineering / QA / IT lead at a Fortune 500 or regulated industry (healthcare, finance, gov).
- **Pains.** Every outbound domain needs review. LLM provider choice matters for compliance (BAA, region, residency). Needs SBOM, audit log to SIEM, MFA on admin, image-digest pinning. Procurement timeline measured in weeks, not days.
- **Success criteria.** Air-gapped Docker stack, in-tenant Ollama, JIRA via internal proxy, audit log shipped to SIEM, `redactBeforeLLM` enabled.
- **Quickstart.** [`docs/quickstart/corp.md`](./quickstart/corp.md).

### 3.5 Designer (consumer of widget)
- **Role.** Designer reviewing a build. Doesn't have JIRA, doesn't want JIRA, can't be expected to know which team owns what.
- **Pains.** Currently sends Slack DMs to the eng lead with screenshots. Half get lost. The other half lose context by the time they're triaged.
- **Success criteria.** Press Ctrl+Shift+F, type one sentence, hit send. Never sees JIRA. Knows the right team got it because they get a follow-up in Slack.
- **Quickstart.** [`docs/quickstart/designer.md`](./quickstart/designer.md).

### 3.6 Security engineer (reviewer)
- **Role.** Application security engineer reviewing snapfeed before adoption. Reads source, runs SBOM diff, looks for outbound calls.
- **Pains.** Most third-party widgets phone home. Most have telemetry endpoints they don't disclose. Most LLM integrations send entire payloads to a vendor.
- **Success criteria.** Confirms zero phone-home, confirms BYOK LLM, confirms in-tenant Ollama supported, confirms audit log primitive, confirms redaction primitive, confirms self-host Docker stack with no required cloud. Approves with conditions documented in `THREAT_MODEL.md` residual risks.
- **Quickstart.** Read [`SECURITY.md`](../SECURITY.md), [`THREAT_MODEL.md`](../THREAT_MODEL.md), [`PRIVACY.md`](../PRIVACY.md), [`COMPLIANCE.md`](../COMPLIANCE.md) in that order.

---

## 4. Goals & non-goals

### 4.1 Goals
- **Thirty-second tester loop.** Hotkey → type → send. No JIRA UI, no project picker, no owner picker.
- **One tap → routed → contextualized.** Server-side routing decides destination(s); the widget attaches URL, viewport, UA, console errors, build context automatically.
- **Passes corporate security review.** Zero phone-home, MIT license, self-hostable end-to-end, SBOM-able, LLM optional and BYOK.
- **Works air-gapped.** The Docker stack (`docker/docker-compose.yml`) runs offline. Ollama profile gives in-tenant LLM. Nothing requires an outbound call snapfeed itself originates.
- **LLM-optional with in-tenant providers.** Every smart feature degrades to a deterministic non-LLM fallback. Anthropic, OpenAI, Azure OpenAI, Bedrock, Ollama supported.
- **Fork-friendly.** MIT, no CLA. `package.json` `files` array ships docs that survive a fork. The codebase intentionally minimizes runtime dependencies (zero hard runtime deps; `html2canvas` is an optional peer).

### 4.2 Non-goals
- **End-customer feedback widget.** Not a Canny / Feedbear replacement. If you want a public "tell us what you think" form on your marketing site, snapfeed is the wrong tool.
- **Support ticketing system.** No SLA tracking, no agent assignment, no customer reply-back. snapfeed dispatches to a tracker; the tracker is the system of record.
- **NPS / CSAT surveys.** No score collection, no trend dashboards. Use a survey tool.
- **Replacing your bug tracker.** snapfeed is a *front-end* to your existing tracker. JIRA / Linear / GitHub Issues remain the system of record.
- **Hosted SaaS.** There is no snapfeed cloud. There will not be a snapfeed cloud. (See decision log §11.)
- **Vendor-locked LLM.** No "snapfeed AI" tier. BYOK only. The LLM provider is the consumer's choice.
- **End-to-end encryption between widget and destination.** The destinations the consumer chose (Slack, JIRA, etc.) see plaintext; encrypting between widget and handler adds complexity without changing the trust boundary.

---

## 5. Success metrics

Tracked on a rolling basis from the public v0.5.x launch.

### 5.1 Adoption
- **100 GitHub stars by day 30.**
- **1,000 GitHub stars by day 90.**
- **10,000 GitHub stars by day 365.**

### 5.2 Activation
- **50 production installs by day 30.** Signal: an install that *receives at least one feedback per week for four consecutive weeks*. (Inferred from voluntary adopter-list sign-ups + GitHub install-graph + community Discord pings; we run no telemetry, so this is a soft signal.)

### 5.3 Quality
- **Fewer than three critical bugs reported per month** at v0.4–v0.5. "Critical" = data loss, secret leak, or widget appearing in production for end customers without explicit opt-in.
- **Greater than 90% test pass rate on PRs.** v0.4 baseline: 270+ tests across 30+ files, all passing.

### 5.4 Community
- **10+ external contributors with merged PRs by day 90.**
- **5+ community-contributed adapters by day 90.** Templates: ServiceNow, Pagerduty, Zendesk, Freshdesk, Trello.

### 5.5 Security
- **Passes a SOC 2-prep audit at one Fortune 500** by day 180. Signal: a public adopter case study or an unsolicited "we approved this in our internal review" mention.

---

## 6. MVP scope (what shipped in v0.3 and v0.4)

### 6.1 Shipped — v0.3
- React widget (`<FeedbackProvider>`, `<FeedbackWidget>`, `<FeedbackButton>`, `<FeedbackInbox>`, `<AnnotationCanvas>`, `useDevFeedback`).
- Hotkey activation; default `ctrl+shift+f`; configurable.
- `html2canvas`-backed screenshot, paste, drag-drop, file picker.
- Annotation layer (pen, rectangle, arrow, highlighter; undo; 5-color palette).
- Server handlers: `createFeedbackHandler` (Next.js App Router) and `feedbackMiddleware` (Express).
- Server hardening: per-IP sliding-window rate limit (in-memory + pluggable `RateLimitStore`), payload size validation, origin allowlist, console-error redaction (`SECRET_PATTERNS` strips token / key / secret / password / bearer / Authorization / JWT shapes).
- Adapters: `consoleAdapter`, `webhookAdapter`, `slackAdapter`, `telegramAdapter`, `supabaseAdapter`, `githubAdapter`, `discordAdapter`, `fileAdapter`, `jiraAdapter`, `linearAdapter`, `googleSheetsAdapter`, `autoAdapters` (env-var-driven).
- `defineRouting()` (Tier 1 — file-based config).
- `npx snapfeed init` CLI scaffolder.
- Runnable Next.js example at `examples/nextjs/`.
- Hygiene: `LICENSE` (MIT), `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `CHANGELOG.md`, `.nvmrc` (Node 20), CI workflow, PR + issue templates.

### 6.2 Shipped — v0.4
- **New adapters.** `msTeamsAdapter`, `asanaAdapter`, `clickUpAdapter`, `notionAdapter`.
- **LLM (BYOK).** `snapfeed/llm` subpath with `applyLLM`, `createProvider`, `createBudgetTracker`, `redactForLLM`. Providers: `anthropicProvider`, `openaiProvider` (also serves Azure OpenAI), `ollamaProvider`. Per-feature toggles (`title`, `severity`, `repro`, `redact`); each falls back deterministically when disabled / budget hit / network fail.
- **Voice + Screen recording.** `snapfeed/voice` (`createVoiceRecorder`, `isVoiceSupported`, `pickSupportedMimeType`); `snapfeed/screen-recording` (`createScreenRecorder`, `isScreenRecordingSupported`).
- **Storage.** `snapfeed/storage` (`fileStorage`, `s3Storage` — works with AWS S3, Cloudflare R2, Backblaze B2, MinIO; pure `node:crypto` SigV4 signing).
- **Routing — Tier 2.** `snapfeed/routing-sources` (`csvRoutingSource`, `googleSheetsRoutingSource`, `cacheRoutingSource` polling + last-known-good).
- **Audit log.** `snapfeed/audit-log` (`fileAuditLog`, `noopAuditLog`, `multiAuditLog`; discriminated `AuditEvent` union: `feedback.received`, `adapter.dispatched`, `llm.called`, `config.changed`, `rate_limit.hit`).
- **Network capture.** `snapfeed/network-capture` (`installNetworkCapture`; ring buffer of last N requests; origin redaction; ignoreUrls).
- **Release Campaigns.** `snapfeed/campaigns` (`defineCampaign`, `isCampaignActive`, `getCampaignTags`, `getCampaignRouting`, `campaignShareUrl`).
- **Self-hosted Docker stack.** `docker/docker-compose.yml` runs `worker` + `minio` services; optional `--profile llm` adds Ollama. Multi-stage `node:20-alpine`, runs as non-root.
- **Examples — admin.** `examples/admin/` Next.js app reading the JSONL `fileAdapter` writes; search + filter + click-to-expand row with screenshot rendering. Read-only.

### 6.3 Explicitly out of scope of v0.4 (deferred)
- Postgres-backed inbox (v0.6).
- Admin app with write-back (resolve, assign) (v0.5–0.6).
- SSO / SAML for the admin app (v0.5).
- SBOM artifact per release (v0.5).
- Image-digest pinning in `docker-compose.yml` (v0.5).
- `retentionDays` config + `deleteByUserId()` API (v0.5).
- React Native SDK (v1.0).
- Vue / Svelte / Solid widget ports (v1.0; community contributions welcome).

---

## 7. Roadmap

Quarter targets, not exact dates. We do not promise dates we can't keep.

| Phase | Cut as | Target | Highlights |
|---|---|---|---|
| v0.3 | shipped | — | Hygiene, adapter coverage (file/auto/jira/linear/sheets/discord), routing config, CLI, Next.js example |
| v0.4 | shipped | — | MS Teams / Asana / ClickUp / Notion adapters; LLM (BYOK); voice; screen recording; storage adapters; spreadsheet-backed routing source; audit log; network capture; Release Campaigns; Docker stack; admin viewer example |
| v0.5 | next | Q3 2026 target | SSO/SAML for admin app; image-digest pinning; SBOM per release; `retentionDays` + `deleteByUserId()`; full WCAG 2.1 AA audit + remediation; Remix / Vite first-class examples; WORM-backed audit sink template |
| v0.6 | after | Q4 2026 target | Postgres-backed inbox; admin app write-back (resolve, assign, comment); admin app standalone deployable separately from the npm package; multi-instance worker (rate limit shared via Redis docs); pinned digests in compose by default |
| v1.0 | longer-term | 2027 | React Native SDK (bare RN minimum; Expo plugin if community contributes); Vue / Svelte / Solid widget ports; Release Campaigns UX in admin app; screen recording rewind UX |

---

## 8. Architecture summary

> Full architecture document: see [`ARCHITECTURE.md`](./ARCHITECTURE.md) (sibling document; covers internal module graph, data shapes, and request flow).

snapfeed ships as a single npm package with **subpath imports** (`snapfeed`, `snapfeed/adapters`, `snapfeed/llm`, `snapfeed/voice`, `snapfeed/screen-recording`, `snapfeed/storage`, `snapfeed/routing`, `snapfeed/routing-sources`, `snapfeed/audit-log`, `snapfeed/network-capture`, `snapfeed/campaigns`, `snapfeed/server/nextjs`, `snapfeed/server/express`). Subpaths exist so the React-only browser bundle does not pull in Node-only modules (`fs/promises`, `node:crypto` for SigV4) and so consumers tree-shake what they don't use.

Three deployment modes share the same widget, distinguished by where the server handler lives and what destinations it dispatches to:

1. **Cloud-relayed** — browser → consumer's Next.js / Express handler → adapters call third-party APIs (Slack webhook, GitHub REST, etc.) directly. Zero infra beyond the consumer's existing app.
2. **Self-hosted** — browser → `docker/docker-compose.yml` worker on the consumer's VPC → adapters + MinIO storage + optional Ollama LLM.
3. **Air-gapped** — same as self-hosted but with no outbound internet egress; in-tenant Ollama for LLM; webhooks point to the consumer's internal bug tracker.

Three cross-cutting layers run end-to-end in every mode:

- **UI layer** — React widget (`<FeedbackProvider>` + `<FeedbackWidget>`); subpath modules for voice and screen recording; headless components (`snapfeed/headless`) for consumers who want to bring their own UI shell.
- **Routing layer** — `defineRouting()` (Tier 1, file config) + `snapfeed/routing-sources` (Tier 2, sheet/CSV with polling + last-known-good); URL-glob, feature-flag, and category matching.
- **Destinations layer** — adapter contract (`FeedbackAdapter.send(payload) → FeedbackAdapterResult`); 16 built-in adapters; storage adapters (`fileStorage`, `s3Storage`) for media; audit log primitive recording every dispatch.

---

## 9. Competitive landscape

Honest comparison. Where snapfeed has a gap relative to a competitor, that gap is called out.

| | **snapfeed** | Userback | Marker.io | Birdie | Sentry user feedback |
|---|---|---|---|---|---|
| Target user | **Internal** dogfooders | End customers (and internal) | Internal QA | Internal | End customers reporting errors |
| Self-hostable | **Yes** (Docker + MinIO + Ollama) | No | No | No | Yes (Sentry self-hosted) |
| BYOK LLM | **Yes** (Anthropic / OpenAI / Azure / Bedrock / Ollama) | Vendor LLM | No (some AI features, vendor) | No | No |
| In-tenant LLM (Ollama) | **Yes** | No | No | No | No |
| Cost | **Free, MIT, no CLA** | $74–$390+/mo | $59–$299+/mo | Pricing on request | Bundled with Sentry |
| Audit log | **Yes** (`fileAuditLog`, `multiAuditLog`, custom) | Vendor-side | Vendor-side | Vendor-side | Sentry's own audit log |
| Code-routable (config-as-code) | **Yes** (`defineRouting`) | UI-config | UI-config | UI-config | UI-config |
| PM-editable routing | **Yes** (Sheets/CSV via `routing-sources`) | UI | UI | UI | UI |
| Hosted SaaS option | **No** (deliberate) | Yes | Yes | Yes | Yes |
| Mobile (RN) | **No** (community port welcome; v1.0) | Yes (limited) | Web only | Web only | Yes |
| Open source | **Yes** (MIT) | No | No | No | Yes (BSL) |
| End-customer feedback (anon, captcha, etc.) | **No** (deliberate) | Yes | Partial | Partial | Yes |
| Survey / NPS | **No** (deliberate) | Yes | No | No | No |

**Honest gaps:**
- snapfeed has no mobile widget. If your testers report from RN apps, snapfeed cannot help in v0.4.
- snapfeed has no hosted option. If your team has no Docker, no Vercel/Netlify, no infra at all, snapfeed in self-hosted mode is too much. Cloud-relayed mode mitigates this for indie/startup use, but it still requires an existing app to install into.
- snapfeed has no triage UX yet. The admin example is read-only. If you need an inbox with assign / resolve / comment, snapfeed is a v0.6 product, not a v0.4 product.

---

## 10. Risks & mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Small maintainer team — bus factor | High | Open governance documented in `CONTRIBUTING.md`; encourage co-maintainers from external contributors with merged PR history; MIT + no-CLA so a fork is always viable |
| Third-party API churn (JIRA REST v3, Linear GraphQL, Slack webhooks, etc.) | Medium | Per-adapter test coverage (`vitest`); adapter contract (`FeedbackAdapter.send → FeedbackAdapterResult`) is intentionally tiny so churn is contained inside one file; CHANGELOG records per-adapter compatibility breakage |
| LLM provider lock-in (consumer ties to one vendor) | Medium | BYOK + multi-provider (`anthropic`, `openai`, `azure-openai`, `bedrock`, `ollama`, `custom`); Ollama path gives full locality and no vendor at all |
| Privacy regression in a future release (e.g. someone adds telemetry "to help us improve") | High | Explicit non-changes called out in `SECURITY.md` ("What snapfeed does NOT do") and `PRIVACY.md` ("Telemetry: zero. None. Ever."); any change to that posture requires a major version bump and an explicit changelog entry |
| Supply-chain attack on snapfeed npm publish | High | Pinned `package-lock.json`; zero hard runtime deps; CI runs `npm audit`; SBOM artifact per release shipping in v0.5; consumers should pin to specific version + integrity hash in their lockfile |
| Adapter token leak via misuse (consumer mis-wires server-only adapter on client) | Medium | All README + docker README + CLI scaffolder examples use `apiUrl` + `createFeedbackHandler()` (server-side); LLM module documented as server-side-only at the top of `src/llm/index.ts` |
| Reporter pastes secrets into feedback text | Medium | `redactForLLM` strips emails / CC-shape / JWT / high-entropy tokens before any LLM call; `sanitizeConsoleError` strips `token=` / `key=` / `Authorization` / JWT-shape from console errors before adapter dispatch; reporter education (PLAYBOOK §"common objections") |
| Screenshot of secrets visible on screen | Medium | No technical fix — the widget shows a preview pane before send so the reporter can discard; documented in tester onboarding guidance |

---

## 11. Decision log

Key architectural decisions that someone forking the codebase should understand.

### 11.1 Why React-only for v0.x
Smaller surface area to maintain while the API stabilizes. Vue / Svelte / Solid ports are deferred to v1.0 and welcomed as community contributions — the widget UI is a self-contained component tree and a port is a contained piece of work, but multiplying frameworks before the API is stable multiplies the cost of every API change.

### 11.2 Why subpath imports (`snapfeed/llm`) instead of one fat import
- **Bundle size.** The browser bundle should not pull in Node-only modules (`node:crypto` for AWS SigV4, `fs/promises` for `fileAdapter`).
- **Tree-shaking.** Consumers using only `slackAdapter` should not pay for the LLM scaffolding.
- **Server-side enforcement.** The `snapfeed/llm` subpath documents at the top of `src/llm/index.ts` "Server-side only. Do NOT import this file from any browser bundle." Subpaths make the boundary explicit instead of relying on a `'use server'` annotation.

### 11.3 Why JSONL audit log instead of SQLite (or Postgres)
- **Simpler self-host.** A JSONL file requires no schema, no migration, no dependency. Single-instance self-hosted deployments can grep it.
- **Tooling compatibility.** JSONL is the native input format for `jq`, Vector, Fluent Bit, Datadog Logs, CloudWatch Logs, Splunk. The audit log slots into existing log pipelines without ceremony.
- **Pluggable contract.** The `AuditLog` interface is intentionally minimal (`record(event)`); consumers can implement Postgres / OpenTelemetry / SIEM-direct sinks behind the same interface. Postgres-backed inbox storage is on the v0.6 roadmap; the audit log primitive shipped in v0.4 to unblock SOC 2 / HIPAA conversations.

### 11.4 Why no hosted SaaS
- **Security review blocker.** A hosted SaaS would put snapfeed maintainers in the data path. The trust model is "the maintainers see nothing" — that is the entire pitch to corp security.
- **Trust model.** There is no upgrade path from "you can audit the source and run it yourself" to "you also need to trust our hosted service" without breaking the trust model.
- **Cost / sustainability.** A free MIT library is sustainable on contributor time. A hosted service is not.

### 11.5 Why no end-to-end encryption between widget and handler
The destinations the consumer chose (Slack, JIRA, GitHub Issues) see plaintext anyway. Encrypting between widget and consumer's handler adds key-management complexity (where does the decryption key live? rotation? compromise?) without changing the trust boundary — the consumer's handler must see plaintext to dispatch to plaintext destinations. TLS termination in front of `/feedback` (the consumer's existing ingress / load balancer) is the right layer.

---

## 12. Open questions

Honest list of things still being debated. None of these block v0.4 launch; all of these are decisions to make before v1.0.

### 12.1 Postgres backend in v0.5 vs v0.6?
**Currently parked at v0.6.** Argument for v0.5: corp adopters want it sooner; JSONL doesn't scale beyond one worker. Argument for v0.6: schema design + migration story is a chunk of work that risks slipping v0.5; v0.5's main job is SSO + SBOM + accessibility audit (security review unblockers), and Postgres can wait until those land.

### 12.2 Should the admin app eventually be a separate package vs. an example?
**Currently an example (`examples/admin/`).** Argument for separate package: the admin app has its own auth model, its own deployment surface, its own dependency tree (Next.js); shipping it as `snapfeed-admin` lets it version independently. Argument against: separate packages mean two repos to maintain, two CI pipelines, two release cadences; staying as `examples/admin/` lets a fork copy it once and own it. Decision likely tied to v0.6 when write-back lands.

### 12.3 Mobile (React Native) — bare RN vs Expo plugin?
No decision. The widget assumes DOM APIs (`html2canvas`, `MediaRecorder`); a React Native port is a substantial reimplementation, not a port. Expo plugin is more discoverable but ties to Expo's release cadence; bare RN is more flexible but more setup. Likely answer is "both, eventually, contributed by the community." Tracked for v1.0.

### 12.4 Telemetry — do we ever want anonymous usage stats?
**Current decision: NO. Ever.** This is the third-rail of the product. Adding "anonymous" telemetry would: (a) violate the explicit promise in `PRIVACY.md`, (b) trigger a major version bump per the changelog policy, (c) compromise the security-review story (consumers would need to allowlist the telemetry endpoint), (d) put the project on a slope toward the same posture as the vendors snapfeed exists to displace. The closest acceptable workaround is *opt-in* adopter sign-ups (a CLI command that posts an install ping if and only if the consumer explicitly opts in); even that is parked indefinitely.

---

## Document version history

| Version | Date | Author | Notes |
|---|---|---|---|
| 0.4.0 | 2026-04-26 | snapfeed maintainers | Initial PRD aligned to v0.4.0 launch. Pulls problem framing from internal positioning, persona set from the six quickstart guides, scope from the v0.3 + v0.4 CHANGELOG entries, roadmap from the README roadmap table. Replaces ad-hoc internal positioning notes. |

> Future revisions: bump the version field at the top, append a row here, summarize the diff in one line.
