# JIRA Cloud adapter

Creates a JIRA Cloud issue (REST API v3) for each feedback submission, optionally attaching the screenshot. Best for teams that already triage bugs and ideas in JIRA and want feedback to land directly in a project backlog.

> Source: [`src/adapters/jira.ts`](../../src/adapters/jira.ts)
> Type: `jiraAdapter(opts: JiraAdapterOptions): FeedbackAdapter`

---

## Step 1: Get a JIRA API token

1. Go to <https://id.atlassian.com/manage-profile/security/api-tokens> (sign in to the Atlassian account you want feedback issues created under).
2. Click **Account** → **Security** → **Create and manage API tokens**.
3. Click **Create API token**, give it a label (`snapfeed`), and **Copy** the value — you can't view it again.

The user account whose token you use must have at least **Browse projects** + **Create issues** permission on the target project. Verify in JIRA: **Project settings** → **Permissions**. If you also want screenshot attachments, the user needs **Create attachments** too.

---

## Step 2: Wire the adapter

snapfeed does **not** auto-detect JIRA — there's no `autoAdapters()` env-var convention for it. Wire it explicitly in your handler:

```ts
import { createFeedbackHandler } from 'snapfeed/server/nextjs'
import { jiraAdapter } from 'snapfeed/adapters'

export const POST = createFeedbackHandler({
  adapters: [
    jiraAdapter({
      host: process.env.JIRA_HOST!,                    // "mycompany.atlassian.net" (no protocol)
      email: process.env.JIRA_EMAIL!,                  // account email — used as Basic auth username
      apiToken: process.env.JIRA_API_TOKEN!,           // token from Step 1
      projectKey: process.env.JIRA_PROJECT_KEY!,       // short uppercase prefix, e.g. "FEED"
      issueType: 'Bug',                                // optional, default "Bug"
      labels: ['snapfeed'],                            // optional
      assignee: '5b10a2844c20165700ede21g',            // optional, accountId (NOT email/username)
      priority: {                                      // optional, single string or per-category map
        bug: 'High',
        idea: 'Low',
        question: 'Low',
        praise: 'Low',
        other: 'Medium',
      },
      includeScreenshot: true,                          // optional, default true
    }),
  ],
})
```

Keep the secrets in env:

```bash
# .env.local
JIRA_HOST=mycompany.atlassian.net
JIRA_EMAIL=bot@mycompany.com
JIRA_API_TOKEN=ATATT3xFfGF0…
JIRA_PROJECT_KEY=FEED
```

---

## Step 3: Restart the dev server

Env vars are read at process startup, not per request — restart `npm run dev` (or your equivalent) after editing `.env.local`.

```bash
npx snapfeed doctor
```

The doctor command should print `✓ Destinations wired: jira`. If it doesn't list `jira`, your handler isn't importing the adapter — `jiraAdapter({...})` must appear in the `adapters` array.

---

## Step 4: Test it works

End-to-end through your handler:

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

A new issue should appear in your JIRA project within ~1–2 seconds. The issue summary will be `[Feedback] Test from curl`.

To isolate **"is the token valid"** from **"is the project key right"**, hit the JIRA API directly:

```bash
# Verifies Basic auth (email + token) — should return your account JSON
curl -u "$JIRA_EMAIL:$JIRA_API_TOKEN" \
  "https://$JIRA_HOST/rest/api/3/myself"
```

A `200` here means the credential pair works. If that succeeds but issue creation 404s, the problem is `projectKey` or `issueType`, not auth.

---

## Step 5: Common errors and fixes

| Symptom | Likely cause | Fix |
|---|---|---|
| `401: Unauthorized` from issue create | Token is wrong, revoked, or `email` doesn't match the account that owns the token | Run the `/myself` curl above. If that also 401s, regenerate the token (Step 1) and confirm `JIRA_EMAIL` matches the token owner's account email exactly. |
| `403: Forbidden` from issue create (auth itself works) | Token user lacks **Create issues** permission on this project | In JIRA: **Project settings** → **Permissions** → grant **Create issues** to the user (or their group/role). Use a service-account user instead of a personal one for stable permissions. |
| `404: Not Found` on `/rest/api/3/issue` | Wrong `host` (typo, missing region prefix, included `https://`) | `host` must be just the bare hostname like `mycompany.atlassian.net` — no protocol, no trailing slash, no path. |
| `404` mentioning the project | `projectKey` doesn't exist or is misspelled | The project key is the short uppercase prefix shown before the dash in any issue ID (e.g. `BUG-123` → key is `BUG`). Find it in JIRA under **Projects** → your project → **Details**. |
| `400: Bad Request` saying *"issue type is required"* or *"valid issue type"* | `issueType` doesn't exist in this project's scheme (e.g. you passed `'Bug'` to a project that only has `'Task'` and `'Story'`) | Check **Project settings** → **Issue types** for the exact name (case-sensitive). Common gotcha: company-managed vs team-managed projects ship different default types. |
| `400: Bad Request` mentioning a `customfield_*` field | The project requires custom fields on creation that this adapter doesn't set | This adapter only sets `project`, `summary`, `description`, `issuetype`, and (optionally) `labels`/`assignee`/`priority`. If your project requires more, either make those fields optional in the project's create screen, or fork the adapter — see [the custom-adapter example](../../examples/custom-adapter/). |
| `429: Too Many Requests` with a `Retry-After` header | Hit Atlassian Cloud rate limits (per-user, per-tenant) | Add `rateLimit: { max: 10, windowMs: 60_000 }` to `createFeedbackHandler` to throttle at your edge. snapfeed surfaces the failure but doesn't retry — use a queue if you need durable redelivery. |
| `404` everywhere even though the host loads in a browser | You're on **JIRA Server / Data Center**, not Cloud | This adapter is **Cloud-only**. Self-hosted JIRA uses `/rest/api/2/…` (different auth scheme too — typically PAT in a Bearer header, not Basic). Fork the adapter and swap the base URL + auth header. |
| Issue is created but no screenshot attached | Token user lacks **Create attachments** permission, or the deployment blocks the multipart upload | The adapter logs `[jira adapter] screenshot upload to KEY-N failed (status): …` to your server console. Attachment failures are non-fatal by design — the issue still gets created. |

---

## Notes on security

- The API token is a credential — treat it like any other secret. Use `.env.local` locally and your platform's secret store (Vercel env vars, GitHub Actions secrets, etc.) in production.
- The token's user becomes the **Reporter** on every issue created by snapfeed. If that user is your personal account, every feedback ticket will look like *you* filed it. **Use a dedicated service-account user** (e.g. `snapfeed-bot@yourcompany.com`) for clean audit trails and so revoking access doesn't require offboarding a human.
- This adapter is **JIRA Cloud only**. Server / Data Center deployments use the v2 REST API (`/rest/api/2/…`) and a different auth model (Personal Access Tokens via `Authorization: Bearer …`, not Basic). Pointing this adapter at a self-hosted host will 404 on every request.
- Atlassian rate-limits per user and per tenant. If feedback volume is high, either throttle at snapfeed (`rateLimit` on the handler) or batch via a queue.

---

## See also

- [Atlassian API token docs](https://support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/)
- [Routing recipes](../MANUAL.md#5-routing-recipes) — send `bug` to JIRA, `praise` to Slack
- [Custom adapter example](../../examples/custom-adapter/) — pattern for Server / Data Center, custom fields, or anything else this adapter doesn't cover
