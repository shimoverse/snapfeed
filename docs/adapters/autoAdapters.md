# autoAdapters() — zero-config env-based wiring

`autoAdapters()` is a factory that introspects `process.env` and returns the array of adapters whose `SNAPFEED_*` env vars are set. It's not an adapter itself — it's the "I don't want to think about imports" path.

> Source: [`src/adapters/auto.ts`](../../src/adapters/auto.ts)
> Type: `autoAdapters(): FeedbackAdapter[]`

---

## What it does

`autoAdapters()` is the zero-config path. You install snapfeed, you set env vars, you wrap your handler once, you're done — no per-adapter imports, no per-adapter wiring code:

```ts
import { createFeedbackHandler } from 'snapfeed/server'
import { autoAdapters } from 'snapfeed/adapters'

export const POST = createFeedbackHandler({
  adapters: autoAdapters(),
})
```

Then in `.env.local`:

```bash
SNAPFEED_SLACK_WEBHOOK=https://hooks.slack.com/services/T0XXX/B0YYY/abc123…
SNAPFEED_GITHUB_TOKEN=ghp_…
SNAPFEED_GITHUB_REPO=my-org/my-app
```

That config wires Slack and GitHub. Add `SNAPFEED_DISCORD_WEBHOOK` later and you get Discord too — no code change. Every matching adapter is appended to the returned array; nothing is mutually exclusive.

---

## The full env var table

This is the canonical reference. Anything not on this list is not read by `autoAdapters()`.

### Slack

| Env var | What it wires | Required co-var |
|---|---|---|
| `SNAPFEED_SLACK_WEBHOOK` | `slackAdapter({ webhookUrl })` | — |
| `SNAPFEED_SLACK_USERNAME` | `username` override (default: "Feedback Bot") | requires `SNAPFEED_SLACK_WEBHOOK` |
| `SNAPFEED_SLACK_CHANNEL` | `channel` override (rarely needed; webhooks bind to one channel) | requires `SNAPFEED_SLACK_WEBHOOK` |

### Discord

| Env var | What it wires | Required co-var |
|---|---|---|
| `SNAPFEED_DISCORD_WEBHOOK` | `discordAdapter({ webhookUrl })` | — |
| `SNAPFEED_DISCORD_MENTION_ROLE` | `mentionRoleId` for `<@&roleId>` pings on bug reports | requires `SNAPFEED_DISCORD_WEBHOOK` |

### GitHub

| Env var | What it wires | Required co-var |
|---|---|---|
| `SNAPFEED_GITHUB_TOKEN` | personal access token | requires `SNAPFEED_GITHUB_REPO` |
| `SNAPFEED_GITHUB_REPO` | `owner/repo` (must be exactly two segments) | requires `SNAPFEED_GITHUB_TOKEN` |

The GitHub adapter is wired only when **both** are present and `SNAPFEED_GITHUB_REPO` parses cleanly as `owner/repo`. Anything else (`my-org`, `my-org/my-app/extra`, empty halves) is rejected with a `console.warn` and the adapter is skipped — better than silently posting to the wrong repo. The auto-wiring sets `labels: ['snapfeed']`; if you need different labels, wire `githubAdapter` explicitly.

### Telegram

| Env var | What it wires | Required co-var |
|---|---|---|
| `SNAPFEED_TELEGRAM_BOT_TOKEN` | bot token from @BotFather | requires `SNAPFEED_TELEGRAM_CHAT_ID` |
| `SNAPFEED_TELEGRAM_CHAT_ID` | numeric chat ID (DM, group, or channel) | requires `SNAPFEED_TELEGRAM_BOT_TOKEN` |

### Webhook (generic)

| Env var | What it wires | Required co-var |
|---|---|---|
| `SNAPFEED_WEBHOOK_URL` | `webhookAdapter({ url })` — POSTs raw JSON payload | — |

### File

| Env var | What it wires | Required co-var |
|---|---|---|
| `SNAPFEED_FILE_PATH` | `fileAdapter({ path })` — appends one JSON object per line | — |

---

## The dev fallback

If no `SNAPFEED_*` env vars match, behavior depends on `NODE_ENV`.

**In development** (`NODE_ENV !== 'production'`), `autoAdapters()` returns:

```ts
[fileAdapter({ path: 'feedback.jsonl' }), consoleAdapter()]
```

…and prints:

```
[snapfeed] No SNAPFEED_* env vars detected — falling back to file + console adapters
(writes to ./feedback.jsonl). Set one of SNAPFEED_SLACK_WEBHOOK, SNAPFEED_SLACK_USERNAME,
SNAPFEED_SLACK_CHANNEL, SNAPFEED_DISCORD_WEBHOOK, … to wire a real destination.
```

