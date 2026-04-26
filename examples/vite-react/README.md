# snapfeed — Vite + React example

Use this if you have a Vite + React SPA and want to wire snapfeed into a
small Node backend. The frontend is a standard Vite app; the backend is
a tiny Express server that hosts the snapfeed feedback handler. Vite's
dev server proxies `/api/feedback` to the Express server so they feel
like one app in development.

In production, deploy `server.mjs` (or the equivalent middleware) inside
your own backend — Vite is purely a client bundler and has no runtime.

## Quickstart

1. **Copy env template** — `cp .env.example .env`, then uncomment one
   `SNAPFEED_*` variable (e.g. `SNAPFEED_FILE_PATH=feedback.jsonl` for a
   no-setup demo).
2. **Install** — `npm install` (also resolves the local `snapfeed`
   package via `file:../..`; make sure you've run `npm run build` once
   inside the parent `snapfeed/` directory).
3. **Run dev** — `npm run dev`. This boots Vite on
   <http://localhost:5173> and the Express backend on
   <http://localhost:8788> in parallel.
4. **Open** <http://localhost:5173> and press
   **Ctrl+Shift+F** (or **Cmd+Shift+F** on Mac).
5. **Submit** — type something, send. Check your destination (or the
   dev server stdout if you set `SNAPFEED_FILE_PATH`).

## Architecture

```
 ┌──────────────────┐    POST /api/feedback    ┌──────────────────┐
 │  Browser         │ ───────────────────────▶ │  Vite dev server │
 │  <FeedbackProv.> │                          │  (port 5173)     │
 └──────────────────┘                          └────────┬─────────┘
                                                        │ proxy
                                                        ▼
                                            ┌──────────────────────┐
                                            │  Express backend     │
                                            │  (server.mjs, 8788)  │
                                            │                      │
                                            │  feedbackMiddleware  │
                                            │  + autoAdapters()    │
                                            └────────┬─────────────┘
                                                     │
                                  ┌──────────────────┼──────────────────┐
                                  ▼                  ▼                  ▼
                              Slack            GitHub Issues       Telegram (etc.)
```

In production, replace the Vite proxy hop with your own backend
deployment. The `<FeedbackProvider apiUrl="...">` prop can point
anywhere.

## What's wired up

- `src/main.tsx` — mounts `<FeedbackProvider>` with `appName="Vite Demo"`,
  hotkey `ctrl+shift+f`, accent `#D4714B`, `autoScreenshot`.
- `src/App.tsx` — landing page with a programmatic-trigger button using
  the `useDevFeedback` hook.
- `vite.config.ts` — proxies `/api/feedback` → `http://localhost:8788`.
- `server.mjs` — Express on `8788` with `feedbackMiddleware` from
  `snapfeed/server/express`, fed by `autoAdapters()`. Falls back to
  `consoleAdapter()` when no env vars are set.

## Environment variables

See [`.env.example`](./.env.example). Any combination of:
`SNAPFEED_SLACK_WEBHOOK`, `SNAPFEED_DISCORD_WEBHOOK`,
`SNAPFEED_GITHUB_TOKEN` + `SNAPFEED_GITHUB_REPO`,
`SNAPFEED_TELEGRAM_BOT_TOKEN` + `SNAPFEED_TELEGRAM_CHAT_ID`,
`SNAPFEED_WEBHOOK_URL`, `SNAPFEED_FILE_PATH`.

## Troubleshooting

- **"Module not found: 'snapfeed'"** — run `npm run build` in the parent
  `snapfeed/` directory first; the example imports from its `dist/`.
- **Port 5173 / 8788 in use** — set `PORT` for the backend in `.env` and
  update the `target` in `vite.config.ts`, or pass `--port` to Vite via
  `npm run dev:client -- --port 5174`.
- **CORS error in the browser** — you should be hitting Vite (5173), not
  the Express backend directly. The proxy adds the right origin headers.
- **Env vars not loaded** — `.env` (not `.env.local`) is what
  `dotenv/config` reads; verify the file is at the example root and that
  you restarted `npm run dev`.
- **Widget doesn't appear in `npm run preview`** — `enableInProduction`
  is `false` by default; the production build hides the launcher.
