# Compatibility

Browser, runtime, and framework compatibility for snapfeed v0.6.0.

> If your environment isn't listed below, it probably still works — snapfeed targets standard Web Platform APIs (`fetch`, `MediaRecorder`, `getDisplayMedia`, `TextEncoder`) on the browser side and standard Node ESM/CJS interop on the server side. The matrices below cover what we actively test or have user reports for.

---

## Browsers

The widget UI runs in any modern browser. Specific feature support varies — see the matrix below.

| Browser | Min version | Status | Notes |
|---|---|---|---|
| Chrome / Edge (Chromium) | 88+ | Full support | Includes screen recording, voice, paste-image |
| Firefox | 90+ | Full support | All features |
| Safari (desktop) | 14+ | Full support | All features |
| Mobile Safari (iOS) | 14+ | Works with caveats | Voice recording works but `getUserMedia` may require an explicit user gesture; **`getDisplayMedia` (screen recording) is not supported on iOS at all** |
| Mobile Chrome (Android) | 88+ | Full support | Screen recording requires user permission per call |
| IE 11 | — | **Not supported** | No `MediaRecorder`, no top-level await, no `TextEncoder` in older builds |
| Opera (Chromium-based) | matches Chrome | Works | Untested but should match Chrome behavior |
| Brave | matches Chrome | Works | Same |
| Samsung Internet | 14+ | Works | Untested but Chromium-based |

### Browser-feature minimums

The widget activates a feature only when the browser supports it. The minimums below are what the underlying API requires.

| Feature | Required browser API | Min Chrome | Min Firefox | Min Safari | iOS Safari |
|---|---|---|---|---|---|
| Hotkey activation | `KeyboardEvent` | all | all | all | all |
| Screenshot via `html2canvas` | Canvas 2D + DOM serialization | 88 | 90 | 14 | 14 |
| Paste / drag-drop image | `ClipboardEvent` + `DataTransfer` | 88 | 90 | 14 | 14 (paste only) |
| Voice recording (`snapfeed/voice`) | `MediaRecorder` + `getUserMedia` | 88 | 90 | 14.1 | 14.5 |
| Screen recording (`snapfeed/screen-recording`) | `getDisplayMedia` + `MediaRecorder` | 88 | 90 | 13 | **not supported** |
| Network capture (`snapfeed/network-capture`) | `fetch` + `XMLHttpRequest` patching | all | all | all | all |
| Cross-runtime UTF-8 length | `TextEncoder` | all (modern) | all (modern) | all (modern) | all (modern) |

---

## Node runtimes

The server handler (`createFeedbackHandler`, `feedbackMiddleware`) and Node-only adapters target the following.

