# Corp / regulated quickstart — air-gapped install with security review

**Persona:** Engineering, QA, or IT lead at a Fortune 500 or regulated industry (finance, healthcare, defense, gov). Strict security review. Data must not leave the VPC. Identity provider is Okta or Azure AD. Any LLM must be in-tenant (AWS Bedrock or Azure OpenAI in your subscription) — no third-party AI APIs.
**Goal:** Air-gapped Docker install, in-tenant LLM, audit log shipped to your SIEM, JIRA + ServiceNow destinations, full security review checklist green.
**Time budget:** 1–2 weeks total. Less than a day of actual install work; the rest is your security review cycle.
**snapfeed version:** v0.5.x

This guide is sequenced as a **security-review-friendly path**, not "install first, ask forgiveness later." Steps 1–2 happen before any code lands in your network.

---

## 1. Pre-install: submit docs to security review

Before touching your internal Git mirror, hand your security team this set of files from the snapfeed repo. They are the entire surface of what you'd be approving:

- `README.md` — what the library does, three deployment modes, persona picker
- `SECURITY.md` — security review checklist, threat posture, what snapfeed does NOT do
- `PRIVACY.md` — data handling and retention posture
- `CHANGELOG.md` — what changed in each release; useful for "is this fork up to date" questions
- `LICENSE` — MIT
- `docker/README.md` — self-host install with air-gapped notes
- `docker/Dockerfile` — exact build of the runtime image
- `docker/docker-compose.yml` — service topology
- `docker/worker.cjs` — the entire HTTP server (zero runtime deps; ~300 lines)
- `src/server/security.ts` — origin allowlist, rate limit, payload validation, console-error redaction

**Documents you can hand directly to your reviewer (all shipped):**

- `THREAT_MODEL.md` — assets, trust boundaries, threat actors, 12-row threat-mitigation table tied to `src/server/security.ts` and `src/llm/redact.ts`.
- `COMPLIANCE.md` — GDPR / CCPA / HIPAA / SOC 2 / PCI / ISO / FedRAMP / Section 508 / data-residency posture, with a SOC 2 control-mapping table.
- `docs/SECURITY_REPORT.md` — third-party-style audit deliverable with 13 numbered findings (1 dev-deps High, 2 Low — both fixed in v0.5.0+, 10 Info).
- `docs/SECURE_DEPLOYMENT.md` — operator hardening guide (network, container, persistence, monitoring, backup, DR).
- `legal/DPA-template.md` — Data Processing Addendum template.
- `legal/THIRD_PARTY_NOTICES.md` — license + source for every optional/peer dependency.

**Honest gaps still on the v0.6 roadmap:**

- **SBOM is planned for v0.6**, not auto-published per release yet. Generate one yourself if your review requires it: `npm sbom --sbom-format cyclonedx > snapfeed-sbom.json` after `npm install`.
- **Image digests are named tags, not pinned by sha256** in `docker/docker-compose.yml`. Pin yourself for reproducible builds (step 3).
- **SSO/SAML for the admin app** is not built in. Front the admin app with oauth2-proxy / Pomerium / Cloudflare Access / IAP and forward `x-snapfeed-admin-user` (see `examples/admin/lib/auth.ts`).

## 2. Once approved: clone into your internal Git mirror, pin a tag

```bash
# In your internal Git server
git clone https://github.com/shimoverse/snapfeed.git snapfeed-mirror
cd snapfeed-mirror
git fetch --tags
git checkout v0.4.0
git tag review-approved-2026-q2
git push --tags origin
```

From now on, your CI builds from `review-approved-2026-q2`, not from `main`. Re-tag explicitly when security re-approves a future version.

## 3. Build the Docker image inside your CI

```bash
docker build \
  --no-cache \
  -t internal-registry.acmecorp.local/snapfeed:0.4.0 \
  -f docker/Dockerfile \
  .
```

For full reproducibility, also pin the base image by digest. Edit `docker/Dockerfile`'s `FROM node:20-alpine` to `FROM node:20-alpine@sha256:<digest>`. The digest you pin is the one your reviewer approves.

## 4. Push to your internal registry

```bash
docker push internal-registry.acmecorp.local/snapfeed:0.4.0
```

Mirror the upstream MinIO and (optionally) Ollama images the same way. The exact image references in `docker/docker-compose.yml`:

- `minio/minio:RELEASE.2024-01-16T16-07-38Z`
- `ollama/ollama:latest` — re-tag to a specific digest before mirroring

