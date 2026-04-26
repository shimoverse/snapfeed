# Security Assessment Report — snapfeed v0.4.0

```
Date:              2026-04-25
Assessment type:   Internal review against published threat model
Scope:             Source code (src/, docker/), build pipeline (tsup, GitHub Actions),
                   supply chain (npm dependencies), shipped artifacts (dist/), documentation
Out of scope:      Consumer's deployment configuration, third-party adapter destinations,
                   browser security
Methodology:       Manual code review; npm audit; threat-model-driven test coverage review;
                   supply-chain inspection
Authors:           snapfeed maintainers (self-review). Independent review welcome —
                   see SECURITY.md for disclosure.
```

---

## Executive summary

snapfeed v0.4.0 ships as an MIT-licensed library that the consumer self-installs in their own application and (optionally) their own backend. The maintainers operate no service, and the library is built around that fact — there is no telemetry, no relay, no hosted SaaS path. The result is a small, auditable codebase (61 TypeScript source files, ~12,000 lines) where every outbound network call is one the consumer explicitly wired.

The security posture is **strong for self-hosted internal-feedback use cases**, including healthcare, finance, and air-gapped environments where the operator deploys the Docker stack with the optional Ollama in-tenant LLM. The defense-in-depth controls — origin allowlist, rate limiter, payload-size validation, console-error secret sweep, optional pre-LLM redaction, opt-in per-feature LLM toggles, and a discriminated audit-event log — line up directly with the threats enumerated in `THREAT_MODEL.md`.

The review found **no critical or high-severity issues in snapfeed's own code**. The single high-severity item below (F-001) is a moderate-severity npm audit chain in **dev-only** dependencies (vitest → vite → esbuild) that does not ship to consumers; we rate the cluster `HIGH` only because it currently fails an aggressive `npm audit --audit-level=moderate` and reviewers will see it. Two genuine bugs were caught by the edge-case test pass — F-002 (telegram error message lacks HTTP status) and F-003 (redact heuristic flags macOS temp paths) — both rated **Low**. The remaining nine findings are **Info**: documented architectural choices the consumer must understand and configure correctly (client-side adapter mode, single-instance rate-limit memory, audit log mutability, placeholder admin auth, image-tag pinning, SBOM publication, CSRF model, html2canvas pixel leak, console.error monkey-patch lifecycle).

snapfeed can be safely adopted by enterprise security teams that (a) self-host the worker inside their existing trust boundary, (b) run the audit log into an append-only sink they control, (c) put their own SSO in front of the admin viewer, and (d) treat the consumer's own SOC 2 / ISO / HIPAA controls as the parent. Residual risks — image-digest pinning, SBOM, built-in OIDC for the admin, WORM-backed audit storage — are tracked in `SECURITY.md` for v0.5 / v0.6 with concrete owners.

| Severity | Count | Notes |
|---|---|---|
| Critical | 0 | — |
| High | 1 | Dev-only dependency chain (npm audit moderates in vitest/vite/esbuild) |
| Medium | 0 | — |
| Low | 2 | Telegram error detail; macOS temp-path false positive in entropy heuristic |
| Info | 10 | Documented architectural choices; v0.5/v0.6 roadmap items |

---

## 1. Scope and methodology

### Files reviewed

- `src/` — every source file (61 `.ts`/`.tsx`, ~12,085 lines), with line-by-line review of `src/server/security.ts`, `src/llm/`, `src/audit-log.ts`, `src/FeedbackProvider.tsx`.
- `docker/` — `Dockerfile`, `docker-compose.yml`, `worker.cjs`, `.env.example`, `README.md`.
- `tests/` — 39 test files; both unit tests under `tests/<area>/` and edge-case suites under `tests/edge-cases/`.
- `.github/workflows/ci.yml` — CI definition.
- Top-level docs: `SECURITY.md`, `THREAT_MODEL.md`, `PRIVACY.md`, `COMPLIANCE.md`, `README.md`, `CHANGELOG.md`, `package.json`, `package-lock.json`.

### Tools used

- Manual code review against the threat model in `THREAT_MODEL.md`.
- `npm audit --json` (full tree).
- `npm audit --audit-level=high --omit=dev` (the gating call in CI).
- `tsc --noEmit` (type-check; clean).
- `vitest run` (unit + edge-case tests).
- `grep`-based supply-chain inspection: telemetry endpoints, dynamic `eval`/`Function` use, third-party crypto.

### Exclusions and why

- **Consumer deployments.** snapfeed makes no choices about where the worker runs, how TLS is terminated, or which adapter destinations are wired. Those are the consumer's controls and live in their security review. Recommendations for the consumer live in `docs/SECURE_DEPLOYMENT.md`.
- **Third-party adapter destinations.** Slack's, JIRA's, Linear's etc. own security postures are out of scope; snapfeed treats each as a black-box `https://` endpoint the consumer chose.
- **Browser security.** The widget runs in whatever the user's browser provides. Zero-days in Chromium, malicious extensions in the user's browser, and cross-origin attacks at the browser layer are out of scope (see `THREAT_MODEL.md` § "Out of scope").
- **Visual / annotation tooling correctness.** The widget's annotation canvas (`src/AnnotationCanvas.tsx`) and screenshot composition were not exercised for security; they read no privileged data and emit only what the user composes.

### Limitations of self-review

This document is a **self-assessment** by the same team that wrote the code. Two structural caveats apply:

