# Changelog

All notable changes to snapfeed are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.3] — 2026-04-26

Final pre-publish hardening pass after a four-agent deep review surfaced
critical / high-priority drift across `src/`, `docs/`, `examples/`, and
configs. This release lands the unblockers (every example app now builds
clean), eliminates the promise-vs-reality gaps in the docs, and refreshes
the lockfile + version stamps so first-time consumers do not hit
documented-but-not-shipped surfaces. No new runtime features.

### Fixed — Critical (build-blockers for consumers)
- **`createFeedbackHandler` now satisfies Next 14's strict route validator.**
  The handler input is typed as the standard web `Request` (Next 14 accepts
  `Request | NextRequest`) and the return type is widened to `Response`
  (NextResponse extends Response at runtime, so the actual returned object
  satisfies both). Earlier the structural `NextRequest` shim caused
  `next build` to fail with *"Type 'NextRequest' is not assignable to type
  'Request | NextRequest'"* under strict tsconfig. `req.ip` is still read
  via a small structural cast for Vercel platform support — no hard
  dependency on `next/server`.
- **`vitest` glob now matches `.tsx` files** (`tests/**/*.test.{ts,tsx}`).
  The previous `*.test.ts` glob silently skipped two React component test
  files in CI. The two `.tsx` files are still `it.todo` placeholders
  pending `jsdom` + `@testing-library/react` devDeps; flipping the glob
  surfaces them in the `27 todo` count instead of hiding them entirely.
- **`snapfeed/messages` subpath now actually exports.** Promised in v0.5.2
  CHANGELOG but the `package.json` exports + `tsup` entry were missing.
  Now `import { defaultMessages, mergeMessages } from 'snapfeed/messages'`
  resolves to a 1.9 KB ESM bundle with full `.d.ts`. (`defaultMessages` was
  already importable from the main barrel; this adds the standalone
  subpath consumers expected.)

### Fixed — Examples (every example app now builds clean)
- `examples/nextjs` builds via `next build`. Three blockers:
  (1) handler typing fix above; (2) `app/page.tsx` marked
  `dynamic = 'force-dynamic'` since it reads `process.env` at request time
  AND mounts a client island that uses `useDevFeedback`; (3) custom
  `app/not-found.tsx` opts out of the auto-generated 404 prerender.
- `examples/remix` builds via `remix build`. Added `isbot@^4` (Remix
  runtime requirement; was missing), committed `package-lock.json`, and
  added `browserNodeBuiltinsPolyfill` to `remix.config.js` for `fs`,
  `fs/promises`, `path`, `crypto`, `stream`, `url`, `util`, `buffer`. The
  polyfills are needed because the `snapfeed` barrel re-exports
  server-only adapters (`fileAdapter`, `googleSheetsAdapter`,
  `defaultRateLimitStore`) that import node built-ins; tree-shaking
  removes them at runtime, but Remix's bundler still needs to resolve
  them at build time. (Splitting these out of the main barrel is on the
  v0.6 roadmap.)
- `examples/vite-react` and `examples/admin` continue to build clean —
  verified end-to-end as part of this pass.

### Fixed — Documentation drift
- **`snapfeed/server/security` removed from public-API docs** in
  `VERSIONING.md` and the `ARCHITECTURE.md` mindmap. The subpath does not
  exist in `package.json` exports — only `defaultRateLimitStore` is
  re-exported via the main barrel. Replaced with a row for the missing
  `snapfeed/messages`, `snapfeed/headless`, and `snapfeed/theme`
  subpaths that *do* ship.
- **accentColor `#D4714B` → `#B85A36` swept across all surfaces** that
  document the default. The contrast bump shipped in v0.5.2's runtime but
  the docs lagged: `src/theme.ts`, `src/AnnotationCanvas.tsx`,
  `src/FeedbackInbox.tsx` defaults; `README.md`, `docs/MANUAL.md`,
  `docs/customization.md`; example apps (`examples/nextjs/app/`,
  `examples/vite-react/`, `examples/remix/app/`) and their READMEs.
- **`COMPLIANCE.md` no longer falsely claims `#D4714B` meets WCAG AA.**
  The CHANGELOG explicitly shipped a fix for this contrast failure;
  `COMPLIANCE.md` was still asserting the old (non-compliant) hex passes.
  Now reflects the true `#B85A36` value (~4.7:1 against white) with the
  history of the change.