## 5. Deploy via your usual orchestrator

The Compose file is for dev convenience; production runs on your platform. Skeletal Kubernetes manifests:

```yaml
# k8s/snapfeed-secret.yaml — pull from Vault / SealedSecrets / SSM, don't commit raw values
apiVersion: v1
kind: Secret
metadata:
  name: snapfeed-secrets
  namespace: dogfood
type: Opaque
stringData:
  SNAPFEED_JIRA_HOST: jira.acmecorp.com
  SNAPFEED_JIRA_EMAIL: snapfeed-bot@acmecorp.com
  SNAPFEED_JIRA_TOKEN: <from-vault>
  SNAPFEED_JIRA_PROJECT: FEED
  SNAPFEED_SLACK_WEBHOOK: <from-vault>
  SERVICENOW_INSTANCE: acmecorp.service-now.com
  SERVICENOW_USER: snapfeed
  SERVICENOW_PASS: <from-vault>
```

```yaml
# k8s/snapfeed-config.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: snapfeed-config
  namespace: dogfood
data:
  ALLOWED_ORIGINS: https://app.acmecorp.com,https://staging.acmecorp.com
  SNAPFEED_AUDIT_LOG_PATH: /data/audit/snapfeed.jsonl
  SNAPFEED_HASH_REPORTER: "true"
  SNAPFEED_RATE_LIMIT_MAX: "60"
  SNAPFEED_RATE_LIMIT_WINDOW_MS: "60000"
```

```yaml
# k8s/snapfeed-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: snapfeed
  namespace: dogfood
spec:
  replicas: 1   # in-memory rate limiter doesn't share state across replicas; see below
  selector:
    matchLabels: { app: snapfeed }
  template:
    metadata:
      labels: { app: snapfeed }
    spec:
      containers:
        - name: worker
          image: internal-registry.acmecorp.local/snapfeed:0.4.0
          ports:
            - containerPort: 8787
          envFrom:
            - secretRef: { name: snapfeed-secrets }
            - configMapRef: { name: snapfeed-config }
          volumeMounts:
            - name: audit
              mountPath: /data/audit
            - name: audit-shipper
              mountPath: /var/log/snapfeed
              readOnly: true
          readinessProbe:
            httpGet: { path: /healthz, port: 8787 }
            periodSeconds: 5
        - name: log-shipper
          image: fluent/fluent-bit:2.2
          volumeMounts:
            - name: audit
              mountPath: /data/audit
              readOnly: true
            - name: fluent-bit-config
              mountPath: /fluent-bit/etc
      volumes:
        - name: audit
          emptyDir: {}    # or PVC if you need durability beyond pod lifetime
        - name: audit-shipper
          emptyDir: {}
        - name: fluent-bit-config
          configMap: { name: snapfeed-fluent-bit }
---
apiVersion: v1
kind: Service
metadata:
  name: snapfeed
  namespace: dogfood
spec:
  selector: { app: snapfeed }
  ports:
    - port: 80
      targetPort: 8787
```

A note on `replicas: 1`: the in-memory rate limiter in `src/server/security.ts` doesn't share state across pods. For multi-replica deployments, supply a Redis-backed `RateLimitStore` to `createFeedbackHandler` (the type lives in `src/types.ts`). Until you do, scale to one worker pod per region.

## 6. Configure secrets from your secret store

Whatever your team uses — Vault, SealedSecrets, AWS SSM, GCP Secret Manager — populate `snapfeed-secrets` from there. The secrets list in step 5 is the full set the worker needs, plus whatever your custom adapters need (ServiceNow below).

## 7. Wire the JIRA + ServiceNow adapters in `worker.cjs`

JIRA is wired the same way as the mid-size guide. ServiceNow is community territory — there is no built-in `serviceNowAdapter`, but it's a 30-line `webhookAdapter` against ServiceNow's Table API. Inside `docker/worker.cjs`, replace the `const adapters = autoAdapters()` line with:

