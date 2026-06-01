# Secure Deployment Guide — snapfeed

> **Hardening guide for self-hosted operators.** Audience: SRE / DevOps / security ops standing up the snapfeed worker inside a corporate environment. Pair with `SECURITY.md` (review checklist), `THREAT_MODEL.md` (what we defend against), `PRIVACY.md` (data handling), `COMPLIANCE.md` (regime mapping), and `docs/SECURITY_REPORT.md` (audit findings).

This is a checklist, not prose. Tick items as you complete them. The defaults snapfeed ships are safe for development; the items below are what you add for production.

Last updated: 2026-06-01 (snapfeed v0.6.0)

---

## 1. Pre-deployment

### Image build hardening

- [ ] Build the worker image from `docker/Dockerfile` in your own pipeline (do not pull pre-built images from public registries unless your organization has verified the image provenance).
- [ ] Pin the `node:20-alpine` base image to a digest in your fork of `docker/Dockerfile`:
      ```dockerfile
      FROM node:20-alpine@sha256:<your-pinned-digest> AS builder
      ```
- [ ] Sign your built image with `cosign`:
      ```bash
      cosign sign --key <kms-key> registry.your-corp.com/snapfeed/worker:0.6.0
      ```
- [ ] Generate an SBOM at build time (until upstream release automation publishes one):
      ```bash
      npm sbom --sbom-format=spdx --omit=dev > snapfeed-sbom.spdx.json
      ```
- [ ] Scan the built image with your container scanner (Trivy, Grype, Snyk) against your CVE policy.

### Secrets management

Never bake secrets into the image. Use your secret store (HashiCorp Vault, AWS SSM Parameter Store, Sealed Secrets, Doppler, 1Password, etc.) and inject at runtime.

Sensitive environment variables the worker reads:

| Variable | What it grants | Storage |
|---|---|---|
| `SNAPFEED_SLACK_WEBHOOK` | Post to a Slack channel | Vault / SSM |
| `SNAPFEED_DISCORD_WEBHOOK` | Post to a Discord channel | Vault / SSM |
| `SNAPFEED_GITHUB_TOKEN` | Open issues in a configured repo | Vault / SSM |
| `SNAPFEED_TELEGRAM_BOT_TOKEN` | Send messages as the bot | Vault / SSM |
| `SNAPFEED_WEBHOOK_URL` | Generic POST destination | Vault / SSM |
| `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` | Full admin on the MinIO instance | Vault / SSM (rotate quarterly) |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `AZURE_OPENAI_API_KEY` / AWS credentials for Bedrock | Billable LLM access | Vault / SSM (rotate quarterly) |
| Any other adapter token | See the adapter's README | Vault / SSM |

Non-sensitive config (`SNAPFEED_AUDIT_LOG_PATH`, `SNAPFEED_UPLOAD_DIR`, `SNAPFEED_RATE_LIMIT_MAX`, `WORKER_PORT`, `ALLOWED_ORIGINS`) can sit in `docker/.env` checked into your GitOps repo.

### TLS

The worker speaks plain HTTP on `:8787` by design. **Never expose port 8787 directly to the internet.**

- [ ] Front the worker with your existing reverse proxy (nginx, Traefik, Envoy, Caddy, ALB) terminating TLS 1.2+.
- [ ] Recommended: mTLS between the widget origin and the handler if both are inside your VPC.
- [ ] HSTS, OCSP stapling, modern cipher suite per your standard.

### Reverse proxy snippet (nginx + oauth2-proxy)

