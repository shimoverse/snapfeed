# Changelog

All notable changes to snapfeed are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
