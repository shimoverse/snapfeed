# Adapters

Each adapter sends a `FeedbackPayload` to a single destination. Compose any number of them in a `createFeedbackHandler({ adapters: [...] })` call — they run in parallel; the handler returns success when at least one succeeds.

This index is the canonical map: pick a destination, follow the 5-step setup. Every adapter doc has the same shape so you can skim them quickly.

> **First time? Use [`autoAdapters()`](./autoAdapters.md)** — set a `SNAPFEED_*` env var, restart your dev server, done. The 5-step adapter docs below are for when you want explicit control or your destination needs more than env-var wiring.

> **Stuck? Run `npx snapfeed doctor`** — checks your install, framework, env vars, typo suggestions, and handler file.

---

## Pick by destination type

### Chat / messaging
| Adapter | Best for | Setup time |
|---|---|---|
| [Slack](./slack.md) | Most teams | ~5 min |
| [Discord](./discord.md) | OSS communities, indie | ~5 min |
| [Microsoft Teams](./msTeams.md) | Corporate / Office 365 shops | ~10 min |
| [Telegram](./telegram.md) | Solo devs, small private groups | ~5 min |

### Issue tracking
| Adapter | Best for | Setup time |
|---|---|---|
| [GitHub Issues](./github.md) | OSS projects, GitHub-native teams | ~5 min |
| [JIRA Cloud](./jira.md) | Mid-size + enterprise | ~10 min |
| [Linear](./linear.md) | Modern startups + product teams | ~10 min |
| [Asana](./asana.md) | Cross-functional teams | ~10 min |
| [ClickUp](./clickUp.md) | All-in-one work platform | ~10 min |
| [Notion](./notion.md) | Notion-as-database PMs | ~15 min |

### Storage / database
| Adapter | Best for | Setup time |
|---|---|---|
| [Supabase](./supabase.md) | Self-hosted Postgres + admin UI | ~15 min |
| [Google Sheets](./googleSheets.md) | Non-technical PMs, spreadsheet triage | ~20 min |
| [File (JSONL)](./file.md) | Self-hosted dev / audit trail | ~2 min |

### Catch-all
| Adapter | Best for | Setup time |
|---|---|---|
| [Webhook](./webhook.md) | n8n, Zapier, custom HTTP receivers | ~5 min |
| [Console](./console.md) | Dev fallback, smoke testing | 0 min (default) |

### Helpers
| Helper | What it does |
|---|---|
| [`autoAdapters()`](./autoAdapters.md) | Reads `SNAPFEED_*` env vars and returns the array of adapters whose env is set. Zero-config wiring path. |

---

## Don't see your destination? Write one.

Adapters are 50–150 lines of TypeScript. The contract is small (`name: string` + `send(payload) → Promise<{ ok, error?, deliveryId?, warnings? }>`).

See **[examples/custom-adapter/](../../examples/custom-adapter/)** for a complete worked example: a Mattermost adapter with construction-time validation, payload formatting, error handling, partial-failure surfacing, and tests. Read its README for the six things to get right when writing an adapter.

If your adapter would be useful to other snapfeed users, consider opening a PR. See [CONTRIBUTING.md](../../CONTRIBUTING.md).

---

## What's in every adapter doc

The 16 docs all share the same 5-step structure so you can skim them:

1. **Get a credential** — exact UI path on the destination's site
2. **Set env vars / wire the adapter** — both auto-adapter env vars and the explicit `xAdapter({...})` form
3. **Restart + verify with `npx snapfeed doctor`**
4. **Test it works** — curl-through-the-handler + a raw-curl test against the destination's own API to isolate failures
5. **Common errors and fixes** — every adapter doc has a 6+ row table covering 401s, 403s, 404s, rate limits, and the destination-specific quirks

Most also include a short "Notes on security" section.

---

## See also

- [`docs/MANUAL.md` §1.2](../MANUAL.md#12-adapters) — the adapter-contract reference
- [`docs/MANUAL.md` §5](../MANUAL.md#5-routing-recipes) — routing recipes (send `bug` to one channel, `idea` to another)
- [`examples/custom-adapter/`](../../examples/custom-adapter/) — write your own
- [`examples/admin/`](../../examples/admin/) — admin UI for the JSONL feedback file format
