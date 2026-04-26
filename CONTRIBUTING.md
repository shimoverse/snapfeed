# Contributing to snapfeed

Thanks for considering a contribution. snapfeed is a small library with a focused mission: **make internal feedback in dogfooding teams as friction-free as possible**. Contributions that move us toward that goal are very welcome.

## Quick start for contributors

```bash
git clone https://github.com/shimoverse/snapfeed.git
cd snapfeed
nvm use            # uses Node 20 from .nvmrc
npm install
npm run build      # tsup, ~3s
npm run type-check # tsc --noEmit
npm test           # vitest (when added)
```

## What we welcome

- **Adapters** for new destinations (JIRA, Linear, Notion, MS Teams, Discord, ServiceNow, etc.)
- **Bug fixes** with a regression test
- **Accessibility improvements** to the widget
- **Documentation improvements** — especially worked examples for specific stacks
- **Framework ports** (Vue, Svelte, Solid, vanilla JS) — discuss in an issue first
- **Translations** of the widget UI — once i18n lands

## What to discuss before starting

Open an issue first if your change involves:

- A new top-level API or breaking change
- A new runtime dependency
- A new framework target (Vue, Svelte, RN)
- A change to the `FeedbackPayload` schema
- A change to the security defaults

This avoids spending time on a PR we can't merge for design reasons.

## Adapter contribution guide

Each adapter implements one interface:

```ts
export interface FeedbackAdapter {
  name: string
  send(payload: FeedbackPayload): Promise<FeedbackAdapterResult>
}
```

A good adapter:

- Lives in `src/adapters/<name>.ts`
- Exports a factory function `nameAdapter(options)` returning a `FeedbackAdapter`
- Has a JSDoc block on the factory with a usage example
- Reads secrets from `options`, **never** from `process.env` directly (the consumer wires that up)
- Returns `{ ok: false, error }` on failure — never throws
- Handles network errors and non-2xx responses
- Includes a `deliveryId` in the result when the destination returns one (e.g., JIRA issue key, Slack message TS)
- Is added to `src/adapters/index.ts` and re-exported from `src/index.ts`
- Includes at least one happy-path and one sad-path test

Look at `src/adapters/slack.ts` as a reference.

## Branch & commit conventions

- Branch name: `feat/<short>`, `fix/<short>`, `docs/<short>`, `chore/<short>`
- Commit messages: present-tense, imperative — `fix: telegram adapter no longer hides upload errors`
- One logical change per PR. If your PR description says "and also...", split it.

## Pull request checklist

Before opening a PR, verify:

- [ ] `npm run build` passes
- [ ] `npm run type-check` passes
- [ ] `npm test` passes (or you added/updated tests)
- [ ] You ran `npm audit` and your change doesn't introduce new HIGH/CRITICAL findings
- [ ] You updated the README if your change affects the public API
- [ ] You updated `CHANGELOG.md` under "Unreleased"

## Code style

- TypeScript, `strict` mode
- Inline styles in widget components are fine for now (we'll move to CSS variables in v0.4)
- No new runtime dependencies without discussion
- Keep accessibility in mind: every interactive element needs a label, every modal needs Esc, every focus needs to be visible

## Where to ask questions

- **General questions:** GitHub Discussions
- **Bug reports:** GitHub Issues with the bug template
- **Security issues:** **Do not open a public issue.** Email shimoverse@gmail.com — see [SECURITY.md](./SECURITY.md)
- **Feature ideas:** GitHub Issues with the feature template, or jump into Discussions first

## Code of conduct

By participating, you agree to abide by the [Code of Conduct](./CODE_OF_CONDUCT.md). Be kind. Assume good intent. We're all here to make a useful thing.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
