# Microsoft Teams adapter

Posts feedback as an [Adaptive Card](https://adaptivecards.io) (v1.4) into a Microsoft Teams channel via an Incoming Webhook. Best for orgs whose primary collaboration surface is Teams (typically Microsoft 365 / enterprise stacks).

> Source: [`src/adapters/msTeams.ts`](../../src/adapters/msTeams.ts)
> Type: `msTeamsAdapter(opts: MsTeamsAdapterOptions): FeedbackAdapter`

---

## Step 1: Get an Incoming Webhook URL

> **Heads up:** Microsoft is retiring the classic *Office 365 Connectors* / *Incoming Webhook* integration in favour of *Workflows* via Power Automate. Both paths still produce a POST-able webhook URL today, and the snapfeed adapter works against either. See the [Notes on connector deprecation](#notes-on-connector-deprecation) section below before you choose.

**Classic path (Incoming Webhook connector):**

1. In Teams, navigate to the target channel (e.g. `#feedback`).
2. Click the channel's **⋯** menu → **Manage channel** → **Connectors**.
3. Find **Incoming Webhook** in the list → **Add** → **Configure**.
4. Give it a name (`snapfeed`) and optionally upload an avatar.
5. Click **Create** and copy the resulting **Webhook URL** — looks like `https://<tenant>.webhook.office.com/webhookb2/<guid>@<tenant-guid>/IncomingWebhook/<id>/<key>`.

**New path (Workflows / Power Automate):**

1. In Teams, channel **⋯** menu → **Workflows**.
2. Pick the template **"Post to a channel when a webhook request is received"**.
3. Sign in, confirm the team and channel, click **Create flow**.
4. Copy the **Workflow URL** that's shown — `https://prod-XX.<region>.logic.azure.com:443/workflows/...`.

The webhook URL is bound to the channel you picked. To post elsewhere, create a separate webhook for each channel.

---

## Step 2: Wire the adapter

The Teams adapter is **not** wired by `autoAdapters()` — there's no `SNAPFEED_MS_TEAMS_WEBHOOK` shortcut. You wire it explicitly:

```bash
# .env.local
MS_TEAMS_WEBHOOK=https://<tenant>.webhook.office.com/webhookb2/...
```

```ts
import { createFeedbackHandler } from 'snapfeed/server'
import { msTeamsAdapter } from 'snapfeed/adapters'

createFeedbackHandler({
  adapters: [
    msTeamsAdapter({
      webhookUrl: process.env.MS_TEAMS_WEBHOOK!,
      mentionUserIds: ['triage@yourcompany.com'],   // optional, AAD UPNs
      theme: {                                       // optional, hex per category
        bug: '#cc2936',
        idea: '#f5c84b',
        question: '#4b89dc',
        praise: '#3fb950',
        other: '#8b949e',
      },
    }),
  ],
})
```

**Options:**

| Option | Type | Required | Notes |
|---|---|---|---|
| `webhookUrl` | `string` | yes | Throws at construction if missing or empty. |
| `mentionUserIds` | `string[]` | no | AAD UPNs / email addresses; rendered as `<at>` mentions in the card. |
| `theme` | `{ bug?, idea?, question?, praise?, other?: string }` | no | Per-category accent colors as hex strings. Falls back to sensible defaults. |

You can mix this with other adapters in the same `adapters: [...]` array — e.g. Teams plus a `fileAdapter` for local archival.

---

## Step 3: Restart and verify

`process.env.MS_TEAMS_WEBHOOK` is read at process startup, not per request — restart `npm run dev` (or your equivalent) after editing `.env.local`.

```bash
npx snapfeed doctor
```

Doctor doesn't currently know about `MS_TEAMS_WEBHOOK` (it's not in `AutoEnvKeys`), so it won't list Teams under "Destinations wired". That's expected — Teams is wired explicitly in your handler code, not via env-var auto-detection.

Before involving snapfeed, confirm the webhook URL itself is alive with a raw curl:

```bash
curl -X POST -H 'Content-Type: application/json' \
  -d '{
    "type": "message",
    "attachments": [{
      "contentType": "application/vnd.microsoft.card.adaptive",
      "content": {
        "type": "AdaptiveCard",
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
        "version": "1.4",
        "body": [{ "type": "TextBlock", "text": "Hello from curl", "wrap": true }]
      }
    }]
  }' \
  "$MS_TEAMS_WEBHOOK"
```

A `200` with body `1` (or empty) means the URL works. A `4xx` / `410` means the URL is wrong, revoked, or has been migrated — see Step 5 before going further.

---

## Step 4: Test through snapfeed

Once the raw curl works, test the full pipeline:

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

A card should appear in your Teams channel within ~1 second. Or just press the hotkey in your app and submit through the widget.

---

## Step 5: Common errors and fixes

| Symptom | Likely cause | Fix |
|---|---|---|
| `200 OK` from the webhook but no message appears in Teams | Adaptive Card schema mismatch — Teams returns 200 even when its renderer rejects the card. Most often the `version` field is wrong, or a field name was misspelled. | Confirm `version: "1.4"` (Teams' max supported as of 2026). Validate the JSON in the [Adaptive Cards Designer](https://adaptivecards.io/designer/) before posting. |
| `400 Bad Request` | Malformed JSON — usually a stray comma, unescaped newline, or wrong `Content-Type`. | Re-send through `jq` or pipe through `python -m json.tool` to validate. Make sure `Content-Type: application/json` is set. |
| `410 Gone` | The classic Incoming Webhook connector for this channel was deprecated or migrated. Microsoft has been progressively turning these off per tenant. | Re-create the webhook via the **Workflows** path (Step 1). The snapfeed adapter works against either URL shape. |
| `401` / `403 Forbidden` | The webhook URL was revoked, the connector was removed by an admin, or the tenant disabled connectors entirely. | Recreate the webhook (Step 1). If your tenant has connectors disabled by policy, you'll have to use the Workflows path. |
| Card renders but is truncated / clipped | Adaptive Cards have a ~28 KB total payload limit in Teams. Large screenshots embedded as `data:` URIs blow this fast. | snapfeed already skips screenshots above ~1 MB with a warning; if you're still hitting the limit, trim `consoleErrors` or move to a hosted-screenshot setup. |
| Embedded screenshot doesn't display | Teams blocks `data:` images above its size limit and (in some tenants) blocks them outright. Inline base64 is fragile. | Host the screenshot on an HTTPS URL the tenant can reach (S3, Cloudinary, your own CDN) and pass that URL instead of inline base64. snapfeed surfaces the skip via `result.warnings`. |
| `<at>user@co.com</at>` text shows up literally instead of as a mention | The user UPN doesn't exist in your AAD tenant, or the `msteams.entities` block isn't being parsed. | Verify the UPN is a real, current AAD identity. The adapter populates `entities` automatically when you pass `mentionUserIds`. |

---

## Notes on connector deprecation

Microsoft [announced](https://devblogs.microsoft.com/microsoft365dev/retirement-of-office-365-connectors-within-microsoft-teams/) that the classic *Office 365 Connectors* (which includes the *Incoming Webhook* connector this adapter targets) are being retired and replaced by *Workflows* in Power Automate. The retirement has rolled out in waves per tenant — some workspaces have lost connectors entirely, others still have them.

The good news: the **Workflows** replacement (template *"Post to a channel when a webhook request is received"*) emits a Workflow URL that accepts the same `application/json` POST with the same `{ type: "message", attachments: [...] }` Adaptive Card payload shape. snapfeed's adapter does not branch on URL format — it just POSTs. **The same `msTeamsAdapter({ webhookUrl })` call works against either URL.**

If you're starting fresh in 2026, prefer the Workflows path. If you have a working classic webhook, you can keep it until your tenant flips it off (you'll see a `410` when that happens — see Step 5).

---

## Notes on security

- The webhook URL is a credential — anyone with the URL can post to that channel as the connector. Treat it like any other secret: `.env.local` locally, your platform's secret store (Vercel env vars, Azure Key Vault, GitHub Actions secrets) in production. **Rotate periodically** by deleting and re-creating the connector.
- The connector identity is **workspace-bound** — there's no per-user audit trail on incoming webhook posts. Every message looks like it came from "snapfeed" (or whatever you named the connector), regardless of which user actually triggered the feedback. If you need per-reporter attribution, surface it inside the message body (snapfeed already includes the reporter in the `Reporter` fact).
- snapfeed escapes nothing in the Adaptive Card text body — Adaptive Cards are JSON, so injection is bounded by JSON encoding. But mentions are an exception: only UPNs you explicitly pass via `mentionUserIds` are rendered as mentions. User-supplied feedback text cannot ping `@channel`.
- Combine with `rateLimit: { max: 10, windowMs: 60_000 }` on `createFeedbackHandler` to prevent feedback-spam from flooding the channel.

---

## See also

- [Adaptive Cards reference](https://adaptivecards.io) — schema, designer, samples
- [Routing recipes](../MANUAL.md#5-routing-recipes) — send `bug` to one channel, `idea` to another
- [Custom adapter example](../../examples/custom-adapter/) — pattern for destinations snapfeed doesn't ship
