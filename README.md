# snapfeed

A plug-and-play developer feedback widget for React apps. Drop it in, get a polished modal with screenshot support, and wire it to Supabase, Telegram, Slack, or any webhook — in under 5 minutes.

---

## Features

- 🎯 **Hotkey toggle** — default `Ctrl+Shift+F`, fully configurable
- 📸 **Screenshot support** — paste from clipboard, drag-and-drop, file picker, or auto-capture via html2canvas
- 🔌 **Adapter system** — chain multiple backends (Supabase + Telegram + Slack + webhooks)
- 🎨 **Zero CSS dependencies** — all styles are inline (no Tailwind, no CSS modules, no external stylesheets)
- 🌗 **Dark mode** — auto-detects system preference, or set manually
- 🎨 **Themeable** — configure accent color and position
- 📦 **Tiny footprint** — core widget ~12KB gzipped (html2canvas is optional/lazy-loaded)
- 🔒 **Production-safe** — disabled in production by default; set `enableInProduction` to unlock
- ⌨️ **Full keyboard support** — Escape to close, Ctrl+Enter to submit
- 🖥️ **Server helpers** — drop-in handlers for Next.js App Router and Express
- 📱 **Responsive** — works on mobile (hotkeys don't, but the button and modal do)

---

## Who Is This For?

| Role | How they use snapfeed |
|------|----------------------|
| 🧑‍💼 **Product Manager** | Test features in staging, flag UX issues without leaving the browser |
| 🧪 **QA Engineer** | File bugs with auto-captured screenshots and console errors attached |
| 👨‍💻 **Developer** | Hotkey-activated during local dev — never context-switch to Jira mid-flow |
| 🎨 **Designer** | Annotate screenshots and mark exactly what looks off |
| 🚀 **Founder / Solo builder** | Ship fast, get real-time feedback from beta users without a support tool |

---

## User Journeys

### 🧑‍💼 Product Manager — Reviewing a staging build

```
Sarah is reviewing the new checkout flow on staging before sign-off.
She hits a confusing UX on the payment step.
```

```
┌─────────────────────────────────────────────────────┐
│  Sarah opens staging.myapp.com                      │
│                                                     │
│  Step 1 ─── Navigates to Checkout > Payment step   │
│                                                     │
│  Step 2 ─── Spots confusing label on "Save card"   │
│             checkbox — it's ambiguous               │
│                                                     │
│  Step 3 ─── Presses Ctrl+Shift+F                   │
│             ↓                                       │
│  ┌─────────────────────────┐                        │
│  │ 💡 Idea  🐛 Bug  ❓ Q   │  ← picks 💡 Idea      │
│  │─────────────────────────│                        │
│  │ 📍 Checkout / Payment   │                        │
│  │                         │                        │
│  │ "Save card" checkbox    │                        │
│  │ copy is confusing —     │                        │
│  │ does it save for this   │                        │
│  │ session or permanently? │                        │
│  │                         │                        │
│  │ [📎 Attach screenshot]  │                        │
│  │         [Send Feedback] │                        │
│  └─────────────────────────┘                        │
│                                                     │
│  Step 4 ─── Pastes screenshot (⌘V)                 │
│             Clicks ✏️ Annotate                      │
│             Draws red arrow pointing at checkbox    │
│                                                     │
│  Step 5 ─── Clicks Send Feedback                   │
│                                                     │
│  Step 6 ─── Dev gets Slack/Telegram notification:  │
│             "💡 Idea — Checkout/Payment             │
│              Save card checkbox copy is confusing…" │
│             + annotated screenshot attached         │
└─────────────────────────────────────────────────────┘
```

**What Sarah never had to do:** Open Jira. Screenshot separately. Copy a URL. Write a ticket. Explain which page.

---

### 🧪 QA Engineer — Filing a bug during test run

```
Alex is running regression tests on the dashboard. 
A chart fails to load on Firefox. Time to log it.
```

```
┌─────────────────────────────────────────────────────┐
│  Alex opens app in Firefox, navigates to Dashboard  │
│                                                     │
│  Step 1 ─── Chart throws a JS error in console     │
│             (snapfeed auto-captures it)             │
│                                                     │
│  Step 2 ─── Presses Ctrl+Shift+F                   │
│                                                     │
│  Step 3 ─── Selects 🐛 Bug category               │
│                                                     │
│  Step 4 ─── Types:                                 │
│             "Revenue chart not rendering on         │
│              Firefox 121. Console shows             │
│              TypeError: d3 is not defined."         │
│                                                     │
│  Step 5 ─── snapfeed has already:                  │
│             ✓ Captured current URL                  │
│             ✓ Noted viewport: 1440x900              │
│             ✓ Logged browser: Firefox 121           │
│             ✓ Captured the console error            │
│                                                     │
│  Step 6 ─── Clicks Send                            │
│                                                     │
│  Result: GitHub Issue created automatically        │
│  ┌─────────────────────────────────────────┐       │
│  │ [Bug] 🐛 Revenue chart not rendering…   │       │
│  │ Page: /dashboard                        │       │
│  │ Browser: Firefox 121 / 1440x900         │       │
│  │ Console error: TypeError: d3 is not…    │       │
│  │ Labels: bug, dashboard                  │       │
│  └─────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────┘
```

**What Alex never had to do:** Copy-paste the URL. Look up the browser version. Re-type the console error. Manually attach metadata.

---

### 👨‍💻 Developer — Catching your own bug mid-build

```
Dev is building a new feature on localhost:3000.
Spots a layout issue on mobile viewport while testing.
```

```
┌─────────────────────────────────────────────────────┐
│  Dev resizes browser to 375px (iPhone)             │
│                                                     │
│  Sidebar overflows — overlaps main content         │
│                                                     │
│  Ctrl+Shift+F  →  Widget opens                     │
│                                                     │
│  autoScreenshot: true fires html2canvas            │
│  Screenshot auto-attached ✓                        │
│                                                     │
│  Types: "Sidebar overflow at <768px breakpoint"    │
│  Selects 🐛 Bug                                    │
│  Clicks ✏️ Annotate → draws red box on sidebar    │
│  Sends                                             │
│                                                     │
│  consoleAdapter() logs to terminal:                │
│  {                                                 │
│    text: "Sidebar overflow at <768px...",          │
│    category: "bug",                                │
│    pageUrl: "localhost:3000/dashboard",            │
│    metadata: { viewport: "375x812", ... }          │
│    screenshot: { base64: "...", mimeType: "..."  } │
│  }                                                 │
│                                                     │
│  → Creates GitHub issue or Slack message           │
│    without leaving the browser                     │
└─────────────────────────────────────────────────────┘
```

---

### 🚀 Beta launch — Collecting user feedback

```
You've shipped a beta. You want real users to report
issues without a support form or Intercom subscription.
```

```
┌─────────────────────────────────────────────────────┐
│  Enable snapfeed for beta users only:              │
│                                                     │
│  <FeedbackProvider                                 │
│    enableInProduction={true}                       │
│    user={{ name: session.user.name,                │
│             email: session.user.email }}           │
│    apiUrl="/api/feedback"                          │
│  >                                                 │
│                                                     │
│  Beta user hits a broken page                      │
│  Clicks the "Feedback" button (bottom-right)       │
│  Fills form, pastes screenshot                     │
│  Hits Send                                         │
│                                                     │
│  You get:                                          │
│  ┌─────────────────────────────────────────┐       │
│  │ Telegram message (instant):             │       │
│  │ 🔧 MyApp Feedback                       │       │
│  │ From: Alex Chen (alex@example.com)      │       │
│  │ Page: Settings / Billing                │       │
│  │ "The upgrade button does nothing on     │       │
│  │  Safari — no error, just hangs"         │       │
│  └─────────────────────────────────────────┘       │
│                                                     │
│  + row in Supabase feedback table                  │
│  + GitHub issue (if githubAdapter configured)      │
└─────────────────────────────────────────────────────┘
```

---

## Use Cases

| Scenario | Recommended setup |
|----------|------------------|
| **Solo dev / side project** | `consoleAdapter()` locally, `telegramAdapter()` in staging |
| **Startup in beta** | `supabaseAdapter` + `telegramAdapter` + `enableInProduction: true` for beta users |
| **Agency / client work** | `slackAdapter` — feedback lands in the client's Slack channel |
| **Open-source project** | `githubAdapter` — submissions become GitHub issues automatically |
| **Enterprise SaaS** | `webhookAdapter` → your internal bug tracker (Jira, Linear, etc.) |
| **QA team** | `supabaseAdapter` + `<FeedbackInbox />` on `/admin/feedback` for triage |
| **Design review** | Annotation layer + `slackAdapter` → screenshot with drawings goes to #design |

---

## The Full Loop (End to End)

```
TESTER / PM / USER                    YOUR BACKEND
──────────────────                    ────────────

  Opens app on any page
        │
        ▼
  Ctrl+Shift+F (or clicks button)
        │
        ▼
  ┌─────────────────────┐
  │  snapfeed widget    │
  │  ─────────────────  │
  │  Category: 🐛 Bug   │
  │  Text: [........]   │
  │  Screenshot: [img]  │
  │  [Send Feedback]    │
  └────────┬────────────┘
           │ POST /api/feedback
           ▼
  ┌─────────────────────┐             ┌──────────────┐
  │  Server handler     │────────────▶│  Supabase DB │
  │  (Next.js/Express)  │             │  (persisted) │
  └────────┬────────────┘             └──────────────┘
           │
           ├──────────────────────────▶ Telegram / Slack
           │                            (instant notification)
           │
           └──────────────────────────▶ GitHub Issue
                                        (auto-created)

  ──────────────────────────────────────────────────
  
  Dev / PM opens /admin/feedback
        │
        ▼
  ┌─────────────────────────────────────┐
  │  <FeedbackInbox />                  │
  │  ───────────────────────────────    │
  │  🐛 Sidebar overflow   /dashboard  │
  │  💡 Add dark mode      /settings   │
  │  ❓ How do I export?   /reports    │
  │  ───────────────────────────────    │
  │  [Filter by category] [Search]      │
  └─────────────────────────────────────┘
```

---

## Quick Start

### 1. Install

```bash
npm install snapfeed
# or
yarn add snapfeed
# or
pnpm add snapfeed
```

### 2. Wrap your app

```tsx
// app/layout.tsx (Next.js App Router)
import { FeedbackProvider } from 'snapfeed'
import { consoleAdapter } from 'snapfeed/adapters'

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <FeedbackProvider
          appName="My App"
          adapters={[consoleAdapter()]} // logs to console for local testing
        >
          {children}
        </FeedbackProvider>
      </body>
    </html>
  )
}
```

### 3. Try it

Open your app and press **Ctrl+Shift+F** (or Cmd+Shift+F on Mac). A feedback modal appears. Done.

For production, swap `consoleAdapter()` for a real backend — see [Adapters](#adapters) and [Server Helpers](#server-helpers).

---

## FeedbackProvider Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `appName` | `string` | `"App"` | App name shown in the UI and in notifications |
| `hotkey` | `string` | `"ctrl+shift+f"` | Keyboard shortcut to toggle widget. Format: `"ctrl+shift+f"`, `"meta+k"`, etc. |
| `position` | `"bottom-right" \| "bottom-left" \| "top-right" \| "top-left"` | `"bottom-right"` | Position of the floating trigger button |
| `theme` | `"auto" \| "light" \| "dark"` | `"auto"` | Color theme. `auto` detects system preference |
| `accentColor` | `string` | `"#D4714B"` | Primary color for buttons, focus rings, and accents |
| `adapters` | `FeedbackAdapter[]` | `[]` | Client-side adapters. When provided, feedback is sent directly from the browser |
| `apiUrl` | `string` | `"/api/feedback"` | Server API URL. Used when `adapters` is empty — recommended for production |
| `collectMetadata` | `boolean` | `true` | Auto-collect viewport size, user agent, and console errors |
| `autoScreenshot` | `boolean` | `false` | Auto-capture screenshot when widget opens (requires `html2canvas`) |
| `enableInProduction` | `boolean` | `false` | Show widget in production. Disabled by default for safety |
| `user` | `{ name?: string; email?: string }` | — | User context attached to every submission |
| `onSuccess` | `(payload) => void` | — | Called after successful submission |
| `onError` | `(error) => void` | — | Called when submission fails |

---

## useDevFeedback Hook

Programmatic control of the widget from anywhere inside `<FeedbackProvider>`.

```tsx
import { useDevFeedback } from 'snapfeed'

function MyComponent() {
  const { open, close, toggle, submit, isOpen } = useDevFeedback()

  return (
    <button onClick={open}>
      {isOpen ? 'Close feedback' : 'Open feedback'}
    </button>
  )
}
```

### Hook return values

| Value | Type | Description |
|-------|------|-------------|
| `isOpen` | `boolean` | Whether the widget is currently visible |
| `open` | `() => void` | Show the widget |
| `close` | `() => void` | Hide the widget |
| `toggle` | `() => void` | Toggle visibility |
| `submit` | `(partial) => Promise<void>` | Submit feedback programmatically |
| `config` | `object` | The resolved provider config |

### Programmatic submit

```tsx
await submit({
  text: 'The chart is broken on mobile',
  pageUrl: window.location.href,
  pageName: 'Dashboard',
  screenshot: { base64: '...', mimeType: 'image/png' }, // optional
})
```

---

## FeedbackButton Component

A standalone trigger button. Use as a floating FAB or inline in a nav.

```tsx
import { FeedbackButton } from 'snapfeed'

// Floating button (default)
<FeedbackButton />

// Inline in a sidebar
<FeedbackButton inline label="Send feedback" />

// Custom styling
<FeedbackButton inline style={{ borderRadius: '4px' }} />
```

### FeedbackButton Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `inline` | `boolean` | `false` | Render inline (in document flow) instead of fixed |
| `label` | `string` | `"Feedback"` | Button label text |
| `className` | `string` | — | Custom CSS class |
| `style` | `CSSProperties` | — | Custom inline styles |

---

## Adapters

Adapters receive every submitted `FeedbackPayload` and deliver it somewhere. You can chain multiple — all run in parallel.

### Console adapter (dev/testing)

```ts
import { consoleAdapter } from 'snapfeed/adapters'

consoleAdapter()
consoleAdapter({ level: 'info', pretty: true })
```

### Supabase adapter

```ts
import { supabaseAdapter } from 'snapfeed/adapters'

// Client-side (anon key)
supabaseAdapter({
  url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
  anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  table: 'feedback', // default
})

// Server-side (service role key — recommended)
supabaseAdapter({
  url: process.env.SUPABASE_URL!,
  serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
})
```

**Required SQL schema:**

```sql
CREATE TABLE feedback (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamptz DEFAULT now(),
  app_name text NOT NULL,
  text text NOT NULL,
  page_name text,
  page_url text,
  sender text,
  sender_email text,
  image_base64 text,
  image_mime_type text,
  metadata jsonb,
  delivered boolean DEFAULT false,
  delivery_channel text,
  delivery_id text
);

-- Optional: enable RLS
ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;

-- Allow service role (used by server adapters)
-- No policy needed for service role — it bypasses RLS by default

-- Allow anon insert if using client-side adapter
CREATE POLICY "Allow anon insert" ON feedback
  FOR INSERT TO anon WITH CHECK (true);
```

### Telegram adapter

```ts
import { telegramAdapter } from 'snapfeed/adapters'

telegramAdapter({
  botToken: process.env.TELEGRAM_BOT_TOKEN!,
  chatId: process.env.TELEGRAM_CHAT_ID!, // group chat id (with leading -)
  sendScreenshot: true, // default: true
})
```

Sends a formatted HTML message:
```
🔧 MyApp Feedback
From: Jane
Page: Dashboard /dashboard

Something is broken on this page.

Viewport: 1440x900
```

### Slack adapter

```ts
import { slackAdapter } from 'snapfeed/adapters'

slackAdapter({
  webhookUrl: 'https://hooks.slack.com/services/T.../B.../...',
  username: 'Feedback Bot',      // optional
  iconEmoji: ':pencil:',          // optional
})
```

### Webhook adapter

Posts the full `FeedbackPayload` as JSON to any URL.

```ts
import { webhookAdapter } from 'snapfeed/adapters'

webhookAdapter({
  url: 'https://your-api.com/feedback',
  headers: { 'Authorization': 'Bearer your-token' },
  timeoutMs: 10000, // default
  transform: (payload) => ({ ...payload, source: 'devtools-feedback' }), // optional
})
```

### Custom adapter

Implement the `FeedbackAdapter` interface:

```ts
import type { FeedbackAdapter } from 'snapfeed'

const myAdapter: FeedbackAdapter = {
  name: 'my-adapter',
  async send(payload) {
    // do something with payload
    console.log(payload.text)
    return { ok: true, deliveryId: 'optional-id' }
  },
}
```

---

## Server Helpers

Server-side handlers run your adapters safely on the backend (no secrets exposed to the browser). Set `apiUrl` in `FeedbackProvider` and add a route.

### Next.js App Router

```ts
// app/api/feedback/route.ts
import { createFeedbackHandler } from 'snapfeed/server/nextjs'
import { supabaseAdapter, telegramAdapter } from 'snapfeed/adapters'

export const POST = createFeedbackHandler({
  adapters: [
    supabaseAdapter({
      url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    }),
    telegramAdapter({
      botToken: process.env.TELEGRAM_BOT_TOKEN!,
      chatId: process.env.TELEGRAM_CHAT_ID!,
    }),
  ],
  // Optional hooks
  onReceive(payload) {
    // Return false to reject
    return payload.text.length <= 2000
  },
  onComplete(payload, results) {
    console.log('Feedback received:', payload.appName, results)
  },
})
```

In your layout:
```tsx
<FeedbackProvider appName="MyApp" apiUrl="/api/feedback">
  {children}
</FeedbackProvider>
```

### Express

```ts
import express from 'express'
import { feedbackMiddleware } from 'snapfeed/server/express'
import { supabaseAdapter, telegramAdapter } from 'snapfeed/adapters'

const app = express()
app.use(express.json({ limit: '10mb' })) // allow images

app.post('/api/feedback', feedbackMiddleware({
  adapters: [
    supabaseAdapter({ url: '...', serviceKey: '...' }),
    telegramAdapter({ botToken: '...', chatId: '...' }),
  ],
}))
```

---

## FeedbackPayload Type

This is what gets sent to every adapter:

```ts
interface FeedbackPayload {
  text: string         // feedback text
  appName: string      // from FeedbackProvider.appName
  pageUrl: string      // full URL (window.location.href)
  pageName: string     // document.title at time of submission
  timestamp: string    // ISO 8601

  user?: {
    name?: string
    email?: string
  }

  metadata?: {
    viewport: string       // e.g. "1440x900"
    userAgent: string
    consoleErrors: string[] // last 20 console.error() calls
  }

  screenshot?: {
    base64: string      // raw base64, no data URI prefix
    mimeType: string    // e.g. "image/png"
  }
}
```

---

## Auto-Screenshot (html2canvas)

To enable automatic screenshot capture on widget open:

1. Install html2canvas:
   ```bash
   npm install html2canvas
   ```

2. Enable in provider:
   ```tsx
   <FeedbackProvider autoScreenshot={true} ...>
   ```

html2canvas is loaded lazily — it only runs when `autoScreenshot` is true and the widget opens. It won't bloat your main bundle.

---

## TypeScript

Full TypeScript support with strict mode. All types are exported:

```ts
import type {
  FeedbackPayload,
  FeedbackAdapter,
  FeedbackAdapterResult,
  FeedbackProviderConfig,
  FeedbackContextValue,
  FeedbackHandlerConfig,
} from 'snapfeed'
```

---

## Production Mode

By default, `FeedbackProvider` is a no-op in production (it just renders children). This is a safety rail — you don't want end-users of a live product to accidentally see a dev feedback widget.

To enable in production:
```tsx
<FeedbackProvider enableInProduction={true} ...>
```

The widget is **always active** on `localhost` regardless of this setting.

---

## Recipes

### Full stack pattern (Supabase + Telegram via server route)

```tsx
// layout.tsx
<FeedbackProvider
  appName="MyApp"
  accentColor="#D4714B"
  apiUrl="/api/feedback"
  user={{ name: 'Jane' }}
>
  {children}
</FeedbackProvider>

// app/api/feedback/route.ts
export const POST = createFeedbackHandler({
  adapters: [
    supabaseAdapter({ url: process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey: process.env.SUPABASE_SERVICE_KEY! }),
    telegramAdapter({ botToken: process.env.TELEGRAM_BOT_TOKEN!, chatId: process.env.TELEGRAM_CHAT_ID! }),
  ],
})
```

### Multiple apps, one adapter config

```ts
// shared/feedback.ts
export const feedbackAdapters = [
  supabaseAdapter({ url: process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey: process.env.SUPABASE_SERVICE_KEY! }),
  telegramAdapter({ botToken: process.env.TELEGRAM_BOT_TOKEN!, chatId: process.env.TELEGRAM_CHAT_ID! }),
]

// each app's layout.tsx
<FeedbackProvider appName="AppName" adapters={feedbackAdapters}>
```

### Dark mode app

```tsx
<FeedbackProvider theme="dark" accentColor="#3B82F6" ...>
```

### Inline button in sidebar nav

```tsx
import { FeedbackButton } from 'snapfeed'

function Sidebar() {
  return (
    <nav>
      <FeedbackButton inline label="Send feedback" />
    </nav>
  )
}
```

---

## Browser Support

All modern browsers. No IE support. Uses `fetch`, `FileReader`, `ClipboardEvent`, `KeyboardEvent`.

---

## License

MIT
