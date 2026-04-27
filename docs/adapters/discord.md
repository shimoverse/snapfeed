# Discord adapter

Posts feedback as a rich embed into a Discord channel via an [incoming webhook](https://discord.com/developers/docs/resources/webhook). Best for communities, gaming teams, and any group whose primary chat is Discord.

> Source: [`src/adapters/discord.ts`](../../src/adapters/discord.ts)
> Type: `discordAdapter(opts: DiscordAdapterOptions): FeedbackAdapter`

---

## Step 1: Get a Discord channel webhook URL

1. In Discord, open the **server** that should receive feedback.
2. Hover the target **channel** (e.g. `#feedback`) and click the **⚙ Edit Channel** gear.
3. Open **Integrations** → **Webhooks** → **New Webhook**.
4. Set a name (`snapfeed`) and an avatar.
5. Click **Copy Webhook URL** — looks like `https://discord.com/api/webhooks/<id>/<token>`.

The webhook is bound to the channel you picked. To post to multiple channels, create one webhook per channel.

---

## Step 2: (Optional) Get a role ID for pings

If you want a role like `@oncall` to be pinged on every feedback message:

1. In Discord, open **User Settings** → **Advanced** → toggle **Developer Mode** on.
2. Go to **Server Settings** → **Roles**.
3. Right-click the role and pick **Copy Role ID** — a long numeric string like `123456789012345678`.

Make sure the role is **Mentionable** (Server Settings → Roles → role → toggle *Allow anyone to @mention this role*), otherwise the ping won't fire.

---

## Step 3: Set environment variables

```bash
# .env.local (or wherever your handler reads env from)
SNAPFEED_DISCORD_WEBHOOK=https://discord.com/api/webhooks/123/abc…

# Optional:
SNAPFEED_DISCORD_MENTION_ROLE=123456789012345678   # role to ping on each post
```

If you wire the adapter explicitly (instead of via `autoAdapters()`):

```ts
import { discordAdapter } from 'snapfeed/adapters'

discordAdapter({
  webhookUrl: process.env.SNAPFEED_DISCORD_WEBHOOK!,
  username: 'snapfeed',                                  // optional, default "snapfeed"
  avatarUrl: 'https://example.com/snapfeed.png',          // optional
  mentionRoleId: process.env.SNAPFEED_DISCORD_MENTION_ROLE, // optional
})
```

---

## Step 4: Restart the dev server

`SNAPFEED_*` env vars are read at process startup, not per request — restart `npm run dev` (or your equivalent) after editing `.env.local`.

```bash
npx snapfeed doctor
```

The doctor command should print `✓ Destinations wired: discord`. If it instead suggests a near-miss like *"Did you mean SNAPFEED_DISCORD_WEBHOOK?"*, you have a typo.

---

## Step 4 (continued): Test it works

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

A message should appear in your Discord channel within ~1 second. Or just press the hotkey in your app and submit through the widget.

Without going through snapfeed at all, you can verify the webhook URL itself:

```bash
curl -X POST -H 'Content-Type: application/json' \
  -d '{"content":"hi"}' \
  $SNAPFEED_DISCORD_WEBHOOK
```

A `404` or `401` from this curl means the webhook URL is wrong / revoked, regardless of snapfeed.

---

## Step 5: Common errors and fixes

| Symptom | Likely cause | Fix |
|---|---|---|
| `Discord adapter error: 404` in your server logs | Webhook was deleted in Discord, or the URL is malformed | Re-copy the URL from **Edit Channel → Integrations → Webhooks**, or generate a new one. |
| `Discord adapter error: 401` | Webhook token portion of the URL is wrong (truncated copy/paste) | Re-copy the full URL — the token is the segment after the last `/`. |
| `Discord adapter error: 429` during testing | Discord rate-limits each webhook to ~30 requests/minute | Back off testing, or add `rateLimit: { max: 10, windowMs: 60_000 }` on `createFeedbackHandler`. |
| `50027: Invalid Webhook Token` | The webhook was rotated or deleted and re-created | Copy the new URL into `.env.local` and restart. |
| `mentionRoleId` is set but the role isn't pinged | Role doesn't exist, isn't mentionable, or the ID has a typo | Confirm the ID via right-click → **Copy Role ID** and toggle **Allow anyone to @mention this role** on the role. |
| Long feedback gets truncated with `…` | Discord caps embed `description` at 4096 chars and total embed at 6000 chars; snapfeed truncates defensively | Expected — full text is preserved in the JSON payload sent to other adapters; if you need the raw text, route through a webhook adapter as well. |
| Screenshot doesn't appear in the embed | Malformed base64 or attachment over Discord's 25 MB limit | Check `result.warnings` — snapfeed falls back to JSON-only and surfaces `screenshot upload failed: <reason>`. |

---

## Notes on security

- The webhook URL is a credential — anyone with it can post to your channel as the webhook bot, including impersonating your team. Treat it like any other secret. Use `.env.local` locally and your platform's secret store (Vercel env vars, GitHub Actions secrets, etc.) in production.
- Discord webhooks **bypass channel permissions** — if a user can't normally see `#feedback`, they still can't read what's posted, but the webhook itself doesn't check member roles. Rotate the URL (delete + recreate) if you suspect leakage.
- Discord enforces a per-webhook rate limit of roughly 30 requests/minute. Combine with `rateLimit: { max: 10, windowMs: 60_000 }` on `createFeedbackHandler` to prevent reporters from exhausting it via spam.

---

## See also

- [Discord webhook docs](https://discord.com/developers/docs/resources/webhook)
- [Routing recipes](../MANUAL.md#5-routing-recipes) — send `bug` to one channel, `idea` to another
- [Custom adapter example](../../examples/custom-adapter/) — pattern for destinations snapfeed doesn't ship
