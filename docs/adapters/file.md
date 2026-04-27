# File adapter

Appends each feedback payload as a JSON line (JSONL) to a local file. Best for local development (the default fallback in `autoAdapters()`) and for self-hosted deployments that want a tail-able audit trail on disk.

> Source: [`src/adapters/file.ts`](../../src/adapters/file.ts)
> Type: `fileAdapter(opts?: FileAdapterOptions): FeedbackAdapter`

---

## Step 1: Decide where to write

Pick a path the Node process can write to:

- **Local dev:** `./feedback.jsonl` — the default. `autoAdapters()` falls back to this when no other destination is configured, so you usually don't need to set anything.
- **Self-hosted prod:** `/var/log/snapfeed/feedback.jsonl` — a stable, well-known location your ops tooling already knows how to rotate.
- **Docker / Kubernetes:** mount a volume (`/data/snapfeed/feedback.jsonl`) so the file survives container restarts.

The directory must be writable by the Node process. The adapter auto-creates parent directories with `mkdir -p` semantics, but it can't fix permissions for you.

This adapter **will not work** on read-only or ephemeral filesystems — Vercel Functions, Cloudflare Workers, Netlify Functions, AWS Lambda. On those platforms, use [`webhookAdapter`](../../src/adapters/webhook.ts) or an object-store backend like `s3Storage` instead.

---

## Step 2: Set the environment variable

```bash
# .env.local (or wherever your handler reads env from)
SNAPFEED_FILE_PATH=/var/log/snapfeed/feedback.jsonl
```

When `SNAPFEED_FILE_PATH` is set, `autoAdapters()` wires the file adapter automatically. With nothing set in dev, it still wires `fileAdapter()` at the default path (`./feedback.jsonl`) as a last-resort fallback.

If you wire the adapter explicitly (instead of via `autoAdapters()`):

```ts
import { fileAdapter } from 'snapfeed/adapters'

fileAdapter({
  path: '/var/log/snapfeed/feedback.jsonl', // absolute or relative-to-cwd
  pretty: false,                             // optional, default false (JSONL)
  redactScreenshot: true,                    // optional, default true
})
```

> As of v0.6, `fileAdapter` is imported from `snapfeed/adapters`, **not** the main `snapfeed` barrel.

Relative paths resolve against `process.cwd()` at request time, not at module-load time — so the same `feedback.jsonl` may end up in different places depending on where you start the server. Use absolute paths in production.

---

## Step 3: Restart the dev server

`SNAPFEED_*` env vars are read at process startup, not per request — restart `npm run dev` (or your equivalent) after editing `.env.local`.

```bash
npx snapfeed doctor
```

The doctor command should print `✓ Destinations wired: file`. Then sanity-check that the Node process can actually write to that path:

```bash
touch $SNAPFEED_FILE_PATH && echo "ok"
```

If `touch` fails with `Permission denied` or `No such file or directory`, fix that first — the adapter will hit the same error.

---

## Step 4: Test it works

The fastest end-to-end test:

```bash
curl -X POST http://localhost:3000/api/feedback \
  -H 'Content-Type: application/json' \
  -d '{
    "text": "Test from curl",
    "appName": "MyApp",
    "pageUrl": "http://localhost:3000",
    "pageName": "Home",
    "timestamp": "2026-04-26T12:00:00Z"
  }'
```

Then check the most recently appended line:

```bash
tail -n1 $SNAPFEED_FILE_PATH | jq
```

You should see the full payload as a single JSON object. The `screenshot.base64` field is replaced with `"[base64 omitted]"` by default — set `redactScreenshot: false` if you actually want the raw image data on disk.

---

## Step 5: Common errors and fixes

| Symptom | Likely cause | Fix |
|---|---|---|
| `File adapter error: ENOENT … no such file or directory` | Parent directory was deleted between requests, or the path points somewhere unmountable | The adapter `mkdir -p`s on every write, so a steady-state ENOENT usually means the path is on a missing volume. Verify the mount and restart. |
| `File adapter error: EACCES … permission denied` | Node process can't write to the path | `chown` the directory to the user running Node, or pick a path you own. On Docker, ensure the mounted volume's UID matches the container's user. |
| `File adapter error: EBUSY` (Windows only) | Another process has the file open with an exclusive lock (often an editor or antivirus) | Close the file in your editor; exclude the path from real-time AV scanning. |
| `feedback.jsonl` grows without bound | JSONL files don't self-rotate | Use `logrotate` (Linux) with `copytruncate`, or call [`pruneOlderThan`](../../src/audit-log/) from `snapfeed/storage` on a cron. |
| `fileAdapter requires Node` in your server logs | Handler ran in an edge runtime (Vercel Edge, Cloudflare Workers, middleware) | Add `export const runtime = 'nodejs'` to the route, or switch to `webhookAdapter` / `s3Storage` for that environment. |
| Reader sees a partial line at end of file | Reading the file mid-write | Writes are line-atomic at the OS level — only the last (incomplete) line is ever in flight. Use `tail -f` or skip the trailing partial line in your reader. |
| Doctor prints `file` even though I never set it | `autoAdapters()` falls back to `fileAdapter()` in dev when nothing else is wired | Expected. Set any other adapter env var to take over, or call `createFeedbackHandler` with explicit `adapters: [...]`. |

---

## Notes on viewing the file

Pair the file adapter with [`examples/admin/`](../../examples/admin/) — a small Next.js app that tails `feedback.jsonl` and renders each entry as a card with the screenshot inline. Point it at the same `SNAPFEED_FILE_PATH` and you have a zero-dependency local inbox.

For long-term queryability, use `multiAuditLog` to forward each entry to Postgres while keeping the file as a tamper-evident backup:

```ts
import { multiAuditLog, postgresAuditLog, fileAuditLog } from 'snapfeed/audit-log'

const audit = multiAuditLog([
  fileAuditLog({ path: '/var/log/snapfeed/feedback.jsonl' }),
  postgresAuditLog({ connectionString: process.env.DATABASE_URL! }),
])
```

If the DB write fails, the file write still succeeds — you don't lose the entry.

---

## Notes on security

- **The file path is privileged.** Never expose `SNAPFEED_FILE_PATH` (or its contents) to a web route. The adapter's docstring is explicit: `path` MUST be a developer-supplied constant. `path.resolve()` does not prevent traversal — `../../etc/passwd` resolves cleanly and the adapter will append to it.
- **Retention.** JSONL files grow forever by default. Use [`pruneOlderThan`](../../src/audit-log/) from `snapfeed/storage` on a daily cron, or wire `logrotate` with `copytruncate`.
- **Backups vs. queryability.** Files are great for tamper-evidence and `grep`, terrible for joins and dashboards. Use `multiAuditLog` to forward to Postgres for queries while keeping the file as a sequential backup.
- **Screenshot data.** `redactScreenshot` is `true` by default, which strips `screenshot.base64`. Leaving it on keeps the file small and avoids accidentally writing PII-rich images to a path your team backs up to S3.

---

## See also

- [`examples/admin/`](../../examples/admin/) — JSONL viewer Next.js app
- [`snapfeed/audit-log`](../../src/audit-log/) — `fileAuditLog`, `postgresAuditLog`, `multiAuditLog`
- [`snapfeed/storage`](../../src/storage/) — `pruneOlderThan` and other retention helpers
- [Custom adapter example](../../examples/custom-adapter/) — pattern for destinations snapfeed doesn't ship