- **`docs/MANUAL.md` removed the `features.redact` row** from the LLM
  feature toggles table. The toggle was advertised in early v0.4 drafts
  but never landed (the source removed it from `LLMFeatureToggles` with a
  TODO for v0.6). Both the table and the §6.6 code example now match the
  shipped type.
- **README's LLM example replaced** the fictional `defineLLM` import (no
  such export exists) with the real `createProvider` + `applyLLM` shape
  from `snapfeed/llm`.
- **README + `SECURITY.md` updated** to reflect that SBOM, retention
  policy, SSO/SAML for admin, and image-digest pinning slipped from v0.5
  to v0.6. The README's "ships in v0.5" line in the Air-gapped section
  now honestly says "slated for v0.6 (see SECURITY.md)".
- **Stale `// Planned shape — ships in v0.4` comment** removed from the
  README LLM example; that code block now describes the actually-shipped
  v0.5.3 surface.
- **Version stamps bumped** v0.4.0 → v0.5.3 across PRIVACY, COMPLIANCE,
  THREAT_MODEL, COMPATIBILITY, PRD, MANUAL, PLAYBOOK, ARCHITECTURE,
  SECURE_DEPLOYMENT, and the quickstart pin in `docs/quickstart/index.md`,
  `docs/quickstart/midsize.md`, `docs/quickstart/corp.md`. The
  `docs/SECURITY_REPORT.md` deliberately stays stamped v0.4.0 — it is a
  historical assessment of that release; re-running the audit against
  v0.5.3 is a separate effort.
- **`CITATION.cff` 0.4.0 → 0.5.3.** **`docker/docker-compose.yml`
  worker image tag `0.5.0` → `0.5.3`.** **`bug_report.yml` placeholder
  `0.3.0` → `0.5.3`.**

### Fixed — Code rot
- **Stale hotkey-skip comment** in `FeedbackProvider.tsx` (lines
  ~308–311) said the skip was conditional on the hotkey lacking `shift`.
  The shipped behavior (since v0.5.2) ALWAYS skips on editable elements
  regardless of modifiers — a tester typing into an autocomplete that
  closes on blur could otherwise lose their input. Comment now matches
  the code.
- **Orphaned `<div data-snapfeed-media-row>` placeholder** removed from
  `FeedbackWidget.tsx` (lines 985–989). It was reserved during the
  v0.5.2-rc2 widget UX work for a media-button row that has not been
  built yet; ship-the-real-thing-or-delete-the-stub.

### Fixed — Build & devDep hygiene
- **`package-lock.json` refreshed** — root version was lagging at 0.5.0
  while `package.json` claimed 0.5.2; both now agree at 0.5.3.
- **`html2canvas` added as a devDependency.** It is correctly an optional
  peer at runtime, but `tsc --noEmit` and `tsup` dts emission both need
  the types resolvable at dev time. Earlier installs got it transitively;
  the lockfile refresh dropped it. Adding it as a devDep keeps
  `type-check` and `build` green deterministically.
- **ESLint flat-config ignore list extended** to cover
  `examples/*/build/**`, `examples/*/dist/**`, and
  `examples/*/public/build/**`. After running `npm run build` in the
  example apps, those directories contained minified bundler output that
  was being linted, producing 11,000+ false-positive `no-undef` errors.

### Verification
- `npm run type-check` clean.
- `npm run build` clean — all 16 entry points (incl. new `messages`)
  emit ESM + CJS + `.d.ts` + `.d.cts`.
- `npx vitest run` — 48 test files, **602 passed | 12 skipped | 27 todo**,
  0 unhandled errors.
- `npm run lint` — 0 errors, 19 pre-existing warnings.
- `npm pack --dry-run` — 124 files, 794 KB packed, 3.4 MB unpacked,
  includes `dist/messages.{js,cjs,d.ts,d.cts}`.
- `examples/nextjs`, `examples/remix`, `examples/vite-react`, and
  `examples/admin` all build successfully end-to-end.

