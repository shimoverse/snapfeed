# Notion adapter

Creates a page in a Notion database for each feedback submission, with the body text, context (URL, reporter, viewport, timestamp), recent console errors, and an inline screenshot. Best for teams that already triage product feedback as a Notion database.

> Source: [`src/adapters/notion.ts`](../../src/adapters/notion.ts)
> Type: `notionAdapter(opts: NotionAdapterOptions): FeedbackAdapter`

Unlike Slack, this adapter is **not auto-detected** — you must wire it explicitly with `notionAdapter({...})`.

---

## Step 1: Create a Notion integration

1. Go to <https://www.notion.so/my-integrations> → **New integration**.
2. Name it (`snapfeed`) and pick the workspace it should live in.
3. Click **Submit**.
4. Copy the **Internal Integration Token** — it looks like `secret_abc123…` on older accounts, or `ntn_abc123…` on newer ones. Either format works.

The integration is workspace-scoped: it can only see databases and pages inside the workspace you picked.

---

## Step 2: Share the database with the integration

Creating the integration is not enough — Notion's API will return `404 object_not_found` for any database the integration hasn't been explicitly invited to.

1. In Notion, navigate to the database where feedback should land (the page that displays as a table, board, or list view).
2. Click the `⋯` menu in the top-right → **Connections** → **Add connections**.
3. Pick the `snapfeed` integration you just created. Confirm the access prompt.
4. Copy the database ID from the URL. The URL looks like `https://www.notion.so/myworkspace/8a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p?v=…` — the database ID is the 32-character alphanumeric chunk between the workspace name and `?v=`. Dashes are optional; the adapter accepts either form.

> If you skip this share step, **every** API call will 404, no matter how correct your token is. This is the single most common setup failure.

---

## Step 3: Wire the adapter

Notion is not auto-detected, so you wire it explicitly in your handler:

```ts
import { createFeedbackHandler } from 'snapfeed/server'
import { notionAdapter } from 'snapfeed/adapters'

export default createFeedbackHandler({
  adapters: [
    notionAdapter({
      apiKey: process.env.NOTION_TOKEN!,
      databaseId: process.env.NOTION_DATABASE_ID!,
      titleProperty: 'Title',          // default: "Name"
      categoryProperty: 'Category',    // default: "Category"
      statusProperty: 'Status',        // default: "Status"
      defaultStatus: 'Triage',         // default: "Triage"
      notionVersion: '2022-06-28',     // default: "2022-06-28"
    }),
  ],
})
```

Environment variable pattern:

```bash
# .env.local
NOTION_TOKEN=secret_abc123…
NOTION_DATABASE_ID=8a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p
```

### Property mapping

Notion databases have **typed** properties — a column called `Reporter` might be of type Email, URL, Rich Text, or Person, and the API will reject a payload that uses the wrong shape. The adapter currently writes three fixed property types out of the box:

| Adapter option | Notion property type | What gets written |
|---|---|---|
| `titleProperty` | Title | `[Feedback] 🐛 <first 80 chars of text>` |
| `categoryProperty` | Select | `bug` / `idea` / `question` / `praise` / `other` |
| `statusProperty` | Select | The `defaultStatus` value (e.g. `Triage`) |

For a database with columns like `Title`, `Reporter`, `Page`, `Category`, the minimum config is:

```ts
notionAdapter({
  apiKey: process.env.NOTION_TOKEN!,
  databaseId: process.env.NOTION_DATABASE_ID!,
  titleProperty: 'Title',
  categoryProperty: 'Category',
})
```

