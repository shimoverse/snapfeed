# Supabase adapter

Inserts feedback rows into a Supabase Postgres table via the [PostgREST](https://postgrest.org/) REST API. Best for self-hosted / mid-size teams who want their feedback in their own database — queryable via SQL, joinable to user records, and viewable in any admin UI you already have.

> Source: [`src/adapters/supabase.ts`](../../src/adapters/supabase.ts)
> Type: `supabaseAdapter(opts: SupabaseAdapterOptions): FeedbackAdapter`

Unlike the Slack adapter, Supabase is **not auto-detected** — you wire it explicitly with `supabaseAdapter({...})` because the table name and key live with your app, not your environment.

---

## Step 1: Create the table in Supabase

Open your Supabase project → **SQL Editor** → **New query**, and run:

```sql
create table if not exists feedback (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz       not null default now(),
  app_name        text              not null,
  text            text              not null,
  page_name       text,
  page_url        text,
  sender          text,
  sender_email    text,
  image_base64    text,
  image_mime_type text,
  metadata        jsonb,
  category        text,
  delivered       boolean           not null default false,
  delivery_channel text,
  delivery_id     text,
  resolved        boolean           not null default false
);

-- Optional: an index for the inbox triage view
create index if not exists feedback_created_at_idx on feedback (created_at desc);
```

Column names map 1:1 to the row shape the adapter sends — if you rename one, you'll get a `400 column does not exist` on insert (see Step 5).

If your screenshots are large (full-page captures regularly run >500 KB), consider routing them to a Supabase Storage bucket (`screenshots/`) and storing only the bucket path in `image_base64`. The adapter ships base64 inline by default, which is the simplest path but the heaviest one.

---

## Step 2: Get the URL + service-role key

1. Supabase project → **Project Settings** → **API**.
2. Copy the **Project URL** — looks like `https://abcdefgh.supabase.co`.
3. Under **Project API keys**, copy the **`service_role`** key (NOT `anon`).

> The `service_role` key bypasses Row Level Security. That's what you want for a server-side handler doing trusted inserts. It is **also a privileged credential** — if it leaks into a browser bundle, anyone can read or wipe any row in your project. **Never** put it in `NEXT_PUBLIC_*`, never ship it to the client, never commit it to git.

If you genuinely need to insert from the browser, use the `anon` key plus an `INSERT` RLS policy on the `feedback` table — but the recommended path is server-side with `service_role`.

---

## Step 3: Wire the adapter

Unlike `slackAdapter`, this one isn't picked up by `autoAdapters()` — wire it explicitly in your handler:

```ts
// app/api/feedback/route.ts (or pages/api/feedback.ts)
import { createFeedbackHandler } from 'snapfeed/server'
import { supabaseAdapter } from 'snapfeed/adapters'

export const POST = createFeedbackHandler({
  adapters: [
    supabaseAdapter({
      url: process.env.SUPABASE_URL!,
      serviceKey: process.env.SUPABASE_SERVICE_KEY!,   // server-side only
      table: process.env.SUPABASE_FEEDBACK_TABLE ?? 'feedback',
    }),
  ],
})
```

```bash
# .env.local — server-side only, NOT prefixed with NEXT_PUBLIC_
SUPABASE_URL=https://abcdefgh.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGciOiJI...   # the service_role key, kept secret
SUPABASE_FEEDBACK_TABLE=feedback       # optional; defaults to "feedback"
```

`serviceKey` and `anonKey` are aliases for the same option — pick whichever name reads more honestly for the environment. On the server, prefer `serviceKey:` so reviewers can tell at a glance the credential is privileged.

---

## Step 4: Restart and test

`SUPABASE_*` env vars are read at process startup. Restart `npm run dev` after editing `.env.local`, then:

```bash
npx snapfeed doctor
```

You should see `✓ Destinations wired: supabase`. A near-miss like *"Did you mean SUPABASE_SERVICE_KEY?"* means a typo.

Verify the key + table independently of snapfeed first — this isolates credential problems from handler problems:

```bash
curl -sS \
  -H "apikey: $SUPABASE_SERVICE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" \
  "$SUPABASE_URL/rest/v1/feedback?limit=1"
```

A `[]` or a row back means the key works and the table exists. A `401`, `403`, or `404` here means snapfeed isn't the problem (see Step 5).

Then end-to-end through your handler:

```bash
curl -X POST http://localhost:3000/api/feedback \
  -H 'Content-Type: application/json' \
  -d '{
    "text": "Test from curl",
    "appName": "MyApp",
    "pageUrl": "http://localhost:3000",
    "pageName": "Home",
    "timestamp": "2026-04-26T12:00:00Z"
  }'
```

A new row should appear in the Supabase **Table Editor** within ~1 second.

---

## Step 5: Common errors and fixes

| Symptom | Likely cause | Fix |
|---|---|---|
| `Supabase insert failed (401)` | `apikey` / `Authorization` header missing or wrong | Re-copy the `service_role` key from Settings → API. The anon key will also 401 if the JWT is expired or rotated. |
| `Supabase insert failed (403)` with `new row violates row-level security policy` | You used the **anon key** and RLS is on with no INSERT policy | Switch to the `service_role` key on the server. If you must keep anon, add an `INSERT` RLS policy on the `feedback` table. |
| `Supabase insert failed (404)` | `table` name doesn't exist (typo, wrong schema, never ran the SQL) | Open Table Editor and confirm the table is in the `public` schema. If you used a custom schema, set `table: 'myschema.feedback'` — or just create it in `public`. |
| `Supabase insert failed (400)` with `column "xxx" of relation "feedback" does not exist` | Schema drift — the adapter sends a column your table doesn't have | Re-run the `CREATE TABLE` from Step 1, or `ALTER TABLE feedback ADD COLUMN xxx ...`. The full column list is in the adapter source. |
| `Supabase insert failed (409)` with `duplicate key value violates unique constraint "feedback_pkey"` (Postgres `23505`) | You added an `id` column without `default gen_random_uuid()` and something is sending a colliding `id` | Add the default (`alter table feedback alter column id set default gen_random_uuid()`), or stop setting `id` from the client. |
| `Supabase insert failed (400)` with `invalid input syntax for type json` | `metadata` column isn't `jsonb`, or you altered it to `text` | `alter table feedback alter column metadata type jsonb using metadata::jsonb;` |
| `Supabase insert failed (413)` or silent payload truncation behind a proxy | Screenshot base64 is huge — Postgres TEXT/JSONB allow ~1 GB but your reverse proxy / Supabase plan caps request bodies (commonly 1–6 MB) | Lower screenshot quality in the widget, route screenshots to Supabase Storage and store the path instead, or raise the body limit on your handler. |
| Inserts succeed but `delivery_id` is always `null` in your code | The adapter returns `deliveryId` from the inserted row's `id` — the row is fine; the field is just on the `FeedbackAdapterResult`, not on the row itself | Working as intended. Read the row's `id` column directly if you need it for follow-up writes. |

---

## Notes on the FeedbackInbox React component

snapfeed ships a built-in inbox React component, [`<FeedbackInbox />`](../../src/FeedbackInbox.tsx), that reads from the same `feedback` table you just created. It's the "view your feedback" companion piece — drop it into your admin app, point it at the same Supabase URL + key (anon key + RLS is fine here, since this is a trusted admin surface), and you get triage out of the box: filter by `app_name`, `category`, `resolved`, mark items resolved, view screenshots inline.

You don't have to use it — any tool that reads the `feedback` table works (Supabase Table Editor, Metabase, Retool, your own admin). The inbox is just the shortest path from "feedback is landing" to "I can act on it."

---

## Notes on security

- The `service_role` key bypasses RLS. Treat it like a database password: server-side only, in `.env.local` for development and your platform's secret store (Vercel env vars, Doppler, AWS Secrets Manager) in production. **Never** prefix it with `NEXT_PUBLIC_`. **Never** commit it.
- For your admin UI / FeedbackInbox: use the `anon` key plus RLS policies. A typical setup: `SELECT` policy gated on `auth.uid() in (...admin user ids)`, `UPDATE` policy on the `resolved` column for the same set, no `INSERT`/`DELETE` for anon. This way a leaked anon key can't exfiltrate your feedback.
- Audit-log every adapter dispatch for compliance. snapfeed's `createFeedbackHandler` accepts `auditLog: fileAuditLog({ path: '...' })` (or a custom function) — wire it so every Supabase insert gets a corresponding line in your audit trail with the timestamp, app name, and delivery result.
- Combine with `rateLimit: { max: 10, windowMs: 60_000 }` on `createFeedbackHandler`. PostgREST will happily accept thousands of inserts per second; your Supabase plan probably charges for them.

---

## See also

- [Supabase REST API (PostgREST) reference](https://supabase.com/docs/guides/api)
- [`<FeedbackInbox />` component](../../src/FeedbackInbox.tsx) — admin triage UI for this same table
- [Routing recipes](../MANUAL.md#5-routing-recipes) — send `bug` to Slack, archive everything to Supabase
- [Custom adapter example](../../examples/custom-adapter/) — pattern for destinations snapfeed doesn't ship