### Known limitations carried into v0.6
- Server-only adapters (`fileAdapter`, `googleSheetsAdapter`,
  `defaultRateLimitStore`) still re-exported from the main `snapfeed`
  barrel. This is why bundlers like Vite warn about node built-in
  externalization and Remix needs polyfills. Splitting them out is a
  v0.6 breaking change that will need a deprecation cycle.
- The two `.tsx` test files (`tests/headless/`) remain `it.todo`
  placeholders pending the `jsdom` + `@testing-library/react` devDeps;
  the glob fix is the prerequisite.
- LLM `features.redact` second-pass remains v0.6 roadmap. Use
  `redactBeforeLLM: true` (regex + entropy) for outbound payload
  redaction today.
- README screenshots / visual walkthroughs not yet captured. Tracked for
  the next pass with a running preview.

## [0.5.2] — 2026-04-26

Pre-publish UX pass. Two thorough UX reviews (reporter + integrator) found
~25 friction points; this release lands the high-impact fixes plus the
foundation (types + helpers) for the widget UX upgrades that finish in v0.5.3.
No new features, no breaking changes.

### Fixed — integrator path
- README 60-second quickstart now includes the missing `<FeedbackProvider>`
  wrap step (the literal snippet) — without this, the headline path was
  broken because the hotkey listener never mounted.
- README "Identifying the reporter" no longer shows fictional `buildId` /
  `gitSha` / `env` provider props. Replaced with the canonical workaround
  using `metadata.custom` (now a real field on `FeedbackMetadata`) and an
  `onReceive` snippet showing how to attach build context server-side.
- All 6 persona quickstart guides (indie, startup, midsize, corp,
  oss-maintainer, designer) bumped from `v0.4.0` to `v0.5.x` in their version
  headers.
- `docs/quickstart/corp.md` no longer falsely claims `THREAT_MODEL.md` and
  `COMPLIANCE.md` are missing — both ship at the repo root and in the npm
  tarball. The "documents to hand to your reviewer" list is now honest.
- README's auto-adapter env-var table now includes the variants the code
  actually reads: `SNAPFEED_SLACK_USERNAME`, `SNAPFEED_SLACK_CHANNEL`,
  `SNAPFEED_DISCORD_MENTION_ROLE`.
- README + `docs/customization.md` agree on "four levels" of customization
  (token / compound / slot-swap / headless). The slot-swap level
  (`FeedbackComponentsProvider`) is now promoted from buried-in-customization
  to a first-class option.
- `docs/customization.md` standardized on `from 'snapfeed/theme'` (subpath form,
  tree-shake friendly) for theme imports; top-of-file note explains the
  barrel re-export is also available.

### Fixed — CLI scaffold correctness
- `snapfeed.config.ts` generated by `npx snapfeed init` now uses the
  canonical `from 'snapfeed/routing'` import (was `from 'snapfeed'` —
  inconsistent with every doc).
- Generated config now produces a real `RoutingDestination`-shaped `default`
  (e.g. `{ slack: '#bugs' }`) instead of the previous `{ mode, hotkey, ... }`
  shape that didn't conform to the `RoutingConfig` type.
- Generated config ships an active `routes` example (e.g.
  `{ category: 'bug', to: { slack: '#bugs' } }`) instead of `routes: []` so
  the CLI's output is functional out of the box, not decorative.
- Generated `app/api/feedback/route.ts` now wires the routing config: imports
  `resolveRoute` from `'snapfeed/routing'`, loads `snapfeed.config`, and
  attaches the resolved destination to `payload.metadata.custom.route` via
  `onReceive`. Previously the config was generated but never used.
- CLI now detects Pages Router vs App Router (`pages/` vs `app/`) and
  generates `pages/api/feedback.ts` for Pages Router projects — previously
  always assumed App Router.
- CLI's "Next steps" output now prints the literal `<FeedbackProvider>`
  snippet plus a complete `app/snapfeed-client.tsx` example. Previously
  said "Wrap your app in `<FeedbackProvider>`" without showing how.

### Fixed — adapter / package safety
- `slackAdapter` now validates `webhookUrl` parses via `new URL()` at
  construction time. A misconfigured webhook surfaces immediately when the
  adapter is wired up — not lazily on the first feedback submission.
