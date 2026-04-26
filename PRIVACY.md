# Privacy

> **Project-level privacy posture for the snapfeed open-source library.** This is *not* the privacy policy for any application that embeds snapfeed — that policy belongs to the consumer. See ["What to write in your own app's privacy policy"](#what-to-write-in-your-own-apps-privacy-policy) at the bottom for a copy-paste paragraph you can adapt.

Last updated: 2026-04-26 (snapfeed v0.5.3)

---

## Scope

snapfeed is an MIT-licensed library you self-install in your own application and (optionally) your own backend. **The snapfeed maintainers operate no servers, run no cloud, and process no end-user data.** There is no SaaS tier, no hosted relay, no signup.

This document describes:

1. What data the library handles inside *your* infrastructure.
2. Where that data flows (only to destinations you configure).
3. What the library does **not** do (telemetry, cookies, analytics, etc.).

If you redistribute snapfeed inside a product, you remain the data controller for the data your users submit. snapfeed is a sub-component of your stack; treat it the same way you treat any other npm dependency.

---

## Data the library handles

snapfeed handles only the fields defined on the `FeedbackPayload` interface in `src/types.ts`. Nothing else is collected.

| Field | Source | Required | Notes |
|---|---|---|---|
| `text` | User-typed | Yes | The feedback message. Free-form text up to 64,000 characters (configurable soft cap, default 10 KB). |
| `appName` | Consumer config | Yes | Set via `<FeedbackProvider appName="…">`. Static. Never user input. |
| `pageUrl` | Browser-collected | Yes | `window.location.href` at submission time. May contain query strings — sanitize on your side if URLs contain secrets. |
| `pageName` | Consumer-provided / fallback | Yes | Human-readable label for the screen. |
| `timestamp` | Browser-collected | Yes | ISO-8601 string at submission time. |
| `category` | User-selected | No | One of `bug`, `idea`, `question`, `praise`, `other`. |
| `user.name` | Consumer-provided | No | Passed via `<FeedbackProvider user={…}>`. Optional. |
| `user.email` | Consumer-provided | No | Same. Subject to the redaction rules below when LLM is enabled. |
| `metadata.viewport` | Browser-collected | Auto | e.g. `"1440x900"`. Cannot identify a user on its own. |
| `metadata.userAgent` | Browser-collected | Auto | Standard `navigator.userAgent`. May contain OS/browser fingerprint surface. |
| `metadata.consoleErrors` | Browser-collected | Auto | Last N captured `console.error` strings. **Pre-redacted server-side** by `sanitizeConsoleError` in `src/server/security.ts` against `SECRET_PATTERNS` (token/key/secret/password/bearer/Authorization + JWT shape). |
| `screenshot.base64` | User-triggered | No | Captured via `html2canvas` only when the user opens the widget with `autoScreenshot: true` *or* explicitly captures. The user can preview and discard before sending. Hard cap 5 MB (configurable). |
| `screenshot.mimeType` | Browser-collected | No | `image/png` or `image/jpeg`. |

**User-controlled vs browser-collected:** `text`, `category`, `screenshot`, `user.*` are user-controlled (the reporter can see and choose). `pageUrl`, `pageName`, `timestamp`, `metadata.*` are browser-collected automatically when `collectMetadata: true` (the default). The reporter sees all metadata in the preview pane before submitting.

If you want to disable all browser-collected metadata, set `collectMetadata: false` on `<FeedbackProvider>`. The widget will then send only `text` + `appName` + `timestamp` + whatever the user explicitly enters.

---

## Where data flows

snapfeed is an in-process library. Data leaves the browser only along paths the consumer wires up.

```
[browser widget]
      │
      ▼ POST /feedback (consumer's own endpoint)
[consumer's server, running createFeedbackHandler()]
      │
      ├──► slackAdapter      ─► hooks.slack.com   (consumer's webhook)
      ├──► jiraAdapter        ─► consumer's JIRA Cloud
      ├──► linearAdapter      ─► api.linear.app    (consumer's API key)
      ├──► githubAdapter      ─► api.github.com    (consumer's PAT)
      ├──► supabaseAdapter    ─► consumer's Postgres
      ├──► fileAdapter        ─► local JSONL on consumer's host
      ├──► s3Storage          ─► AWS S3 / R2 / B2 / MinIO (consumer's bucket)
      ├──► …other built-ins   ─► destinations the consumer configured
      │
      └──► (optional) LLM provider chosen by consumer (Anthropic / OpenAI / Azure / Bedrock / Ollama)
```

Built-in adapter destinations (each fires only if the consumer wires it):

| Adapter | Destination | What it stores there |
|---|---|---|
| `slackAdapter` | Slack incoming webhook URL | Message + optional screenshot upload |
| `discordAdapter` | Discord incoming webhook | Embed message + optional screenshot |
| `msTeamsAdapter` | Teams incoming webhook | Adaptive Card + optional mention |
| `telegramAdapter` | Telegram Bot API | Message + optional screenshot |
| `githubAdapter` | github.com REST API | Issue body + optional screenshot via attached comment |
| `jiraAdapter` | JIRA Cloud REST v3 | Issue with ADF body + optional screenshot attachment |
| `linearAdapter` | linear.app GraphQL | Issue with Markdown body + inline screenshot data URI |
| `asanaAdapter` | Asana REST v1 | Task in a project + multipart screenshot upload |
| `clickUpAdapter` | ClickUp REST v2 | Task with priority + optional attachment |
| `notionAdapter` | Notion REST | Page in a database + ≤1 MB screenshot as image block |
| `googleSheetsAdapter` | Sheets v4 (service account) | Row append |
| `supabaseAdapter` | Consumer's Supabase Postgres | `feedback` table row |
| `fileAdapter` | Local filesystem (Node) | JSONL append; screenshot base64 redacted by default |
| `webhookAdapter` | Arbitrary HTTPS URL | JSON POST body — whatever the consumer's endpoint stores |
| `consoleAdapter` | `console.log` only | Local-only; nothing leaves the process |

snapfeed does **not** introduce any destination of its own. There is no fallback, no error-reporting endpoint, no "we'll keep a copy."

---

## Optional GenAI processing

The `snapfeed/llm` subpath is **opt-in**. snapfeed works fully without any LLM key — see the "LLM degradation table" in the README. Every smart feature falls back to a deterministic non-LLM behavior.

When the consumer enables LLM features:

- The consumer chooses the provider (`anthropic`, `openai`, `azure-openai`, `bedrock`, `ollama`, or `custom`) and supplies the API key via env var on their own server.
- The chosen provider sees the (optionally pre-redacted) feedback `text` plus the last 3 `consoleErrors`. No screenshot bytes, no full payload, no IP, no `user.*` fields beyond what appears in `text`.
- Pre-redaction is recommended: enable `redactBeforeLLM` to strip emails, credit-card-shaped digits, JWTs, and high-entropy tokens before any prompt is sent (`redactForLLM` in `src/llm/redact.ts`).
- snapfeed never proxies the LLM call; the request goes directly from the consumer's server to the consumer's chosen provider.
- snapfeed never sees, stores, or transmits the API key. It is read from `process.env` on the consumer's host.
- snapfeed never bills. There is no metering, no subscription, no relay.
- The audit log records `provider`, `feature`, `tokensUsed`, and `degraded` only — never the prompt or completion content. See `AuditEvent.llm.called` in `src/audit-log.ts`.

For the strongest privacy posture, point `provider: 'ollama'` at a local Ollama instance (the Docker stack ships with this profile). No prompts or completions leave the host.

---

## Telemetry

**Zero. None. Ever.**

The library makes **no** outbound calls of any kind that the consumer did not explicitly configure:

- No phone-home.
- No version checks.
- No analytics.
- No error reporting.
- No update notifications.
- No "anonymous usage statistics."
- No CDN fetches at runtime.
- No font / asset loads from third parties.

The only outbound network calls the runtime ever makes are:

1. The browser widget's `fetch(apiUrl)` to the consumer's own endpoint.
2. Calls each configured adapter makes to the destination the consumer wired.
3. Optional LLM calls to the provider the consumer configured, with the consumer's key.

You can verify this end-to-end by reading the source — `npm sbom` (planned v0.5) will produce the dependency manifest.

---

## Cookies / tracking

The widget itself sets **no** cookies, no `localStorage`, no `sessionStorage`, no `IndexedDB`, no fingerprinting, no third-party trackers. There is no concept of a "snapfeed session."

The consumer's own auth cookies travel with the `fetch(apiUrl)` POST exactly as they would for any same-origin request — that is the consumer's responsibility, not the library's.

---

## Children's data

snapfeed is a developer tool, not directed at children, and not designed for products targeted at users under 13 / 16 (depending on jurisdiction). The library has no "child-safe mode."

Consumer applications that may be used by children must satisfy their own COPPA, GDPR-K, and equivalent obligations independently. Disable the widget for those user segments via `enableInProduction={false}` or a role check (`enableInProduction={user.isAdult && user.role === 'beta'}`).

---

## Third parties

The only third parties that ever see feedback data are:

1. The destination(s) the consumer configures via the adapters listed above (Slack, JIRA, GitHub, etc.).
2. The LLM provider the consumer optionally configures, with the consumer's own API key.

snapfeed maintainers are **not** in the data path. There is no sub-processor introduced by the library itself.

---

## Retention

snapfeed itself stores **nothing** centrally. Retention policy lives in whichever destinations the consumer configured:

- Slack: retention is governed by the consumer's Slack workspace policy.
- JIRA / Linear / GitHub Issues: governed by the consumer's tracker.
- Supabase / S3 / file: governed by the consumer's storage configuration.
- File / JSONL: nothing is rotated automatically — the consumer must run their own log rotation.

A `retentionDays` config + `deleteByUserId()` API for GDPR right-to-erasure is on the v0.5 roadmap (see `SECURITY.md`).

---

## Your rights

Because snapfeed processes no data centrally, the maintainers cannot fulfill access / erasure / correction requests — we have nothing to give you and nothing to delete.

If you submitted feedback through an application that embeds snapfeed, direct your request to the operator of that application. They are the data controller and the only party with access to the stored feedback.

---

## Contact

For project-level privacy questions about the library itself: **shimoverse@gmail.com**.

For security-sensitive disclosures, follow the responsible-disclosure process in `SECURITY.md` (do not file public issues for vulnerabilities).

---

## Changes

This document is versioned by date. Material changes are also called out in `CHANGELOG.md`. If a future release ever adds telemetry, a hosted relay, or any other outbound call beyond what is described here, it will require a major version bump and an explicit changelog entry.

---

## What to write in your own app's privacy policy

You are the data controller for the feedback your users submit. Adapt the paragraph below for your own privacy policy:

> **Product feedback.** Our application includes an in-app feedback widget powered by [snapfeed](https://github.com/shimoverse/snapfeed), an open-source library we self-host. When you submit feedback, we collect the text you type, the page you were viewing, your browser metadata (viewport, user agent, recent console errors), and — if you choose to attach one — a screenshot. If you are signed in, we associate the feedback with your account name and email. This data is sent to our own infrastructure and forwarded to the bug-tracking and team-chat tools we use internally — *[list your destinations: e.g., Slack, JIRA, GitHub Issues, our internal Postgres database]*. The snapfeed maintainers operate no servers and do not receive any of this data. We retain feedback for *[your retention period]* and you can request deletion by contacting *[your privacy contact]*.

If you optionally enable snapfeed's GenAI features, also add:

> We additionally process the text portion of your feedback through *[your chosen LLM provider — e.g., Anthropic Claude / OpenAI / a self-hosted Ollama instance]* to generate a summary, infer severity, and detect duplicates. Sensitive patterns (emails, JWTs, credit-card-shaped numbers) are redacted before this processing.
