# snapfeed — Remix example

Use this if you have a Remix app and want to wire snapfeed in without
adding a separate backend. The widget posts to a Remix resource route
that calls `autoAdapters()` from snapfeed.

## Quickstart

1. **Copy env template** — `cp .env.example .env`, then uncomment one
   `SNAPFEED_*` variable (e.g. `SNAPFEED_FILE_PATH=feedback.jsonl` for a
   no-setup demo).
2. **Install** — `npm install` (resolves the local `snapfeed` package
   via `file:../..`; make sure you've run `npm run build` once inside
   the parent `snapfeed/` directory first).
3. **Run dev** — `npm run dev`. Remix boots on
   <http://localhost:3000>.
4. **Open** <http://localhost:3000> and press
   **Ctrl+Shift+F** (or **Cmd+Shift+F** on Mac).
5. **Submit** — type something, send. Check your destination (or the
   dev server stdout if you set `SNAPFEED_FILE_PATH`).

## What's wired up

- `app/root.tsx` — Remix root document. Wraps `<Outlet />` with
  `<SnapfeedProviderClient>`.
- `app/snapfeed-provider.tsx` — client-only wrapper. Mounts
  `<FeedbackProvider>` after the first effect runs so the SSR pass
  doesn't touch `window`.
- `app/routes/_index.tsx` — landing page with a programmatic-trigger
  button using the `useDevFeedback` hook.
- `app/routes/api.feedback.tsx` — Remix resource route (`action`
  function). Calls `autoAdapters()` and dispatches via
  `Promise.allSettled`. Falls back to `consoleAdapter()` if no env
  vars are set.

## Why ClientOnly for the provider?

`<FeedbackProvider>` registers a hotkey listener and (with
`autoScreenshot`) reaches for `window.html2canvas`. Both blow up during
SSR. Rather than pulling in `remix-utils`, we use a tiny `useEffect`
gate in `snapfeed-provider.tsx` — render children as-is on the server,
swap in the provider once mounted on the client.

## Why a resource route, not the Express middleware?

Remix actions receive a standard fetch `Request`, not Express's
`req`/`res`. Re-using `feedbackMiddleware` would mean shimming both
sides. The resource route is ~30 lines and gets you the same result —
call `autoAdapters()`, run `Promise.allSettled`, return JSON. For
production you'll want to add an origin allowlist, payload size limits,
and rate limiting (the Express middleware does these for you out of the
box if you'd rather wire that up via a separate Node process).

## Environment variables

See [`.env.example`](./.env.example). Any combination of:
`SNAPFEED_SLACK_WEBHOOK`, `SNAPFEED_DISCORD_WEBHOOK`,
`SNAPFEED_GITHUB_TOKEN` + `SNAPFEED_GITHUB_REPO`,
`SNAPFEED_TELEGRAM_BOT_TOKEN` + `SNAPFEED_TELEGRAM_CHAT_ID`,
`SNAPFEED_WEBHOOK_URL`, `SNAPFEED_FILE_PATH`.

## Troubleshooting

- **"Module not found: 'snapfeed'"** — run `npm run build` in the parent
  `snapfeed/` directory first; the example imports from its `dist/`.
- **Widget doesn't appear** — `enableInProduction` is `false` by
  default; make sure you're running `npm run dev`, not `npm start`.
- **Hydration mismatch warnings** — check that the provider stays
  client-only (the gate in `snapfeed-provider.tsx`); never render the
  widget during SSR.
- **No feedback delivery** — check the dev server console; with no env
  vars set, the route falls back to `consoleAdapter()` so submissions
  print there.
