# LinkedIn draft: snapfeed agent-ready launch

Attach this GIF to the post:

```text
docs/screenshots/snapfeed-demo.gif
```

## Recommended post

> I have been using a small feedback widget across my personal projects for a while.
>
> The pattern kept coming back: when you are dogfooding a product, the hardest part is not noticing the bug. It is turning that moment into something actionable.
>
> Screenshot. URL. Browser details. Console errors. Build context. Who reported it. Which area of the product it belongs to. Where it should go next.
>
> Humans forget half of that. Agents need all of it.
>
> So I cleaned it up, made a few updates, and open sourced it.
>
> It is called snapfeed.
>
> snapfeed is a React/Next.js feedback layer for internal dogfooding. A human tester, designer, PM, QA agent, design-review agent, or any reviewer inside your workflow can flag an issue from the product itself. snapfeed captures the context and routes it to Slack, JIRA, Linear, GitHub, Discord, Telegram, Supabase, Google Sheets, a webhook, or your own agent orchestrator.
>
> The bigger idea is not “file a better ticket.”
>
> The bigger idea is: bug spotted → feedback sent → coding agent gets context → fix tested → deployed.
>
> snapfeed is not trying to be the orchestrator. Tools like Hermes, OpenClaw, Codex, Claude Code, OpenCode, GitHub Actions, Temporal, or your own queue can own the agent run, approvals, tests, PRs, and deployment.
>
> snapfeed is the handoff layer between product review and product repair.
>
> I built it from a product-builder point of view: reduce friction at the exact moment someone notices the issue, preserve the context, and make the next step obvious for either a human teammate or an agent.
>
> It is web-friendly, mobile-web friendly, self-hostable, and open source. You can inspect the code, fork it, open PRs, add adapters, or shape it for your own agent workflow.
>
> Personal open-source project, built outside my day job.
>
> Repo: https://github.com/shimoverse/snapfeed
>
> If you are building QA agents, PM agents, design-review agents, or product repair loops, I would love feedback.

## Shorter variant

> I open sourced a small tool I have been using across my personal projects.
>
> It is called snapfeed: a React/Next.js feedback layer for internal dogfooding.
>
> A human tester, designer, PM, QA agent, or design-review agent can flag an issue from inside the product. snapfeed captures screenshot, URL, viewport, console errors, reporter identity, and build context, then routes it to Slack/JIRA/Linear/GitHub/webhook or an agent orchestrator.
>
> The goal is not just a better ticket.
>
> It is: bug spotted → feedback sent → coding agent gets context → fix tested → deployed.
>
> snapfeed does not replace your orchestrator. Hermes, OpenClaw, Codex, Claude Code, OpenCode, GitHub Actions, Temporal, or your own queue can own approvals, tests, PRs, and deploys.
>
> snapfeed is the handoff layer between product review and product repair.
>
> Web-friendly, mobile-web friendly, self-hostable, and open source.
>
> Personal project, built outside my day job.
>
> Repo: https://github.com/shimoverse/snapfeed
>
> Would love feedback, forks, adapters, and examples from anyone building agent review/fix loops.

## Posting notes

- Use the GIF as the media attachment.
- Lead with the personal builder story, not the feature list.
- Keep the “outside my day job” line near the end so it is clear but not defensive.
- Avoid overclaiming auto-fix. The accurate claim is that snapfeed gives the orchestrator enough context to start the fix workflow.