| Runtime | Status | Notes |
|---|---|---|
| Node 18 LTS | Minimum supported | Required for native `fetch` and `Web Streams` used by `s3Storage` SigV4 signing |
| Node 20 LTS | **Recommended** — CI baseline | Pinned in `.nvmrc`; all examples and Docker images use this |
| Node 22 (current) | Works | Tested ad-hoc; no known issues |
| Bun ≥ 1.0 | Works for the handler | Node-only adapters that use `fs/promises` (e.g. `fileAdapter`, `googleSheetsAdapter`'s service-account JWT mint) work in Bun. Edge-runtime-only deployments don't apply. |
| Deno | Works for the handler | Requires `--allow-net` and the `npm:` specifier (`import { … } from 'npm:snapfeed'`). Untested across all adapters. |
| Cloudflare Workers | Works for handler + edge-safe adapters | `snapfeed/server/nextjs` and `snapfeed/server/express` use the cross-runtime `utf8ByteLength` helper (TextEncoder-first, Buffer-fallback). **Node-only adapters (`fileAdapter`, `googleSheetsAdapter`, `s3Storage`) won't run on edge** — they need `node:fs/promises` / `node:crypto`. |
| Vercel Edge | Same as Workers | Same Node-only restrictions |

The `utf8ByteLength` cross-runtime helper is in `src/server/security.ts`.

---

## Frameworks

| Framework | Version | Status | Example | Notes |
|---|---|---|---|---|
| Next.js | 14 (App Router) | First-class | `examples/nextjs/` | Recommended path. Uses `snapfeed/server/nextjs`. |
| Next.js | Pages Router | Works | — | Pass `createFeedbackHandler` through an `api/` route; the handler returns a `Response` that you can adapt to the legacy `(req, res)` shape. |
| Remix | 2+ | Works in principle | Example pending | Use `snapfeed/server/express`-style handler in a Remix `action`. |
| Vite + React | 5+ | Works | Example available | Client-only setup; pair with any Node backend for the handler. |
| Express | 4+ | First-class | — | Use `snapfeed/server/express`. |
| Fastify | — | Works | — | Wrap `createFeedbackHandler` in a Fastify route handler — community port welcome. |
| Hono | — | Works | — | Hono runs on edge runtimes; use the same handler + edge-safe adapters. |
| SvelteKit | — | Should work | — | Same handler pattern; community port welcome. |
| Nuxt | — | Should work | — | Same; community port welcome. |
| Vue / Svelte / Solid | — | Community port welcome | — | The widget UI is React-only today. The widget renders a self-contained component tree; a port to other frameworks is a contained piece of work. See [CONTRIBUTING.md](./CONTRIBUTING.md). |
| React Native | — | Community port welcome | — | The widget assumes DOM APIs (`html2canvas`, `MediaRecorder`); a React Native port would be a substantial reimplementation. |

---

## Known limitations

These are real, shipped behaviors — not bugs. Document them with your testers so they don't get surprised.

### iOS

- **No screen recording.** `getDisplayMedia` is not implemented in iOS Safari. The `isScreenRecordingSupported()` helper returns `false` and the screen-recording UI is hidden.
- **Voice requires a user gesture.** `getUserMedia` for the microphone may fail unless triggered directly from a user tap, depending on iOS version. The widget's mic button is a direct tap so this normally works.
- **Background-tab throttling.** iOS aggressively throttles background tabs; long-running captures may be paused.

### Backgrounded tabs

- Some browsers throttle `setInterval` when the tab is not focused. The `cacheRoutingSource` polling wrapper handles this gracefully — when the tab regains focus it catches up using its last-known-good fallback.
- `MediaRecorder` capture may be paused or terminated by the browser when the tab loses focus during long captures.

### Cross-origin iframes in screenshots

- `html2canvas` cannot capture content from cross-origin iframes (this is browser security, not a snapfeed limitation). The iframe will appear blank in the screenshot. For internal tools that embed third-party iframes, this is the expected behavior.

### Edge runtime

- Node-only adapters (`fileAdapter`, `googleSheetsAdapter`, `s3Storage`) cannot run on Cloudflare Workers / Vercel Edge — they require `node:fs/promises` and `node:crypto` (the `crypto` parts that aren't on the Web Crypto API). Use HTTP-only adapters (`slackAdapter`, `webhookAdapter`, `discordAdapter`, `githubAdapter`, etc.) for edge deployments.

### Distributed deployments

- The default in-memory rate limiter (`defaultRateLimitStore`) does **not** share state across instances. Provide a custom `RateLimitStore` (Redis / Upstash) for multi-instance deployments.

### `html2canvas` CSS coverage

- `html2canvas` rasterizes the DOM in JavaScript and does not support every CSS feature. Common gaps: complex CSS filters, some `mix-blend-mode` cases, certain CSS-grid edge cases. If your screenshots look subtly wrong, this is usually `html2canvas`, not snapfeed.

### Browser permission prompts

- Voice and screen recording trigger native browser permission dialogs. snapfeed cannot suppress, pre-grant, or skin these. Document this in your tester onboarding so they know what to click.
