# ClickUp adapter

Creates a ClickUp task in a list per feedback submission via the [ClickUp REST v2 API](https://clickup.com/api). Optionally uploads the screenshot as an attachment to the new task. Best for teams that already triage work in ClickUp.

> Source: [`src/adapters/clickUp.ts`](../../src/adapters/clickUp.ts)
> Type: `clickUpAdapter(opts: ClickUpAdapterOptions): FeedbackAdapter`

This adapter is **not auto-detected** — wire it explicitly with `clickUpAdapter({...})`.

---

## Step 1: Get a ClickUp API key

1. In ClickUp, click your **avatar** (top right corner).
2. Go to **Settings** → **Apps**.
3. Under **API Token**, click **Generate** (or **Copy** if one already exists).
4. Copy the token — it looks like `pk_12345678_ABCDEF0123456789ABCDEF0123456789`.

This is a **personal API key** tied to your ClickUp user account. The adapter will create tasks as you, with your full permissions. For production use, create a dedicated service-account user (a separate ClickUp seat used only by integrations) and generate the token from that account so audit trails and access scope are predictable when teammates leave.

---

## Step 2: Get the list ID

1. In ClickUp, navigate to the list you want feedback to land in.
2. Look at the URL — it has the form `https://app.clickup.com/<workspace>/v/li/<LIST_ID>`.
3. Copy the numeric `LIST_ID` (e.g. `901234567`).

The user attached to the API token must have access to this list — otherwise task creation returns a 403.

---

## Step 3: Wire the adapter

ClickUp is wired explicitly (it has no auto-detect path):

```ts
import { createFeedbackHandler } from 'snapfeed/server'
import { clickUpAdapter } from 'snapfeed/adapters'

export const POST = createFeedbackHandler({
  adapters: [
    clickUpAdapter({
      apiToken: process.env.CLICKUP_API_KEY!,
      listId: process.env.CLICKUP_LIST_ID!,
      tags: ['snapfeed'],                          // optional
      assignees: [12345678],                        // optional, ClickUp user ids
      priority: {                                   // optional
        bug: 1,        // Urgent
        idea: 3,       // Normal
        question: 3,   // Normal
        praise: 4,     // Low
        other: 3,      // Normal
      },
      includeScreenshot: true,                      // default true
    }),
  ],
})
```

```bash
# .env.local (or wherever your handler reads env from)
CLICKUP_API_KEY=pk_12345678_ABCDEF0123456789ABCDEF0123456789
CLICKUP_LIST_ID=901234567
```

**Priority values** map to ClickUp's built-in scale:

| Value | Meaning |
|---|---|
| `1` | Urgent |
| `2` | High |
| `3` | Normal |
| `4` | Low |

You can pass either a single `ClickUpPriority` (applied to every task) or a per-category map. Categories without an entry get no explicit priority — ClickUp uses the list's default.

> ClickUp's auth header is just the raw token (`Authorization: pk_…`), with no `Bearer` prefix. The adapter handles this for you, but it's worth knowing if you're testing with curl.

---

## Step 4: Restart + test

`CLICKUP_*` env vars are read at process startup. Restart `npm run dev` (or your equivalent) after editing `.env.local`.

```bash
npx snapfeed doctor
```

The doctor command should print `✓ Destinations wired: clickUp`.

Verify the API key is valid without going through snapfeed:

```bash
curl -H "Authorization: $CLICKUP_API_KEY" \
  https://api.clickup.com/api/v2/user
```

A `200` with your user object means the token is good. A `401` means the token is wrong or revoked.

Then hit your handler end-to-end:

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

A new task should appear in your ClickUp list within ~1 second. Or just press the hotkey in your app and submit through the widget.

---

## Step 5: Common errors and fixes

| Symptom | Likely cause | Fix |
|---|---|---|
| `401: …` in your server logs | API token is wrong, malformed, or revoked | Re-check `CLICKUP_API_KEY` against the value in **Settings → Apps**. Restart the dev server after editing `.env.local`. Confirm with the `curl …/v2/user` test above. |
| `403: …` in your server logs | Token user doesn't have access to the target list | In ClickUp, share the list (or its parent space/folder) with the token's user. If you're using a service account, this is the most common cause. |
| `404: …` in your server logs | `CLICKUP_LIST_ID` is wrong, or the list was deleted/archived | Re-copy the `LIST_ID` from the list's URL (`/v/li/<LIST_ID>`). Make sure it's the numeric id, not the list name. |
| `400: …` in your server logs | List has required custom fields, or a custom-field value type doesn't match the schema | Open the list's settings in ClickUp and either remove the required flag or set a default. The adapter does not currently populate custom fields. |
| `429: …` (intermittent failures under load) | ClickUp rate-limits at **100 requests/minute/token** | Add `rateLimit: { max: 60, windowMs: 60_000 }` to `createFeedbackHandler`, or use a separate token for snapfeed so it doesn't share the budget with other tooling. |
| Task created but no screenshot attached; result includes a `warnings` entry | Attachment upload is best-effort and non-fatal — task creation succeeded but the upload failed (often a `400` for an oversized image or a transient network blip) | Check the warning text in your handler's `onResult` log. Set `includeScreenshot: false` if you don't want screenshots at all. |
| Task created but with no priority, even though `priority` is set | Category resolved to one without an entry in the priority map (e.g. `praise` with only `bug`/`idea` mapped), or the value isn't `1`–`4` | Add an entry for every category you want prioritized, or pass a single number to apply one priority to all tasks. Only `1`, `2`, `3`, `4` are valid. |

---

## Notes on security

- The ClickUp API token is a **credential** — treat it like any other secret. Use `.env.local` locally and your platform's secret store (Vercel env vars, GitHub Actions secrets, etc.) in production.
- The token inherits the **full ClickUp permissions** of the user it was generated for. There are no fine-grained scopes — anyone holding the token can read and write everything that user can. This is why a dedicated service-account user is worth the seat in production.
- Rotate by going to **Settings → Apps**, clicking **Regenerate** next to the existing token, and updating your env. The old token stops working immediately.
- Combine with `rateLimit: { max: 10, windowMs: 60_000 }` on `createFeedbackHandler` to prevent feedback spam from chewing through your ClickUp rate-limit budget.

---

## See also

- [ClickUp API docs](https://clickup.com/api)
- [Routing recipes](../MANUAL.md#5-routing-recipes) — send `bug` to one list, `idea` to another
- [Custom adapter example](../../examples/custom-adapter/) — pattern for destinations snapfeed doesn't ship
