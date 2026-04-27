# Versioning

snapfeed follows [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html).

---

## Pre-1.0 caveat

While snapfeed is on the `0.x` line:

- **Minor versions (0.x.0) MAY contain breaking changes.** We will always call them out explicitly in `CHANGELOG.md` under a "Breaking changes" subsection, and we'll provide migration notes when the change is non-obvious.
- **Patch versions (0.x.y) are bug fixes only.** No new features, no API changes.
- We do not backport patches to older minors. If you're on `0.3.x` and a fix lands in `0.5.1`, the recommendation is to upgrade to the latest minor.

Once we ship `1.0.0`, semver applies in the strict sense: breaking changes require a major bump.

---

## What counts as the public API surface

Anything reachable from these subpath exports is part of the public API and protected by the policy above:

| Subpath | Notes |
|---|---|
| `snapfeed` | Main entry — `<FeedbackProvider>`, `<FeedbackWidget>`, `<FeedbackButton>`, `useDevFeedback()`, `<FeedbackInbox>`, types, campaign re-exports |
| `snapfeed/adapters` | All adapter factories and the `FeedbackAdapter` / `FeedbackAdapterResult` interfaces |
| `snapfeed/server/nextjs` | `createFeedbackHandler` for Next.js App Router |
| `snapfeed/server/express` | `feedbackMiddleware` for Express ≥ 4 |
| `snapfeed/server/security` | `validatePayload`, `checkOrigin`, `checkRateLimit`, `defaultRateLimitStore`, `normalizePayload`, `sanitizeConsoleError`, exported `RateLimitStore` interface (from `snapfeed`) |
| `snapfeed/routing` | `defineRouting`, `matchUrl`, `resolveRoute`, `mergeDestinations` |
| `snapfeed/routing-sources` | `csvRoutingSource`, `googleSheetsRoutingSource`, `cacheRoutingSource` |
| `snapfeed/llm` | `applyLLM`, `createProvider`, `createBudgetTracker`, `redactForLLM`, provider factories (`anthropicProvider`, `openaiProvider`, `ollamaProvider`) |
| `snapfeed/voice` | `createVoiceRecorder`, `isVoiceSupported`, `pickSupportedMimeType` |
| `snapfeed/screen-recording` | `createScreenRecorder`, `isScreenRecordingSupported` |
| `snapfeed/storage` | `fileStorage`, `s3Storage` |
| `snapfeed/audit-log` | `fileAuditLog`, `noopAuditLog`, `multiAuditLog`, `AuditLog`, `AuditEvent` |
| `snapfeed/network-capture` | `installNetworkCapture` and its config interface |
| `snapfeed/campaigns` | `defineCampaign`, `isCampaignActive`, `getCampaignTags`, `getCampaignRouting`, `campaignShareUrl`, `ReleaseCampaign` |
| `snapfeed/theme` | Theme-token data and CSS variable names |
| `snapfeed/headless` | Headless compound components, `useFeedbackWidget` |
| `snapfeed/messages` | `defaultMessages`, `mergeMessages`, `FeedbackMessages` type for i18n |

Plus:

- The `npx snapfeed init` CLI flags (`--yes`, `--mode`, `--destinations`, `--hotkey`).
- Field names on `FeedbackPayload` that adapters depend on (renaming `text` to `body` would be breaking even if the runtime accepted both).
- The shape of `FeedbackHandlerConfig` (rate limit, origins, payload caps, hooks).
- Default values that consumers commonly rely on (e.g. `enableInProduction: false`).

If we change any of the above incompatibly, we bump the appropriate version per the policy above.

---

## What is internal-only (NOT semver-protected)

The following may change in any release, including patch releases, without notice:

- Anything under `src/lib/`. This is implementation detail. Do not import from here.
- The exact wire format of audit log JSONL beyond the `AuditEvent` discriminated union — we may add fields. Don't write parsers that reject unknown fields.
- The exact request shapes adapters send to third-party destinations. Third-party APIs change; we update accordingly.
- The exact prompt templates used by `snapfeed/llm`. Prompt engineering is a moving target.
- The set of regex patterns in `SECRET_PATTERNS` (`src/server/security.ts`) and `redactForLLM` (`src/llm/redact.ts`). We will only **add** patterns, not remove, but the exact set is not part of the API contract.
- Internal CSS class names on widget DOM nodes. Style with the documented `accentColor` / `theme` props, not by targeting internals.
- Internal React component names not exported from a public subpath.
- The rate-limiter sweep interval (5 minutes) in `defaultRateLimitStore`.

If you find yourself reaching into one of these for a feature, open a discussion — we'd rather promote a stable surface than have you depend on internals.

---

## Deprecation policy

When we plan to remove a public API:

1. We add `@deprecated` JSDoc to the symbol with a pointer to the replacement.
2. We emit a `console.warn` at the first call site (server-side; client-side widgets warn once per page load) explaining the deprecation.
3. The deprecated symbol stays for at least **one minor release** before removal.
4. Removal lands in the next minor (pre-1.0) or next major (post-1.0), with a note in `CHANGELOG.md` under "Breaking changes."

Example timeline:
- `0.4.0` ships `oldFn()` and `newFn()`. `oldFn()` is marked `@deprecated`.
- `0.5.0` removes `oldFn()`. CHANGELOG calls out the breaking change.

---

## LTS policy

Pre-1.0: we patch only the latest minor. There is no LTS line.

Post-1.0 (planned): we will commit to a published support window for the current major. Specifics will be documented when we cut `1.0.0`.

---

## How to check what's exported

The complete export surface is the union of:

- `package.json` `exports` map — defines every subpath.
- `tsup.config.ts` `entry` array — defines every build artifact.
- The `.d.ts` files in `dist/` — defines every type a consumer can `import { … }`.

If a symbol isn't reachable from any of those, it is internal regardless of where it lives in `src/`.