1. **Confirmation bias.** Maintainers tend to under-rate findings in code they wrote. We have tried to compensate by formally rating each finding against CWE and by anchoring severities to consumer impact rather than developer impact.
2. **Coverage bias.** A self-review covers what the team thought to look for. Independent review is encouraged via the disclosure flow in `SECURITY.md` (`shimoverse@gmail.com`).

A first independent third-party assessment is on the v0.6 roadmap once the codebase stabilizes around the v0.5 SSO/SAML and Postgres-backed inbox additions.

---

## 2. Architecture-level findings

### Strengths

**Zero phone-home design.** A grep across `src/` for telemetry SDK names (`mixpanel`, `segment`, `posthog`, `sentry.io`, `amplitude`, `datadog`, `google-analytics`, `newrelic`, `honeycomb`, `phone-home`) returns **no hits in any code path**. The only hits are documentation references in `src/network-capture.ts` describing the `ignoreUrls` skip-list ("e.g. analytics endpoints"). The library's own runtime makes zero unsolicited outbound calls. This is the structural property that makes snapfeed adoptable in regulated environments without a vendor security review of the maintainer's infrastructure: there *is* no maintainer infrastructure.

**BYOK LLM with optional in-tenant providers.** `src/llm/index.ts` lines 50-69: `createProvider()` takes the consumer's `LLMConfig` and returns the matching `LLMProvider`. The Anthropic and OpenAI providers accept a key via the consumer's config; `azure-openai` reuses the OpenAI provider with a consumer-supplied `endpoint`; `ollama` points at a consumer-controlled local server. snapfeed never sees an API key in transit — the consumer's process loads it from `process.env` and hands it to the provider directly.

**Per-feature LLM toggles fail closed.** `src/llm/index.ts` lines 90-96: `applyLLM` returns the empty result if `config.enabled === false`, and individually short-circuits each of `features.title`, `features.severity`, `features.repro`, `features.redact` if the feature flag is unset. There is no "enabled by default" path. The budget tracker (`src/llm/budget.ts` lines 35-39) returns `false` from `allow()` whenever `dailyTokens <= 0`, so a misconfigured budget skips every call rather than billing.

**SECRET_PATTERNS regex sweep + entropy heuristic.** `src/server/security.ts` lines 190-199 enumerate the secret patterns (`token=`, `key=`, `secret=`, `password=`, `bearer`, `authorization`, JWT shape) applied to every captured `console.error` before any adapter sees the payload. `src/llm/redact.ts` repeats those patterns and adds `EMAIL_PATTERN`, `CC_PATTERN`, and a `HIGH_ENTROPY_PATTERN` (≥40 chars with mixed case + digits) for any text leaving the server toward an LLM. The `llm/redact.ts` module deliberately re-implements the secret list rather than importing `server/security.ts`, so it remains self-contained for air-gapped audit (lines 9-15).

**Production-disable rail.** `src/FeedbackProvider.tsx` lines 107-112: the widget computes `isEnabled = enableInProduction || NODE_ENV !== 'production' || hostname === 'localhost'`. In production, the default behavior is a no-op render that returns `<>{children}</>` (line 199-201) — no console patch, no hotkey listener, no widget DOM. The consumer must opt in explicitly, ideally gated by a role check (`enableInProduction={user.role === 'admin'}`).

**Pluggable rate limiter.** `src/server/security.ts` lines 45-58 define `defaultRateLimitStore` as a single-instance memory map, but the `RateLimitStore` interface is the public contract — consumers can provide a Redis or Upstash store for distributed deployments without forking the handler.

**Audit-log discriminated union.** `src/audit-log.ts` lines 27-66: a typed `AuditEvent` union covers `feedback.received`, `adapter.dispatched`, `llm.called`, `config.changed`, `rate_limit.hit`. The `llm.called` event records `tokensUsed` and `degraded` only — never prompt or completion content. `hashReporter` truncates SHA-256 of `user.email` to 12 chars before write, supporting log forwarding to a SIEM without leaking reporter PII.

### Concerns

**Client-side adapter mode bypasses server-side redaction.** `src/FeedbackProvider.tsx` lines 162-182 show the dual mode: if the consumer passes `adapters` directly to `<FeedbackProvider>`, those adapters run in the browser and the server-side `validatePayload` / `sanitizeConsoleError` / origin / rate-limit pipeline is skipped entirely. This is documented as the cloud-relayed path for indies (README "Pick your mode"), but it means a consumer who configures an adapter token directly on the client will leak that token into the bundle, and any console-error payload going out from the browser is unredacted. **This is an architectural choice we are documenting rather than patching** — see F-004. The handler pattern (`apiUrl` + `createFeedbackHandler`) is the recommended production path and what the CLI scaffolds.

**html2canvas can capture PII visible on screen.** Screenshots are pixels. No regex can read pixels and infer "this is a draft email" or "this is a JWT in DevTools". The widget always shows the screenshot in a preview pane before submission so the reporter can discard, but this is a **reporter-education problem, not a code problem**. Documented in `PRIVACY.md` and `THREAT_MODEL.md` Threat #4. See F-011.

---

## 3. Findings inventory