- `autoAdapters()` now warns once when an unprefixed env var (e.g.
  `SLACK_WEBHOOK`, `GITHUB_TOKEN`) is set without its `SNAPFEED_` prefix:
  `[snapfeed] Did you mean SNAPFEED_X? Found X but snapfeed only reads
  SNAPFEED_-prefixed env vars.`
- `package.json` no longer declares `html2canvas` in BOTH
  `peerDependenciesMeta` AND `optionalDependencies`. Now declared as a real
  optional peer (in `peerDependencies` with `peerDependenciesMeta.optional:
  true`). Stops auto-install while preserving the optional-peer contract.
- `package.json` description tightened to ≤150 chars (npm snippet width).
- `package.json` keywords trimmed from 33 → 15 (dropped duplicates and
  redundant terms).
- `package.json` author is now `{ name: "shimoverse", email:
  "shimoverse@gmail.com" }` matching the security contact.

### Fixed — widget hotkey UX (foundation)
- `matchesHotkey` now substitutes Cmd for Ctrl on Mac when a hotkey is
  configured as `ctrl+shift+f` (matches `docs/quickstart/designer.md`
  promise). The fix lives in the matcher; non-Mac runtimes are unchanged.
- `shouldSkipHotkeyForTarget` now ALWAYS skips when the user is typing in
  an editable element (`<input>`, `<textarea>`, `<select>`,
  `[contenteditable]`), regardless of whether the hotkey includes shift.
  Previously the default `ctrl+shift+f` could steal a tester's in-progress
  input focus and lose its content.

### Added — widget UX foundation (consumption ships in v0.5.3)
- New types in `FeedbackProviderConfig` (all optional, additive — no
  breaking change): `floatingButton: boolean | string`, `persistDraft:
  boolean`, `persistIdentity: boolean`, `messages: Partial<FeedbackMessages>`,
  `metadata: Record<string, string>`. v0.5.3 wires these into the widget UI.
- New `FeedbackMetadata.custom?: Record<string, string>` — sanctioned
  extension seam for arbitrary build/release/flag context. Forwarded
  unchanged to every adapter destination and the audit log.
- New `FeedbackMessages` interface (~30 i18n keys) and new
  `snapfeed/messages` module with `defaultMessages` + `mergeMessages`.
- New `src/llm/providers/endpoint.ts` — shared URL validation helper for
  custom LLM endpoints (rejects non-http(s); warns once on `http://` for
  non-localhost). Wired into the Anthropic / OpenAI / Ollama providers.
- Default `accentColor` changed from `#D4714B` (~3.4:1 contrast — fails
  WCAG AA) to `#B85A36` (~4.7:1 — passes AA for body text on white).
  Visual change is subtle; existing consumers explicitly setting
  `accentColor` are unaffected.

### Examples polish
- `examples/nextjs/README.md`: build-the-parent step is now Step 1 (was
  buried in troubleshooting). Removed broken `snapfeed-demo.png` reference.
- `examples/nextjs/app/api/feedback/route.ts`: prod-safe `allowedOrigins`
  gating using `NEXT_PUBLIC_SITE_ORIGIN`. Removed unreachable dead branch.
- `examples/nextjs/next.config.js`: 20-line comment block explains WHAT /
  WHY / COST / FUTURE for the webpack `resolve.fallback`. Will be removable
  once v0.6 splits the client/server barrel.
- `examples/vite-react`: `concurrently` moved to `dependencies` (was
  devDeps); `vite.config.ts` reads `process.env.PORT` for the proxy target;
  `tsconfig.json` drops unneeded `"node"` type; same prod-safe
  `allowedOrigins` gating in `server.mjs`.
- `examples/admin/README.md` bumped from v0.4 to v0.5; new `type-check`
  script; bulk-action failures surfaced via `console.error` + alert (was
  silent).
- `examples/remix/package.json`: removed `"sideEffects": false`; changed
  `dev` from `remix dev --manual` to `remix dev` (auto-restart by default).
- `examples/remix/app/snapfeed-provider.tsx`: top-of-file comment block
  explains the SSR mount-gate pattern.

### CLI / Docker polish
- `docker/docker-compose.yml`: removed obsolete `version: '3.9'` (silenced
  Compose v2 warning). Added `mem_limit` + `pids_limit` to worker.
  Ollama gets `mem_limit: 8g` + a wget-based healthcheck.