```nginx
# /etc/nginx/conf.d/snapfeed.conf
server {
  listen 443 ssl http2;
  server_name feedback.internal.your-corp.com;

  ssl_certificate     /etc/ssl/your-corp.crt;
  ssl_certificate_key /etc/ssl/your-corp.key;

  client_max_body_size 11m;        # match SNAPFEED_MAX_BODY_BYTES default
  proxy_read_timeout 30s;

  # Public widget endpoint — no auth, but origin checked by snapfeed
  location = /feedback {
    proxy_pass http://snapfeed-worker:8787/feedback;
    proxy_set_header X-Forwarded-For $remote_addr;       # OVERWRITE, not append
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header Origin $http_origin;
  }

  location = /healthz {
    proxy_pass http://snapfeed-worker:8787/healthz;
  }

  # Admin viewer — auth-gated via oauth2-proxy
  location /admin/ {
    auth_request /oauth2/auth;
    error_page 401 = /oauth2/sign_in;
    proxy_pass http://snapfeed-admin:3000/;
  }

  location /oauth2/ {
    proxy_pass http://oauth2-proxy:4180;
  }
}
```

---

## 2. Network

- [ ] **Outbound allowlist** at the security group / VPC firewall: permit only the destinations you wired (Slack webhook host, your JIRA host, your LLM endpoint, MinIO if external). Default-deny everything else. snapfeed itself enforces no egress restriction — that is your network layer's job.
- [ ] **WAF rules:**
  - Rate-limit by source IP at the WAF in addition to snapfeed's own limiter (defense in depth — snapfeed's limiter is single-instance per F-005 in `docs/SECURITY_REPORT.md`).
  - Body size limit ≤ 11 MB (matches `SNAPFEED_MAX_BODY_BYTES` default; covers a 5 MB screenshot base64-expanded).
  - URI length limit (e.g. 8 KB) — `pageUrl` lives in the body, not the URI, so the URI itself is short.
- [ ] **Internal-only listener.** The worker binds `0.0.0.0:8787`. Use Docker network isolation or a private subnet so only the reverse proxy reaches it.
- [ ] **Trusted proxy chain.** Make sure your LB / ingress *overwrites* `X-Forwarded-For` rather than appending — see `THREAT_MODEL.md` Threat #12. The worker (`docker/worker.cjs:228-233`) reads the first hop of `X-Forwarded-For`.

---

## 3. Container hardening

- [x] **Non-root user.** Already implemented — `docker/Dockerfile:46` switches to `USER node` after copying artifacts.
- [ ] **Read-only root filesystem.** Add to your runtime spec:
      ```yaml
      securityContext:
        readOnlyRootFilesystem: true
      ```
      The worker only writes to `/data/audit` and `/data/uploads`, which are mounted volumes. No writes to `/app`.
- [ ] **Drop capabilities.** The worker needs none beyond default. Add:
      ```yaml
      securityContext:
        capabilities:
          drop: ["ALL"]
      ```
      Add `CAP_NET_BIND_SERVICE` only if you map port < 1024 (the default `8787` does not need it).
- [ ] **AppArmor / seccomp profile.** Use your platform's default (Docker `runtime/default`, Kubernetes `RuntimeDefault`). Custom profiles are unnecessary for the worker's syscall set.
- [ ] **Resource limits.** Sufficient for ~100 req/min:
      ```yaml
      resources:
        requests: { cpu: "100m", memory: "128Mi" }
        limits:   { cpu: "200m", memory: "256Mi" }
      ```
      Increase `memory.limits` to 512Mi if you enable LLM features (provider clients buffer responses).
- [ ] **Restart policy.** `unless-stopped` (compose) or `Always` (Kubernetes).
- [ ] **PID 1.** Already handled — `docker/Dockerfile:53` uses `tini` so signals propagate cleanly to the Node process.

---

## 4. Persistence

### Audit log volume

- [ ] Mount `/data/audit` on a separate volume from the application root (already in `docker/docker-compose.yml:45`).
- [ ] Set restrictive permissions on the host: `chmod 0700 ./data/audit && chown <node-uid>:<node-gid> ./data/audit`.
- [ ] **Forward to SIEM in real time.** Either tail the JSONL with Vector / Fluent Bit / Filebeat, or wrap the audit log:
      ```ts
      // In your worker config
      auditLog: multiAuditLog(
        fileAuditLog({ path: '/data/audit/snapfeed.jsonl', hashReporter: true }),
        siemAuditLog({ endpoint: process.env.SIEM_INGEST_URL! }),  // your impl
      )
      ```