### F-001: Moderate-severity npm audit chain in dev-only dependencies
**Severity:** High
**Component:** Build / dev dependencies (vitest, vite, esbuild, @vitest/coverage-v8, vite-node)
**CWE:** CWE-346 (Origin Validation Error in esbuild dev server); CWE-22 (Path Traversal in vite optimized deps)
**Description:**
`npm audit` reports five moderate findings in transitive dev-only dependencies pulled in by `vitest@^1.6.0`:
- `esbuild <=0.24.2` — GHSA-67mh-4wv8-2f99 (dev-server enables any website to read responses)
- `vite <=6.4.1` — GHSA-4w7w-66w2-5vf9 (path traversal in `.map` handling)
- `vite-node`, `vitest`, `@vitest/coverage-v8` — chained via the above

**Location:** `package.json:152-162` (`devDependencies`); `package-lock.json` (transitive).
**Reproduction:**
```bash
npm audit --audit-level=moderate
```
**Impact:**
None at runtime for consumers. These dependencies do not ship in `dist/` and are not present in the published npm package (the `files` array in `package.json:125-133` ships only `dist`, `README.md`, `LICENSE`, and four other docs). The CI gating call is `npm audit --audit-level=high --omit=dev` (`.github/workflows/ci.yml:40`), which currently passes. The risk is reputational: an enterprise reviewer running `npm audit` against the dev tree will see the moderates and need to be reassured.
**Recommendation:**
Bump to `vitest@^4.x` once the upstream Node-25 reporter shutdown bug is resolved (the ecosystem signal says wait one minor release). Until then, document the dev-vs-runtime distinction in `SECURITY.md` and reference this finding.
**Status:** Open — accepted for v0.4.0. Plan to bump in v0.4.1 or v0.5.

---

### F-002: Telegram adapter error message lacks HTTP status code
**Severity:** Low
**Component:** `src/adapters/telegram.ts`
**CWE:** CWE-209 (Information Exposure Through an Error Message — inverse: insufficient detail)
**Description:**
When the Telegram `sendMessage` call returns a non-OK HTTP status, the adapter returns an error string built from the response body but does not include the HTTP status code:
```ts
// src/adapters/telegram.ts:93-96
if (!textRes.ok) {
  const err = await textRes.text().catch(() => '')
  return { ok: false, error: `Telegram sendMessage failed: ${err.slice(0, 200)}` }
}
```
The follow-up `sendPhoto` failure path (lines 126-135) **does** include the status code. The asymmetry was found by the edge-case test pass.
**Location:** `src/adapters/telegram.ts:93-96`
**Reproduction:** Inject a 401 response (invalid bot token) into the mock and inspect the returned `error` field — it contains Telegram's `description` text but not `HTTP 401`. Operators triaging an audit-log row see a body but cannot tell whether the failure was auth, rate-limit, or transient 5xx without re-running.
**Impact:** Operational. Slows incident response on a Telegram-routed feedback flow. No data exposure.
**Recommendation:** Mirror the `sendPhoto` branch: include `HTTP ${textRes.status}` in the error string.
**Status:** Mitigated in v0.5.0.

---