```js
const { jiraAdapter, webhookAdapter } = require('../dist/adapters/index.cjs')

const adapters = autoAdapters()

// JIRA
if (
  process.env.SNAPFEED_JIRA_HOST &&
  process.env.SNAPFEED_JIRA_EMAIL &&
  process.env.SNAPFEED_JIRA_TOKEN &&
  process.env.SNAPFEED_JIRA_PROJECT
) {
  adapters.push(
    jiraAdapter({
      host: process.env.SNAPFEED_JIRA_HOST,
      email: process.env.SNAPFEED_JIRA_EMAIL,
      apiToken: process.env.SNAPFEED_JIRA_TOKEN,
      projectKey: process.env.SNAPFEED_JIRA_PROJECT,
      issueType: 'Bug',
      labels: ['snapfeed', 'dogfood'],
    })
  )
}

// ServiceNow — incident table via Basic auth
if (process.env.SERVICENOW_INSTANCE && process.env.SERVICENOW_USER) {
  const auth = Buffer
    .from(`${process.env.SERVICENOW_USER}:${process.env.SERVICENOW_PASS}`)
    .toString('base64')
  adapters.push(
    webhookAdapter({
      url: `https://${process.env.SERVICENOW_INSTANCE}/api/now/table/incident`,
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: 'application/json',
      },
      // ServiceNow's incident table accepts the snapfeed payload shape via field mapping;
      // for production-grade mapping, replace with a custom adapter that emits ServiceNow's
      // exact field names (short_description, description, urgency, etc.).
    })
  )
}
```

Note: the JIRA Cloud adapter targets `*.atlassian.net`. If your shop runs **JIRA Server / Data Center** behind your firewall (no Atlassian Cloud egress allowed), the adapter as-shipped won't work — JIRA Server uses different auth (PAT in `Authorization: Bearer` header) and a different REST URL shape. A community-contributed JIRA Server adapter is the path forward; for now, copy `src/adapters/jira.ts` and adjust the auth header and URL path. We'll accept a `jiraServerAdapter` PR — see `CONTRIBUTING.md`.

## 8. In-tenant LLM (if you opt in)

LLM features are off by default. To enable, the snapfeed LLM module supports two in-tenant paths today:

**Option A — AWS Bedrock** (in your AWS account, no data leaves your subscription):

```ts
import { applyLLM } from 'snapfeed/llm'

// In your worker process or on-demand from a custom adapter wrapper.
const result = await applyLLM(payload, {
  enabled: true,
  provider: 'bedrock',     // reserved in v0.4 — see note below
  model: 'anthropic.claude-3-haiku-20240307-v1:0',
  features: { title: true, severity: true },
  budget: { dailyTokens: 100_000 },
  redactBeforeLLM: true,
})
```

**Honest note:** `bedrock` is listed in `LLMProviderName` (`src/llm/types.ts`) but `createProvider()` in `src/llm/index.ts` returns `null` for `bedrock` and `custom` in v0.4 — they're reserved, not implemented. The runner degrades gracefully (no LLM call, payload passes through). Until shipped, route through the `custom` provider with your own SDK call OR use the OpenAI-compatible endpoint your Bedrock proxy exposes (set `provider: 'openai'` with an `endpoint` pointing at your in-tenant proxy).

**Option B — Ollama in a separate pod** (fully on-prem, no cloud AI dependency):

```bash
docker compose -f docker/docker-compose.yml --profile llm up -d
```

For Kubernetes, deploy `ollama/ollama` as a sidecar or its own deployment with a PVC mounted at `/root/.ollama`. Pre-load model weights into the volume before deploying to the air-gapped cluster — no `ollama pull` once it's offline. Then:

```ts
{
  enabled: true,
  provider: 'ollama',
  endpoint: 'http://ollama.dogfood.svc.cluster.local:11434/api/generate',
  model: 'llama3',
  features: { title: true },
  redactBeforeLLM: true,
}
```

`redactBeforeLLM: true` runs `redactForLLM()` over the text and console errors before they hit the model — strips emails, JWTs, credit-card-shaped digits, high-entropy tokens.

## 9. Audit log → SIEM via Fluent Bit sidecar

The worker writes one JSONL line per event to `SNAPFEED_AUDIT_LOG_PATH` (default `/data/audit/snapfeed.jsonl`). Ship it to your SIEM with a Fluent Bit sidecar:

```ini
# k8s ConfigMap: snapfeed-fluent-bit, key: fluent-bit.conf
[SERVICE]
    Flush         5
    Daemon        Off
    Log_Level     info

[INPUT]
    Name          tail
    Path          /data/audit/snapfeed.jsonl
    Parser        json
    Tag           snapfeed.audit
    Refresh_Interval 5

[FILTER]
    Name          modify
    Match         snapfeed.audit
    Add           service snapfeed
    Add           env     prod