- [ ] **Daily backup** of the JSONL to long-term storage (S3 with versioning + Object Lock for WORM semantics).
- [ ] Set `hashReporter: true` (`docker/worker.cjs` env: `SNAPFEED_HASH_REPORTER=true`) when forwarding off-host so reporter emails are SHA-256 truncated rather than plaintext.

### Uploads volume

- [ ] If using `s3Storage`, configure bucket lifecycle policy to delete after your retention period.
- [ ] If using `fileStorage` to local disk, run `logrotate` against `/data/uploads` per your retention.
- [ ] Encrypt the underlying volume at rest (LUKS / EBS SSE / etc.).

### Status / health

- [ ] `GET /healthz` should be scraped by your orchestrator's liveness probe but NOT exposed publicly. Restrict via reverse-proxy ACL.

---

## 5. Authentication

### Admin app (until built-in OIDC ships)

- [ ] Front the admin viewer with `oauth2-proxy` + your IdP (Okta, Azure AD, Auth0, Google Workspace).
- [ ] Service-principal accounts only — no shared logins.
- [ ] MFA required at the IdP.
- [ ] Restrict to a security group (e.g. `snapfeed-admins`) at the IdP, not in oauth2-proxy.

### Worker `/feedback` endpoint

- The widget's POST is treated as same-origin from the consumer's app. snapfeed itself does not authenticate the caller — it relies on:
  - The `Origin:` allowlist (`ALLOWED_ORIGINS` env var; rejected with 403 if the header is missing or unlisted).
  - The consumer's existing auth cookie (SameSite=Lax/Strict at minimum).
- [ ] Configure `ALLOWED_ORIGINS` explicitly in production. **Empty list = allow all** (per F-010 in `docs/SECURITY_REPORT.md`).
- [ ] If you want hard auth on `/feedback`, front it with the same `oauth2-proxy` you use for the admin app.

### LLM provider keys

- [ ] Rotate quarterly. Set a calendar reminder.
- [ ] Use the lowest-privilege key your provider offers (Anthropic project-scoped keys, OpenAI per-project API keys).
- [ ] If your provider supports IP allowlisting on the key (Azure OpenAI, Bedrock), restrict to your worker's egress IP.

---

## 6. Authorization

Currently:
- The admin app has placeholder auth — wire your reverse proxy.
- The worker handler has no role model — every authenticated caller has the same write capability.

Current production guidance:
- Keep the admin viewer behind your existing reverse-proxy SSO/OIDC layer.
- Enforce RBAC at the proxy or ingress before traffic reaches the admin app (for example, require `X-Auth-Roles: snapfeed-admin`).
- Gate the feedback route with your app's existing same-origin session/auth checks before calling the handler when role-level restrictions matter.

Built-in OIDC/SAML, role-based admin filtering, and per-route authorization hooks remain roadmap items; do not assume they are available in v0.6.

---

## 7. Logging and monitoring

### Metrics

- v0.4: no Prometheus scrape endpoint. Parse the audit log JSONL.
- Planned `/metrics` endpoint exposing `feedback_received_total`, `adapter_dispatched_total{adapter,ok}`, `llm_called_total{provider,degraded}`, `rate_limit_hit_total`.

### Alerts

Wire alerts on:

- [ ] HTTP 4xx rate > 10% over 5 min — likely misconfigured `ALLOWED_ORIGINS` or upstream auth issue.
- [ ] HTTP 5xx rate > 0.5% over 5 min — worker or adapter regression.
- [ ] p99 latency > 1 s — adapter destination slow / LLM provider degraded.
- [ ] **Audit log gap > 1 min** — possible tampering or disk full.
- [ ] **`SECRET_PATTERNS` regex never fires for 24 h** while feedback volume > 0 — suggests the redaction code path was bypassed (regression alarm).
- [ ] LLM `degraded: true` rate > 20% — budget exhausted, provider down, or model choice broken.