- `docker/Dockerfile`: replaced second `npm ci --omit=dev` with `npm prune
  --omit=dev` (faster, no re-fetch).
- `docker/worker.cjs`: numeric env var validation (NaN exits cleanly);
  prod-with-no-allowlist now fail-closes (`['__never_match__']`); per-adapter
  `durationMs` is real (was hardcoded 0); typed `BodyReadError` replaces
  fragile string-matching for 413/400 status selection; `SNAPFEED_TRUST_PROXY`
  env (default `false`) gates X-Forwarded-For honouring; `start()` rejects on
  bind failure with clean exit.
- `docker/.env.example`: documented multi-origin `ALLOWED_ORIGINS` and
  `SNAPFEED_TRUST_PROXY=false`.
- `docker/README.md`: hardcoded `"version": "0.5.0"` replaced with `<x.y.z>`;
  Ollama llama3:8b ~4 GB / multi-minute pull note added; new "Production
  hardening" subsection.
- `src/cli.ts`: `--hotkey` arg parsing made consistent with `--mode`;
  `--help` shows both numeric and string forms for `--mode`; `mkdirSync`
  deferred so declined overwrite no longer leaves an empty
  `app/api/feedback/` behind; generated config indentation normalized to 4
  spaces.

### Verification at commit time
- Build EXIT=0 (16 entries, all `.d.ts` present)
- Type-check EXIT=0
- ESLint EXIT=0 (0 errors, 19 cosmetic warnings)
- Tests EXIT=0 — 600+ pass + 12 skipped across 48+ files
- npm audit EXIT=0 (0 vulnerabilities at `--audit-level=high --omit=dev`)

### Deferred to v0.5.3 (not regressions — v0.5.2 ships the foundation)
- Wire voice + screen-recording controls into the default `FeedbackWidget`
  UI (the "talk" half of "see → tap → talk → done"). Primitives in
  `snapfeed/voice` and `snapfeed/screen-recording` are production-ready;
  the widget just needs to call them.
- Wire i18n consumption into `FeedbackWidget` (the `messages` prop is
  defined and `defaultMessages` exists; widget still hardcodes English).
- Default-mount the floating trigger when `floatingButton !== false`
  (today the trigger is opt-in via separate `<FeedbackButton />`).
