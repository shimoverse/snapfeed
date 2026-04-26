# Changelog

All notable changes to snapfeed are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.0] — 2026-04-26

### Added — Customization layer
- `snapfeed/theme` subpath: `lightTheme`, `darkTheme`, `themeToCss`, `extendTheme`, `SnapfeedTheme`. Pure-data tokens exposed as `--snapfeed-*` CSS variables so consumers can override accent / radii / spacing / fonts without touching React. Re-exported from the main `snapfeed` entry too.
- `snapfeed/headless` subpath: compound components (`FeedbackRoot`, `FeedbackTrigger` with Radix-style `asChild`, `FeedbackModal`, `FeedbackTextarea`, `FeedbackCategorySelect`, `FeedbackScreenshotPreview`, `FeedbackSubmitButton`, `FeedbackError`, `FeedbackSuccess`), render-prop (`FeedbackHeadless`), slot-swap provider (`FeedbackComponentsProvider` + `useFeedbackComponents`), and the `useFeedbackWidget` hook for fully custom UIs.

### Added — Admin dashboard upgrade
- `examples/admin/` substantially upgraded: filters by date range / category / status / reporter / page URL / has-screenshot / campaign / search; bulk actions (mark triaged / resolved / wontfix); CSV export of filtered set; local-storage saved views.
- New Dashboard view (`/dashboard`) with metrics: total feedback by week, breakdown by category and status (inline SVG charts — bar / donut / sparkline), top reporters, top page URLs, mean time-to-triage trend, active campaigns.
- New Audit view (`/audit`) listing the last 200 audit events with type filter and JSON expansion.
- `lib/auth.ts` placeholder middleware for SSO wire-up (`x-snapfeed-admin-user` header from your reverse proxy or `SNAPFEED_ADMIN_BYPASS=1` for dev).
- `lib/data.ts` with sidecar pattern: status updates write to `feedback-status.jsonl`; the immutable adapter-written `feedback.jsonl` stays untouched. Last-write-wins concurrency (Postgres backend in v0.6).
- `POST /api/admin/feedback/[id]` endpoint for status / notes updates with role check.

### Added — Documentation pack
- `PRIVACY.md`, `THREAT_MODEL.md`, `COMPLIANCE.md`, `COMPATIBILITY.md`, `VERSIONING.md`, `SUPPORT.md`, `RELEASE.md`, `CITATION.cff`.
- `legal/DPA-template.md`, `legal/THIRD_PARTY_NOTICES.md`.
- `docs/quickstart/` — six per-persona walkthroughs (indie, startup, mid-size, corp, OSS-maintainer, designer) — copy-paste runnable.
- `docs/PRD.md` — internal-quality product requirements doc.
- `docs/PLAYBOOK.md` — 30/60/90 day rollout playbook for adopters.
- `docs/MANUAL.md` — full reference manual (~60 KB) covering concepts, installation, configuration, every adapter, routing, LLM, voice/screen, server handler, customization, deployment, operations, migration, troubleshooting (30+ entries), FAQ, glossary, full API reference.
- `docs/ARCHITECTURE.md` — system architecture with 20 Mermaid diagrams (modes, trust boundaries, threat surface, sequence diagrams, state machines, class diagrams, build pipeline, bundle budget, mindmap of public API).
- `docs/SECURITY_REPORT.md` — third-party-style audit deliverable with 13 numbered findings (1 High in dev-deps, 0 Medium, 2 Low — both fixed in this release, 10 Info).
- `docs/SECURE_DEPLOYMENT.md` — operator hardening guide.
- `docs/customization.md` — three levels of customization (CSS vars, compound components, headless).

### Added — Quality gates and tooling
- ESLint flat config with typescript-eslint, React, react-hooks, jsx-a11y, import, security plugins.
- Prettier config + ignore.
- size-limit budget per subpath.
- 184 new edge-case tests (network failures, auth failures, rate limit / 5xx, malformed payloads, LLM failure modes, budget clock, server handler edge cases, redact corner cases).
- New `vite-react/` and `remix/` example apps alongside the existing `nextjs/` and `admin/`.

