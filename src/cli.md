# snapfeed CLI

The `snapfeed` package ships a tiny, zero-dependency CLI for scaffolding
config and (when applicable) a Next.js API route into an existing project.

## Installation

The CLI is bundled with the `snapfeed` package — no separate install step.
You can invoke it via `npx` without installing globally:

```bash
npx snapfeed init
```

If you've already installed `snapfeed` as a dependency:

```bash
npm exec snapfeed init
# or
./node_modules/.bin/snapfeed init
```

## Commands

### `snapfeed init`

Scaffolds snapfeed into the current project.

The CLI:

1. Detects `package.json` in the current working directory. (Errors out if missing.)
2. Detects whether the project is Next.js (`next` in `dependencies` or `devDependencies`).
3. Prompts for **mode**, **destinations**, and **hotkey** — or accepts flags
   for non-interactive use.
4. Generates files (prompting before overwriting existing ones).
5. Prints next steps.

#### Files generated

| Path                                | When         | Notes                                                 |
| ----------------------------------- | ------------ | ----------------------------------------------------- |
| `snapfeed.config.ts`                | always       | Skeleton with `defineRouting({ routes, default })`.   |
| `.env.example`                      | always       | Created if missing; otherwise a marked block is appended. Existing `.env` and `.env.local` are never touched. |
| `app/api/feedback/route.ts`         | Next.js only | Stub that calls `createFeedbackHandler({ adapters: autoAdapters(), allowedOrigins, rateLimit })`. |

If a target file already exists, the CLI prompts:

```
Overwrite snapfeed.config.ts (/path/to/snapfeed.config.ts)? [y/N]
```

`N` (default) skips the file. `--yes` skips the prompt and overwrites.

`.env.example` is always merged rather than overwritten — the snapfeed block is
appended between sentinel comments so re-running is safe.

#### Flags

| Flag                       | Purpose                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------- |
| `-y`, `--yes`              | Skip all prompts. Defaults to `--mode=cloud --destinations=file,console`.             |
| `--mode=<n>`               | `1`/`cloud`, `2`/`self-hosted`, `3`/`air-gapped`.                                     |
| `--destinations=<csv>`     | Comma-separated list. Choices: `file`, `console`, `slack`, `github`, `jira`, `linear`, `sheets`, `discord`, `telegram`, `webhook`. |
| `--hotkey=<key>`           | Hotkey to toggle the widget. Default: `ctrl+shift+f`.                                 |
| `-h`, `--help`             | Print help.                                                                            |

#### Examples

Interactive setup:

```bash
npx snapfeed init
```

Non-interactive defaults (good for CI / scripts):

```bash
npx snapfeed init --yes
```

Pick mode + destinations explicitly:

```bash
npx snapfeed init \
  --mode=self-hosted \
  --destinations=slack,github,file \
  --hotkey="meta+shift+f" \
  --yes
```

## Modes

| Mode             | When to choose                                                                         |
| ---------------- | -------------------------------------------------------------------------------------- |
| **Cloud-relayed** (default) | Fastest setup. Feedback POSTs to your `/api/feedback` route, adapters fan out from there. |
| **Self-hosted**  | You run a server adapter (Supabase, Postgres, your own webhook).                        |
| **Air-gapped**   | All adapters run client-side; no backend round-trip.                                    |

The mode is recorded in `snapfeed.config.ts` and used by your routing logic;
it does not change which files are scaffolded.

## Destinations and env vars

Each destination corresponds to one or more `SNAPFEED_*` env vars that the
runtime `autoAdapters()` reads. The CLI stubs them into `.env.example`:

| Destination | Env vars                                                                              |
| ----------- | ------------------------------------------------------------------------------------- |
| `file`      | `SNAPFEED_FILE_PATH`                                                                  |
| `console`   | (no env vars; always available)                                                       |
| `slack`     | `SNAPFEED_SLACK_WEBHOOK`, optional `SNAPFEED_SLACK_USERNAME`, `SNAPFEED_SLACK_CHANNEL` |
| `github`    | `SNAPFEED_GITHUB_TOKEN`, `SNAPFEED_GITHUB_REPO` (`owner/repo`)                        |
| `jira`      | `SNAPFEED_JIRA_HOST`, `SNAPFEED_JIRA_EMAIL`, `SNAPFEED_JIRA_TOKEN`, `SNAPFEED_JIRA_PROJECT` |
| `linear`    | `SNAPFEED_LINEAR_TOKEN`, `SNAPFEED_LINEAR_TEAM`                                       |
| `sheets`    | `SNAPFEED_SHEETS_ID`, `SNAPFEED_SHEETS_KEY`                                           |
| `discord`   | `SNAPFEED_DISCORD_WEBHOOK`                                                            |
| `telegram`  | `SNAPFEED_TELEGRAM_BOT_TOKEN`, `SNAPFEED_TELEGRAM_CHAT_ID`                            |
| `webhook`   | `SNAPFEED_WEBHOOK_URL`                                                                |

## Production doctor

After `init`, run the normal health check locally:

```bash
npx snapfeed doctor
```

Before enabling snapfeed beyond local/staging, run the stricter production check:

```bash
npx snapfeed doctor --prod
```

`--prod` keeps the normal install/framework/env/handler checks and adds static verification that the detected Next.js handler has explicit `allowedOrigins` and `rateLimit` guardrails.

## Troubleshooting

**"snapfeed init must be run inside a Node project"**
Run the command from a directory that contains a `package.json`. The CLI
does not search parent directories.

**The CLI didn't create `app/api/feedback/route.ts`.**
That file is only scaffolded when `next` is in your `dependencies` or
`devDependencies`. Add Next.js first, then re-run `snapfeed init`.

**The CLI overwrote my `snapfeed.config.ts`.**
You answered `y` (or passed `--yes`) at the overwrite prompt. The previous
contents are not backed up — recover via git.

**My `.env.local` secrets disappeared.**
They didn't — the CLI never reads or writes `.env`, `.env.local`, or any file
besides `.env.example`. Check your VCS history.

**Re-running `snapfeed init` re-appends the env block.**
It shouldn't — the CLI looks for the `# >>> snapfeed (added by snapfeed init) >>>`
marker and skips the merge if found. If you removed the marker manually,
re-add it (or delete the duplicate block).

**Hotkey doesn't trigger the widget.**
The hotkey written to `snapfeed.config.ts` is informational; you also need
to pass it to `<FeedbackProvider hotkey="..." />` in your app layout. The
example in `examples/nextjs/` shows the pattern.
