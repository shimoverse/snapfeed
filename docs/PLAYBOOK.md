# snapfeed adoption playbook

> **Adoption playbook for snapfeed v0.4. Use this as a template — copy what fits, drop what doesn't.** Written for an engineering manager who has decided to try snapfeed and needs to (a) convince their team it's worth the airtime, (b) roll it out without breaking anything, and (c) know within 30 days whether it's working.

Last updated: 2026-04-26 (snapfeed v0.4.0)

---

## Why a playbook

The biggest reason internal-feedback rollouts fail is not the tool. It is that the testers don't know the tool exists, *or* that the receivers (PMs, engineers) have no process to triage what arrives. The widget can be perfect and the rollout will still fail if a feedback item lands in a Slack channel with no owner, sits for two weeks, and the reporter learns "filing feedback is a dead drop." That reporter will never file again, and they'll tell three colleagues.

This playbook gives you the three things a rollout needs: the **comms** (what you say to the testers and to the broader org), the **triage workflow** (the role, the SLA, the rituals), and the **success measures** (how you know in 30 days whether to scale or kill it).

It is opinionated by design. The opinions come from the shape of the product (snapfeed is internal-first, server-routed, fork-friendly) and from talking to teams that adopted it. If your context is different — say, your testers are external contractors, or your bug tracker is ServiceNow — fork this playbook and adapt.

---

## Pre-flight checklist (before day 1)

Do these once, in order, before you announce anything to the team.

