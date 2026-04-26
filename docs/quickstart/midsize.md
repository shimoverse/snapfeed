# Mid-size quickstart — self-hosted Docker, JIRA + Slack + audit log in 1 hour

**Persona:** Engineering manager or tech lead at a 50–500 person company. Stack: JIRA Cloud + Slack. IT reviews new tools but you don't have full corp lockdown. Probably running on AWS/GCP/Azure, behind your usual ingress.
**Goal:** Self-hosted Docker stack inside your VPC. Every piece of feedback creates a JIRA issue (with screenshot, build SHA, reporter), posts to a Slack channel for awareness, and writes one line per dispatch to an append-only audit log.
**Time budget:** 1 hour, including JIRA token provisioning and a smoke test.
**snapfeed version:** v0.5.x

---

## 1. Clone the repo for the `docker/` directory

You don't need the source for runtime — you'll install snapfeed via npm in your app. But the Docker stack lives under `docker/` and is the easiest entry point for the worker.

```bash
git clone https://github.com/shimoverse/snapfeed.git
cd snapfeed
git checkout v0.5.3
```

You can pin to a tag here so you control upgrades. The Docker image is built locally from the source — there is no pre-built image on Docker Hub yet.

## 2. Get JIRA Cloud auth

snapfeed's JIRA adapter authenticates via Basic auth with a JIRA email + API token (NOT a Personal Access Token — those are for Atlassian Server / Data Center).

1. Sign in to https://id.atlassian.com/manage-profile/security/api-tokens
2. Click **Create API token**, label it "snapfeed", copy the token. You won't see it again.
3. Note your JIRA Cloud host (e.g. `acmecorp.atlassian.net` — no `https://`, no trailing slash).
4. Pick a project key (e.g. `FEED`, `BUG`, or whatever your team uses for inbound feedback). The project must already exist and your account must be able to create issues in it.

Atlassian's docs: https://support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/

## 3. Get a Slack incoming webhook

Same as the indie guide — https://api.slack.com/messaging/webhooks. Copy the URL.

## 4. Edit `docker/.env`

```bash
cp docker/.env.example docker/.env
```

Then edit `docker/.env`. The fields you actually need to set:

```
WORKER_PORT=8787
ALLOWED_ORIGINS=https://yourapp.example.com

SNAPFEED_SLACK_WEBHOOK=https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXX

# JIRA: not auto-wired today; we'll inject it via worker.cjs in step 5.
# Pass the credentials through the env file so the customized worker can read them.
SNAPFEED_JIRA_HOST=acmecorp.atlassian.net
SNAPFEED_JIRA_EMAIL=bot@acmecorp.com
SNAPFEED_JIRA_TOKEN=your_api_token_here
SNAPFEED_JIRA_PROJECT=FEED

SNAPFEED_AUDIT_LOG_PATH=/data/audit/snapfeed.jsonl
SNAPFEED_HASH_REPORTER=true

MINIO_ROOT_USER=snapfeed
MINIO_ROOT_PASSWORD=replace-with-a-real-password
```