### Fixed
- F-002: `telegramAdapter` non-2xx error string now includes the HTTP status code (`Telegram sendMessage failed (HTTP 503): ...`). Previously the status was dropped and only the body bled through.
- F-003: `redactForLLM` no longer false-positives on macOS temp paths (e.g. `/var/folders/.../T/foo` was being swallowed by `[HIGH_ENTROPY]`). Heuristic now skips any string containing `/` or `\` path separators.

### Changed
- Bumped to v0.5.0 (significant new public surface: `snapfeed/theme`, `snapfeed/headless`).
- `tsup.config.ts` adds `theme` and `headless/index` entries (16 build entries total).
- `package.json` `exports` adds `./theme` and `./headless` subpaths.
- `package.json` `files` array now ships PRIVACY.md, THREAT_MODEL.md, COMPLIANCE.md, COMPATIBILITY.md, VERSIONING.md, SUPPORT.md, docs/MANUAL.md, docs/PLAYBOOK.md, docs/ARCHITECTURE.md, docs/SECURITY_REPORT.md, docs/customization.md, docs/quickstart/, legal/ — so security teams can read offline after `npm install`.
- README adds prominent links to all new docs in a "Documentation" section; Customization section linking to the three levels of customization.
- SECURITY.md cross-links to all related security/privacy/compliance docs and to the new audit report and hardening guide.

## [0.4.0] — 2026-04-26

### Added — adapters
- `msTeamsAdapter` — Microsoft Teams via incoming webhook, posts an Adaptive Card with per-category accents and optional AAD user mentions.
- `asanaAdapter` — Asana REST v1; creates a task in a project, attaches screenshot via multipart.
- `clickUpAdapter` — ClickUp REST v2; creates a task in a list, per-category priority map (urgent/high/normal/low).
- `notionAdapter` — Notion REST; creates a page in a database with title/category/status select properties; embeds screenshot as a data-URI image block when ≤1 MB.

### Added — LLM (BYOK, optional)
- `snapfeed/llm` subpath: `applyLLM`, `createProvider`, `createBudgetTracker`, `redactForLLM`.
- Providers: `anthropicProvider` (Messages API), `openaiProvider` (Chat Completions; also serves Azure OpenAI via `endpoint` + `headers`), `ollamaProvider` (local `/api/generate`).
- Per-feature opt-in toggles: `title`, `severity`, `repro`, `redact`. Every feature falls back to a deterministic non-LLM behavior when disabled or when the daily token budget is exhausted.
- Pre-LLM redaction: `redactForLLM` strips emails, credit-card-shaped digits, JWTs, and high-entropy tokens before the prompt is sent.

### Added — Voice + Screen recording
- `snapfeed/voice` — `createVoiceRecorder`, `isVoiceSupported`, `pickSupportedMimeType`. Browser-only `MediaRecorder` wrapper; auto-stop, mic release on stop/cancel.
- `snapfeed/screen-recording` — `createScreenRecorder`, `isScreenRecordingSupported`. Browser-only `getDisplayMedia` + `MediaRecorder` wrapper; default 30s max duration; correctly parses data URLs whose MIME contains codec parameter commas.

### Added — Storage
- `snapfeed/storage` subpath: `fileStorage` (Node JSONL/file fallback) and `s3Storage` (S3-compatible — works with AWS S3, Cloudflare R2, Backblaze B2, MinIO; pure `node:crypto` AWS SigV4 signing, zero new runtime deps).

### Added — Routing sources (Tier 2, non-dev editing)
- `snapfeed/routing-sources` subpath: `csvRoutingSource` (Node fs read), `googleSheetsRoutingSource` (service-account JWT, read-only scope), `cacheRoutingSource` (polling wrapper with last-known-good fallback and `onUpdate`/`onError` hooks).

### Added — Audit log
- `snapfeed/audit-log` subpath: `fileAuditLog` (JSONL append, optional reporter hashing), `noopAuditLog`, `multiAuditLog`. Discriminated `AuditEvent` union covering `feedback.received`, `adapter.dispatched`, `llm.called`, `config.changed`, `rate_limit.hit`.

### Added — Network capture
- `snapfeed/network-capture` subpath: `installNetworkCapture` patches `window.fetch` + `XMLHttpRequest` and records the last N requests with method/url/status/duration. Origin redaction via `redactOrigins`, `ignoreUrls` skip-list, ring buffer.

### Added — Release Campaigns
- `snapfeed/campaigns` subpath: `defineCampaign`, `isCampaignActive`, `getCampaignTags`, `getCampaignRouting`, `campaignShareUrl`. Time-bound dogfooding sessions with optional feature-flag filter and routing override.

### Added — Self-hosted Docker stack
- `docker/docker-compose.yml` with `worker` + `minio` services and an optional `ollama` profile.
- `docker/Dockerfile` multi-stage build on `node:20-alpine`, runs as non-root.
- `docker/worker.cjs` — zero-runtime-dep Node http server wiring `autoAdapters` + `fileAuditLog` + `fileStorage` through `feedbackMiddleware`. Exposes `GET /healthz` and `POST /feedback`.
- `docker/.env.example`, `docker/README.md`, `docker/.dockerignore`.

### Added — Examples
- `examples/admin/` — runnable Next.js app that reads a JSONL feedback file (the format `fileAdapter` writes), supports search, category filter, click-to-expand row with screenshot rendering. Read-only; write-back planned for v0.6.

### Changed
- Bumped to v0.4.0.
- Refreshed package.json description and keywords (asana, clickup, notion, microsoft-teams, llm, byok, anthropic, openai, ollama, bedrock, voice-feedback, release-campaigns, audit-log).
- New `tsup.config.ts` entries: `llm`, `voice`, `screen-recording`, `storage`, `routing-sources`, `audit-log`, `network-capture`, `campaigns`.
- New `package.json` `exports` entries for each of the above subpaths.
- Re-exported `defineCampaign`, `isCampaignActive`, `getCampaignTags`, `getCampaignRouting`, `campaignShareUrl`, `ReleaseCampaign` from the main `snapfeed` entry (campaigns are isomorphic).

### Tests
- 270+ tests passing across 30+ files. New coverage for every adapter, the LLM scaffolding (budget, redact, providers, runner with degradation paths), voice, screen recording, storage (file + S3 sigv4 shape), routing sources (csv, google sheets, cache wrapper), audit log, network capture, release campaigns, and the docker worker.

## [0.3.0] — 2026-04-26

### Added
- `LICENSE` file (MIT) — previously declared in package.json but no file existed.
- `SECURITY.md` with full corporate security review checklist and responsible disclosure policy.
- `CONTRIBUTING.md` with adapter contribution guide, branch and commit conventions, PR checklist.
- `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1).
- `CHANGELOG.md` (this file) following Keep a Changelog format.
- `.nvmrc` pinning Node 20.
- `.github/workflows/ci.yml` running build, type-check, tests, and audit on every PR and push to main.
- `.github/pull_request_template.md` and issue templates for bugs, features, and adapter requests.
- `fileAdapter` — Node-only JSONL append adapter for local dev and audit logging. Auto-creates parent dirs, redacts screenshot base64 by default.
- `autoAdapters()` — env-var detection that returns the right adapter set from `SNAPFEED_*` env vars (Slack, Discord, GitHub, Telegram, webhook, file). Falls back to `[fileAdapter, consoleAdapter]` in dev when none are set; warns and returns `[]` in production.
- `jiraAdapter` for JIRA Cloud — creates issues via REST API v3 with ADF description, optional screenshot attachment, edge-runtime safe Basic auth.
- `linearAdapter` for Linear — creates issues via GraphQL with Markdown description, optional inline screenshot data URI.
- `googleSheetsAdapter` — Node-only Sheets v4 append adapter using a service account, mints RS256 JWTs with `node:crypto`, caches OAuth tokens.
- `discordAdapter` — Discord webhook adapter posting feedback as a colored embed with optional role mention and multipart screenshot.
- `defineRouting()`, `matchUrl()`, `resolveRoute()`, `mergeDestinations()` from `snapfeed/routing` — declarative routing primitive (Tier 1, file-based). Spreadsheet-backed source coming in v0.4.
- `npx snapfeed init` CLI scaffolder — interactive setup of `snapfeed.config.ts`, `.env.example`, and a Next.js API route. `--yes`, `--mode`, `--destinations`, `--hotkey` flags for non-interactive use.
- Runnable Next.js example at `examples/nextjs/` — `npm install && npm run dev`. Uses `autoAdapters()` so any `SNAPFEED_*` env var wires its destination automatically.
- vitest test scaffold with starter coverage on `server/security`, `console`, `webhook`, `file`, `auto`, and `routing`.