1. **Pick your mode.** Cloud-relayed, self-hosted, or air-gapped. See the [README persona picker](../README.md#pick-your-mode). If you're not sure: indie/hackathon = cloud-relayed; startup with a security review pending = self-hosted; corporate with internal-tracker-only = air-gapped.
2. **Get security review approval.** For now, send your security team:
   - [`SECURITY.md`](../SECURITY.md) — the corporate review checklist.
   - [`THREAT_MODEL.md`](../THREAT_MODEL.md) — threats, mitigations, and residual risks.
   - [`COMPLIANCE.md`](../COMPLIANCE.md) — GDPR / CCPA / HIPAA / SOC 2 / PCI / FedRAMP posture.
   - [`PRIVACY.md`](../PRIVACY.md) — data flow, telemetry posture (zero), and a copy-paste paragraph for your own privacy policy.
   - (Once it exists: `SECURITY_REPORT.md` from a third-party audit.)
3. **Pick your destinations.** At minimum: one Slack channel (real-time visibility) plus one ticket tracker (JIRA project, Linear team, GitHub repo, or Notion DB). Pick the tools your team already lives in. Do not introduce a new tool with snapfeed.
4. **Designate a feedback steward.** One named person responsible for triaging during the pilot. Not a rotation. Not a team. One person, ten minutes a day in Phase 1. The most common rollout failure mode is "everyone owns it, no one owns it." Give the role a clear charter (see Triage runbook in the templates appendix).

---

## Phase 1 — Days 1–7: Pilot with 5 people

**Goal.** Prove the plumbing works end-to-end with one team. By end-of-week, you have empirical evidence that a piece of feedback typed into the widget arrives in Slack and the tracker, contextualized.

### Day 1 — Install
Install snapfeed in your **staging environment** per the [indie quickstart](./quickstart/indie.md) (cloud-relayed) or the [mid-size quickstart](./quickstart/midsize.md) (self-hosted). Do **not** turn on `enableInProduction: true` yet.

### Day 2 — Smoke test
Submit five internal feedback items yourself. Verify each lands in your Slack channel **and** opens a ticket in your tracker, with screenshot, URL, viewport, and console errors attached. Submit one with a category of `bug`, one `idea`, one `question`, one `praise`, one `other` — confirm routing distinguishes them if you wired category-based rules.

### Day 3 — Invite the first 5 testers
Pick five peers, designers, PMs on the same product. Send the **pilot Slack message** from the templates appendix below. Ask them to do exactly one thing: file one piece of feedback this week.

### Days 4–7 — Collect & triage
The steward triages once per day. For each item:
- Acknowledge with a thumbs-up reaction or a one-line reply in the Slack thread.
- Mark **resolved** (fix went out), **triaged** (filed for later), or **closed-no-action** (with a one-line "thanks, considered, not doing because…").

The reporter must see *something* happen on every item, even if the answer is no.

### End-of-week metrics
- Total submissions.
- Time-to-first-triage (P50 — half of items got triaged within X hours).
- Number resolved.
- Top page URLs receiving feedback.

If you got fewer than five submissions in the week, **do not roll out further**. The plumbing is fine but your testers aren't engaged. Talk to them. Phase 2 cannot fix Phase 1's adoption problem.

---

## Phase 2 — Days 8–30: Roll out to a team (20–50 people)

**Goal.** Prove the workflow scales beyond five testers. By end of Phase 2, you have feedback flowing automatically to the right team without the steward manually re-routing.

### Wire routing
Add a `snapfeed.config.ts` with routing rules per team. Example:

```ts
import { defineRouting } from 'snapfeed/routing'

export default defineRouting({
  routes: [
    { match: '/checkout/**', to: { team: 'payments', slack: '#checkout-feedback', jira: 'CHK' } },
    { match: '/dashboard/**', to: { team: 'growth', slack: '#dashboard-feedback', linear: 'GRW' } },
    { category: 'praise', to: { slack: '#kudos' } },
  ],
  default: { team: 'platform', slack: '#bugs' },
})
```

If a PM should be able to edit routing without a deploy, wire `googleSheetsRoutingSource` from `snapfeed/routing-sources` and put the table in a sheet. The same routing shape, polled with last-known-good fallback.

### Set up the admin dashboard
Stand up `examples/admin/` (read-only) and point it at the JSONL `fileAdapter` writes. Designate a URL inside your network and link it from the steward's bookmarks. This is the steward's daily view.

### Add a weekly feedback review
Fifteen minutes inside an existing standup or product review. The steward reads the top items aloud, decisions get made, owners get assigned. Do not create a new meeting — feedback review attached to an existing ritual sticks; a standalone meeting gets cancelled.

### Build a triage SLA
- **P0** (broken / blocking): triaged within 24 hours, ack to reporter same day.
- **P1** (functional bug): within a week.
- **P2** (minor issue): within two weeks.
- **Nit / closed-no-action**: still requires a one-line explanation in the Slack thread. Silence is the killer.

If you've enabled LLM features, the `severity` toggle returns `p0`/`p1`/`p2`/`nit` automatically — use it as a hint, not as a final answer. Severity inference is degradable per `applyLLM`'s contract.

### Send the broader-team announcement
Use the **Phase 2 email/post** from the templates appendix. Cap the scope to the chosen team(s); do not announce org-wide yet.

### End-of-month metrics
- Submissions per week, trended.
- Time-to-first-triage P50 (target: <24h).
- Percentage of items resolved within SLA.
- Top reporters (visibility for engaged testers).
- Top page URLs receiving feedback.

If by end of Phase 2 fewer than 50% of testers in the cohort have submitted at least one item, **do not roll out further** until you understand why.

---

## Phase 3 — Days 31–90: Org-wide rollout

**Pre-req.** Phase 2 shows >50% participation and SLA compliance >70%. If both hold, scale up. If either fails, stay in Phase 2 and fix the gap.

### Get cross-team buy-in
Present at the eng leads sync. Show the dashboard. Show the time-to-triage trend. Show one specific bug that snapfeed shortened from "took two weeks to find" to "filed Tuesday, fixed Wednesday." Specifics convince; abstractions do not.

### Add LLM triage (if budget)
Wire an LLM provider (`anthropic`, `openai`, `azure-openai`, `bedrock`, or `ollama`). Set `features.title: true` and `features.severity: true`. Set `redactBeforeLLM: true`. Set a daily token budget so a runaway cannot bill you out:

```ts
import { applyLLM, createBudgetTracker } from 'snapfeed/llm'

const budget = createBudgetTracker({ dailyTokens: 50_000 })
// pass budget into applyLLM(...) for every dispatch
```

For corp / regulated: use `provider: 'ollama'` against an in-tenant Ollama. The Docker stack ships an `--profile llm` for this.

### Wire Release Campaigns
For major launches, define a campaign window. Feedback during the window gets auto-tagged with the campaign id, optionally routed to a campaign-specific channel:

```ts
import { defineCampaign } from 'snapfeed/campaigns'

export const checkoutBeta = defineCampaign({
  id: 'checkout-v2-beta',
  name: 'Checkout v2 beta',
  flag: 'checkout_v2',
  startsAt: '2026-04-20',
  endsAt: '2026-05-04',
  owners: ['mohit@shimoverse.com'],
  routing: { slack: '#checkout-beta' },
  tags: ['checkout', 'beta'],
})
```

Use `campaignShareUrl()` to generate a shareable test URL the campaign owner can paste into Slack to recruit testers.

### Send the launch post
Use the **Phase 3 launch post** from the templates appendix. Include the dashboard link, the steward(s) by name, and the SLA.

---

## Common objections + responses

| Objection | Response |
|---|---|
| "We already use [tool X]." | snapfeed is internal-first (your tool is end-customer first); self-hosted (your tool is SaaS); MIT and fork-friendly (your tool charges per seat). It also routes *into* tool X if tool X has a webhook — they can coexist. Pick the one that solves the dogfooding loop in 30 seconds. |
| "I don't want one more tool." | Snapfeed routes to existing tools (Slack, JIRA, Linear, GitHub). Testers don't see a new tool — they see a hotkey. Receivers see tickets in their existing tracker. There is no new inbox to check. |
| "What about privacy?" | See [`PRIVACY.md`](../PRIVACY.md) and [`SECURITY.md`](../SECURITY.md). In self-host mode, data never leaves your infra. The maintainers operate no servers. There is no telemetry of any kind. |
| "What if it breaks?" | `enableInProduction: false` is the default — the widget is a no-op in production unless you opt in. Phase 1 is staging-only. The handler has rate limits, payload caps, and origin allowlist by default. Worst case in Phase 1 is "the widget doesn't open." |
| "Who's going to triage?" | The feedback steward role. One named person, ten minutes per day in Phase 1. See the triage runbook in the templates appendix. |
| "What about leaks (secrets in feedback)?" | Three layers: `sanitizeConsoleError` strips token / key / secret / Authorization / JWT shapes from console errors before any adapter sees the payload; `redactForLLM` strips emails / CC-shape digits / JWTs / high-entropy tokens before LLM calls; reporter education ("don't paste API keys into the textbox") in your onboarding. The widget shows a screenshot preview before send so the reporter can discard. |
| "Does it work with our SSO?" | The widget itself doesn't have its own auth — it uses the consumer's session. The admin viewer ships SSO/SAML in v0.5; until then, put it behind your existing reverse-proxy SSO. |
| "Can we keep the data in [region]?" | Yes. The worker runs wherever you put it. The destinations you wire control storage residency. See the residency table in [`COMPLIANCE.md`](../COMPLIANCE.md). |

---

## Success metrics dashboard

Track these every week. The first three are leading indicators of health; the last two are what to celebrate.

- **Submissions per week** (rising = adoption working; flat or falling at week 3+ = fix the rollout).
- **Time-to-first-triage, P50** (target: <24h in Phase 2; <8h once you scale).
- **% of items resolved within SLA** (target: >70% in Phase 2; >85% by Phase 3).
- **Top reporters** (recognition matters — call them out by name in the team channel).
- **Top page URLs receiving feedback** (signal for what's hot in the product; feed it back to the PM).

The audit log (`fileAuditLog` from `snapfeed/audit-log`) gives you raw events. A two-line `jq` pipeline against the JSONL gets you any of these metrics. Dashboards are nice; CSV is enough.

---

## Anti-patterns

These are the rollout failures we have seen. Avoid them.

- **Skipping Phase 1.** "We'll just turn it on org-wide on day 1." You will discover the plumbing problem on day 1 with 500 angry testers instead of day 1 with 5 friendly ones.
- **No designated steward.** Items pile up, testers see nothing happen, stop submitting. The cohort dies in week 2.
- **Auto-resolving items without notes.** "Closed: not a bug" with no explanation makes the reporter feel ignored. Always one line of context.
- **Using snapfeed as your end-customer feedback channel.** Wrong tool. snapfeed is for testers and employees who are signed in. For end customers, use a tool built for that.
- **Turning on every LLM feature on day 1.** Pick one (`title` or `severity`). Watch the budget. Add the next one once you trust the first.
- **Coupling routing to engineer-only edits.** PMs and TPMs should be able to add a route in 30 seconds. Use `googleSheetsRoutingSource` for that.
- **Promising "real-time" SLA in Phase 1.** The steward is doing this on top of their day job. Set realistic SLAs and meet them.

---

## Off-ramp

If after 30 days you are getting fewer than two submissions per week and you have done all of Phase 1 and Phase 2 honestly, then **snapfeed is not your bottleneck — your team isn't dogfooding the product.** The fix is process, not tooling. Common reasons:

- Testers don't actually use the product in a deep enough way to find feedback. (Fix: assigned scenarios, not "use it whenever.")
- The product is in a state where everything is broken and submitting feedback feels pointless. (Fix: stabilize a slice; dogfood that slice.)
- The tester cohort is wrong. (Fix: pick people who naturally use the product, not people you assigned to.)

snapfeed is uninstallable. Remove the `<FeedbackProvider>` from your app, remove the env vars, remove the route handler. There is no data lock-in — your data is in your destinations (Slack, JIRA, Linear, etc.) and stays there. Removing snapfeed leaves no residue.

---

## Templates appendix (verbatim copy-paste)

### Template 1 — Slack message announcing the pilot (Day 3)

> **Hey #pilot-cohort 👋 — quick favor.**
>
> We're piloting **snapfeed**, a one-tap feedback widget. While you're testing the staging build this week:
>
> 1. When you spot something off — a confusing label, a broken flow, even just "this feels slow" — press **Ctrl+Shift+F** (Cmd on Mac).
> 2. Type one sentence. Optional: paste/screenshot, draw an arrow on it.
> 3. Hit send.
>
> It lands in `#bugs` in real-time and opens a ticket in JIRA / Linear / our tracker, pre-tagged with the URL, your viewport, and recent console errors. You don't pick a project. You don't pick an owner. You don't fill out a form.
>
> **Goal for this week: each of you files at least one item.** Even nits. Especially nits — those tell us about polish.
>
> [STEWARD NAME] is the steward this week — they'll ack every item in the same Slack thread within a day.
>
> Questions? Reply here or DM me.

### Template 2 — Email/Slack post to the broader team (Phase 2 / Day 8)

> **Subject: Filing bugs in [PRODUCT NAME] just got 30 seconds long**
>
> **What changed.** We installed **snapfeed** on staging. From now on, when you're testing and you spot something — bug, confusing copy, polish — you press **Ctrl+Shift+F**, type one sentence, hit send. It routes to the right team automatically:
>
> - `/checkout/**` → #checkout-feedback + JIRA `CHK`
> - `/dashboard/**` → #dashboard-feedback + Linear `GRW`
> - Praise → `#kudos` (yes, please)
> - Everything else → `#bugs` + `PLATFORM` triage
>
> **Why we did this.** Filing a bug used to take 5–10 minutes. Most of the time we didn't bother. We were shipping with less feedback than we had. Now it takes 30 seconds.
>
> **What you have to do.** Use the staging build with the widget on. When you spot something, hit Ctrl+Shift+F. That's it.
>
> **What we (the team) commit to.** Steward [STEWARD NAME] triages daily. P0 = ack within 24h. P1 = within a week. We'll never close an item silently — every item gets at least a one-line response.
>
> **Privacy / security.** No data leaves our infra. snapfeed is open-source MIT, runs in our own VPC, no telemetry, no third-party. See the security review doc if you want the details.
>
> **Questions / nits / "this is broken":** reply here, DM [STEWARD NAME], or — yes — file it via the widget.

### Template 3 — Quarterly review template

> **snapfeed quarterly review — Q[N] 2026**
>
> **Adoption**
> - Submissions this quarter: [N]
> - Unique reporters: [N] (last quarter: [N])
> - % of eligible team submitting at least one item: [N%]
>
> **Triage health**
> - Time-to-first-triage P50: [Xh] (target: <24h)
> - % resolved within SLA: [N%] (target: >70%)
> - % closed-no-action with explanation: [N%] (target: 100%)
>
> **What snapfeed found this quarter (3 specific items)**
> 1. [Concrete bug] — filed by [reporter], shipped fix in [time].
> 2. [Concrete idea] — filed by [reporter], became [feature/spec/PR].
> 3. [Concrete polish item] — filed by [reporter], shipped in [release].
>
> **Top page URLs by submissions**
> - [/path] — [N submissions] — owned by [team]
> - [/path] — [N submissions] — owned by [team]
>
> **Top reporters (recognition)**
> - [name] — [N items], [resolved %]
> - [name] — [N items], [resolved %]
>
> **What's not working**
> - [Honest list of process gaps. E.g. "growth team's SLA slipped, items aging >2 weeks."]
>
> **Decisions / changes for next quarter**
> - [E.g. enable LLM-suggested severity, scope to checkout team for one month, A/B against current.]
> - [E.g. wire Sheets-backed routing so PMs can update without a deploy.]

### Template 4 — Triage runbook for the steward (one page)

> **You are the snapfeed feedback steward this week. Ten minutes a day. Five questions per item.**
>
> **Once a day (recommended: morning):**
>
> 1. Open the admin dashboard (or your `#bugs` Slack channel + JIRA project).
> 2. For every new item that arrived since your last pass, ask:
>    1. **Is this a duplicate of something already filed?** If yes, link the duplicate, close, leave a comment in the Slack thread.
>    2. **Severity.** Is it P0 (blocking), P1 (functional bug), P2 (minor), or nit (cosmetic)? If LLM-suggested severity is on, sanity-check it; you have final say.
>    3. **Owner.** Which team should fix this? Routing should have already done most of the work — if it landed in the wrong place, route it manually and note the routing rule that needs updating.
>    4. **Action.** Resolve / triaged-for-later / closed-no-action / needs-more-info. Pick one.
>    5. **Reporter ack.** Reply in the Slack thread (or comment on the ticket) with one line: what you decided and why. *Even if the answer is no.* Especially if the answer is no.
>
> **Weekly:** post the metrics snapshot in the team channel. Submissions, P50 time-to-triage, top reporters. Two lines.
>
> **Monthly:** rotate or recommit. Steward burnout is real. If you're not enjoying it, hand off — and document the handoff.
>
> **Escalate when:**
> - More than 5 P0s in a single day. (Probably a regression went out — pull in the on-call.)
> - SLA breach for two weeks running on the same team. (Pull in the EM for that team.)
> - A reporter complains they were ignored. (Look at the thread — almost always someone forgot the one-line ack.)

---

> Document version: v0.4.0 / 2026-04-26. See [`CHANGELOG.md`](../CHANGELOG.md) for what changed in this release.
