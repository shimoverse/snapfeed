# GDPR / right-to-erasure

Self-hosted snapfeed deployments often need to honor "delete my data" requests under GDPR Art. 17, CCPA, or internal data-retention policies. v0.7 ships the building blocks — `snapfeed/gdpr` plus the foundation primitives in `snapfeed/audit-log` and `snapfeed/storage`.

> Source: [`src/gdpr.ts`](../src/gdpr.ts)
> Type: `deleteByUserId(reporter: string, opts: DeleteByUserIdOptions): Promise<DeleteByUserIdResult>`

This doc covers what snapfeed itself controls (the audit log + uploaded media in your storage adapter) and what you have to handle separately (third-party adapter destinations like Slack messages or JIRA tickets).

---

## What `snapfeed/gdpr` deletes

When a user (the **reporter**) asks to be forgotten, you call:

```ts
import { deleteByUserId } from 'snapfeed/gdpr'
import { fileAuditLog } from 'snapfeed/audit-log'
import { s3Storage } from 'snapfeed/storage'

const result = await deleteByUserId('ananya@example.com', {
  auditLog: fileAuditLog({ path: '/data/audit/snapfeed.jsonl' }),
  storage: s3Storage({ bucket: 'snapfeed-uploads', region: 'us-east-1', accessKeyId: '...', secretAccessKey: '...' }),
})

console.log(result)
// {
//   feedbackEventCount: 7,        // matched feedback.received events
//   legacyEventsWithoutFeedbackId: 0,
//   deletedUploads: 12,           // unique deliveryIds removed from storage
//   failedUploads: 0,
//   errors: [],
// }
```

The helper does three things, in order:

1. **Walks the audit log** via `fileAuditLog().readAll()` and finds every `feedback.received` event whose `reporter` matches your input.
2. **Follows the `feedbackId`** stamped on each match to the corresponding `adapter.dispatched` events, collects every successful upload's `deliveryId`, and calls `storage.delete(deliveryId)` for each.
3. **Appends a `feedback.redacted` event** to the audit log so the log itself records that this reporter's data was removed (counts of feedback events matched + uploads deleted).

---

## What it does NOT delete

Three categories of data are deliberately out of scope:

### 1. The original `feedback.received` lines in the audit log
Audit logs are append-only — that's a security property, not a limitation we should fix. Modifying historical entries would let anyone with write access cover their tracks. Instead:

- The new `feedback.redacted` event records what was removed.
- Pair `fileAuditLog({ hashReporter: true })` in production so reporter identifiers are stored as truncated SHA-256 hashes from the start. Then the original `feedback.received` line carries a 12-character hash, not an email — and the `feedback.redacted` line that follows ALSO gets hash-redacted automatically.

### 2. Data already in third-party adapter destinations
Slack messages, JIRA tickets, GitHub issues, Notion pages, etc. — once snapfeed dispatched the feedback there, those systems own the data. snapfeed cannot delete them remotely.

For each destination the user is in, you have to call that destination's own deletion API. Per-destination guidance lives in [`docs/adapters/`](./adapters/index.md). Common ones:

- **Slack**: `chat.delete` requires the bot to have been the poster (incoming-webhook posts can't be deleted via the webhook URL — you need a bot token).
- **JIRA**: `DELETE /rest/api/3/issue/{key}` with the API token.
- **GitHub**: GitHub Issues cannot be deleted via the API (only closed) — issues belong to the repo, not the user.
- **Linear**: `archiveIssue` GraphQL mutation.

A practical pattern: keep a `DELETIONS_OPS` runbook with one curl-per-destination, scripted around the `result.feedbackEventCount` snapfeed returns.

### 3. Data on adapters that don't track `deliveryId`
Some adapter `send()` calls don't return a useful `deliveryId` (e.g. `consoleAdapter` — there's no message to delete). Those are just no-ops at the storage layer; the `feedback.redacted` event still records the action.

---

## Reporter matching

`deleteByUserId(reporter, ...)` matches **EXACTLY** — no case folding, no trimming. This is on purpose:

- Reporter strings come from `payload.user?.email ?? payload.user?.name`.
- These should be normalized at submission time (your auth provider gives them in canonical form).
- A surprising fuzzy match here would risk deleting **the wrong user's** data — which is itself a GDPR breach.

If your auth tokens give you both an email and a stable user ID, prefer the user ID — emails change.

---

## Pre-v0.7 audit logs

Audit events written by snapfeed v0.6 and earlier do NOT have a `feedbackId` field. The helper:

- Still counts those `feedback.received` events in `feedbackEventCount`.
- Cannot follow them to their uploads (no correlation key), so they show up in `legacyEventsWithoutFeedbackId`.

