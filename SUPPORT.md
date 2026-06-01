# Support

snapfeed is a community-maintained open-source library. Here is where to get help.

---

## Documentation first

Most questions are answered in the docs. Check these before opening an issue:

| Question | Where to look |
|---|---|
| "How do I install / get started?" | [README.md](./README.md) — 60-second quickstart |
| "How do I configure the widget?" | [README.md](./README.md) — Configuration section |
| "Which adapter should I use?" | [README.md](./README.md) — Adapters table + Persona picker |
| "How do I self-host?" | [docker/README.md](./docker/README.md) |
| "Is it secure?" | [SECURITY.md](./SECURITY.md) + [THREAT_MODEL.md](./THREAT_MODEL.md) |
| "What about GDPR / SOC 2 / HIPAA?" | [COMPLIANCE.md](./COMPLIANCE.md) |
| "What data does it collect?" | [PRIVACY.md](./PRIVACY.md) |
| "What browsers / Node versions are supported?" | [COMPATIBILITY.md](./COMPATIBILITY.md) |
| "How do I cut a release?" | [RELEASE.md](./RELEASE.md) |
| "Will breaking change X happen in a patch?" | [VERSIONING.md](./VERSIONING.md) |
| "How do I contribute?" | [CONTRIBUTING.md](./CONTRIBUTING.md) |

Per-persona quickstarts live at `docs/quickstart/`.

---

## GitHub Discussions

For questions, design discussions, and "how do I X?" — use **GitHub Discussions**:

`https://github.com/shimoverse/snapfeed/discussions`

Good for:
- "What's the recommended way to do X?"
- "Has anyone integrated snapfeed with [tool not yet adapter-supported]?"
- Sharing your deployment setup
- Requesting design feedback before opening a PR
- General Q&A

---

## GitHub Issues

For **bugs** and **feature requests** — use GitHub Issues:

`https://github.com/shimoverse/snapfeed/issues`

Templates exist for:
- Bug reports (please include version, browser/Node version, repro steps, and the smallest possible config that reproduces)
- Feature requests
- Adapter requests

Issues without a clear repro or use-case may be converted to Discussions.

---

## Security issues

**Do not file security issues publicly.** Email **shimoverse@gmail.com** per the responsible-disclosure process in [SECURITY.md](./SECURITY.md).

You should expect an acknowledgement within **3 business days** and a fix plan within **10 business days** for confirmed issues.

---

## Commercial support

There is **no commercial support tier today**. snapfeed is a community project with no paid offering, no support contract, no SLA.

The maintainer is open to **consulting engagements** around custom adapter development, security review for regulated deployments, and bespoke integrations. Reach out via shimoverse@gmail.com if interested.

If your organization needs guaranteed support response times, the recommended posture is to vendor the dependency: pin to a known-good version, build internal expertise on the (small) source tree, and contribute fixes upstream as needed.

---

## Response times

All response times are **best-effort**. There is no SLA.

In practice:
- Security issues: 3 business days for ack, 10 for fix plan (per SECURITY.md).
- Bugs with a clear repro: typically 1–2 weeks.
- Feature requests: triaged at each release; non-trivial requests may be deferred to "good first issue" for community contribution.
- Discussions: best-effort; community members often answer faster than the maintainer.

If a response is blocking you and you've waited > 2 weeks with no engagement, ping the issue once. After that, consider posting in Discussions or sending a follow-up email — the maintainer is human and may have missed it.
