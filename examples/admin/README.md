# snapfeed admin (example)

A Next.js 14 app that turns a snapfeed JSONL file into a real triage tool —
filters, bulk actions, a dashboard, audit log, saved views, and CSV export.
Designed to be self-hosted behind your existing SSO proxy.

## Quickstart

```bash
cd examples/admin
cp .env.example .env.local
npm install
npm run dev
```

Then open <http://localhost:3000>. With `SNAPFEED_ADMIN_BYPASS=1` set, you'll
be auto-authenticated as a stub admin — flip it off (or remove the env var)
to require an SSO header.

## What's new in v0.5

- **Filters bar** with date range, category, status, reporter, page-URL
  contains, has-screenshot, campaign, and free-text search. Filters live in
  the URL — share `/?status=open&category=bug` and the next person sees the
  same view.
- **Bulk actions:** select rows, then mark triaged / resolved / wontfix in
  one shot, or export the selection as CSV.
- **Inline expansion** with full text, screenshot, console errors, build /
  git SHA / env if your `metadata` carries them, and a notes textarea
  persisted to a sidecar file.
- **Dashboard tab** — totals this week / last 30, breakdown by category
  (bar chart) and status (donut), top reporters and pages, mean time-to-triage
  weekly sparkline, and active release campaigns. Charts are inline SVG —
  no Recharts / Chart.js dep added.
- **Audit log tab** — the last 200 events from `fileAuditLog`, filterable by
  type, expandable to full JSON. Read-only; the audit file is immutable.
- **Saved views** — name a filter combination ("P0 bugs from this sprint")
  and reuse it. Stored in `localStorage`, no server state.
- **CSV export** — current filtered set or current selection.
- **Top nav** with Inbox / Dashboard / Audit log.

## Auth wire-up

This example ships an intentionally placeholder auth shim
(`lib/auth.ts`). The expected production topology is a reverse proxy that
terminates SSO and forwards an identity header:

| Header                    | Required | Notes                                  |
| ------------------------- | -------- | -------------------------------------- |
| `x-snapfeed-admin-user`   | yes      | Stable user id                         |
| `x-snapfeed-admin-email`  | no       | Falls back to user id if missing       |
| `x-snapfeed-admin-role`   | no       | `admin` (default) or `viewer`          |

Common proxies that map cleanly onto this shape:

- [oauth2-proxy](https://oauth2-proxy.github.io/oauth2-proxy/) — set
  `--set-xauthrequest=true` and rename via `--set-authorization-header=true`,
  then a tiny middleware (or your ingress) renames the headers.
- [Pomerium](https://www.pomerium.com/) — use the
  [`pass_identity_headers`](https://www.pomerium.com/docs/reference/headers)
  option; remap `x-pomerium-claim-email` → `x-snapfeed-admin-email`.
- [Cloudflare Access](https://www.cloudflare.com/zero-trust/products/access/)
  — `Cf-Access-Authenticated-User-Email` → `x-snapfeed-admin-email`.
- [Google IAP](https://cloud.google.com/iap) — `X-Goog-Authenticated-User-Email`
  → `x-snapfeed-admin-email`.

For local dev set `SNAPFEED_ADMIN_BYPASS=1` and skip SSO entirely. Do **not**
ship that flag in any environment that isn't `localhost`.

A first-class auth adapter (NextAuth + SAML/OIDC bridge) is on the v0.6
roadmap.

## Data layout

The admin reads three JSONL files (paths configurable via env, see
`.env.example`):

| File                            | Direction       | Written by                        |
| ------------------------------- | --------------- | --------------------------------- |
| `SNAPFEED_FEEDBACK_FILE`        | read-only       | `fileAdapter` from your app       |
| `SNAPFEED_AUDIT_LOG_FILE`       | read-only       | `fileAuditLog`                    |
| `SNAPFEED_FEEDBACK_STATUS_FILE` | append-only     | this admin (sidecar pattern)      |

### The sidecar pattern

Triage state — `status`, `notes`, `triagedBy`, `resolvedAt`, … — never
touches the immutable feedback file. Instead, every status change appends one
JSON line to `SNAPFEED_FEEDBACK_STATUS_FILE`, keyed by a stable `id` we
derive from `(timestamp, reporter, text-prefix)`. On read we replay the
sidecar in order, so the latest entry wins per id.

This lets you back up, ship, and analyse the feedback file completely
independently of the admin's mutable state.

### Concurrency caveat

The sidecar is plain append. If two admins triage the same record in the
same millisecond, the entry written second wins on the next read — there is
no row-level lock. For the JSONL scale this admin targets (single instance,
tens of thousands of records), that is fine. If you need stronger guarantees,
wait for the v0.6 Postgres backend or wrap the write path in your own queue.

## Roadmap to v0.6

- **Postgres-backed inbox** — drop-in adapter for the data layer; same UI.
- **First-class auth adapter** — NextAuth + SAML/OIDC bridge.
- **Multi-tenant** — org scoping for hosted deployments.
- **Webhook out** — fire on status transitions so Linear / Jira can react.
- **Saved views per user, server-side** — instead of `localStorage`-only.
