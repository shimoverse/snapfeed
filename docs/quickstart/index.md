# snapfeed quickstart guides

Per-persona guides that take you from `npm install` (or `git clone`) to your first piece of feedback delivered. Each guide is self-contained — pick the one that matches your situation.

| Guide | Persona | Setup time | Stack |
|-------|---------|------------|-------|
| [Indie](./indie.md) | Solo dev, hackathon, side project, OSS docs site | 5 min | Slack |
| [Startup](./startup.md) | Founder, PM, eng at a 5–50 person company | 30 min | Slack + Linear, with routing |
| [Mid-size](./midsize.md) | Eng manager / tech lead at 50–500 people | 1 hour | Self-hosted Docker, JIRA + Slack + audit log |
| [Corp / regulated](./corp.md) | Eng / QA / IT at Fortune 500 or regulated industry | 1–2 weeks (mostly review) | Air-gapped, in-tenant LLM, JIRA + ServiceNow + SIEM |
| [OSS maintainer](./oss-maintainer.md) | Maintainer of an OSS project, accepts community PRs | 15 min + fork strategy | GitHub Issues, plus forking guide |
| [Designer / PM](./designer.md) | Consumer of the widget, not the installer | 2 min | Just press the hotkey |

## Picking a guide

If you're not sure where you fit:

- **You're installing snapfeed today and want it working in minutes.** Start with [indie](./indie.md).
- **You have a routing requirement** ("checkout bugs go to one team, dashboard to another"). Use [startup](./startup.md).
- **Your IT requires self-hosting but you're not in a regulated industry.** Use [midsize](./midsize.md).
- **You need a security review packet, in-tenant LLM, audit log to SIEM.** Use [corp](./corp.md).
- **You want feedback in your OSS repo as GitHub Issues**, or you're forking snapfeed. Use [oss-maintainer](./oss-maintainer.md).
- **Someone on your team installed snapfeed and you just want to use it.** Use [designer](./designer.md).

## Common to every guide

- **Every guide ends with a "Verify it works" section** listing the exact signals to look for after install.
- **Every guide ends with a "Troubleshooting" table** covering the most likely failure modes with fixes.
- **All code blocks are copy-paste runnable** from a fresh project root.
- **Pinned to snapfeed v0.5.3.** When you see API names like `autoAdapters`, `defineRouting`, `createFeedbackHandler`, those are the real exports — not invented for the docs.

## Reference docs

For everything beyond quickstart:

- [README](../../README.md) — full configuration reference, three deployment modes, customer journeys
- [SECURITY.md](../../SECURITY.md) — security review checklist
- [PRIVACY.md](../../PRIVACY.md) — data handling
- [CONTRIBUTING.md](../../CONTRIBUTING.md) — adapter contribution guide
- [docker/README.md](../../docker/README.md) — Docker self-host install
- [CHANGELOG.md](../../CHANGELOG.md) — what shipped in each version