If you have a large pre-v0.7 audit log AND need to delete uploads correlated to it, the cleanest path is a manual sweep of the upload directory by mtime — or, if your storage adapter writes uploads with a path containing the user's identifier, a `find … -delete` with a grep for the identifier.

---

## Wiring it into your admin app

`deleteByUserId` is server-side only. Wire it behind whatever auth your admin surface uses:

```ts
// app/api/admin/gdpr/delete/route.ts (Next.js example)
import { NextResponse } from 'next/server'
import { deleteByUserId } from 'snapfeed/gdpr'
import { fileAuditLog } from 'snapfeed/audit-log'
import { s3Storage } from 'snapfeed/storage'
import { requireAdmin } from '../../../../lib/auth'  // your auth helper

export async function POST(req: Request) {
  await requireAdmin(req)  // 401 / 403 if not admin
  const { reporter } = await req.json()
  if (typeof reporter !== 'string' || !reporter.length) {
    return NextResponse.json({ error: 'reporter required' }, { status: 400 })
  }

  const result = await deleteByUserId(reporter, {
    auditLog: fileAuditLog({ path: process.env.SNAPFEED_AUDIT_LOG_PATH! }),
    storage: s3Storage({
      bucket: process.env.SNAPFEED_S3_BUCKET!,
      region: process.env.SNAPFEED_S3_REGION!,
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    }),
    log: (entry) => console.log('[snapfeed/gdpr]', entry),  // forward to your logger
  })

  return NextResponse.json(result)
}
```

**Logging caution.** The `log` callback receives `deliveryId`s and the `reporter` string. If your application logger ships off-host (e.g. to Datadog), make sure that's allowed under your data-handling policy — a redacted reporter that lands intact in your log infrastructure defeats the redaction.

---

## Time-based retention (v0.6, related)

For policies expressed as "delete everything older than N days" rather than "delete this specific user," use the v0.6 retention helper:

```ts
import { pruneOlderThan } from 'snapfeed/storage'

await pruneOlderThan({ retentionDays: 90 }, { storage: s3Storage({ ... }) })
```

That deletes uploads by mtime; it doesn't touch the audit log. Pair both: nightly `pruneOlderThan` for blanket retention + ad-hoc `deleteByUserId` for individual requests.

---

## Verification

After running `deleteByUserId`:

```ts
// 1. The result's counts match what you expected.
expect(result.feedbackEventCount).toBeGreaterThan(0)
expect(result.failedUploads).toBe(0)

// 2. The uploads are actually gone.
//    Each deliveryId in the matched events should now 404 / ENOENT
//    when fetched from the storage adapter.

// 3. The audit log has a feedback.redacted event for this reporter.
//    Tail the log:  tail -n5 /data/audit/snapfeed.jsonl | jq 'select(.type == "feedback.redacted")'
```

---

## Common errors

| Symptom | Likely cause | Fix |
|---|---|---|
| `audit log does not implement readAll()` | You passed `noopAuditLog()` or a custom write-only adapter | Use `fileAuditLog` (the bundled one), or implement `readAll()` on your custom adapter |
| `storage adapter "X" does not implement delete()` | Custom storage adapter without retention support | Implement `delete(deliveryId): Promise<{ deleted }>` (see [`src/storage/types.ts`](../src/storage/types.ts)) |
| `feedbackEventCount: 0` for a known user | Reporter strings don't match exactly (case/whitespace differs) | Print a sample of `reporter` values from `auditLog.readAll()` to see the canonical form, then normalize before calling |
| `legacyEventsWithoutFeedbackId > 0` | Audit log has events from snapfeed ≤ v0.6 (no correlation key) | Sweep uploads manually by mtime; the helper deletes only v0.7+ events automatically |
| `failedUploads > 0`, errors mention 403 | IAM key cannot delete S3 objects | Add `s3:DeleteObject` to the IAM policy on the bucket |
| `feedback.redacted` event not appearing in audit log | The audit log's `record()` threw (disk full, S3 outage) | Storage deletes already happened; check stderr for the `[snapfeed] audit-log write failed` line and re-run the redact event manually if needed |

---

## See also

- [`src/gdpr.ts`](../src/gdpr.ts) — source
- [`docs/MANUAL.md`](./MANUAL.md) — the full reference manual
- [`docs/adapters/`](./adapters/index.md) — per-adapter setup + how to delete from each destination
- [`snapfeed/storage` `pruneOlderThan`](../src/storage/retention.ts) — time-based retention companion to `deleteByUserId`
- [`PRIVACY.md`](../PRIVACY.md) — overall snapfeed privacy posture
- [`COMPLIANCE.md`](../COMPLIANCE.md) — regime mapping (GDPR / CCPA / SOC2 / HIPAA)
