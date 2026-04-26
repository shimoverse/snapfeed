# snapfeed — Next.js example

A minimal runnable Next.js 14 app that uses the local `snapfeed` package
(via `file:../..`) to demonstrate the feedback widget end-to-end.

## Quickstart

1. **Build the local snapfeed package** — from the snapfeed repo root, run
   `npm install && npm run build` (the example imports from `dist/`)
2. **Copy env template** — `cp .env.example .env.local`
3. **Set at least one destination** — uncomment one `SNAPFEED_*` block in
   `.env.local` (e.g. `SNAPFEED_FILE_PATH=feedback.jsonl` for a no-setup demo)
4. **Install** — `npm install` (resolves the local `snapfeed` via `file:../..`)
5. **Run** — `npm run dev`
6. **Try it** — open <http://localhost:3000>, then press **Ctrl+Shift+F**

## What's wired up

- `app/layout.tsx` — server component that mounts the client provider
- `app/snapfeed-client.tsx` — `<FeedbackProvider>` (client) with
  `appName="Demo App"`, hotkey `ctrl+shift+f`, accent `#D4714B`
- `app/api/feedback/route.ts` — `createFeedbackHandler({ adapters: autoAdapters() })`
  reads `SNAPFEED_*` env vars and falls back to console if none are set
- `app/page.tsx` — landing page with a programmatic-trigger button and a
  panel listing which env vars were detected

## Environment variables

See [`.env.example`](./.env.example) for the full list. Any combination of:
`SNAPFEED_SLACK_WEBHOOK`, `SNAPFEED_DISCORD_WEBHOOK`,
`SNAPFEED_GITHUB_TOKEN` + `SNAPFEED_GITHUB_REPO`,
`SNAPFEED_TELEGRAM_BOT_TOKEN` + `SNAPFEED_TELEGRAM_CHAT_ID`,
`SNAPFEED_WEBHOOK_URL`, `SNAPFEED_FILE_PATH`.

## Troubleshooting

- **"Module not found: 'snapfeed'"** — run `npm run build` in the parent
  `snapfeed/` directory first (the example imports from `dist/`).
- **Widget doesn't appear** — `enableInProduction` is `false`; make sure
  you're running `npm run dev`, not `npm run start`.
- **No feedback delivery** — check the dev server console; with no env vars
  set, the handler falls back to `consoleAdapter()` so submissions print there.
