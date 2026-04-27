# Security Policy

## Related documents

- **[THREAT_MODEL.md](./THREAT_MODEL.md)** — assets, trust boundaries, threat actors, mitigations
- **[PRIVACY.md](./PRIVACY.md)** — what data is handled and where it goes
- **[COMPLIANCE.md](./COMPLIANCE.md)** — GDPR / CCPA / HIPAA / SOC 2 / PCI / ISO posture
- **[docs/SECURITY_REPORT.md](./docs/SECURITY_REPORT.md)** — full audit-style assessment with 13 numbered findings
- **[docs/SECURE_DEPLOYMENT.md](./docs/SECURE_DEPLOYMENT.md)** — operator hardening guide (network, container, persistence, monitoring)
- **[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)** — system architecture with Mermaid diagrams (sections 5-6 cover trust boundaries and threat surface)
- **[legal/DPA-template.md](./legal/DPA-template.md)** — Data Processing Addendum template

## Reporting a vulnerability

If you discover a security vulnerability in snapfeed, please **do not open a public GitHub issue**.

Instead, email **shimoverse@gmail.com** with:

- A description of the vulnerability
- Steps to reproduce
- The version affected (`npm list snapfeed` or commit SHA)
- Your assessment of the impact

You should expect an acknowledgement within **3 business days** and a fix plan within **10 business days** for confirmed issues.

We follow coordinated disclosure: please give us a reasonable window to ship a fix before publishing details.

## Supported versions

We patch security issues on the latest minor version. While snapfeed is pre-1.0, we do not backport to earlier versions.

| Version | Supported |
|---------|-----------|
| Latest minor | ✅ |
| Older versions | ❌ — please upgrade |

---

## Security review checklist (for teams evaluating snapfeed)

If your security team needs to approve snapfeed before adoption, here is what they will likely ask. Tick each item against the current release.

### Data flow

- [x] **Zero phone-home.** snapfeed makes no telemetry, analytics, or "update check" calls to any domain we control. The only outbound calls are to adapters you explicitly configure.
- [x] **Outbound allowlist.** Only the destinations you wire up (Slack webhook, JIRA URL, your Postgres, etc.) receive data.
- [x] **Self-hostable.** All server code can run inside your VPC. No required SaaS dependency.
- [x] **Open source, MIT.** Audit the full source tree. No CLA, no obligation.

### LLM / GenAI usage

- [x] **LLM is optional.** snapfeed works fully without any GenAI calls. Every smart feature degrades gracefully (see "LLM degradation table" in the README).
- [x] **Bring your own key.** When LLM is enabled, you supply the API key and provider. snapfeed never proxies through our servers.
- [x] **In-tenant LLMs supported.** Compatible with Azure OpenAI in your tenant, AWS Bedrock in your account, and self-hosted Ollama / vLLM. No data leaves your boundary.
- [x] **Server-side only.** API keys are never exposed to the browser bundle.
- [x] **Pre-LLM redaction.** Optional regex pass strips emails, tokens, and high-entropy strings before any LLM call.

### Secrets & data handling

- [x] **Secrets stay server-side.** Adapter tokens (Slack webhook, GitHub PAT, Supabase service key) are read from `process.env` on the server and are never sent to the client.
- [x] **Console error redaction.** A built-in regex pass strips `token=`, `key=`, `secret=`, `Authorization`, and JWT-shaped strings from captured console errors before they leave the browser.
- [x] **Payload size caps.** 10 KB text + 5 MB screenshot by default; configurable.
- [x] **Origin allowlist.** Server handler rejects requests from non-allowlisted origins when configured.
- [x] **Rate limiting.** In-memory by default; Redis/Upstash supported for distributed deployments.

### Production safety

- [x] **Disabled in production by default.** Widget is a no-op unless `enableInProduction: true` is set explicitly.
- [x] **Role-scopable.** When enabled in production, you can scope by user role: `enableInProduction={user.role === 'admin'}`.

### Build & supply chain

- [x] **Pinned dependencies.** `package-lock.json` checked in.
- [x] **Minimal runtime dependencies.** Zero hard runtime deps; `html2canvas` is an optional peer.
- [x] **No `eval`, `Function()`, or dynamic remote imports** in the bundle.
- [x] **Audit log primitive shipped** in v0.4 — `snapfeed/audit-log` exposes `fileAuditLog`, `noopAuditLog`, `multiAuditLog` with a discriminated `AuditEvent` union for `feedback.received`, `adapter.dispatched`, `llm.called`, `config.changed`, `rate_limit.hit`. Wire into `FeedbackHandlerConfig.onReceive` / `onComplete`.
- [x] **Self-hostable Docker stack shipped** in v0.4 — `docker/docker-compose.yml` runs the worker + MinIO (+ optional Ollama for in-tenant LLM). No outbound calls during build or runtime beyond what you configure.
- [ ] **SBOM published per release.** _Slipped to v0.6 (`npm sbom` + GitHub Actions artifact)._
- [ ] **Reproducible builds.** _Partially: `package-lock.json` pinned + `Dockerfile` builds deterministically. Image digests still TODO for v0.6._

### Coming in later releases

- [x] **Retention policy + GDPR right-to-erasure.** Time-based retention (`pruneOlderThan({ retentionDays: N })`) shipped in v0.6. User-initiated deletion (`deleteByUserId(reporter, { auditLog, storage })`) shipped in v0.7 — see [`docs/gdpr.md`](./docs/gdpr.md).
- [ ] **SSO/SAML for admin.** OIDC + SAML for the self-hosted admin app. _Slipped to v0.6._
- [x] **Image digest pinning** in `docker/docker-compose.yml`. Shipped in v0.6 — compose file pins to specific tags (no `:latest`) and `./docker/pin-digests.sh` resolves + applies sha256 digests for supply-chain-grade reproducibility.

---

## What snapfeed does **not** do

- We do not run a hosted SaaS. You install snapfeed in your own infrastructure.
- We do not collect any telemetry from installs.
- We do not require you to sign a CLA to contribute.
- We do not have a "free tier" or paid tier — the library is MIT, period.

If a future release ever changes any of the above, it will be called out in the changelog and require a major version bump.