### Log retention

- [ ] Audit log: 90 days hot in SIEM, 7 years cold in WORM bucket (or per your regulatory regime).
- [ ] Application log (`stdout` from the worker): 30 days hot.
- [ ] Reverse-proxy access log: 90 days hot.

---

## 8. Backup and DR

- [ ] **Audit log:** rsync-style daily snapshot to your long-term store. S3 with `Object Lock` (compliance mode) gives you WORM.
- [ ] **Uploads:** included in the bucket's normal backup policy if using `s3Storage`; daily `tar` snapshot if using `fileStorage` on local disk.
- [ ] **Worker config:** stored in your GitOps repo (Argo / Flux / Terraform). Recoverable from `git`.
- [ ] **DR drill:** monthly. Steps:
  1. Pull the latest signed image to a clean host.
  2. Restore the audit log from the most recent backup.
  3. Replay the last 24 h of audit events into a staging SIEM index.
  4. Validate the worker passes `GET /healthz` and that a sample `POST /feedback` round-trips through every configured adapter.
- [ ] Document your RTO / RPO for the worker explicitly. Suggested baseline: RTO 1 h, RPO 24 h (audit log) / 1 h (uploads).

---

## 9. Updates

- [ ] Subscribe to GitHub Releases for `shimoverse/snapfeed` (RSS or webhook).
- [ ] Pin to a minor version range in `package.json`: `"snapfeed": "^0.6.0"` — accepts patch updates, blocks minors that may include breaking changes.
- [ ] Change-management ticket required for major-version bumps. Review `CHANGELOG.md` for breaking changes and run your full test suite against the new version in staging first.
- [ ] **Security patches:** maintain a hotfix branch in your fork. On a CVE in snapfeed or a runtime dep, cherry-pick the fix, build, redeploy within your patch SLA.
- [ ] Subscribe to `npm audit` notifications via your dependency scanner (Dependabot, Snyk, Renovate) so you see runtime CVEs the day they land.

---

## 10. LLM-specific hardening

- [ ] **Always set `redactBeforeLLM: true`** in your `LLMConfig` so emails, JWTs, credit-card-shaped numbers, and high-entropy tokens are stripped before any prompt.
- [ ] Set per-feature toggles to the minimum that achieves your value. If you only want auto-generated titles, enable `features.title` and leave `severity` / `repro` / `redact` off.
- [ ] **Set `budget.dailyTokens`** to a hard ceiling. This caps the blast radius of a runaway prompt loop or a compromised API key.
- [ ] For full air-gap: `provider: 'ollama'` with a locally-hosted model. The Docker stack ships an `ollama` profile (`docker compose --profile llm up`).
- [ ] For in-tenant cloud LLM: `provider: 'azure-openai'` with an Azure resource in your subscription, or `provider: 'bedrock'` with AWS Bedrock in your account.
- [ ] Quarterly review:
  - Top providers used (from audit log `llm.called` events).
  - Top features (`feature` field on the same event).
  - Drift in `tokensUsed` per call (sudden spikes = prompt regression).
  - Drift in `degraded: true` rate (sudden rises = provider or budget issue).

---

## 11. Compliance evidence collection

- [ ] **Quarterly:** export the last 90 days of audit log events to your SIEM, generate the standard SOC 2 / ISO dashboards, attach the screenshot to your control evidence binder.
- [ ] **Annual:** re-run `npm audit`, re-tick this checklist, file the evidence in your internal compliance portal. Note any new findings against snapfeed's own roadmap (`SECURITY.md` "Coming in later releases").
- [ ] **Per-release:** code signoff in your change-management process, attach the upstream `CHANGELOG.md` entry and your internal regression test result.

---

## 12. Incident response

### LLM key leaked

