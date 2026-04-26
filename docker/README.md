# snapfeed — self-hosted Docker stack (v0.5)

A turnkey, in-VPC deployment of the snapfeed feedback worker. No SaaS, no
phone-home, no required cloud. Bring your own adapters via env vars.

What you get:

- **worker** — Node HTTP server exposing `POST /feedback` and `GET /healthz`
- **minio** — S3-compatible object storage for feedback media
- **ollama** *(optional)* — in-tenant LLM for smart features

This satisfies the "self-hostable", "no telemetry", "in-tenant LLM via Ollama",
"audit log", and "PII redaction" rows of `SECURITY.md`.

---

## Prerequisites

- Docker Desktop (macOS/Windows) or Docker Engine 20.10+ (Linux)
- `docker compose` v2 (bundled with Docker Desktop)
- Free TCP ports: **8787** (worker), **9000** + **9001** (MinIO), **11434** (Ollama, only if `--profile llm`)

---

## Quickstart (5 steps)

```bash
# 1. Clone the repo
git clone https://github.com/shimoverse/snapfeed.git
cd snapfeed

# 2. Set up environment
cp docker/.env.example docker/.env
# (edit docker/.env to taste — at minimum review ALLOWED_ORIGINS)

# 3. Bring the stack up
docker compose -f docker/docker-compose.yml up

# 4. Verify it's healthy (in another terminal)
curl http://localhost:8787/healthz
# → { "ok": true, "version": "<x.y.z>", "adapters": [...], ... }

# 5. POST a sample feedback payload
curl -X POST http://localhost:8787/feedback \
  -H 'Content-Type: application/json' \
  -H 'Origin: http://localhost:3000' \
  -d '{
    "text": "Hello from curl",
    "appName": "MyApp",
    "pageUrl": "http://localhost:3000/test",
    "pageName": "Test",
    "timestamp": "2026-04-25T12:00:00Z",
    "category": "praise"
  }'
# → { "success": true, "results": [...] }
```

The audit log line will appear at `docker/data/audit/snapfeed.jsonl`.

---

## Wiring the widget

In your snapfeed-equipped app:

```tsx
import { FeedbackProvider } from 'snapfeed'

<FeedbackProvider
  appName="MyApp"
  apiUrl="http://localhost:8787/feedback"
/>
```

For production, terminate TLS in front of the worker and put it behind your
existing ingress. The worker speaks plain HTTP on `:8787` by design.

---

## Adding an adapter

Adapters are configured via `SNAPFEED_*` env vars — no code, no rebuild.
Edit `docker/.env`, restart the worker:

```bash
# docker/.env
SNAPFEED_SLACK_WEBHOOK=https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX
```

```bash
docker compose -f docker/docker-compose.yml restart worker
```

Now every POST to `/feedback` also fans out to Slack. The full list of
recognized env var keys lives in `src/adapters/auto.ts` (`AutoEnvKeys`).

---

## Enabling Ollama (in-tenant LLM)

Ollama is gated behind a Compose profile so it doesn't start by default:

```bash
docker compose -f docker/docker-compose.yml --profile llm up
```

In your snapfeed config, point the LLM client at the local Ollama instance:

```ts
{
  provider: 'ollama',
  endpoint: 'http://localhost:11434/api/generate',
  model: 'llama3',
}
```

To pull a model the first time:

```bash
docker exec -it snapfeed-ollama ollama pull llama3
```

Note: `llama3:8b` is ~4 GB and takes several minutes to download on a typical
home connection — grab a coffee. Smaller models (`phi3:mini`, ~2 GB) finish
faster if you're just kicking the tires.

No prompts or completions ever leave the host. Per `SECURITY.md`, the only
field the audit log records about LLM calls is `tokensUsed` — never content.

---

## Where data lives

Everything the stack writes lives under `docker/data/` (gitignored):