The fallback is loud on purpose. Pre-v0.7 it was silent, and integrators would burn an afternoon wondering why their Slack channel was empty before realising `feedback.jsonl` had been quietly capturing everything.

**In production** (`NODE_ENV === 'production'`), `autoAdapters()` returns `[]` and prints:

```
[snapfeed] No adapters configured. Set SNAPFEED_* env vars or pass adapters explicitly.
```

A handler with `adapters: []` will accept feedback and discard it. If you want production to fail loudly on misconfiguration, assert `autoAdapters().length > 0` at boot time.

---

## Typo detection (v0.7+)

`autoAdapters()` runs two typo checks at construction time, before deciding what to wire. Both fire `console.warn`.

**1. Bare-name check.** If you set a common adapter env var without the `SNAPFEED_` prefix, snapfeed flags it:

```bash
# .env.local
SLACK_WEBHOOK=https://hooks.slack.com/services/...
```

```
[snapfeed] Did you mean SNAPFEED_SLACK_WEBHOOK? Found SLACK_WEBHOOK but snapfeed
only reads SNAPFEED_-prefixed env vars.
```

Checked names: `SLACK_WEBHOOK`, `DISCORD_WEBHOOK`, `GITHUB_TOKEN`, `WEBHOOK_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.

**2. Levenshtein near-miss check.** For every `SNAPFEED_*` var you set that *isn't* a known key, snapfeed finds the closest known key and suggests it if the edit distance is ≤ 3:

```bash
# .env.local
SNAPFEED_SLACK_WEBHOK=https://hooks.slack.com/services/...   # missing O
```

```
[snapfeed] Did you mean SNAPFEED_SLACK_WEBHOOK? Found SNAPFEED_SLACK_WEBHOK but
snapfeed does not read that variable.
```

The cap of 3 covers single missing/extra/transposed/substituted letters without hallucinating matches for unrelated names like `SNAPFEED_TOTALLY_UNRELATED_THING`.

If a near-miss warning fires, the dev fallback message is suppressed — the typo warning is a better explanation of what's wrong.

---

## When to use autoAdapters() vs. wire adapters explicitly

| Situation | Pattern |
|---|---|
| **Zero-config indie / startup.** You want one of the built-in destinations with default options, configured via env. | `adapters: autoAdapters()` |
| **You need custom adapter options.** E.g. `slackAdapter` with a non-default bot username, custom GitHub labels, a `webhookAdapter` with auth headers. | Import and wire each adapter explicitly. Skip `autoAdapters()`. |
| **Mix-and-match.** You want all the env-driven adapters *plus* one you wired by hand (a custom destination, or a built-in adapter with non-default options). | `adapters: [...autoAdapters(), myCustomAdapter]` |

The third pattern is common: `autoAdapters()` handles Slack and GitHub from env, while a hand-wired adapter pushes to your internal triage queue.

---

## Gotchas

- **Env vars are read at process startup, not per request.** Edit `.env.local` → restart `npm run dev`. The values are captured the first time `autoAdapters()` runs and (in most frameworks) the module-level handler keeps that array for the life of the process.
- **Only `SNAPFEED_*` names are read.** Sharing a `SLACK_WEBHOOK` var across multiple tools won't work — snapfeed needs its own prefixed copy. The bare-name typo check exists to catch exactly this.
- **Serverless platforms must inject env at runtime.** Vercel, Netlify, Cloudflare Workers, and AWS Lambda all support this, but the env vars need to be set in the platform's dashboard, not just `.env.local`. Local dev pulling from `.env.local` does not imply production has the same values — verify in your platform's UI.
- **GitHub wiring is strict.** Both `SNAPFEED_GITHUB_TOKEN` and `SNAPFEED_GITHUB_REPO` are required, and the repo string must be exactly `owner/repo` — no leading slash, no trailing path. `owner/repo/extra` is rejected with a warning rather than silently truncated.
- **The dev fallback writes to `./feedback.jsonl`** in the process's current working directory. In monorepos, that may not be where you expect — check the cwd if you can't find the file.

---

## See also

- `npx snapfeed doctor` — prints the resolved adapter list, surfaces the same typo warnings, and is the right next step when something isn't wiring.
- [Custom adapter example](../../examples/custom-adapter/) — pattern for destinations snapfeed doesn't ship.
- [Routing recipes](../MANUAL.md#5-routing-recipes) — once you've got multiple adapters wired, route `bug` to one, `idea` to another.
