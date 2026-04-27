# snapfeed example: writing your own custom adapter

snapfeed ships 16 built-in adapters (Slack, JIRA, Linear, GitHub, Discord, Mattermost-via-MS-Teams, etc.). When your destination isn't on that list — Mattermost, Symphony, RocketChat, an internal bug tracker, a custom webhook with bespoke auth — you write your own.

This example walks through building a **Mattermost adapter** end-to-end: ~150 lines of real, production-shaped TypeScript with tests.

> The Mattermost adapter is illustrative — once you've read this, you can build an adapter for any HTTP-based destination in 30 minutes.

---

## What's in this folder

| File | What it shows |
|---|---|
| [`src/mattermost-adapter.ts`](./src/mattermost-adapter.ts) | The adapter itself: factory, validation, payload formatting, error handling, partial-failure surfacing |
| [`src/mattermost-adapter.test.ts`](./src/mattermost-adapter.test.ts) | Testing pattern: inject a fake `fetch`, assert on what got POSTed |
| [`src/use-with-handler.ts`](./src/use-with-handler.ts) | How to wire your adapter into a `createFeedbackHandler({ adapters: [...] })` |

---

## The 5-line minimum

A custom adapter is anything that satisfies the `FeedbackAdapter` interface:

```ts
import type { FeedbackAdapter, FeedbackAdapterResult, FeedbackPayload } from 'snapfeed/adapters'

export const myAdapter: FeedbackAdapter = {
  name: 'my-adapter',
  async send(payload: FeedbackPayload): Promise<FeedbackAdapterResult> {
    // 1. Format `payload` for your destination
    // 2. POST it
    // 3. Return { ok: true } on success, { ok: false, error: '...' } otherwise
    return { ok: true }
  },
}
```

Pass it into the handler:

```ts
createFeedbackHandler({ adapters: [myAdapter, /* + any built-ins */] })
```

That's the whole contract. Everything else is good practice.

---

## Six things to get right

The Mattermost example demonstrates each:

### 1. Validate config at construction time, not at send time

If `webhookUrl` is malformed, the user wants to know *now* (at server boot) — not on the first feedback submission five hours later. Throw from the factory.

```ts
try { void new URL(opts.webhookUrl) } catch {
  throw new Error('mattermostAdapter: webhookUrl must be a valid URL...')
}
```

### 2. Never throw from `send()`

The handler awaits `send()` for every adapter in parallel. A throw aborts the result chain. Return `{ ok: false, error: ... }` instead — the handler turns that into an audit-log entry and a degraded response, not an exception.

### 3. Truncate error bodies before returning

A 5KB stack trace from the destination is useless in your audit log. Truncate to ~200 chars; the request ID is what matters.

### 4. Handle screenshots explicitly

If your destination supports file uploads (most webhook-based ones don't), upload them. If not, return a `warnings` array — the primary message went through, but tell the caller why the screenshot didn't:

```ts
return { ok: true, warnings: ['screenshot not uploaded: webhook auth cannot post files'] }
```

### 5. Escape user-supplied markdown / HTML / control sequences

The `text` field comes from your reporter. They might write ``` `<!channel> ping` ``` in Slack-like systems and ping your whole workspace. Always escape.

```ts
function escapeMarkdown(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\*/g, '\\*').replace(/_/g, '\\_')
}
```

### 6. Inject `fetch` for testing

A `fetch` option on the factory lets tests pass a `vi.fn()` without monkey-patching the global. Keeps tests fast and deterministic:

```ts
export interface MattermostAdapterOptions {
  fetch?: typeof fetch  // defaults to globalThis.fetch
}
```

The test file shows the full pattern.

---

## Running this example

```bash
cd examples/custom-adapter
npm install
npm run type-check    # tsc --noEmit
```

To run the tests, install vitest first (it's not a dep of this sub-project):

```bash
npm install --no-save vitest@^1
npx vitest run
```

---

## Where to go next

- **Full reference for the adapter contract:** [docs/MANUAL.md §1.2](../../docs/MANUAL.md#12-adapters)
- **Per-adapter setup guides** (5-step format for the 16 built-in adapters): [docs/adapters/](../../docs/adapters/)
- **Browse the source of bundled adapters** for more patterns: [`src/adapters/`](../../src/adapters/)
- **Open a PR**: if your adapter would be useful to others, consider contributing it. See [CONTRIBUTING.md](../../CONTRIBUTING.md).
