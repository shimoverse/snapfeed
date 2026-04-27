# GitHub Issues adapter

Creates a GitHub issue for each feedback submission via the [REST API](https://docs.github.com/en/rest/issues/issues). Best for OSS projects and engineering teams that already triage in their repo's Issues tab.

> Source: [`src/adapters/github.ts`](../../src/adapters/github.ts)
> Type: `githubAdapter(opts: GitHubAdapterOptions): FeedbackAdapter`

---

## Step 1: Get a credential

You need a Personal Access Token (PAT) that can create issues in your target repo. GitHub offers two flavours — either works.

**Classic PAT** (simpler, broader scope):

1. Go to <https://github.com/settings/tokens> → **Generate new token** → **Generate new token (classic)**.
2. Note: `snapfeed`. Expiration: pick whatever your security policy allows.
3. Scopes: check **`repo`** (full control of private repositories). For a public OSS repo, **`public_repo`** alone is enough — no need to grant access to your private code.
4. **Generate token** and copy the `ghp_…` value. You won't see it again.

**Fine-grained PAT** (recommended, scoped to one repo):

1. Go to <https://github.com/settings/tokens?type=beta> → **Generate new token**.
2. Token name: `snapfeed`. Resource owner: the org or user that owns the target repo.
3. Repository access: **Only select repositories** → pick your one repo. This is the whole point of fine-grained tokens.
4. Repository permissions → **Issues**: set to **Read and write**. (Metadata stays at Read-only by default — that's fine.)
5. **Generate token** and copy the `github_pat_…` value.

---

## Step 2: Set the environment variables

```bash
# .env.local (or wherever your handler reads env from)
SNAPFEED_GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
SNAPFEED_GITHUB_REPO=my-org/my-app
```

`SNAPFEED_GITHUB_REPO` is parsed strictly as `owner/repo` — exactly one slash, no leading/trailing whitespace, no `https://github.com/` prefix, no trailing `.git`. `my-org/my-app` is correct; `https://github.com/my-org/my-app` is not.

If you wire the adapter explicitly (instead of via `autoAdapters()`):

```ts
import { githubAdapter } from 'snapfeed/adapters'

githubAdapter({
  token: process.env.SNAPFEED_GITHUB_TOKEN!,
  owner: 'my-org',
  repo: 'my-app',
  labels: ['feedback'],          // optional, applied to every issue
  assignees: ['myusername'],     // optional, GitHub usernames
})
```

The adapter also auto-adds a category label per submission (`bug`, `enhancement`, `question`, `feedback`) on top of any `labels` you pass.

---

## Step 3: Restart the dev server

`SNAPFEED_*` env vars are read at process startup, not per request — restart `npm run dev` (or your equivalent) after editing `.env.local`.

```bash
npx snapfeed doctor
```

The doctor command should print `✓ Destinations wired: github`. If it instead suggests a near-miss like *"Did you mean SNAPFEED_GITHUB_TOKEN?"*, you have a typo.

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

A new issue titled `[Feedback] Test from curl` should appear in your repo's Issues tab within ~1 second.

Without going through snapfeed at all, you can verify the token + repo themselves:

```bash
curl -X POST \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer $SNAPFEED_GITHUB_TOKEN" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  https://api.github.com/repos/my-org/my-app/issues \
  -d '{"title":"snapfeed token test","body":"Delete me"}'
```

A `201 Created` means the credential is good. A `401`, `403`, or `404` here means the problem is the token or repo path, not snapfeed.

---

## Step 5: Common errors and fixes

| Symptom | Likely cause | Fix |
|---|---|---|
| `GitHub Issues API returned 401` | Token is wrong, expired, or revoked | Regenerate the PAT (Step 1) and update `SNAPFEED_GITHUB_TOKEN`. Restart the dev server. |
| `GitHub Issues API returned 403` | Token lacks the `repo` / `public_repo` scope, or fine-grained token doesn't grant **Issues: write** | Edit the token's permissions (or generate a new one) and re-grant Issues write access. |
| `GitHub Issues API returned 404` | Wrong `owner/repo`, repo doesn't exist, or fine-grained token isn't authorized to see this repo | Confirm `SNAPFEED_GITHUB_REPO` matches the URL on github.com exactly (case-sensitive). For private repos under fine-grained tokens, confirm the repo is in the token's "Only select repositories" list. |
| `GitHub Issues API returned 422` with `Validation Failed` | An assignee username doesn't exist (or isn't a collaborator), or a label in `labels` is invalid for this repo | Check `assignees` are real, repo-collaborator GitHub usernames. Remove unknown labels from the `labels` option. |
| Issue is created but the category label (`bug`, `enhancement`, etc.) is missing from the UI | The label doesn't exist in the repo yet | GitHub silently drops unknown labels on issue creation rather than 422-ing. Pre-create the labels you care about under **Issues → Labels**, or pass an existing label via the `labels` option. |
| `GitHub Issues API returned 403` with `rate limit exceeded` | Burned through the 5000 requests/hour authenticated quota (e.g. spam, runaway client) | Add `rateLimit: { max: 10, windowMs: 60_000 }` to `createFeedbackHandler`. Wait for the quota to reset (the response includes an `X-RateLimit-Reset` header). |

---

## Notes on security

- The PAT is a credential — treat it like any other secret. Use `.env.local` locally and your platform's secret store (Vercel env vars, GitHub Actions secrets, AWS Secrets Manager, etc.) in production. Never commit it.
- A **fine-grained token scoped to one repo with Issues: write only** is the smallest blast radius — if it leaks, an attacker can spam issues in one repo and nothing else. A classic `repo` token can read and write all your private code; only use it if you really need to.
- GitHub's REST API rate limit for authenticated requests is 5000/hour per token. snapfeed makes one request per submission, so this is plenty for normal traffic, but combine with `rateLimit` on `createFeedbackHandler` to keep a malicious client from burning your quota.

---

## See also

- [GitHub Personal Access Token docs](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)
- [Routing recipes](../MANUAL.md#5-routing-recipes) — send `bug` to GitHub, `praise` to Slack
- [Custom adapter example](../../examples/custom-adapter/) — pattern for destinations snapfeed doesn't ship