Reporter and Page are written into the page **body** (as bulleted list items), not as database columns. If you want them as columns instead, see [Notes on property mapping](#notes-on-property-mapping) below.

---

## Step 4: Restart and test

`NOTION_TOKEN` and `NOTION_DATABASE_ID` are read at process startup, not per request — restart `npm run dev` after editing `.env.local`.

```bash
npx snapfeed doctor
```

The doctor command should print `✓ Destinations wired: notion`.

Before sending real feedback, confirm the token can actually see the database:

```bash
curl -X GET https://api.notion.com/v1/databases/$NOTION_DATABASE_ID \
  -H "Authorization: Bearer $NOTION_TOKEN" \
  -H "Notion-Version: 2022-06-28"
```

A `200` with the database schema means the token + share are correct. A `404 object_not_found` means you skipped the share step (Step 2). A `401 unauthorized` means the token is wrong or revoked.

Then end-to-end through your handler:

```bash
curl -X POST http://localhost:3000/api/feedback \
  -H 'Content-Type: application/json' \
  -d '{
    "text": "Test from curl",
    "appName": "MyApp",
    "pageUrl": "http://localhost:3000",
    "pageName": "Home",
    "category": "bug",
    "timestamp": "2026-04-26T12:00:00Z"
  }'
```

A new row should appear in your Notion database within a second or two.

---

## Step 5: Common errors and fixes

| Symptom | Likely cause | Fix |
|---|---|---|
| `404: ... object_not_found` | Database not shared with the integration | Open the database in Notion → `⋯` → **Connections** → add the `snapfeed` integration. This is the #1 setup failure. |
| `401: ... unauthorized` | Token is wrong, expired, or from the wrong workspace | Regenerate the token at <https://www.notion.so/my-integrations> and update `NOTION_TOKEN`. Restart the dev server. |
| `400: ... validation_error` mentioning a property name | Property name in your config doesn't match the database schema (case-sensitive) | Open the database, hover the column header, confirm the exact name. Update `titleProperty` / `categoryProperty` / `statusProperty` to match. |
| `400: ... validation_error` mentioning property type | Adapter wrote a `select` to a column that's actually `multi_select` (or vice versa) | Change the column type in Notion to match what the adapter writes (Select for category/status, Title for title). |
| `400: ... body.properties.Title.title[0].text.content.length should be ≤ 2000` | Feedback text exceeded Notion's per-block 2000-character cap | The adapter truncates the title to 80 chars; this only fires if you've patched it. Keep title content short and put long content in body blocks. |
| `400: ... Notion-Version is missing` or `unsupported version` | Custom `notionVersion` value is malformed or in the future | Omit the option to use the default (`2022-06-28`), or pick a published date from <https://developers.notion.com/reference/versioning>. |
| Notion returns `200` but `{ object: "error", ... }` in body | Notion occasionally signals errors with a 2xx status (rate limits, transient issues) | The adapter detects this and returns `ok: false` with `Notion API error: <message>`. Check the message; retry usually succeeds. |
| Page is created but the screenshot is missing, with a warning in the result | Screenshot data URI exceeded ~1MB | Expected. The adapter skips oversized images and creates the page anyway with a warning. Lower screenshot quality in the widget config if this is frequent. |
| Pages stop arriving after working for weeks | Workspace owner revoked the integration, or the database was archived/moved out of the workspace | Re-share the integration in **Settings & Members** → **Connections**, or move the database back. If the database itself was deleted, create a new one and update `NOTION_DATABASE_ID`. |

---

## Notes on property mapping

The adapter's success depends entirely on the schema of the target database. The cleanest setup is to **create the database first** with snapfeed-friendly columns:

| Column | Notion type | Filled by adapter? |
|---|---|---|
| `Title` | Title | Yes — auto-built from category emoji + first 80 chars of text |
| `Category` | Select | Yes — one of `bug`, `idea`, `question`, `praise`, `other` |
| `Status` | Select | Yes — the `defaultStatus` (e.g. `Triage`) |
| `Reporter` | Email | Not yet — currently written into the body as a bulleted line |
| `Page` | URL | Not yet — currently written into the body as a bulleted line |
| `Severity` | Select | Not yet — out of scope for the current adapter |

The matching config:

```ts
notionAdapter({
  apiKey: process.env.NOTION_TOKEN!,
  databaseId: process.env.NOTION_DATABASE_ID!,
  titleProperty: 'Title',
  categoryProperty: 'Category',
  statusProperty: 'Status',
  defaultStatus: 'Triage',
})
```

Pre-populate your `Category` and `Status` Select options (`bug`, `idea`, `question`, `praise`, `other` for Category; whatever pipeline you want for Status) so Notion doesn't have to auto-create them on each write — auto-created options inherit a random color and will pollute your option list over time.

If you need `Reporter` or `Page` as first-class columns instead of body lines, fork the adapter or wrap it — see the [custom adapter example](../../examples/custom-adapter/).

---

## Notes on security

- **The integration token is a credential.** Treat it like a password: `.env.local` for development, your platform's secret store (Vercel env vars, GitHub Actions secrets, etc.) in production. Anyone with the token can read and write every page the integration is connected to.
- **Integration scope is per-workspace.** A token created in your `personal` workspace cannot touch your `company` workspace, even if both are owned by the same Notion account. This is a feature — keep production feedback in a workspace separate from personal notes.
- **Consider a dedicated integration user.** Notion shows the integration as the "Created by" user on every page it writes. If you want a clean audit trail (e.g. "all pages by `snapfeed-bot`" vs. mixed in with a real person's pages), the integration name *is* the audit identity — name it deliberately.
- **Revocation is one click.** If the token leaks, go to <https://www.notion.so/my-integrations> → the integration → **Revoke**. All access stops immediately; rotate the token in your env and restart.

---

## See also

- [Notion API docs](https://developers.notion.com) — request/response schemas, rate limits, version history
- [Routing recipes](../MANUAL.md#5-routing-recipes) — send `bug` to Notion, `praise` to Slack
- [Custom adapter example](../../examples/custom-adapter/) — pattern for extending the Notion adapter (e.g. writing Reporter/Page as columns)