1. Rotate the key immediately at the provider console.
2. Update `ANTHROPIC_API_KEY` (or equivalent) in your secret store; restart the worker pod / container.
3. Review audit log `llm.called` events for the leak window — look for unexpected `tokensUsed` spikes or unfamiliar `feature` patterns.
4. Document via your standard incident process. If billable abuse is suspected, contact the provider's billing support.

### Abnormal feedback volume in audit log

1. Drain the worker (set behind a 503 page; wait 60 s for in-flight requests).
2. Pull the audit log for the spike window into your SIEM and run your standard anomaly query.
3. Tighten `ALLOWED_ORIGINS` if a stranger origin appears.
4. Lower `SNAPFEED_RATE_LIMIT_MAX` temporarily if the volume came from inside your allowlist (compromised browser, scripted abuse).
5. Restore traffic; monitor.

### A vulnerability is reported

1. Receive via your internal security channel (or `shimoverse@gmail.com` if it's against snapfeed itself).
2. Validate the reproduction in a staging copy.
3. If the vuln is in snapfeed: file a private report per `SECURITY.md`. The maintainers' SLA is 3 business days to ack, 10 business days to fix. Coordinate disclosure timing.
4. If the vuln is in your wiring (config, adapter token leak, missing reverse-proxy auth): patch in your fork, redeploy, file post-mortem.

---

## 13. Decommissioning

When sunsetting a snapfeed deployment:

- [ ] **Drain in-flight requests.** Set the worker behind a 503 at the reverse proxy; wait 60 s.
- [ ] **Forward the final audit log batch** to your SIEM and your long-term WORM bucket.
- [ ] **Snapshot the uploads volume** to your retention bucket. Apply a tag for the retention period clock.
- [ ] **Stop the containers.** Preserve volumes for the duration of your retention period (do not delete).
- [ ] **Document data deletion** in your DPIA. After retention expires, run the deletion script against the WORM bucket (which will require a quorum unlock if you used `Object Lock` compliance mode).
- [ ] **Revoke credentials.** Delete the LLM API keys, adapter tokens (Slack webhook, GitHub PAT, etc.), MinIO root credentials. Rotate any keys that may have been observed in audit traffic.
- [ ] **Notify users** if your privacy notice committed to a deletion timeline. Update your Article 30 record-of-processing-activities (GDPR) to reflect the system's removal.

---

## Appendix — Copy-paste worker `docker compose` snippet

```yaml
# docker/docker-compose.override.yml — production overrides
services:
  worker:
    image: registry.your-corp.com/snapfeed/worker@sha256:<your-pinned-digest>
    read_only: true
    cap_drop: ["ALL"]
    security_opt:
      - no-new-privileges:true
    deploy:
      resources:
        limits:   { cpus: "0.5",  memory: "512M" }
        reservations: { cpus: "0.1",  memory: "128M" }
    environment:
      NODE_ENV: production
      ALLOWED_ORIGINS: "https://app.your-corp.com"
      SNAPFEED_HASH_REPORTER: "true"
      SNAPFEED_RATE_LIMIT_MAX: "30"
      SNAPFEED_RATE_LIMIT_WINDOW_MS: "60000"
      SNAPFEED_AUDIT_LOG_PATH: /data/audit/snapfeed.jsonl
    tmpfs:
      - /tmp
    volumes:
      - /var/lib/snapfeed/audit:/data/audit
      - /var/lib/snapfeed/uploads:/data/uploads
```

---

## Appendix — Health check from outside

```bash
$ curl -s https://feedback.internal.your-corp.com/healthz | jq
{
  "ok": true,
  "version": "0.6.0",
  "adapters": ["slack", "jira", "file"],
  "auditLog": "/data/audit/snapfeed.jsonl",
  "uploadDir": "/data/uploads"
}
```

---

For questions on this guide: `shimoverse@gmail.com`. For security-sensitive disclosures: follow `SECURITY.md` (do not file public issues).