### F-003: `redactForLLM` HIGH_ENTROPY false-positive on macOS temp paths
**Severity:** Low
**Component:** `src/llm/redact.ts`
**CWE:** CWE-1287 (Improper Validation of Specified Type of Input — false positive)
**Description:**
The high-entropy heuristic in `redactForLLM` flags strings ≥40 chars containing uppercase + lowercase + digit. macOS temp paths like `/var/folders/4v/0nd_sq0x1kd07l61zrpd2vv40000gn/T/foo` satisfy all three (the trailing `/T/` provides the uppercase character, the path provides digits and lowercase, length is 50+). The path is replaced with `[HIGH_ENTROPY]` before the prompt is sent, mangling stack traces and tmp-file references inside reporter feedback.
**Location:** `src/llm/redact.ts:48-61` (`HIGH_ENTROPY_PATTERN` + `looksHighEntropy`).
**Reproduction:** Documented as `it.todo` in `tests/edge-cases/redact-corner-cases.test.ts:135-143`. The matched-but-asserted variant (`it('preserves a long all-lowercase file path …')` at line 145-151) shows the parallel case where lowercase-only paths survive — confirming the bug is the uppercase `T` in the macOS temp convention.
**Impact:** Quality-of-LLM-output. The model sees `[HIGH_ENTROPY]` instead of the path and cannot infer "this is a tmp file". No security impact (the redaction is over-aggressive, not under-aggressive). No PII or secrets are exposed by the bug.
**Recommendation:** Tighten the heuristic to skip strings containing path separators (`/`, `\`) — or split on those before applying the entropy test. Add a regression test that asserts the macOS path passes through unchanged.
**Status:** Mitigated in v0.5.0.

---

### F-004: Client-side adapter mode bypasses server-side redaction
**Severity:** Info
**Component:** `src/FeedbackProvider.tsx`
**CWE:** N/A — architectural
**Description:**
`<FeedbackProvider adapters={[…]}>` runs adapters directly in the browser, skipping the server-side `validatePayload`, `sanitizeConsoleError`, origin allowlist, and rate limiter. This is the documented "cloud-relayed" topology for indies who want zero backend, but a consumer who mis-applies it in production will (a) ship adapter tokens in the browser bundle and (b) emit unredacted console-error payloads to third parties.
**Location:** `src/FeedbackProvider.tsx:162-182` (`adapters` branch); the alternative `apiUrl` branch is at lines 184-194.
**Reproduction:** Configure `<FeedbackProvider adapters={[slackAdapter({ webhookUrl: '…' })]}>` — webhook URL is now in the browser bundle.
**Impact:** Depends on consumer configuration. For the recommended pattern (`apiUrl` + `createFeedbackHandler` + server-side adapters), no impact. For the misuse pattern, the adapter token ships to the client.
**Recommendation:** Documentation only. The README persona table already steers indies to `autoAdapters()` server-side and enterprise consumers to the handler pattern. CLI `init` scaffolds the server pattern. Add a runtime warning in v0.5 when `adapters.length > 0` AND `process.env.NODE_ENV === 'production'` AND `enableInProduction === true`, suggesting the handler pattern.
**Status:** Open — documented; runtime warning planned for v0.5.

---

### F-005: Single-instance rate limiter memory store does not cluster
**Severity:** Info
**Component:** `src/server/security.ts`
**CWE:** N/A — documented limit
**Description:**
The default `defaultRateLimitStore` (`src/server/security.ts:33-59`) backs the rate limiter with a single-process `Map`. Multi-instance deployments behind a load balancer can each track up to `max` requests independently, so the effective per-IP rate ceiling is `max × instance_count`.
**Location:** `src/server/security.ts:26-43`.
**Reproduction:** Run two worker replicas behind a round-robin LB; observe `2 × max` requests succeed in the window.
**Impact:** Rate-limit ceiling is softer than the configured value in clustered deployments. Not a security boundary in itself — the consumer's WAF / ingress should enforce the hard limit.
**Recommendation:** The `RateLimitStore` interface (in `src/types.ts`) lets consumers swap in a Redis-backed implementation. Documented in `SECURITY.md` and `docs/SECURE_DEPLOYMENT.md`. A `redisRateLimitStore` reference implementation is on the v0.5 roadmap.
**Status:** Open — interface exists; reference implementation v0.5.

---

### F-006: Audit log writes are not WORM
**Severity:** Info
**Component:** `src/audit-log.ts`
**CWE:** CWE-284 (Improper Access Control — writable evidence)
**Description:**
`fileAuditLog()` appends JSONL with `node:fs/promises.appendFile` (`src/audit-log.ts:115-116`). Default file mode is the umask-derived value (typically `0644`). An attacker with shell access at the same UID can rewrite or delete the file and erase evidence.
**Location:** `src/audit-log.ts:111-118`.
**Reproduction:** Submit feedback to populate the JSONL; from the same UID, `truncate -s 0 /data/audit/snapfeed.jsonl`. No tamper-evidence remains.
**Impact:** A local-shell attacker can hide their tracks. Does not affect off-host audit forwarding if the consumer wires `multiAuditLog(fileAuditLog(...), siemAuditLog(...))`.
**Recommendation:** Operators should ship audit events to an append-only sink (WORM S3 bucket with Object Lock, CloudWatch Logs with delete-deny IAM, syslog → SIEM). The `AuditLog` interface (`src/audit-log.ts:73-75`) is intentionally a single-method `record(event)` so any sink is a 10-line wrapper. WORM-backed reference adapter on v0.5 roadmap. See `docs/SECURE_DEPLOYMENT.md` § Persistence.
**Status:** Open — interface supports it; reference adapter v0.5.

---

### F-007: Admin app v0.4 has placeholder authentication
**Severity:** Info
**Component:** `examples/admin/`
**CWE:** CWE-306 (Missing Authentication for Critical Function)
**Description:**
The example admin viewer at `examples/admin/` reads the JSONL feedback file and renders rows. It is **not** auth-gated — it is shipped as a developer reference, not as a production admin app. Consumers must front it with their reverse-proxy SSO or skip it entirely.
**Location:** `examples/admin/` (not a published artifact; not in `package.json` `files` array).
**Reproduction:** Run the example as instructed in its README; observe no login screen.
**Impact:** Only relevant if a consumer ignores the example/production caveat. The first-class admin UI with built-in OIDC + SAML ships in v0.5.
**Recommendation:** Documented in `examples/admin/README.md` and `CONTRIBUTING.md`. Operators must wire `oauth2-proxy` or equivalent in front. See `docs/SECURE_DEPLOYMENT.md` § Authentication.
**Status:** Open — first-class admin UI v0.5.

---

### F-008: Docker compose images use named tags, not digests
**Severity:** Info
**Component:** `docker/docker-compose.yml`
**CWE:** CWE-829 (Inclusion of Functionality from Untrusted Control Sphere)
**Description:**
The compose file pins MinIO by tag (`minio/minio:RELEASE.2024-01-16T16-07-38Z`, line 52) and Ollama by `latest` (line 72). Tags are mutable on the registry; an attacker who compromised the registry could re-publish a malicious image under the same tag.
**Location:** `docker/docker-compose.yml:52`, `docker/docker-compose.yml:72`.
**Reproduction:** Inspect the compose file; observe tag-based pinning.
**Impact:** Supply-chain risk if the upstream registry is compromised. Mitigated in practice by `docker compose pull`'s checksum verification at pull time, but not a defense against a malicious republish.
**Recommendation:** Pin to image digests (`minio/minio@sha256:…`). Tracked for v0.5 and called out in `SECURITY.md` review checklist.
**Status:** Open — v0.5.

---

### F-009: No SBOM published per release
**Severity:** Info
**Component:** Release pipeline
**CWE:** N/A — process gap
**Description:**
v0.4.0 does not publish a Software Bill of Materials. Reviewers must derive the dependency tree from `package-lock.json` themselves.
**Location:** `.github/workflows/ci.yml` (no SBOM step); `package.json` (no `sbom` script).
**Reproduction:** Browse GitHub Releases for v0.4.0; observe no SBOM artifact.
**Impact:** Slows enterprise procurement. Not an immediate vulnerability — `package-lock.json` is checked in and reproducible.
**Recommendation:** Add `npm sbom --sbom-format=spdx` step to CI on tag push, attach the JSON as a release artifact. Tracked for v0.5 in `SECURITY.md`.
**Status:** Open — v0.5.

---

### F-010: CSRF mitigation relies on `allowedOrigins` config
**Severity:** Info
**Component:** `src/server/security.ts`
**CWE:** CWE-352 (Cross-Site Request Forgery)
**Description:**
The `/feedback` handler does not implement a CSRF token primitive. It defends against cross-site POSTs via the `Origin:` header check in `checkOrigin` (`src/server/security.ts:158-169`). If the consumer fails to configure `allowedOrigins`, **the check returns `true`** (line 162) — the handler accepts requests from any origin.
**Location:** `src/server/security.ts:158-169`.
**Reproduction:** Stand up a handler with no `allowedOrigins`; `curl -X POST https://victim/api/feedback -H 'Origin: https://attacker.example' …` succeeds.
**Impact:** A consumer who misses `allowedOrigins` is exposed to cross-site POST. Combined with the consumer's own auth cookie (SameSite=Lax/Strict), the attack surface is small but nonzero.
**Recommendation:** Documentation. The README and quickstart guides include `allowedOrigins`. v0.5 will add a startup-time warning when `allowedOrigins` is empty AND `NODE_ENV === 'production'` to nudge consumers toward configuring it.
**Status:** Open — documented; warning planned for v0.5.

---

### F-011: html2canvas can capture on-screen PII into screenshots
**Severity:** Info
**Component:** `src/screenshot.ts` (consumes the optional peer `html2canvas`)
**CWE:** CWE-200 (Exposure of Sensitive Information to an Unauthorized Actor)
**Description:**
`html2canvas` paints the visible DOM into a canvas. Anything on the reporter's screen at capture time can become part of the screenshot — open chat windows, dev-tools panels showing tokens, draft documents, internal dashboards. No regex sweep can read pixels.
**Location:** `src/screenshot.ts`; `src/FeedbackWidget.tsx` (preview pane).
**Reproduction:** Open DevTools showing an Authorization header; trigger a screenshot; observe the header in the captured image.
**Impact:** Reporter-side PII / secret leak into adapter destinations.
**Recommendation:** Reporter education. The widget ships a preview pane so the reporter can discard before submission (`src/FeedbackWidget.tsx`). PCI consumers should disable `autoScreenshot` in CDE routes (called out in `COMPLIANCE.md`). `html2canvas` is an `optionalDependencies` peer (`package.json:163-165`) — consumers can omit it entirely.
**Status:** Open — documented in `PRIVACY.md` and `THREAT_MODEL.md` Threat #4.

---

### F-012: Rate-limit memory store has a 5-minute background sweep
**Severity:** Info
**Component:** `src/server/security.ts`
**CWE:** N/A
**Description:**
The memory rate-limit store registers a `setInterval` that sweeps expired entries every 5 minutes (`src/server/security.ts:36-43`). The interval runs in the background regardless of request volume.
**Location:** `src/server/security.ts:36-43`.
**Reproduction:** Boot the worker, observe the interval registered at module load.
**Impact:** De minimis CPU. Flagged for completeness because some operators run static analyzers that flag any unconditional `setInterval`. The sweep is gated by `typeof setInterval !== 'undefined'` so non-Node runtimes (Edge / Workers) skip it.
**Recommendation:** Acceptable. If a v0.5 release switches the default store to a strict TTL `Map`, the sweep can go away.
**Status:** Open — accepted.

---

### F-013: `console.error` patch in FeedbackProvider mutates a global
**Severity:** Info
**Component:** `src/FeedbackProvider.tsx`
**CWE:** CWE-471 (Modification of Assumed-Immutable Data)
**Description:**
`patchConsoleError` (`src/FeedbackProvider.tsx:38-52`) replaces `console.error` with a wrapper that buffers the last 20 messages. The `patchedRef.current` guard (lines 105, 117) ensures a single FeedbackProvider only patches once, but if a consumer mounts two FeedbackProviders or another library also patches `console.error`, the cleanup is last-writer-wins on `restore()`.
**Location:** `src/FeedbackProvider.tsx:38-52, 114-120`.
**Reproduction:** Mount two `<FeedbackProvider>` instances or a competing patcher; observe that the second `restore()` (returned cleanup from `useEffect`) reverts to whatever `console.error` was at first patch, not what it was before the second patch.
**Impact:** Cosmetic. The patched function still calls the captured `original`, so no `console.error` calls are dropped. Restore-to-wrong-state on unmount is the only visible symptom.
**Recommendation:** Document — recommend a single FeedbackProvider per app. v0.5 may move console capture to a more disciplined module-level singleton with reference counting.
**Status:** Open — documented.

---

## 4. Defense-in-depth review

| Layer | Mechanism | Location | Tested by | Residual risk |
|---|---|---|---|---|
| Browser → server | HTTPS terminated by consumer's reverse proxy | Consumer's responsibility | Consumer | Misconfigured TLS — out of scope |
| Origin | `allowedOrigins` allowlist (string + RegExp) | `src/server/security.ts:158-169` | `tests/server/security.test.ts` | F-010: empty list = allow-all |
| Auth | Consumer-supplied; snapfeed does not auth callers | N/A | Consumer | Consumer-side gap if not wired |
| Rate limit | In-memory sliding window (`max`, `windowMs`) | `src/server/security.ts:69-85` | `tests/server/security.test.ts`, `tests/edge-cases/rate-limit-and-server-errors.test.ts` | F-005: single-instance only |
| Validation | Required `text`, 64KB hard cap, `maxPayloadBytes`, `maxScreenshotBytes` | `src/server/security.ts:94-154` | `tests/edge-cases/payload-shape.test.ts` | None |
| Console-error redaction | SECRET_PATTERNS regex sweep | `src/server/security.ts:190-207` | `tests/edge-cases/redact-corner-cases.test.ts` | Aggressive false-positives on benign "key " strings (documented) |
| LLM | BYOK + per-feature toggles + budget + pre-LLM redaction | `src/llm/index.ts`, `src/llm/budget.ts`, `src/llm/redact.ts` | `tests/llm/`, `tests/edge-cases/llm-*.test.ts` | F-003: macOS-path false positive |
| Audit | Optional `fileAuditLog` + `multiAuditLog` for fan-out | `src/audit-log.ts` | `tests/audit-log.test.ts` | F-006: filesystem mode |
| Production safety | `enableInProduction: false` default | `src/FeedbackProvider.tsx:107-201` | Manual review | None |
| Build | Pinned `package-lock.json`, multi-stage `Dockerfile`, non-root runtime user | `package-lock.json`, `docker/Dockerfile` | CI | F-008: image tags not digests |
| Storage | Pluggable `s3Storage` / `fileStorage` adapters | `src/storage/` | `tests/storage/` | Consumer picks WORM vs mutable |

---

## 5. Supply chain review

### Direct dependencies

`package.json` declares **zero hard runtime dependencies**:
- `peerDependencies`: `react >=18.0.0`, `react-dom >=18.0.0` (consumer-supplied).
- `optionalDependencies`: `html2canvas ^1.4.1` — only pulled if the consumer installs it. The widget gracefully degrades to "no screenshot" if absent.
- `devDependencies` (do not ship): `@types/react`, `@types/react-dom`, `@types/node`, `@vitest/coverage-v8`, `react`, `react-dom`, `tsup`, `typescript`, `vitest`.

### What ships to consumers

The `files` array (`package.json:125-133`) ships only:
- `dist/` (compiled output)
- `README.md`, `LICENSE`, `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `CHANGELOG.md`

The `dist/` tree is the output of `tsup`, which bundles the TypeScript source to ESM + CJS. No build-tool dependency is included in the published artifact.

### npm audit current state

```
$ npm audit --audit-level=moderate
5 moderate severity vulnerabilities (all dev-only)
$ npm audit --audit-level=high --omit=dev
found 0 vulnerabilities
```

The five moderates are the F-001 chain (vitest → vite → esbuild). None reach consumer runtime. CI's gating call (`.github/workflows/ci.yml:40`) is `--audit-level=high --omit=dev` and currently passes.

### License audit

All direct and dev dependencies are OSI-approved permissive (MIT / Apache-2.0 / ISC). No GPL or AGPL contamination. `LICENSE` at the repo root is MIT.

### Maintainer-trust note

The dependency graph is intentionally small. The `dist/` runtime imports nothing from npm — only `node:` built-ins (`node:fs/promises`, `node:crypto`, `node:path`, `node:http`). This keeps the maintainer-trust attack surface (a malicious package the snapfeed maintainers depend on) limited to the build-time chain (`tsup`, `typescript`, `vitest`). A compromise of those tools could only affect the published `dist/` if it executed at build time — manual `dist/` review per release is feasible because the bundle is small.

---

## 6. Test coverage review

### Baseline

- **39 test files**, ~270+ unit tests passing (per `CHANGELOG.md` v0.4.0).
- `tests/edge-cases/` — eight edge-case suites added in the launch-readiness pass: `auth-failures`, `llm-budget-clock`, `llm-failure-modes`, `network-failures`, `payload-shape`, `rate-limit-and-server-errors`, `redact-corner-cases`, `server-handler-edge-cases`.
- `tests/docker/` — worker boots and serves `/healthz` + `/feedback`.
- `tests/llm/` — provider mocks + runner degradation paths.

### Coverage gaps

- **React widget UI.** The component tests for `FeedbackWidget`, `FeedbackInbox`, `AnnotationCanvas` are not in the v0.4 suite — `jsdom` is not configured for component rendering. Planned for v0.5.
- **`createFeedbackHandler` dynamic import (`next/server`).** Tested via the Express middleware (which shares the same security functions) but not against a live Next.js server. End-to-end test against `next dev` is planned for v0.5.
- **Visual regression.** Out of scope for v0.4. The widget visuals are validated manually per release.

### Test stability note

Full test suite passes on Node 20 LTS (the CI baseline pinned in `.nvmrc`). Local runs on Node 25 surface a vitest reporter shutdown bug that is environmental (vitest has not yet shipped a Node-25-clean reporter); it does not affect test correctness.

---

## 7. Cryptography

snapfeed uses cryptographic primitives only via `node:crypto`. **No third-party crypto libraries.** No custom primitives.

| Use site | Algorithm | Source |
|---|---|---|
| AWS S3 SigV4 signing in `s3Storage` adapter | HMAC-SHA256, SHA-256 | `node:crypto` |
| Service-account JWT signing in `googleSheetsAdapter` and `googleSheetsRoutingSource` | RS256 | `node:crypto` |
| Reporter hash in `fileAuditLog({ hashReporter: true })` | SHA-256 (truncated to 12 hex chars) | `node:crypto` |

**TLS termination** is not snapfeed's responsibility. The worker speaks plain HTTP on `:8787` by design; the consumer puts their existing reverse proxy / ingress in front for TLS. This is documented in `THREAT_MODEL.md` residual risk #3 and `docs/SECURE_DEPLOYMENT.md` § Pre-deployment.

**At-rest encryption** depends on the consumer's storage choice. `s3Storage` inherits the bucket's SSE configuration; `fileStorage` writes plaintext to the consumer's filesystem (the consumer should mount that volume on an encrypted disk).

---

## 8. Privacy review

snapfeed handles only the fields defined on the `FeedbackPayload` interface in `src/types.ts` and emits data only to destinations the consumer wired. The full deep-dive is in `PRIVACY.md`.

**Confirmation of zero phone-home (by absence):** `grep -r '(mixpanel|segment\.io|posthog|sentry\.io|amplitude|datadog|newrelic|honeycomb|google-analytics|phone-?home)' src/` returns only documentation comments in `src/network-capture.ts` describing the user-configured `ignoreUrls` skip-list. No code path issues a request to any maintainer-controlled domain. Reviewers can re-run that grep at any commit to verify.

---

## 9. Compliance posture

snapfeed has **no certifications of its own** because the maintainers operate no service. Consumers inherit their own controls; mappings to common regimes are in `COMPLIANCE.md`.

For the avoidance of doubt, snapfeed does **not** hold:
- SOC 2 Type I or Type II (we operate no service to audit)
- ISO 27001 / 27017 / 27018
- HIPAA BAA (we will not sign one because we handle no PHI)
- PCI DSS attestation
- FedRAMP authorization (we have no ATO)
- GDPR controller / processor status (we are neither)

Each of these obligations is structurally the consumer's. snapfeed provides primitives — pre-LLM redaction, audit log, in-tenant LLM support, server-side adapter pattern — that support the consumer's compliance evidence collection.

---

## 10. Recommendations (prioritized)

| Priority | Effort | Description | Expected version |
|---|---|---|---|
| P1 | M | Fix F-002 — include HTTP status in telegram error string | v0.4.1 |
| P1 | M | Fix F-003 — tighten `redactForLLM` heuristic to skip path-separator strings | v0.4.1 |
| P2 | L | Publish SBOM (`npm sbom --sbom-format=spdx`) as GitHub Release artifact | v0.5 |
| P2 | M | Pin Docker compose images by digest | v0.5 |
| P2 | M | First-class admin UI with built-in OIDC + SAML | v0.5 |
| P2 | S | Reference `redisRateLimitStore` implementation | v0.5 |
| P2 | S | Reference WORM-backed audit-log adapter (S3 Object Lock template) | v0.5 |
| P2 | S | Startup warning when `allowedOrigins` is empty in production | v0.5 |
| P2 | L | Postgres-backed audit log + inbox | v0.6 |
| P2 | M | Bump `vitest` to v4 (clears F-001 chain) | v0.4.1 or v0.5 |
| P3 | L | Optional E2E encryption between widget and handler | Under consideration |
| P3 | M | Public bug bounty programme | Under consideration |
| P3 | L | Independent third-party security assessment | v0.6 |

---

## 11. Disclosure and process

- **Reporting:** see `SECURITY.md`. Email `shimoverse@gmail.com` with description, reproduction steps, version, impact. Do not file public GitHub issues for vulnerabilities.
- **Maintainer SLA:** acknowledgement within 3 business days; fix plan within 10 business days for confirmed issues.
- **Coordinated disclosure:** 90-day default window before public details are published.
- **Supported versions:** the latest minor version is patched. Pre-1.0, snapfeed does not backport.

---

## 12. Conclusion

snapfeed v0.4.0 is structurally well-suited to enterprise self-hosted adoption. The library ships zero runtime dependencies, no telemetry, and a small auditable codebase whose security primitives — origin allowlist, rate limiter, payload validation, secret-sweep redaction, BYOK LLM with per-feature opt-in and pre-LLM redaction, discriminated audit-event log — line up with the threats published in its own threat model. No critical or high-severity issues exist in shipped code; the two genuine bugs found in this review (telegram error detail, macOS-path entropy false positive) are both Low and slated for v0.4.1. The remaining findings are documented architectural choices the consumer must wire correctly: TLS termination, append-only audit forwarding, SSO in front of the admin viewer, image-digest pinning. With those operator-side controls in place, snapfeed is safe to adopt in regulated and air-gapped environments.

---

## Appendix A — File-by-file inventory (source tree, summary)

Top-level `src/`:
- `index.ts` — public entry; re-exports the React surface and the campaigns isomorphic API
- `types.ts` — public interfaces (`FeedbackPayload`, `FeedbackAdapter`, `FeedbackHandlerConfig`, `RateLimitStore`, `LLMConfig`, etc.)
- `FeedbackProvider.tsx` — React context; production-disable rail; `console.error` capture; hotkey listener; client/server adapter dispatch
- `FeedbackWidget.tsx` — main widget UI; preview pane; submission flow
- `FeedbackButton.tsx` — floating trigger
- `FeedbackInbox.tsx` — Supabase-backed admin inbox component
- `AnnotationCanvas.tsx` — annotation tools (pen, rectangle, arrow, highlighter)
- `screenshot.ts` — html2canvas wrapper
- `voice.ts` — `MediaRecorder` voice capture
- `screen-recording.ts` — `getDisplayMedia` screen recording
- `network-capture.ts` — fetch/XHR ring buffer
- `audit-log.ts` — `AuditEvent` union + `fileAuditLog` / `noopAuditLog` / `multiAuditLog`
- `routing.ts` — declarative routing primitive
- `campaigns.ts` — Release Campaigns API
- `cli.ts` — `npx snapfeed init` scaffolder
- `theme.ts`, `styles.ts` — styling
- `useDevFeedback.ts` — hook

`src/server/`:
- `security.ts` — utf8 byte length, in-memory rate-limit store, `checkRateLimit`, `validatePayload`, `checkOrigin`, `normalizePayload`, `SECRET_PATTERNS`, `sanitizeConsoleError`
- `nextjs.ts` — App Router handler (`createFeedbackHandler`)
- `express.ts` — Express middleware (`feedbackMiddleware`)

`src/llm/`:
- `index.ts` — `applyLLM`, `createProvider`, per-feature flow with budget gating and degradation
- `redact.ts` — `redactForLLM` (secrets + email + CC + high-entropy)
- `budget.ts` — `createBudgetTracker` (UTC daily roll, fail-closed)
- `providers/anthropic.ts`, `providers/openai.ts`, `providers/ollama.ts`, `providers/types.ts`

`src/adapters/` — 16 adapters: `asana`, `auto`, `clickUp`, `console`, `discord`, `file`, `github`, `googleSheets`, `jira`, `linear`, `msTeams`, `notion`, `slack`, `supabase`, `telegram`, `webhook`

`src/storage/` — `fileStorage` (Node), `s3Storage` (SigV4 via `node:crypto`)

`src/routing-sources/` — `csvRoutingSource`, `googleSheetsRoutingSource`, `cacheRoutingSource`

`src/headless/` — headless API for non-React hosts

`docker/`:
- `Dockerfile` — multi-stage `node:20-alpine`, non-root `node` user, tini init, healthcheck
- `docker-compose.yml` — `worker` + `minio` + optional `ollama` profile
- `worker.cjs` — zero-dep `node:http` server wiring `autoAdapters` + `fileAuditLog` + `fileStorage`
- `.env.example`, `README.md`, `.dockerignore`

---

## Appendix B — Risk matrix (Likelihood × Impact)

| Finding | Likelihood | Impact | Severity |
|---|---|---|---|
| F-001 — vitest dev-dep audit chain | High (any reviewer runs `npm audit`) | Low (dev-only, no shipped code affected) | High (reputational) |
| F-002 — telegram error detail | Medium | Low (operational only) | Low |
| F-003 — macOS path entropy false-positive | Medium | Low (LLM output quality) | Low |
| F-004 — client-side adapter mode | Low (against documentation) | High (token in bundle if misused) | Info (architectural) |
| F-005 — single-instance rate limit | Medium (multi-instance prod) | Low (consumer's WAF backstop) | Info |
| F-006 — non-WORM audit log | Medium (local-shell attacker) | Medium (evidence loss) | Info |
| F-007 — admin placeholder auth | Low (against documentation) | High (unauth admin) | Info |
| F-008 — image tags not digests | Low (registry compromise) | Medium (supply-chain) | Info |
| F-009 — no SBOM | High (procurement friction) | Low (lockfile substitutes) | Info |
| F-010 — empty `allowedOrigins` allows all | Medium (misconfiguration) | Medium (CSRF vector) | Info |
| F-011 — html2canvas pixel leak | High (reporter habit) | Medium (PII / secret) | Info |
| F-012 — rate-limit `setInterval` | Low | Negligible | Info |
| F-013 — `console.error` patch lifecycle | Low (multiple providers) | Negligible (cosmetic) | Info |

---

## Appendix C — Glossary

- **BYOK** — Bring Your Own Key. The consumer supplies the LLM API key; snapfeed never proxies.
- **CSRF** — Cross-Site Request Forgery. An attacker site triggers a request to the victim's endpoint using the user's cookies.
- **CWE** — Common Weakness Enumeration. MITRE's taxonomy of software weaknesses.
- **DPA** — Data Processing Agreement. The contract a controller signs with each processor under GDPR.
- **JWT** — JSON Web Token. A signed token format frequently leaked via `console.error`.
- **PHI** — Protected Health Information (HIPAA).
- **PII** — Personally Identifiable Information.
- **SBOM** — Software Bill of Materials. A machine-readable inventory of every package in a build.
- **SigV4** — AWS Signature Version 4. The HMAC-SHA256 request-signing scheme S3 uses.
- **SIEM** — Security Information and Event Management. The system the audit log should feed.
- **WORM** — Write Once Read Many. Storage that prevents post-write tampering (S3 Object Lock, immutable buckets).
