# Linear adapter

Creates a Linear issue per feedback submission via the [Linear GraphQL API](https://developers.linear.app). The description is rendered as Markdown (Linear's native format), with optional inline base64 screenshot embedding. Best for product/engineering teams who triage in Linear.

> Source: [`src/adapters/linear.ts`](../../src/adapters/linear.ts)
> Type: `linearAdapter(opts: LinearAdapterOptions): FeedbackAdapter`

Linear is **not** auto-detected by `autoAdapters()` — you must wire it explicitly with `linearAdapter({...})`.

---

## Step 1: Get a Linear API key

1. In Linear, click your avatar → **Settings**.
2. Go to **API** → **Personal API keys** → **Create key**.
3. Name it (`snapfeed`), pick a workspace, and create.
4. Copy the resulting token — looks like `lin_api_abc123…`. You won't see it again.

The key inherits the **full permissions of the user that created it** — if that user is removed from a team, the key loses access too. For clean audit trails (issues attributed to a bot, not a real person), create the key from a dedicated service-account user that's a member of the target team.

OAuth tokens are also supported; the adapter auto-prefixes them with `Bearer ` if the value starts with `lin_oauth_` or contains a `.` (JWT shape). Personal API keys are sent raw, per Linear convention.

---

## Step 2: Get the team ID

The adapter wants the team **ID** (a UUID-shaped string like `team_xxx` / `a1b2c3d4-…`), **not** the team key (`BUG`, `ENG`) you see in issue identifiers.

The team key is visible in the URL when you're on a team in Linear:

```
linear.app/<workspace>/team/<TEAM-KEY>/...
```

To get the **team ID**, query the GraphQL API once:

```bash
curl -X POST https://api.linear.app/graphql \
  -H 'Content-Type: application/json' \
  -H "Authorization: $LINEAR_API_KEY" \
  -d '{"query":"{ teams { nodes { id key name } } }"}'
```

The response includes each team's `id` (use this), `key` (the short uppercase code), and `name`. Copy the `id` of the team you want issues filed under.

If you also want to scope to a project, label, workflow state, or assignee, grab those IDs with similar queries (`{ projects { nodes { id name } } }`, etc.) — see the [Linear API docs](https://developers.linear.app).

---

## Step 3: Wire the adapter

```ts
// app/api/feedback/route.ts (Next.js App Router) — or wherever your handler lives
import { createFeedbackHandler } from 'snapfeed/server/nextjs'
import { linearAdapter } from 'snapfeed/adapters'

export const POST = createFeedbackHandler({
  adapters: [
    linearAdapter({
      apiKey: process.env.LINEAR_API_KEY!,
      teamId: process.env.LINEAR_TEAM_ID!,

      // Optional:
      projectId: process.env.LINEAR_PROJECT_ID,        // file under a project
      labelIds: ['lbl_xxx', 'lbl_yyy'],                 // apply labels (must exist on the team)
      stateId: 'state_xxx',                             // initial workflow state
      assigneeId: 'user_xxx',                           // auto-assign

      // Per-category priority. 0 = none, 1 = urgent, 2 = high, 3 = medium, 4 = low.
      priority: { bug: 1, idea: 3, question: 4, praise: 4, other: 3 },

      // Or a single priority for everything:
      // priority: 2,

      embedScreenshotAsDataUri: true,                   // default true; inline base64
      includeScreenshotAsAttachment: true,              // default true
    }),
  ],
})
```

Set the secrets in your env file:

```bash
# .env.local
LINEAR_API_KEY=lin_api_abc123…
LINEAR_TEAM_ID=a1b2c3d4-e5f6-7890-abcd-ef1234567890

# Optional
LINEAR_PROJECT_ID=…
```

`apiKey` and `teamId` are required — the adapter throws at construction time if either is missing.

---

## Step 4: Restart + test

`process.env.*` is read at process startup, so restart `npm run dev` (or your equivalent) after editing `.env.local`.

```bash
npx snapfeed doctor
```

The doctor command should report your handler is wired. If it can't find the env vars, check for typos.

End-to-end through your handler:

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

A new issue should appear in your Linear team within ~1 second.

To **isolate "is the key valid" from "is the team ID right"**, hit the Linear GraphQL endpoint directly with a `viewer` query — this only needs the key:

```bash
curl -X POST https://api.linear.app/graphql \
  -H 'Content-Type: application/json' \
  -H "Authorization: $LINEAR_API_KEY" \
  -d '{"query":"{ viewer { id name email } }"}'
```

If this returns your user, the key works. If it returns `401`, the key is wrong/expired — fix that before debugging team IDs or labels.

---

## Step 5: Common errors and fixes

| Symptom | Likely cause | Fix |
|---|---|---|
| Adapter returns `401: …` | API key is wrong, expired, or revoked | Run the `viewer { id }` curl above. If it also fails, regenerate the key in Linear → Settings → API and update `LINEAR_API_KEY`. |
| `Linear GraphQL error: Team … doesn't exist or you don't have access` | `teamId` is wrong (you may have used the team **key** like `BUG` instead of the UUID), or the key's user isn't a member of that team | Re-run the `{ teams { nodes { id key name } } }` query with the same key — only teams the key can access appear. Copy `id`, not `key`. |
| `Linear GraphQL error: Variable "$input" got invalid value … at "priority"` | Priority is outside `0-4`. Linear uses `0 = none, 1 = urgent, 2 = high, 3 = medium, 4 = low` | Use only those values. The `LinearPriority` type in the adapter enforces this at compile time. |
| `Linear GraphQL error: Label … doesn't exist` (or labels silently missing on the issue) | `labelIds` references labels from a different team, or labels that were deleted | Labels are scoped per-team in Linear. Query `{ team(id: "…") { labels { nodes { id name } } } }` and use IDs from that list. |
| Adapter returns `429: …` or intermittent failures under load | Hit Linear's per-key rate limit (burst limit on the GraphQL API) | Add `rateLimit: { max: 10, windowMs: 60_000 }` on `createFeedbackHandler` to throttle inbound submissions. For sustained high volume, request a higher limit from Linear or use OAuth. |
| Adapter returned `200` but no issue appears, then later starts failing with `401` | The user that owns the API key was removed from the workspace or the target team | Recreate the key from a service-account user that's a permanent member of the team (see Step 1). |
| Screenshot is missing from the issue body | Screenshot exceeded Linear's renderer size limit (~1MB data URIs may be stripped) | Expected for large screenshots. The issue is still created without it. A storage adapter that produces a public URL is the long-term fix (future work). |

---

## Notes on security

- The Linear API key is a **credential** — treat it like any other secret. Use `.env.local` locally and your platform's secret store (Vercel env vars, GitHub Actions secrets, etc.) in production. Never commit it.
- Linear's GraphQL API does **not** offer fine-grained scopes for personal API keys. The key has the full permissions of the user that created it — read and write across every team that user can see. There is no "issues:write only" scope.
- Use a **service-account user** dedicated to integrations: invite a `bot@yourco.com` user, add it only to the teams snapfeed should write to, and create the key from that account. This bounds blast radius if the key leaks and gives you clean audit trails (issues show "created by snapfeed bot" rather than a random engineer).
- Pair with `rateLimit: { max: 10, windowMs: 60_000 }` on `createFeedbackHandler` to prevent an open `/api/feedback` endpoint from being used to spam-create Linear issues.

---

## See also

- [Linear API docs](https://developers.linear.app) — GraphQL schema, rate limits, OAuth
- [Routing recipes](../MANUAL.md#5-routing-recipes) — send `bug` to Linear, `praise` to Slack
- [Custom adapter example](../../examples/custom-adapter/) — pattern for destinations snapfeed doesn't ship
