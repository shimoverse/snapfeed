# LinkedIn draft: snapfeed agent-ready launch

Attach this GIF to the post:

```text
docs/screenshots/snapfeed-demo.gif
```

Post draft:

> I built snapfeed because the next feedback loop is not just human → ticket → engineer.
>
> It is reviewer agent → structured feedback → coding agent → test → PR → deploy.
>
> Most product feedback tools still assume someone will manually notice the issue, open a tracker, choose a project, write the repro, attach screenshots, add browser details, and route it to the right team.
>
> That is already too much friction for humans.
>
> It is the wrong abstraction for agents.
>
> snapfeed is a small open source React/Next.js widget for internal dogfooding. A PM, designer, QA tester, beta user, or review agent can open it from the app, describe what they found, and send feedback with screenshot, URL, viewport, console errors, reporter identity, and build context attached.
>
> From there it can route to Slack, JIRA, Linear, GitHub, Discord, Telegram, Supabase, Google Sheets, a custom webhook, or your own agent orchestrator.
>
> The goal is simple: if a QA agent or design agent reviews a build and finds a problem, the feedback should already be structured enough for the coding agent to start the fix.
>
> snapfeed does not try to be the orchestrator. Hermes, OpenClaw, Codex, Claude Code, OpenCode, GitHub Actions, Temporal, or your own system can own the actual agent run, approvals, tests, and deployment.
>
> snapfeed is the handoff layer.
>
> It gives the agent stack the thing it usually lacks: high-context product feedback from inside the actual UI.
>
> Humans can use it too. That is the point. Same flow, same payload, same audit trail.
>
> It is built for internal teams dogfooding software with humans and agents side by side.
>
> Repo: https://github.com/shimoverse/snapfeed
>
> If you are building agent review loops, QA agents, PM agents, or design agents, I would love feedback, forks, adapters, and orchestration examples.

Shorter variant:

> I built snapfeed as the feedback layer for agentic software teams.
>
> A human tester, PM agent, QA agent, or design-review agent can flag an issue from inside the product. snapfeed captures the screenshot, URL, viewport, console errors, reporter identity, and build context, then routes it to Slack/JIRA/Linear/GitHub/webhook or an agent orchestrator.
>
> The idea: feedback should be structured enough for the coding agent to start the fix.
>
> snapfeed is not the orchestrator. Hermes, OpenClaw, Codex, Claude Code, OpenCode, GitHub Actions, Temporal, or your own queue can own approvals, tests, PRs, and deploys.
>
> snapfeed is the handoff layer between product review and product repair.
>
> Open source: https://github.com/shimoverse/snapfeed
>
> Would love feedback, forks, adapters, and examples from anyone building agent review/fix loops.
