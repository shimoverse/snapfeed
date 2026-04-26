# Third-Party Notices

snapfeed itself ships with **zero hard runtime dependencies**. The packages listed below are either:

- **Peer dependencies** — required at runtime when the consumer uses a particular feature.
- **Optional peer dependencies** — required only when an opt-in feature is used.
- **Adapter-specific dependencies** — required only when a particular adapter is wired up.

The consumer installs these in their own application; snapfeed does not vendor them. License compliance for each is the consumer's responsibility, but the licenses below are all MIT (permissive — usage requires preserving the upstream copyright notice).

---

## Runtime peers

### `react` and `react-dom`

| | |
|---|---|
| **License** | MIT |
| **Source** | https://github.com/facebook/react |
| **Used for** | Required peer for the widget UI (`<FeedbackProvider>`, `<FeedbackWidget>`, `<FeedbackButton>`, `<FeedbackInbox>`, the `useDevFeedback()` hook) |
| **Required when** | Using the React widget on the client |
| **Min version** | React 18 (the widget uses concurrent-safe patterns and the new JSX transform) |

### `html2canvas`

| | |
|---|---|
| **License** | MIT |
| **Source** | https://github.com/niklasvh/html2canvas |
| **Used for** | Browser-side screenshot rasterization when the user opens the widget with `autoScreenshot: true` or explicitly captures |
| **Required when** | Using screenshot capture features. Optional peer — feature is gated on dynamic import; if not installed, screenshot capture is disabled and the rest of the widget continues to work. |
| **Notes** | Cross-origin iframe limitations apply (browser security). See [COMPATIBILITY.md](../COMPATIBILITY.md) "Known limitations". |

---

## Adapter-specific dependencies

These are pulled in only when the corresponding adapter is configured.

### `@supabase/supabase-js`

| | |
|---|---|
| **License** | MIT |
| **Source** | https://github.com/supabase/supabase-js |
| **Used for** | `supabaseAdapter` — Postgres-backed inbox via Supabase's REST/PostgREST client |
| **Required when** | Wiring `supabaseAdapter` |

---

## Server framework peers

### `next`

| | |
|---|---|
| **License** | MIT |
| **Source** | https://github.com/vercel/next.js |
| **Used for** | `snapfeed/server/nextjs` — exposes `createFeedbackHandler` for the App Router; uses `NextRequest` / `NextResponse` types |
| **Required when** | Using the Next.js server handler |
| **Min version** | Next.js 14 |

### `express`

| | |
|---|---|
| **License** | MIT |
| **Source** | https://github.com/expressjs/express |
| **Used for** | `snapfeed/server/express` — exposes `feedbackMiddleware` |
| **Required when** | Using the Express middleware |
| **Min version** | Express 4 |

---

## Build / dev dependencies

These are not installed by consumers; they're used to build snapfeed itself. Listed here for transparency.

| Package | License | Used for |
|---|---|---|
| `tsup` | MIT | Bundling TS to ESM/CJS |
| `typescript` | Apache-2.0 | Type checking and `.d.ts` emission |
| `vitest` | MIT | Test runner |
| `@types/*` (various) | MIT | Type definitions for peer libraries |

The complete list of dev dependencies is in `package.json` `devDependencies`. None ship with the published npm package — they are excluded by `package.json` `files`.

---

## Notes on attribution

Per the MIT license terms of each package above, consumers redistributing snapfeed (e.g. inside a built product) should preserve the upstream copyright notices for any package whose code ends up in the redistributed binary. Because snapfeed only declares peers — it does not bundle the peer code — the obligation to attribute follows whatever bundling decisions the consumer makes.

If your organization requires a Software Bill of Materials, `npm sbom` (planned for v0.5) will produce a CycloneDX-formatted SBOM per release. In the meantime, `npm ls --json` from a snapfeed-installed project will list the resolved tree.
