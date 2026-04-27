# Console adapter

Logs each feedback payload to the server's console (`console.log` by default). This is the **development default** — it ships in `autoAdapters()`'s dev fallback so you can see feedback land before any real destination is configured. **Not for production.**

> Source: [`src/adapters/console.ts`](../../src/adapters/console.ts)
> Type: `consoleAdapter(opts?: ConsoleAdapterOptions): FeedbackAdapter`

---

## Step 1: When to use console

You usually don't wire this adapter explicitly. `autoAdapters()` includes it in the **dev fallback**: if no `SNAPFEED_*` env vars match a real destination, snapfeed falls back to logging so the widget still has somewhere to send. That means most integrators see the console adapter without ever importing it.

Reach for it deliberately in three cases:

- **Smoke-test the React widget end-to-end** before you've decided where feedback should actually go (Slack? GitHub? a webhook?). The widget submits, the handler runs, the payload prints — you've verified the wire is intact.
- **Pair with a real adapter as a debug log.** Run `consoleAdapter()` alongside `slackAdapter()` and you get a local stdout copy of every payload you posted to Slack — handy when something looks off in the formatted message.
- **Unit tests** where you don't want HTTP side effects. The adapter is synchronous-shaped, never throws, and has no network calls.

---

## Step 2: Wire it explicitly (rarely needed)

```ts
import { consoleAdapter } from 'snapfeed/adapters'

consoleAdapter()
// or with options:
consoleAdapter({
  level: 'info',   // 'log' | 'info' | 'debug' | 'warn'  (default: 'log')
  pretty: true,    // JSON.stringify(payload, null, 2)   (default: true)
})
```

There's **no env var convention** for this adapter — nothing like `SNAPFEED_CONSOLE_*`. It's either in your adapters array or it isn't. The `autoAdapters()` dev fallback adds it for you when nothing else matches.

Output is prefixed with `[devtools/feedback]` so you can grep your logs.

---

## Step 3: How to view output

The adapter writes to whatever `console[level]` resolves to in the **server runtime** that runs your `/api/feedback` handler — not the browser devtools console.

| Runtime | Where to look |
|---|---|
| Next.js dev (`npm run dev`) | The terminal where you started the dev server |
| Vercel (deployed) | Project → **Logs** tab in the Vercel dashboard |
| Cloudflare Workers | `wrangler tail` (or the Workers dashboard log stream) |
| AWS Lambda | CloudWatch log group for the function |
| Docker / self-hosted Node | Whatever STDOUT/STDERR is attached to the container |

If your runtime doesn't surface STDOUT/STDERR (some edge sandboxes silently drop it), you won't see anything. That's a runtime limitation, not a snapfeed bug — switch to a real destination.

---

## Step 4: Verify it works

The fastest end-to-end check:

```bash
# Replace the URL with your dev server's path
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

Watch your `npm run dev` terminal — you should see something like:

```
[devtools/feedback] {
  "text": "Test from curl",
  "appName": "MyApp",
  ...
}
```

If you see nothing, jump to the next section — the most common cause is looking at the wrong stream.

---

## Step 5: Common errors and fixes

| Symptom | Likely cause | Fix |
|---|---|---|
| Nothing appears anywhere | You're checking the **browser devtools console** instead of the server terminal | This adapter logs server-side. Look at the `npm run dev` terminal, not the browser. |
| Nothing in the dev terminal either | Your handler isn't being hit at all | Check the Network tab — is the POST to `/api/feedback` even firing? `npx snapfeed doctor` will tell you whether the route is wired. |
| Output looks like `[Object object]` | A consumer monkey-patched `console.log` to drop the second argument | Set `pretty: true` (the default) so the payload is pre-stringified to a single argument. |
| Used in production by accident | `autoAdapters()` dev fallback fired in prod because no real destination was configured | `npx snapfeed doctor` warns about this. Wire a real adapter (`slack`, `webhook`, `file`, etc.) — feedback is currently going to logs nobody reads. |
| Paired with a real adapter — both fire | Working as intended | Adapters in the array run in parallel; using console as a tee for debugging is a supported pattern. Remove it before shipping. |

---

## When NOT to use

- **Production.** Logs aren't a feedback inbox. Nobody triages CloudWatch for product feedback. Use `slackAdapter`, `webhookAdapter`, `githubAdapter`, or `fileAdapter` (durable log) instead.
- **Browser-only deployments** (static SPAs, Chrome extensions, etc.). This adapter calls the server runtime's `console` — there is no server in that setup. If you want browser-side logging, write a tiny custom adapter that calls `window.console` and ship it from the client.

---

## See also

- [File adapter](./file.md) — durable on-disk log when you want persistence, not just terminal output
- [Webhook adapter](./webhook.md) — forward each payload to an HTTP receiver you control
- [Custom adapter example](../../examples/custom-adapter/) — pattern for destinations snapfeed doesn't ship