| Path                      | What's there                              |
| ------------------------- | ----------------------------------------- |
| `docker/data/audit/`      | JSONL audit log (one line per event)     |
| `docker/data/uploads/`    | File-storage uploads (screenshots, etc.) |
| `docker/data/minio/`      | MinIO object storage backing data        |
| `docker/data/ollama/`     | Pulled LLM model weights                  |

To reset the stack: `docker compose down && rm -rf docker/data/`.

---

## Troubleshooting

**`address already in use :::8787`** — Another process is using 8787.
Set `WORKER_PORT=9999` in `docker/.env`, or stop the other process.

**MinIO healthcheck fails / worker won't start** — MinIO takes ~10 seconds
to become healthy on first boot. Re-run `docker compose up`; if the issue
persists, check `docker compose logs minio`. The worker waits for MinIO via
`depends_on.condition: service_healthy`.

**`EACCES: permission denied, open '/data/audit/snapfeed.jsonl'`** — The
worker runs as the non-root `node` user. The Dockerfile chowns `/data` at
build time, but if you bind-mount a host directory with restrictive perms,
the container user can't write to it. Fix with:

```bash
sudo chown -R 1000:1000 docker/data
```

(`1000:1000` is the UID/GID of the `node` user in `node:20-alpine`.)

**Origin rejected with 403** — `ALLOWED_ORIGINS` is set in `.env` but the
caller's `Origin:` header doesn't match. Add the origin to the CSV list and
restart the worker.

---

## Air-gapped notes

- **No outbound calls at runtime** unless you wire `SNAPFEED_*` env vars
  pointing at external services (Slack, GitHub, etc.). Out-of-the-box, the
  stack runs entirely offline — feedback lands in the audit log and on disk.
- `npm ci --omit=dev` runs at **image build time only**. After the image is
  built, no further package installs happen — the runtime container has
  no network egress requirement.
- **Image tags are named, not pinned by digest.** For reproducible builds
  in regulated environments, pin to digests (e.g. `node:20-alpine@sha256:...`).
  Pinning all images to digests is tracked as a v0.6 follow-up.
- The `ollama/ollama:latest` image is ~1.5 GB and pulls model weights on
  first use. For air-gapped installs, mirror the image to your internal
  registry and pre-load the model weights into `docker/data/ollama/`.

---

## Production hardening

A few things worth doing before you put the worker behind real traffic:

- **Resource limits are set in `docker-compose.yml`** — the worker is capped
  at `mem_limit: 512m` / `pids_limit: 256`, ollama at `mem_limit: 8g`.
  Tune to your hardware.
- **Rotate the JSONL audit log.** It grows unbounded — wire `logrotate`
  (or your platform's equivalent) onto `docker/data/audit/snapfeed.jsonl`.
  A weekly rotation with `copytruncate` is fine; the worker re-opens the
  file via the `fileAuditLog` adapter on every write.
- **Pin image digests** for reproducibility. v0.5 uses tags
  (`node:20-alpine`, `minio/minio:RELEASE.…`, `ollama/ollama:latest`).
  v0.6 will publish digest pins; until then, snapshot the resolved digests
  with `docker compose pull && docker images --digests`.
- **Set `SNAPFEED_TRUST_PROXY=true`** only when an upstream proxy/ingress
  controls the `X-Forwarded-For` header. Default false — otherwise
  rate-limit-per-IP is bypassable.
- **Set `ALLOWED_ORIGINS`** in production. With `NODE_ENV=production` and
  no allowlist, the worker fails closed and rejects every origin.

## What's NOT in v0.5

- **Postgres-backed inbox** — feedback is JSONL only for now. v0.6 adds it.
- **Pinned image digests** — see Air-gapped notes above.
- **TLS termination inside the stack** — put your existing ingress / load
  balancer in front. We deliberately don't bundle nginx or Caddy.
- **Multi-instance deployment** — the in-memory rate limiter doesn't share
  state across replicas. Use the `RateLimitStore` Redis/Upstash hook for
  that, or scale to one worker until v0.6.