[OUTPUT]
    Name          forward
    Match         snapfeed.audit
    Host          siem.acmecorp.local
    Port          24224
    tls           on
```

Vector, Filebeat, or your in-house log shipper work the same way — they tail the same JSONL file, the worker doesn't care.

## 10. SSO / SAML for the admin viewer — read-only behind your auth proxy

SSO/SAML for the admin viewer is **planned for v0.5**, not shipped. The admin app at `examples/admin/` is read-only and stateless — sit it behind your existing auth proxy (oauth2-proxy, Pomerium, your ingress's OIDC plugin):

```nginx
# nginx — example reverse proxy with oauth2-proxy in front
location /snapfeed-admin/ {
    auth_request /oauth2/auth;
    error_page 401 = /oauth2/sign_in;

    auth_request_set $user $upstream_http_x_auth_request_user;
    proxy_set_header X-Forwarded-User $user;

    proxy_pass http://snapfeed-admin.dogfood.svc.cluster.local:3000/;
}
```

Until v0.5 ships SAML/OIDC inside the admin app, this proxy pattern is the supported path.

## Verify it works

End-to-end test from a tester's browser to all four destinations:

1. Tester opens `https://app.acmecorp.com`, presses Ctrl+Shift+F, types feedback, sends.
2. **JIRA**: a new issue appears in project `FEED` with `[Feedback]` prefix, screenshot attached, reporter email in the body.
3. **ServiceNow**: a new record appears in the `incident` table (or whatever table you mapped to).
4. **Slack**: a message in your dogfood channel.
5. **Audit log → SIEM**: search your SIEM for `service:snapfeed type:adapter.dispatched`. You should see N entries (one per adapter).
6. **Worker pod logs**: `kubectl logs -n dogfood deploy/snapfeed -c worker` — no stack traces, one "received feedback" line.

If all six are clean, you're done.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Outbound traffic to `*.atlassian.net` blocked at the corp firewall | You're on JIRA Server / Data Center, not Cloud. The shipped `jiraAdapter` won't work as-is — it targets `https://${host}/rest/api/3/issue` with Basic auth (email + token). Copy `src/adapters/jira.ts` to a new file, swap the `Authorization` header to `Bearer <PAT>`, and adjust the URL to your internal JIRA host. We'll accept a community PR — see CONTRIBUTING.md. |
| Bedrock calls fail with `AccessDenied` | The pod's IAM role (via IRSA on EKS, Workload Identity on GKE, or its instance profile) lacks `bedrock:InvokeModel`. Add the policy and confirm the SDK can assume the role inside the pod (`aws sts get-caller-identity` from a debug pod). Note: `provider: 'bedrock'` is reserved in v0.4 — until v0.4.x ships the implementation, route through a Bedrock-compatible OpenAI proxy or write a `custom` provider. |
| Audit log doesn't reach SIEM | Three failure points to check in order: (1) is the worker writing to `/data/audit/snapfeed.jsonl`? `kubectl exec` and `tail` it. (2) Does the Fluent Bit sidecar see the file? `kubectl logs -c log-shipper`. (3) Does the SIEM receive on the configured port? Check ingress at the SIEM side. |
| SSO loop on the admin viewer | oauth2-proxy's cookie domain doesn't match the admin's served path, or the upstream `/snapfeed-admin/` strips the auth header. Use `proxy_set_header Cookie $http_cookie;` and set `cookie_domain` in oauth2-proxy to your parent domain. |
| Worker pod crashloops with `EACCES` on `/data/audit/snapfeed.jsonl` | The PVC's mount perms don't allow the `node` user (UID 1000) to write. Add `securityContext: { fsGroup: 1000 }` to the pod spec, or pre-chown the volume in an init container. |
| Rate limit fires after one request when scaled to 2+ replicas | Expected — the in-memory rate limiter doesn't share state. Either keep `replicas: 1` or implement a Redis-backed `RateLimitStore` (interface in `src/types.ts`) and pass it to `createFeedbackHandler({ rateLimit: { store } })`. |

---

## Security review checklist

This matrix maps each row in `SECURITY.md`'s review checklist to the file or commit your reviewer can inspect to verify it. Use this as the deliverable to attach to the change request.

