# Slack adapter

Posts feedback as a Block Kit message into a Slack channel via an [incoming webhook](https://api.slack.com/messaging/webhooks). Best for indie / startup / mid-size teams whose primary workspace is Slack.

> Source: [`src/adapters/slack.ts`](../../src/adapters/slack.ts)
> Type: `slackAdapter(opts: SlackAdapterOptions): FeedbackAdapter`

---

## Step 1: Get a Slack incoming webhook URL

1. Go to <https://api.slack.com/apps> → **Create New App** → **From scratch**.
2. Name it (`snapfeed`) and pick the workspace.
3. In the app's left sidebar: **Incoming Webhooks** → toggle **Activate Incoming Webhooks** to On.
4. Click **Add New Webhook to Workspace**, pick the channel (e.g. `#feedback`), and authorize.
5. Copy the resulting **Webhook URL** — looks like `https://hooks.slack.com/services/T0XXX/B0YYY/abc123…`.

The webhook is bound to the channel you picked. To post elsewhere, create a separate webhook for each channel.

---

## Step 2: Set the environment variable

```bash
# .env.local (or wherever your handler reads env from)
SNAPFEED_SLACK_WEBHOOK=https://hooks.slack.com/services/T0XXX/B0YYY/abc123…

# Optional overrides:
SNAPFEED_SLACK_USERNAME=snapfeed-bot   # bot display name (default: "Feedback Bot")
SNAPFEED_SLACK_CHANNEL=#bug-reports    # override the webhook's bound channel (rarely needed)
```

If you wire the adapter explicitly (instead of via `autoAdapters()`):

```ts
import { slackAdapter } from 'snapfeed/adapters'

slackAdapter({
  webhookUrl: process.env.SNAPFEED_SLACK_WEBHOOK!,
  username: 'snapfeed-bot',                     // optional
  channel: '#bug-reports',                       // optional
  iconEmoji: ':pencil:',                         // optional, default ":pencil:"
})
```

---

## Step 3: Restart the dev server

`SNAPFEED_*` env vars are read at process startup, not per request — restart `npm run dev` (or your equivalent) after editing `.env.local`.

```bash
npx snapfeed doctor
```

The doctor command should print `✓ Destinations wired: slack`. If it instead suggests a near-miss like *"Did you mean SNAPFEED_SLACK_WEBHOOK?"*, you have a typo.

---

## Step 4: Test it works

The fastest end-to-end test:

```bash
# Hit your handler directly (replace the URL with your dev server's path)
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

A message should appear in your Slack channel within ~1 second. Or just press the hotkey in your app and submit through the widget.

Without going through snapfeed at all, you can verify the webhook URL itself:

```bash
curl -X POST -H 'Content-Type: application/json' \
  -d '{"text":"Hello from curl"}' \
  $SNAPFEED_SLACK_WEBHOOK
```

A `404` or `403` from this curl means the webhook URL is wrong / revoked, regardless of snapfeed.

---

## Step 5: Common errors and fixes

| Symptom | Likely cause | Fix |
|---|---|---|
| Nothing arrives in Slack | `SNAPFEED_SLACK_WEBHOOK` is unset or typo | Run `npx snapfeed doctor` — it'll suggest the right name. Restart the dev server after editing `.env.local`. |
| `Slack webhook returned 404` in your server logs | Webhook URL was deleted in the Slack app | Generate a new webhook (Step 1 again) and replace the value in `.env.local`. |
| `Slack webhook returned 403` | Workspace owner revoked the app | Check Slack admin → **Apps** → confirm `snapfeed` is still installed. Re-install if not. |
| Bot name shows up as "Slack API" instead of your username | The webhook's default username overrides `username` in some workspaces | Slack workspace setting; talk to your admin about enabling per-message overrides. |
| Message contains literal `<!channel>` text instead of pinging | **Expected behavior.** snapfeed escapes Slack mrkdwn control sequences in user-supplied text to prevent reporters from accidentally pinging your whole workspace. | This is a security feature, not a bug. |
| Channel override (`SNAPFEED_SLACK_CHANNEL`) is ignored | Most webhooks are bound to a single channel and can't post elsewhere | Create one webhook per channel; don't use the override. |

---

## Notes on security

- snapfeed escapes the `<`, `>`, and `&` characters in all user-supplied text (per [Slack's escaping rules](https://api.slack.com/reference/surfaces/formatting#escaping)) before sending. Without this, a feedback payload of `<!channel> ping` would page your entire workspace.
- The webhook URL is a credential — treat it like any other secret. Use `.env.local` locally and your platform's secret store (Vercel env vars, GitHub Actions secrets, etc.) in production.
- Slack incoming webhooks have no rate limits at the snapfeed level; combine with `rateLimit: { max: 10, windowMs: 60_000 }` on `createFeedbackHandler` to prevent spam.

---

## See also

- [Slack incoming webhooks docs](https://api.slack.com/messaging/webhooks)
- [Routing recipes](../MANUAL.md#5-routing-recipes) — send `bug` to one channel, `idea` to another
- [Custom adapter example](../../examples/custom-adapter/) — pattern for destinations snapfeed doesn't ship
