# Webhook adapter

POSTs the raw `FeedbackPayload` as JSON to any HTTPS URL you give it. This is the catch-all for destinations snapfeed doesn't ship a dedicated adapter for — an internal bug tracker, an n8n / Zapier / Make trigger, a Cloudflare Worker, a serverless function that fans out to several systems. Think of it as a building block, not a shrink-wrap integration: you own the receiver, you decide what happens to the payload.

> Source: [`src/adapters/webhook.ts`](../../src/adapters/webhook.ts)
> Type: `webhookAdapter(opts: WebhookAdapterOptions): FeedbackAdapter`

---

## Step 1: Stand up an HTTP endpoint

The contract is simple. snapfeed will `POST` a JSON body of shape [`FeedbackPayload`](../../src/types.ts#L9) — text, app name, page URL, page name, timestamp, plus optional user, metadata, screenshot, and category fields. Your endpoint must respond with a `2xx` status for success and `4xx`/`5xx` for failure (snapfeed surfaces the status + first 200 chars of the body as the adapter error).

Three places this URL commonly points:

- **A Cloudflare Worker** (or AWS Lambda, Deno Deploy, Vercel Edge Function) that validates the payload and writes it to your own database.
- **A no-code workflow trigger** — Zapier "Catch Hook", n8n "Webhook" node, Make "Custom webhook" — that fans the feedback out to email, a spreadsheet, your CRM, etc.
- **An internal Express / Fastify / Rails endpoint** living in your existing app, e.g. `POST /internal/feedback`, that drops the row into your bug tracker's database directly.

The receiver does not need to know anything about snapfeed; it just needs to accept the payload shape.

---

## Step 2: Set the environment variable

```bash
# .env.local (or wherever your handler reads env from)
SNAPFEED_WEBHOOK_URL=https://your-receiver.example.com/feedback
```

If you wire the adapter explicitly (instead of via `autoAdapters()`):

```ts
import { webhookAdapter } from 'snapfeed/adapters'

webhookAdapter({
  url: process.env.SNAPFEED_WEBHOOK_URL!,
  headers: {                                  // optional — sent on every request
    'X-Shared-Secret': process.env.WEBHOOK_SECRET!,
  },
  transform: (payload) => ({                  // optional — reshape before sending
    message: payload.text,
    source: payload.appName,
    submittedAt: payload.timestamp,
  }),
  timeoutMs: 10_000,                          // optional, default 10000
  allowInsecure: false,                       // optional, default false (https only)
})
```

`url` is the only required option. `allowInsecure: true` enables `http://` URLs and is intended only for dev / on-prem deployments where TLS terminates upstream — never set it for URLs sourced from request data.

---

## Step 3: Restart and verify

`SNAPFEED_*` env vars are read at process startup, not per request — restart `npm run dev` (or your equivalent) after editing `.env.local`.

```bash
npx snapfeed doctor
```

The doctor command should print `✓ Destinations wired: webhook`. If it suggests *"Did you mean SNAPFEED_WEBHOOK_URL?"*, you have a typo.

Before involving the widget, hit the receiver directly with a payload in the shape snapfeed will send:

```bash
curl -X POST -H 'Content-Type: application/json' \
  -d '{
    "text": "Test from curl",
    "appName": "MyApp",
    "pageUrl": "http://localhost:3000",
    "pageName": "Home",
    "timestamp": "2026-04-26T12:00:00Z"
  }' \
  $SNAPFEED_WEBHOOK_URL
```

A `2xx` here means the receiver is healthy. A `4xx`/`5xx` means the receiver is rejecting the payload — fix that before debugging snapfeed.

---

## Step 4: Test through snapfeed

Now run the same payload through your handler so you confirm the full path:

```bash
# Replace the URL with your dev server's path
curl -X POST http://localhost:3000/api/feedback \
  -H 'Content-Type: application/json' \
  -d '{
    "text": "End-to-end test",
    "appName": "MyApp",
    "pageUrl": "http://localhost:3000",
    "pageName": "Home",
    "timestamp": "2026-04-26T12:00:00Z"
  }'
```

The receiver should record the entry within ~1 second. Then press the hotkey in your app and submit through the widget to confirm the production path works too.

---

## Step 5: Common errors and fixes

| Symptom | Likely cause | Fix |
|---|---|---|
| `Webhook returned 400: <body>` in your server logs | Receiver's validation rejected the payload — the body usually names the offending field | Inspect the body snippet, then either fix the field on the receiver or reshape with the `transform` option. |
| `Webhook returned 401` or `403` | Receiver requires auth this adapter isn't sending | Add a shared-secret header via `headers: { 'X-Auth': '...' }`, bake the secret into the URL as a query param, or write a custom adapter for signed-request auth. |
| `Webhook request failed: This operation was aborted` | Request exceeded `timeoutMs` (default 10s); some platforms also cap at 30s upstream | Bump `timeoutMs` if your receiver is genuinely slow, or move heavy work behind a queue inside the receiver and ack fast. |
| CORS error in the browser console | Only happens if the widget is posting **directly** to the webhook URL from the browser. The standard server-handler path (`/api/feedback`) is server-to-server and is not subject to CORS. | Route through `createFeedbackHandler` — don't expose the webhook URL to the client. |
| `Webhook request failed: ... self signed certificate ...` | Receiver uses a self-signed or untrusted TLS cert | Use a real cert (Let's Encrypt is free), terminate TLS at a trusted proxy, or run snapfeed's process with `NODE_EXTRA_CA_CERTS` pointing at your CA bundle. |
| `Webhook returned 413` (Payload Too Large) | snapfeed accepts up to 5MB by default (mostly screenshots); some receivers cap lower | Raise the receiver's body limit, or disable screenshots / lower JPEG quality on the widget side. |
| Nothing arrives, no error in logs | `SNAPFEED_WEBHOOK_URL` is unset, typo'd, or the env file wasn't reloaded | Run `npx snapfeed doctor` and restart the dev server after editing `.env.local`. |

---

## Notes on security

- **The URL itself is a credential.** Anyone who knows it can post arbitrary JSON to your receiver. Treat it like any other secret: `.env.local` locally, your platform's secret store (Vercel env vars, GitHub Actions secrets, etc.) in production. Never log it, never commit it, never expose it to the client.
- **Add a shared secret.** Either bake one into a query param (`?token=...`) or — better — pass it as a header via the `headers` option and validate it on the receiver. Reject anything missing or wrong before reading the body.
- **The payload contains user-provided text.** The `text`, `pageName`, and `user.name` fields all come from end users. Your receiver MUST sanitize / escape these before storing them in a database, rendering them in HTML, or forwarding them to a downstream system that interprets markup.
- **Rate-limit at the snapfeed handler level** to protect your receiver from spam. Pass `rateLimit: { max: 10, windowMs: 60_000 }` to `createFeedbackHandler` — the request is dropped before it ever reaches the webhook.
- **Never source `url` from request data.** This adapter does no SSRF guard beyond the `https:` scheme check. If you must pick the URL dynamically, validate the host against a hardcoded allowlist before passing it to `webhookAdapter()`.

---

## When to use this vs. write a custom adapter

The webhook adapter is the right call when:

- Your destination already speaks HTTP and you only need to forward the payload.
- You want the fan-out / routing logic to live on the **receiver** side (one webhook posts to Linear, Slack, and a database).
- You're prototyping — point it at a Zapier hook, see if the integration is worth building properly.

A **custom adapter** is the better choice when you need:

- Bespoke auth (OAuth refresh, AWS SigV4, request signing) that doesn't fit static headers.
- Retries with backoff on transient failures.
- Batched sends (collect N payloads, flush every M seconds).
- Rich error mapping back to snapfeed's UI (e.g. translating a 422 into a user-facing "please add more detail").

See the [custom-adapter example](../../examples/custom-adapter/) for the pattern — it's ~50 lines of TypeScript.

---

## See also

- [`FeedbackPayload` type](../../src/types.ts#L9) — the exact shape snapfeed sends
- [Routing recipes](../MANUAL.md#5-routing-recipes) — send `bug` to one webhook, `idea` to another
- [Custom adapter example](../../examples/custom-adapter/) — when webhook isn't enough
