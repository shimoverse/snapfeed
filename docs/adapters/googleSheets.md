# Google Sheets adapter

Appends each piece of feedback as a row in a Google Sheet via the [Sheets API v4](https://developers.google.com/sheets/api). Best for non-technical PMs and designers who want feedback in a spreadsheet they can sort, filter, and pivot — no SQL, no dashboards.

> Source: [`src/adapters/googleSheets.ts`](../../src/adapters/googleSheets.ts)
> Type: `googleSheetsAdapter(opts: GoogleSheetsAdapterOptions): FeedbackAdapter`

This adapter is **not** auto-detected. Wire it explicitly with `googleSheetsAdapter({...})`. Node only — it signs JWTs with `node:crypto` and will return an error in browser/edge runtimes.

---

## Step 1: Create a Google Cloud service account

1. Go to <https://console.cloud.google.com/iam-admin/serviceaccounts>.
2. Pick a project from the top bar (or **New Project** → name it `snapfeed-feedback` → Create).
3. Click **Create Service Account**.
4. Name it `snapfeed` (description optional) → **Create and continue**.
5. **Skip** the "Grant this service account access to project" step — no roles are needed. Sheets permissions come from sharing the sheet directly (Step 2). Click **Continue** → **Done**.
6. Click into the new service account → **Keys** tab → **Add key** → **Create new key** → choose **JSON** → **Create**. A JSON file downloads.

Open the downloaded JSON. The two fields you need are:

- `client_email` — looks like `snapfeed@your-project.iam.gserviceaccount.com`
- `private_key` — starts with `-----BEGIN PRIVATE KEY-----` and contains real newlines

Treat this file like any other secret. Don't commit it to git.

---

## Step 2: Enable the Sheets API + share the sheet

**Enable the API on the project:**

1. In Cloud Console: **APIs & Services** → **Library** → search `Google Sheets API` → **Enable**.

This is per-project, not per-service-account. Without it, every request returns `403 SERVICE_DISABLED`.

**Share the target sheet with the service account:**

1. Open your target Google Sheet in the browser.
2. Click **Share** (top-right).
3. Paste the service account's `client_email` into the people field.
4. Set the role to **Editor**.
5. Untick "Notify people" (the address can't receive mail anyway) → **Share**.

Without the share, the API returns `403 PERMISSION_DENIED` even with valid credentials and the API enabled. The service account can only see sheets explicitly shared with it.

---

## Step 3: Get the spreadsheet ID + range

The spreadsheet URL looks like:

```
https://docs.google.com/spreadsheets/d/1AbC2dEfGhIjKlMnOpQrStUvWxYz0123456789AbCd/edit#gid=0
```

The long string between `/d/` and `/edit` is the **spreadsheet ID** — copy it.

The **range** uses [A1 notation](https://developers.google.com/sheets/api/guides/concepts#expandable-1) and combines a sheet (tab) name with a column range. Examples:

- `Feedback!A:K` — sheet named `Feedback`, columns A through K (default)
- `Sheet1!A:Z` — first sheet, columns A through Z
- `Bug Reports!A:K` — sheet names with spaces work as-is (no quoting needed in the range string itself)

Sheets API `:append` semantics: it finds the last filled row in the range and inserts after it, so `A:K` is the typical pattern.

---

## Step 4: Wire the adapter

Explicit form (Sheets is not auto-wired by `autoAdapters()`):

```ts
import { googleSheetsAdapter } from 'snapfeed/adapters'
import { createFeedbackHandler } from 'snapfeed/server/nextjs'

export default createFeedbackHandler({
  adapters: [
    googleSheetsAdapter({
      spreadsheetId: process.env.SHEET_ID!,
      range: 'Feedback!A:K',                  // optional, default "Feedback!A:K"
      sheetName: 'Feedback',                  // optional, default "Feedback"
      createHeaderIfEmpty: true,              // optional, default true
      serviceAccount: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL!,
        private_key: process.env.GOOGLE_PRIVATE_KEY!.replace(/\\n/g, '\n'),
      },
    }),
  ],
})
```

**The `replace(/\\n/g, '\n')` is load-bearing.** Environment variables typically encode newlines as the literal two-character sequence `\n` (backslash + n), not real newlines. The PEM parser in `node:crypto` rejects this with the cryptic error `error:1E08010C:DECODER routines::unsupported`, which surfaces from Google as `invalid_grant`. The replace converts the literal sequence back into real newlines before the key is parsed.

If you load credentials from a JSON file instead of env vars, the newlines are already real and no replace is needed:

```ts
import serviceAccount from './snapfeed-sa.json' assert { type: 'json' }

googleSheetsAdapter({
  spreadsheetId: process.env.SHEET_ID!,
  serviceAccount,                             // already has real newlines
})
```

Then confirm the wiring:

```bash
npx snapfeed doctor
```

You should see `✓ Destinations wired: googleSheets`. Submit one piece of feedback through the widget — a new row should appear in the sheet within a second or two.

---

## Step 5: Common errors and fixes

| Symptom | Likely cause | Fix |
|---|---|---|
| `Token exchange failed (400): {"error":"invalid_grant"…}` | The literal `\n` sequence in `GOOGLE_PRIVATE_KEY` was never converted to real newlines, so PEM parsing fails | Wrap the env read with `.replace(/\\n/g, '\n')` (Step 4). If loading from JSON file, this is unnecessary. |
| `Google Sheets returned 403: …PERMISSION_DENIED…` | The sheet was never shared with the service account's `client_email` | Open the sheet → **Share** → paste the `client_email` → **Editor** → Send (Step 2). |
| `Google Sheets returned 403: …SERVICE_DISABLED…` | Sheets API is not enabled on the Cloud project the service account belongs to | Cloud Console → **APIs & Services** → **Library** → **Google Sheets API** → **Enable** (Step 2). |
| `Google Sheets returned 404: …Requested entity was not found…` | `spreadsheetId` is wrong, or the sheet was deleted/moved to a different ID | Re-copy the long string from the sheet URL between `/d/` and `/edit`. IDs don't change when you rename the sheet. |
| `Google Sheets returned 400: …Unable to parse range…` | `range` is malformed, or the sheet (tab) name in the range doesn't exist | Range must be A1 notation: `SheetName!A:K`. Confirm the tab name matches exactly (it's case-sensitive, and spaces count). |
| `Google Sheets returned 429: …Quota exceeded…` | The service account hit Sheets' per-minute write quota (default ~60 writes / 100 seconds / project) | Add `rateLimit: { max: 30, windowMs: 60_000 }` on `createFeedbackHandler`, or request a higher quota in the Cloud Console. |
| Emoji or non-ASCII text shows up as `?` or boxes | The cell font lacks glyph coverage — the API itself preserves UTF-8 fine | Change the column's font to one with broad Unicode coverage (e.g. Noto Sans). The data in the cell is correct. |
| Header row written more than once | Pre-v0.5.x race condition where concurrent first-time sends each wrote a header | Upgrade to current snapfeed — the header check is now promise-cached so concurrent first calls share one in-flight check. Delete duplicate header rows manually. |

---

## Notes on column layout

The adapter writes one row per feedback in this fixed column order:

| Col | Field | Source |
|---|---|---|
| A | `timestamp` | `payload.timestamp` |
| B | `appName` | `payload.appName` |
| C | `category` | `payload.category` (e.g. `bug`, `idea`, `praise`) |
| D | `text` | `payload.text` (the feedback body) |
| E | `pageName` | `payload.pageName` |
| F | `pageUrl` | `payload.pageUrl` |
| G | `reporterName` | `payload.user.name` |
| H | `reporterEmail` | `payload.user.email` |
| I | `severity` | reserved (always empty today) |
| J | `userAgent` | `payload.metadata.userAgent` |
| K | `viewport` | `payload.metadata.viewport` |

If `createHeaderIfEmpty: true` (the default) and the target range is empty on the first write, the adapter writes a header row using the field names above (`timestamp`, `appName`, etc.).

If you'd rather have friendlier labels — `Date`, `App`, `Type`, `Feedback`, `Page`, `URL`, `Reporter`, `Email`, `Severity`, `Browser`, `Viewport` — set `createHeaderIfEmpty: false` and create the header row yourself before the first feedback arrives. The adapter will then just append data rows under your labels.

---

## Notes on Sheets-as-a-routing-source

Separate from this adapter, snapfeed also ships [`googleSheetsRoutingSource`](../../src/routing-sources/googleSheets.ts) (importable from `snapfeed/routing-sources`). That utility reads a sheet **as the routing config itself** — each row maps a category, app, or path pattern to a destination. It's the "PM edits a sheet to change where feedback goes, no deploy required" pattern.

The two are independent: you can use the Sheets adapter as a destination, the routing source to read rules from a sheet, both, or neither. See the [routing recipes section in MANUAL.md](../MANUAL.md#5-routing-recipes) for examples.

---

## Notes on security

- The service account JSON contains a private RSA key. Treat it like any other secret: `.env.local` locally, your platform's secret store (Vercel env vars, AWS Secrets Manager, GitHub Actions secrets) in production. Never commit it to git.
- The service account has **Editor** access to every sheet you share it with. For least privilege, create a dedicated service account per sheet (or per environment) rather than reusing one across many sheets.
- Sheets sharing is the only access control. Revoking is instant: open the sheet → **Share** → click the service account → **Remove access**. The next request returns `403` and stops appending.
- This adapter signs JWTs directly with `node:crypto` — no `googleapis` or `google-auth-library` dependency. That keeps the dependency surface and the supply-chain footprint minimal.
- Access tokens are cached in-process for ~1 hour (refreshed ~60s before expiry to avoid edge-of-window 401s). On a `401`, the cache is invalidated and the request retried once with a fresh token.

---

## See also

- [Google Sheets API v4 reference](https://developers.google.com/sheets/api/reference/rest)
- [Service accounts overview](https://cloud.google.com/iam/docs/service-account-overview)
- [`snapfeed/routing-sources` — Sheets as routing config](../../src/routing-sources/googleSheets.ts)
- [Routing recipes](../MANUAL.md#5-routing-recipes) — send `bug` to one sheet, `idea` to another
- [Custom adapter example](../../examples/custom-adapter/) — pattern for destinations snapfeed doesn't ship
