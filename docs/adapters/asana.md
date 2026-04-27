# Asana adapter

Creates an Asana task per feedback submission via the [Asana REST v1 API](https://developers.asana.com), and (optionally) attaches the screenshot as a file on that task. Best for teams whose product / triage backlog already lives in Asana.

> Source: [`src/adapters/asana.ts`](../../src/adapters/asana.ts)
> Type: `asanaAdapter(opts: AsanaAdapterOptions): FeedbackAdapter`

This adapter is **not** auto-detected. You wire it explicitly with `asanaAdapter({...})` — there is no `SNAPFEED_ASANA_*` env shortcut.

---

## Step 1: Get an Asana Personal Access Token

1. Go to <https://app.asana.com/0/my-apps> while signed in as the user the tasks should be created as.
2. Under **Personal access tokens**, click **+ New access token**.
3. Name it (`snapfeed`) and click **Create token**.
4. Copy the token immediately — Asana shows it **once**. If you lose it, you have to revoke and create a new one.

The token inherits the permissions of the user that created it. Tasks created via the API will appear in the activity log as that user.

---

## Step 2: Get the project ID (gid)

1. Open the target project in Asana in your browser.
2. Look at the URL — it has the shape `https://app.asana.com/0/<PROJECT_GID>/...`.
3. Copy the long numeric `<PROJECT_GID>` segment. That's your `projectId`.

You also need the **workspace gid** that the project lives in. The fastest way to get it: hit `/users/me` with your token (see Step 4) — the response includes a `workspaces` array with each workspace's `gid` and `name`.

---

## Step 3: Wire the adapter

Asana isn't auto-detected — register it explicitly when you build your handler:

```ts
import { createFeedbackHandler } from 'snapfeed/server'
import { asanaAdapter } from 'snapfeed/adapters'

export const POST = createFeedbackHandler({
  adapters: [
    asanaAdapter({
      accessToken: process.env.ASANA_TOKEN!,
      workspaceId: process.env.ASANA_WORKSPACE_ID!,
      projectId: process.env.ASANA_PROJECT_ID!,
      assigneeGid: process.env.ASANA_ASSIGNEE_GID,    // optional
      tagGids: ['1199876543210987'],                  // optional
      includeScreenshotAsAttachment: true,            // default true
    }),
  ],
})
```

Corresponding `.env.local`:

```bash
ASANA_TOKEN=1/12345…           # the personal access token from Step 1
ASANA_WORKSPACE_ID=12345…      # the workspace gid (numeric)
ASANA_PROJECT_ID=67890…        # the project gid from Step 2
ASANA_ASSIGNEE_GID=11223…      # optional: user gid to auto-assign
```

All three of `accessToken`, `workspaceId`, and `projectId` are required — the adapter throws at construction time if any is missing. The project must live inside the named workspace.

---

## Step 4: Restart + test

`process.env.*` is read at process startup, so restart `npm run dev` (or your equivalent) after editing `.env.local`.

```bash
npx snapfeed doctor
```

Doctor only validates env vars it knows about; for explicitly-wired adapters like Asana, it won't print a destination row. So verify the token directly:

```bash
curl -H "Authorization: Bearer $ASANA_TOKEN" \
  https://app.asana.com/api/1.0/users/me
```

A `200` with your name and a `workspaces` array means the token is good. A `401` means the token is wrong or revoked.

Then the end-to-end test through your handler:

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

Within a second or two you should see a new task at the top of your Asana project, titled `[Feedback] 📝 Test from curl`. If the response includes `warnings`, the task was created but the screenshot upload failed — check the warning text.

---

## Step 5: Common errors and fixes

| Symptom | Likely cause | Fix |
|---|---|---|
| `401: Not Authorized` in your server logs | `ASANA_TOKEN` is wrong, expired, or was revoked | Generate a new PAT (Step 1), update `.env.local`, restart the dev server. |
| `403: Forbidden` | The token's user doesn't have access to that project (or the project is in a different workspace than `workspaceId`) | Add the user to the project in Asana, or switch to a token from a user that already has access. Confirm `workspaceId` matches the workspace the project lives in. |
| `404: Not Found` | `projectId` (or `workspaceId`) is wrong — wrong gid, wrong segment of the URL, or the project was archived/deleted | Re-grab the gid from the project URL (Step 2). Confirm the project still exists and isn't archived. |
| `400: Invalid Request` mentioning a field | `assigneeGid` or a `tagGids` entry doesn't exist or doesn't belong to this workspace; or notes exceed Asana's length limit | Asana validates field types strictly. Verify gids via `GET /users/<gid>` and `GET /tags/<gid>`. Drop the offending option and retry. |
| `429: Too Many Requests` under load | Asana rate-limits at ~150 requests / minute / token | Add `rateLimit: { max: 30, windowMs: 60_000 }` on `createFeedbackHandler`, or use a dedicated service-account token so app traffic doesn't share the limit with humans. |
| `assignee email not in workspace` style 400 | Trying to use an email instead of a gid for `assigneeGid` | The adapter passes `assigneeGid` straight through as Asana's `assignee` field. Always pass the user **gid**, not an email. Look it up via `GET /workspaces/<gid>/users`. |
| Task created, but `warnings: ["screenshot upload to task … failed"]` in the response | Attachment upload returned non-2xx (size limit, transient network, blocked MIME type) | Screenshot upload is best-effort and non-fatal — the task still has all the text. If consistently failing, set `includeScreenshotAsAttachment: false` and host screenshots elsewhere. |

---

## Notes on security

- The Personal Access Token is a credential — store it in `.env.local` locally and your platform's secret store (Vercel env vars, GitHub Actions secrets, etc.) in production. Never commit it; never ship it in a client bundle.
- **The token's user becomes the task creator and shows up in every task's activity feed.** For a clean audit trail, create a dedicated service-account user in Asana (e.g. `feedback-bot@yourco.com`), add it to the target project, and generate the PAT as that user. Don't use a real human's PAT for automation — when they leave and the account is deactivated, the integration breaks.
- Rotate tokens by going back to <https://app.asana.com/0/my-apps>, deauthorizing the old one, and creating a replacement. There's no in-place rotation — issue the new token, deploy it, then revoke the old one.
- Asana enforces a global ~150 req/min/token limit. Combine with `rateLimit` on `createFeedbackHandler` to keep abusive submissions from burning your budget.

---

## See also

- [Asana API docs](https://developers.asana.com)
- [Routing recipes](../MANUAL.md#5-routing-recipes) — send `bug` to one project, `idea` to another
- [Custom adapter example](../../examples/custom-adapter/) — pattern for destinations snapfeed doesn't ship