Set `ALLOWED_ORIGINS` to a CSV list of every origin that will POST feedback (your staging URL, your prod URL if you'll dogfood there). The worker rejects anything else with a 403.

`SNAPFEED_HASH_REPORTER=true` causes the audit log to record a hash of the reporter's email instead of the email itself — recommended once you start shipping logs off-host.

## 5. Extend `worker.cjs` to wire the JIRA adapter

`docker/worker.cjs` calls `autoAdapters()`, which only knows the keys listed in `src/adapters/auto.ts` (Slack, Discord, GitHub, Telegram, webhook, file). JIRA is **not** in that list today. To add it without forking the package, append the JIRA adapter to the `adapters` array at the top of the file.

Open `docker/worker.cjs` and find the line that reads:

```js
const adapters = autoAdapters()
```

Replace it with this 20-line snippet:

```js
const { jiraAdapter } = require('../dist/adapters/index.cjs')

const adapters = autoAdapters()

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
      labels: ['snapfeed'],
    })
  )
  console.log('[snapfeed] JIRA adapter wired')
}
```

Why the manual wiring: keeping `autoAdapters()` to webhook-style integrations only is intentional — JIRA needs four env vars, host validation, and a project key. The plumbing is one paste in `worker.cjs` and you're done.

## 6. Bring the stack up

```bash
docker compose -f docker/docker-compose.yml up -d
```

The stack starts:
- `worker` on port 8787 — the HTTP handler
- `minio` on ports 9000 + 9001 — S3-compatible storage (currently provisioned but not yet used by the worker for media — that lands in v0.6)

First boot takes ~30s while the Docker image builds.

## 7. Smoke-test the worker

```bash
curl http://localhost:8787/healthz
```

Expected response:

```json
{ "ok": true, "version": "0.5.3", "adapters": ["slack", "jira"], "auditLog": "/data/audit/snapfeed.jsonl", "uploadDir": "/data/uploads" }
```

If `adapters` is empty or missing entries, your `.env` values aren't being read or the JIRA snippet didn't get committed to `worker.cjs`. Check `docker compose logs worker`.

## 8. Wire your app to the worker

In your snapfeed-equipped app (anywhere you can deploy a React tree):

```bash
npm install snapfeed
```

Then wrap your layout. The widget POSTs to your worker, NOT to a Next.js API route — so set `apiUrl` to wherever you've exposed port 8787:

```tsx
// app/snapfeed-client.tsx (or wherever your client provider lives)
'use client'

import type { ReactNode } from 'react'
import { FeedbackProvider } from 'snapfeed'

export function SnapfeedClient({
  children,
  user,
}: {
  children: ReactNode
  user: { name: string; email: string } | null
}) {
  return (
    <FeedbackProvider
      appName="Acme"
      apiUrl="https://snapfeed.acmecorp.internal/feedback"
      user={user ?? undefined}
      autoScreenshot
    >
      {children}
    </FeedbackProvider>
  )
}
```

`apiUrl` should be the host:port (or fronting domain) where your IT exposed the worker. For local testing, `http://localhost:8787/feedback` works.

Important: the worker checks the request `Origin` header against `ALLOWED_ORIGINS`. If you're testing against `localhost:3000`, add it to the CSV list and restart the worker (`docker compose restart worker`).

## 9. End-to-end smoke test

```bash
npm run dev   # in your app
```

Open http://localhost:3000, press Ctrl+Shift+F, write "Worker smoke test", send.

## Verify it works

Run all four checks. They should all pass:

```bash
# 1. JIRA issue created — replace FEED with your project key
# Check the project's queue in the JIRA web UI; the new issue is titled "[Feedback] Worker smoke test".

# 2. Slack message posted — check the channel your webhook points at.

# 3. Audit log line written
docker compose -f docker/docker-compose.yml exec worker tail -1 /data/audit/snapfeed.jsonl
# Expect a JSON line: {"type":"adapter.dispatched","ts":"...","adapter":"jira","ok":true,"deliveryId":"FEED-123"}

# 4. Worker container logs are clean
docker compose -f docker/docker-compose.yml logs worker --tail 20
# No stack traces; one "received feedback" log; no "audit log failed" warnings.
```

If all four are clean, the stack is healthy and you can hand it off to whoever runs your infra.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| JIRA returns `401 Unauthorized` | You used a JIRA Personal Access Token (PAT) instead of an Atlassian API token. PATs are for Server/Data Center. For Cloud, generate an API token at https://id.atlassian.com/manage-profile/security/api-tokens and use that as `SNAPFEED_JIRA_TOKEN`. The email field must be the email of the Atlassian account that owns the token. |
| Browser console shows `403 Origin not allowed` | Your `ALLOWED_ORIGINS` doesn't include the origin the widget is calling from. Add it to the CSV list in `docker/.env` and `docker compose restart worker`. Empty list + `NODE_ENV !== production` allows all origins for dev convenience — useful when you're spelunking but not what you want in staging. |
| `address already in use :::8787` on `docker compose up` | Another process is on 8787. Set `WORKER_PORT=9999` in `docker/.env` (and update your `apiUrl` to match), or kill the other process. |
| MinIO healthcheck fails / worker exits before starting | MinIO takes ~10s to become healthy on first boot. The worker waits for it via `depends_on.condition: service_healthy`. Re-run `docker compose up`. If it persists, `docker compose logs minio` and look for permission errors on the bind mount. |
| `EACCES: permission denied, open '/data/audit/snapfeed.jsonl'` | The worker runs as the non-root `node` user (UID 1000). The bind mount `./data/audit:/data/audit` inherits host perms. Fix: `sudo chown -R 1000:1000 docker/data`. |
| `docker compose down -v` ate my data | `-v` removes named volumes. The bind mounts under `docker/data/` survive `down -v`. If you wiped them anyway, the audit log is gone — there's no remote backup unless you set one up. Add a sidecar log shipper before going to production. |
| JIRA 400 on issue create with "issuetype is required" | Your project doesn't have a "Bug" issue type. Pass a different name in the `issueType` field of the JIRA snippet, or add Bug to your JIRA project's issue type scheme. |
