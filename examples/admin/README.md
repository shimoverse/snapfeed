# snapfeed admin (example)

A minimal Next.js app that reads feedback from a JSONL file (the format
snapfeed's `fileAdapter` writes) and renders an inbox you can browse,
search, and filter by category.

This is a starting point — production deployments will plug in Postgres,
Supabase, or another store via the data adapter pattern.

## Quickstart

```bash
cd examples/admin
cp .env.example .env.local
npm install
npm run dev
```

Then open <http://localhost:3000>.

## How it works

- `app/page.tsx` is a server component that reads
  `SNAPFEED_FEEDBACK_FILE` (default `./feedback.jsonl`), parses each
  line as a `FeedbackPayload`, and passes the array to a client
  `<Inbox />` component.
- `app/inbox.tsx` is the client island: search, category chips,
  expandable rows, and a local-only "Mark resolved" button.
- If the file is missing, the page renders an empty state with a
  pointer to the `fileAdapter`.

## Wiring up the source file

Configure your app to use snapfeed's `fileAdapter`:

```ts
import { fileAdapter } from 'snapfeed/adapters'

export const adapters = [fileAdapter({ path: './feedback.jsonl' })]
```

Then point this admin at the same path via `SNAPFEED_FEEDBACK_FILE`.

## Roadmap

v0.4 is read-only. v0.5 will add write-back (mark resolved, assign,
comment) via a server action backed by the same data adapter pattern.