| Control | Status | Evidence (file / commit) |
|---------|--------|-------------------------|
| Zero phone-home | ✅ shipped | `src/index.ts`, `src/server/nextjs.ts`, `docker/worker.cjs` — grep for any `fetch(` without an `options.url`-supplied origin; only adapter targets exist |
| Outbound allowlist (only configured adapters egress) | ✅ shipped | `src/adapters/auto.ts` lines 71–145 (every outbound call is gated on a `SNAPFEED_*` env var); `docker/worker.cjs` line 64 (`const adapters = autoAdapters()`) |
| Self-hostable, no required SaaS | ✅ shipped | `docker/docker-compose.yml`, `docker/Dockerfile`, `docker/worker.cjs` — full stack runs on `node:20-alpine` + `minio/minio` |
| Open source, MIT, no CLA | ✅ shipped | `LICENSE`, `CONTRIBUTING.md` (no CLA section) |
| LLM is optional | ✅ shipped | `src/llm/index.ts` lines 80–92 (`if (!config.enabled) return result`) |
| BYOK — no proxy through snapfeed | ✅ shipped | `src/llm/types.ts` `LLMConfig.apiKey`; `src/llm/providers/*.ts` send to provider URLs only |
| In-tenant LLMs supported (Bedrock / Azure / Ollama) | partial v0.4 | `src/llm/index.ts` `createProvider` — Ollama and Azure (via OpenAI provider + endpoint) shipped; Bedrock + custom reserved, return `null` (graceful degrade) |
| LLM keys server-side only | ✅ shipped | `src/llm/` is excluded from the React entry; consumers must import from `snapfeed/llm` in a server file |
| Pre-LLM redaction (PII / secrets) | ✅ shipped | `src/llm/redact.ts` (`redactForLLM`); `src/llm/index.ts` line 104 toggles via `config.redactBeforeLLM` |
| Adapter secrets server-side only | ✅ shipped | `src/server/nextjs.ts` `createFeedbackHandler`; widget POSTs to `apiUrl` — adapters and tokens never reach the browser |
| Console error redaction | ✅ shipped | `src/server/security.ts` — `normalizePayload` strips token/key/secret/JWT patterns |
| Payload size caps | ✅ shipped | `src/types.ts` `FeedbackHandlerConfig.maxPayloadBytes` (10 KB), `maxScreenshotBytes` (5 MB) |
| Origin allowlist | ✅ shipped | `src/server/security.ts` `checkOrigin`; `docker/worker.cjs` lines 169–183 (`applyCors` + middleware origin gate) |
| Rate limiting (in-memory + pluggable Redis) | ✅ shipped | `src/server/security.ts` `defaultRateLimitStore`; `src/types.ts` `RateLimitStore` for distributed deployments |
| Disabled in production by default | ✅ shipped | `src/types.ts` `enableInProduction?: boolean` (default `false`); README "Production safety" |
| Role-scopable in production | ✅ shipped | README "Production safety" example: `enableInProduction={user.role === 'admin'}` |
| Pinned dependencies | ✅ shipped | `package-lock.json` checked into the repo |
| Minimal runtime deps | ✅ shipped | `package.json` `dependencies` field — empty / minimal; `html2canvas` is an optional peer |
| No `eval`, `Function()`, dynamic remote imports | ✅ shipped | grep `src/` — only `await import('next/server')` (static peer dep), no remote URL imports |
| Audit log primitive | ✅ shipped | `src/audit-log.ts` — `fileAuditLog`, `noopAuditLog`, `multiAuditLog`; events: `feedback.received`, `adapter.dispatched`, `llm.called`, `config.changed`, `rate_limit.hit` |
| Self-hostable Docker stack | ✅ shipped | `docker/docker-compose.yml`, `docker/README.md` |
| SBOM published per release | planned v0.5 | Run `npm sbom --sbom-format cyclonedx > snapfeed-sbom.json` against `node_modules/` of the pinned tag for now |
| Reproducible builds (image digests) | partial | `package-lock.json` pinned ✅; image digests in compose file = TODO. Pin `node:20-alpine@sha256:...` in `docker/Dockerfile` yourself. |
| Retention / GDPR right-to-erasure | planned v0.5 | No `retentionDays` config or `deleteByUserId()` API in v0.4. If your jurisdiction requires erasure, write a cron against the audit log JSONL until the API ships. |
| SSO/SAML for admin | planned v0.5 | Front the admin viewer with oauth2-proxy / Pomerium (step 10). |

Hand this matrix, plus the file list from step 1, to your reviewer. The "Evidence" column points at exactly the source they need to read.
