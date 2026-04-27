# Telegram adapter

Posts feedback as a formatted HTML message into a Telegram chat via the [Bot API](https://core.telegram.org/bots/api), and (optionally) uploads the screenshot as a follow-up photo. Best for indie / solo devs who triage in a personal Telegram chat or a small private group.

> Source: [`src/adapters/telegram.ts`](../../src/adapters/telegram.ts)
> Type: `telegramAdapter(opts: TelegramAdapterOptions): FeedbackAdapter`

---

## Step 1: Create a Telegram bot

1. Open Telegram and search for [`@BotFather`](https://t.me/BotFather) — it's the official bot for managing bots.
2. Send `/newbot`.
3. Pick a **display name** (e.g. `Snapfeed Bot`).
4. Pick a **username** — must be unique across Telegram and must end in `bot` (e.g. `myapp_snapfeed_bot`).
5. BotFather replies with a **Bot Token** that looks like `123456789:AAH-abcDEF...`. Copy it — that's your `SNAPFEED_TELEGRAM_BOT_TOKEN`.

Treat the bot token like a password — anyone who has it can post (and read messages) AS your bot.

---

## Step 2: Get a chat ID

A bot needs to know *which chat* to post into. Telegram doesn't surface chat IDs in the UI — you have to ask the API.

**Personal chat (DM the bot directly):**

1. Open Telegram, find your new bot by username, and send it any message (e.g. `hi`). Bots can only DM users who have started the conversation first.
2. From a terminal:

```bash
curl https://api.telegram.org/bot<TOKEN>/getUpdates
```

3. Find `"chat":{"id":123456789, ...}` in the response. That number is your chat ID.

**Group chat:**

1. Add the bot to the group as a member.
2. Send any message in the group (`@yourbot hi` works).
3. Run the same `getUpdates` curl. The chat ID will be a **negative** number, e.g. `-123456789`. Supergroups and channels are prefixed with `-100…` (e.g. `-1001234567890`).

For public channels, you can also use the `@username` form (e.g. `@mychannel`) instead of a numeric ID.

---

## Step 3: Set environment variables

```bash
# .env.local (or wherever your handler reads env from)
SNAPFEED_TELEGRAM_BOT_TOKEN=123456789:AAH-abcDEF...
SNAPFEED_TELEGRAM_CHAT_ID=-1001234567890
```

If you wire the adapter explicitly (instead of via `autoAdapters()`):

```ts
import { telegramAdapter } from 'snapfeed/adapters'

telegramAdapter({
  botToken: process.env.SNAPFEED_TELEGRAM_BOT_TOKEN!,
  chatId: process.env.SNAPFEED_TELEGRAM_CHAT_ID!,
  sendScreenshot: true,                          // optional, default true
})
```

Set `sendScreenshot: false` if you only want the text message and want to skip the photo upload (saves a round-trip and avoids the 10MB cap).

---

## Step 4: Restart + test

`SNAPFEED_*` env vars are read at process startup, not per request — restart `npm run dev` (or your equivalent) after editing `.env.local`.

```bash
npx snapfeed doctor
```

The doctor command should print `✓ Destinations wired: telegram`. If it suggests a near-miss like *"Did you mean SNAPFEED_TELEGRAM_BOT_TOKEN?"*, you have a typo.

Without going through snapfeed at all, verify the token + chat combo with a raw API call:

```bash
curl "https://api.telegram.org/bot$SNAPFEED_TELEGRAM_BOT_TOKEN/sendMessage" \
  -d "chat_id=$SNAPFEED_TELEGRAM_CHAT_ID&text=hello"
```

A `{"ok":true,...}` response means the credentials are good. A `401` means the token is wrong; a `400 chat not found` means the chat ID is wrong (or the bot isn't a member of that chat).

Then end-to-end through your handler:

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

A message should appear in your Telegram chat within ~1 second.

---

## Step 5: Common errors and fixes

| Symptom | Likely cause | Fix |
|---|---|---|
| `Telegram sendMessage failed (HTTP 401)` | Bot token is wrong, malformed, or revoked | Double-check `SNAPFEED_TELEGRAM_BOT_TOKEN`. If it was leaked, regenerate via `/revoke` in BotFather. |
| `Telegram sendMessage failed (HTTP 400): chat not found` | Chat ID is wrong, OR the bot was removed from the group | Re-run the `getUpdates` trick (Step 2). For groups, confirm the bot is still a member. |
| `Telegram sendMessage failed (HTTP 403): bot was blocked by the user` | Personal chat only — the user blocked your bot | Unblock the bot in Telegram, or switch to a group/channel chat ID. |
| `screenshot upload failed (HTTP 413)` warning, but text message arrived | Telegram caps `sendPhoto` payloads at **10 MB** | Either lower the widget's screenshot quality, or set `sendScreenshot: false` and rely on the text message alone. |
| `Telegram sendMessage failed (HTTP 400): can't parse entities` | A user-supplied string contained HTML the adapter didn't escape (rare — `<`, `>`, `&` are escaped, but other malformed HTML could slip through) | snapfeed uses `parse_mode: 'HTML'` (not MarkdownV2), so only `<`, `>`, `&` need escaping — file an issue with the offending payload if you hit this. |
| `Telegram sendMessage failed (HTTP 429): Too Many Requests` | Bot exceeded rate limit (~30 messages/sec across all chats, ~1/sec per chat, ~20/min in groups) | Add `rateLimit: { max: 10, windowMs: 60_000 }` to `createFeedbackHandler` so spammy reporters can't pin the bot. |
| Bot replies in `getUpdates` but never receives the user's first DM | Bots cannot initiate conversations — the user must send the first message | Ask the user to open the bot's profile and tap **Start** before testing. |

---

## Notes on chat types

Telegram has four chat surfaces, and the adapter behaves the same in all of them — the difference is what permissions the bot needs:

- **Personal chat (1:1 DM)** — the simplest setup. Chat ID is a positive integer (e.g. `123456789`). The user must start the conversation; the bot cannot DM unsolicited.
- **Group** — a small chat (up to 200 members). Chat ID is negative (e.g. `-123456789`). Just add the bot as a member; no special permissions needed for it to send messages.
- **Supergroup** — a large group (up to 200,000 members), or any group converted via Telegram's UI. Chat ID is prefixed `-100…` (e.g. `-1001234567890`). Same setup as a regular group.
- **Channel** — broadcast-style, one-to-many. Chat ID is `-100…` or `@username` for public channels. The bot **must be added as an admin with "Post Messages" permission** — being a regular subscriber is not enough.

For public channels the `@username` form (e.g. `@mychannel`) works as a chat ID and is more readable than the numeric form.

---

## Notes on security

- The **bot token is a credential**. Anyone who has it can post AS the bot, read incoming messages, and (if the bot is in a group) read group messages. Treat it like an API key — `.env.local` locally, your platform's secret store (Vercel env vars, GitHub Actions secrets, etc.) in production.
- The **chat ID is not strictly a secret**, but it's worth treating as restricted info — knowing the chat ID + bot token is what lets someone post into your triage channel.
- To **rotate a leaked token**, message `@BotFather` → `/revoke` → pick the bot. The old token stops working immediately and a new one is issued. Update `SNAPFEED_TELEGRAM_BOT_TOKEN` and restart.
- For group/channel chats, the bot must be **explicitly added** by an admin — Telegram won't let a bot wander into a chat on its own. Removing the bot from the group instantly stops delivery (you'll see `chat not found` errors).
- snapfeed escapes `<`, `>`, and `&` in user-supplied text before sending (HTML parse mode), so a feedback payload of `<script>` won't break the message or inject formatting.

---

## See also

- [Telegram Bot API docs](https://core.telegram.org/bots/api)
- [Routing recipes](../MANUAL.md#5-routing-recipes) — send `bug` to one chat, `idea` to another
- [Custom adapter example](../../examples/custom-adapter/) — pattern for destinations snapfeed doesn't ship