### Changed
- Bumped version to 0.3.0.
- Refreshed package.json `description` and `keywords` to reflect dogfooding focus and the expanded adapter list.
- README rewritten — persona picker up front, three deployment modes, 60-second quickstart, customer journeys, full configuration reference. Halved in size from 35 KB to ~13 KB.
- Added new build entries to `tsup.config.ts` for `routing` and `cli`.
- Added `bin` field to package.json (`snapfeed` command).
- Added `./routing` entry to package.json `exports` map.
- `files` field expanded to ship LICENSE, SECURITY, CONTRIBUTING, CODE_OF_CONDUCT, CHANGELOG with the package.

### Fixed
*(Bug fixes land in this release as a follow-up commit; see PR for details.)*

## [0.2.0] — Earlier

### Added
- Annotation layer with pen, rectangle, arrow, and highlighter tools; undo support; 5-color palette.
- Feedback categories (`bug`, `idea`, `question`, `praise`, `other`).
- `<FeedbackInbox />` component for triaging feedback stored in Supabase.
- `githubAdapter` for filing GitHub Issues directly from the widget.
- Server hardening: rate limiting (in-memory + pluggable Redis store), payload size validation, origin allowlist, console-error secret sanitization.

## [0.1.0] — Initial release

### Added
- `<FeedbackProvider>`, `<FeedbackWidget>`, `<FeedbackButton>` React components.
- Hotkey activation (default `ctrl+shift+f`).
- html2canvas-backed screenshot capture; paste/drag-drop/file picker.
- `useDevFeedback()` hook for programmatic widget control.
- Adapters: console, webhook, Slack, Telegram, Supabase.
- Server helpers for Next.js App Router and Express middleware.
- Console-error capture (last 20) for automatic context.