- Draft persistence to `sessionStorage` (the `persistDraft` flag is
  defined; widget doesn't read it yet).
- Identity readout + `localStorage` persistence (the `persistIdentity`
  flag is defined; widget doesn't read it yet).
- Render adapter destinations in the success state ("Sent to
  #checkout-feedback (Slack) and CHK-1242 (JIRA)"); surface partial
  failures in the UI.
- All four are mechanical with the v0.5.2 foundation in place.

## [0.5.1] — 2026-04-26

Pre-publish review pass. Six parallel code-review agents found and 13 critical
issues + several high-priority hardening items were addressed before launch.
No new features — bug fixes and security hardening only.

### Fixed — security & correctness
- **Slack mrkdwn injection** — `slackAdapter` now escapes `&`, `<`, `>` in
  every user-supplied field (text, page name, page URL, app name, reporter,
  console errors). Previously a feedback submission of `<!channel> ping`
  would page the entire Slack workspace.
- **Webhook SSRF guard** — `webhookAdapter` now requires `https://` URLs by
  default and rejects invalid/non-allowed schemes at construction time. Pass
  `allowInsecure: true` for `http://` (dev only). The JSDoc explicitly warns
  consumers to never source `url` from request data.
- **Google Sheets header-write race** — `googleSheetsAdapter` now uses a
  promise-cached header check keyed by `spreadsheetId+range`, eliminating the
  race that previously wrote the header row twice on concurrent first-time
  calls.
- **Audit log wired into both server handlers** — `FeedbackHandlerConfig`
  now accepts `auditLog?: AuditLog`. Both `createFeedbackHandler` (Next.js)
  and `feedbackMiddleware` (Express) emit `feedback.received`,
  `adapter.dispatched`, and `rate_limit.hit` events. Previously the audit
  log primitive existed but neither built-in handler called it; only
  `docker/worker.cjs` wired it. Audit-log failures are caught and logged via
  `console.error` — they never break the request flow.
- **`x-forwarded-for` last-hop trust** — both server handlers now read the
  LAST hop in `x-forwarded-for` (the trusted proxy), not the first
  (attacker-controlled). A spoofed XFF header can no longer bypass per-IP
  rate limiting.
- **Rate-limit memory cap** — the in-memory rate-limit store now caps at
  10,000 keys with a 10% LRU eviction, preventing memory blowup under
  high-cardinality IP floods.
- **`features.redact` removed** from the public LLM API. The toggle was
  advertised in v0.4 but never implemented at the runner level — shipping a
  security-flavored no-op was a footgun. Use `redactBeforeLLM: true`
  (regex + entropy + email patterns) instead. A real LLM-driven redact pass
  is planned for v0.6.
- **LLM redacts `pageUrl` in repro feature** — URLs commonly leak tokens and
  emails (`?api_key=…`, `/users/foo@example.com/…`); now sanitized through
  the same `redactForLLM` pass as `text` and `consoleErrors`.

### Fixed — correctness bugs
- **`screen-recording.ts` records garbage** — chunks were typed as
  `{ size, type? }` and stored only metadata; the final `Blob` constructor
  serialized them as `[object Object]`, producing meaningless recordings.
  Now stores actual `Blob` objects (matching the voice recorder pattern).
- **`useFeedbackWidget.ts` inFlight ref** — concurrent submits could leave
  the widget stuck in `'submitting'` state forever. The success transition
  now uses a captured submit-id ("only fire if I'm still the latest") instead
  of a buggy `inFlight === 1` check after increment.
- **`FeedbackModal.onClose` was un-closeable** when a consumer wired their
  own callback. Always calls `close()` now; the consumer's `onClose` runs
  for side-effects only.
- **`validatePayload` no longer mutates** the caller's `metadata.consoleErrors`
  array — sanitization was leaking back into the consumer's reference.

### Fixed — Docker stack
- **MinIO healthcheck** uses `mc ready local` instead of `curl` (which is not
  in the minio image). Previously the worker would never start because
  `depends_on: minio: condition: service_healthy` waited on a check that
  could never pass.
- **Bind mount perms** — `docker/data/{audit,uploads}/` directories are
  pre-created with `.gitkeep` so the in-container `node` user (UID 1000) can
  write to them on first `docker compose up`.

### Fixed — examples
- **Next.js example `next build` was failing** because the client bundle
  pulled in `fileAdapter` (which uses `await import('fs/promises')`).
  `next.config.js` now sets `webpack.resolve.fallback` for `fs`, `path`,
  `crypto`, and `node:*` variants.
- **Remix `remix.config.js`** converted to ESM `export default` (was
  `module.exports` in a `"type": "module"` package — failed on every
  `npm run dev`).
- **Admin `.gitignore`** now excludes `*.jsonl` so users don't accidentally
  commit real feedback (text, screenshots, console errors, build context).
- **Admin `.env.example`** comments out `SNAPFEED_ADMIN_BYPASS=1` so a
  copy-paste of the example into production doesn't leave the admin app
  wide open by default.

### Verification at commit time
- Build EXIT=0
- Type-check EXIT=0
- ESLint EXIT=0 (0 errors, 19 cosmetic warnings — same as v0.5.0 baseline)
- Tests EXIT=0 — 470 pass + 12 skipped across 39 files
- size-limit EXIT=0 — all 6 browser bundles well under 5KB budgets
- npm audit EXIT=0 — `--audit-level=high --omit=dev`: 0 vulnerabilities

### Findings deferred to v0.5.2 / v0.6
- Several Medium/Low items from the pre-publish review were intentionally
  not addressed in this patch. They're documented in
  `docs/SECURITY_REPORT.md` (F-003 status flipped from "Open" to "Mitigated
  in v0.5.0"; the v0.5.1 fixes above to be reflected by maintainer review).
- v0.6 work: combine LLM title+severity+repro into one provider call,
  extract shared adapter helpers (base64, http, escape, categories), shared
  fetch-with-timeout, third-party SigV4 audit, jsdom-based React component
  tests, Postgres-backed admin store, image-digest pinning, SBOM per release,
  full WCAG 2.1 AA pass.

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
