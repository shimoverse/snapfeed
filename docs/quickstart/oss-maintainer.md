# OSS maintainer quickstart — feedback to GitHub Issues, plus forking + community adapters

**Persona:** Maintainer of an open-source project. You run a docs site or a playground app, and you want feedback from users to land directly in your repo as GitHub Issues. You also want to make it easy for your community to contribute adapters back.
**Goal:** Snapfeed widget on your docs site, feedback creates GitHub Issues with the right labels, gated to maintainers (or open to all readers, your call). Plus a clear path for forking and accepting community PRs.
**Time budget:** 15 minutes for the install. Forking is an afternoon.
**snapfeed version:** v0.4.0

---

## 1. Install snapfeed in your docs site

Works the same way for Next.js, Vite + React, Docusaurus (with the React plugin), or any React-rendering site.

```bash
npm install snapfeed
```

If your site is Next.js (App Router):

```bash
npx snapfeed init --yes
```

This creates `app/api/feedback/route.ts`, `snapfeed.config.ts`, and `.env.example`. For Vite or Docusaurus, you'll need to host the API endpoint somewhere else (a Cloudflare Worker, Netlify Function, or Vercel serverless function pointing at your widget's `apiUrl`) — the snapfeed worker doesn't bundle a static-site server.

## 2. Create a GitHub fine-grained PAT

snapfeed's `githubAdapter` uses a Personal Access Token with `issues:write` scope.

1. Go to https://github.com/settings/personal-access-tokens/new (fine-grained tokens — preferred over classic).
2. Set:
   - **Resource owner:** your org (or your user account).
   - **Repository access:** "Only select repositories" → pick the repo you want issues filed against.
   - **Permissions → Repository permissions → Issues:** Read and write.
3. Generate, copy the token (starts with `github_pat_`).

Don't use a classic PAT unless you have to — fine-grained tokens scope to a single repo and can't be used to read other private repos if leaked.

## 3. Set the env vars

In your deployment environment (Vercel project settings, Netlify env, Fly.io secrets, etc.):

```
SNAPFEED_GITHUB_TOKEN=github_pat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
SNAPFEED_GITHUB_REPO=your-org/your-repo
```

`autoAdapters()` reads both. The repo must be in `owner/repo` form — `autoAdapters()` warns and skips if it isn't.

For local testing, put them in `.env.local`:

```bash
echo 'SNAPFEED_GITHUB_TOKEN=github_pat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx' >> .env.local
echo 'SNAPFEED_GITHUB_REPO=your-org/your-repo' >> .env.local
```

## 4. Wrap your layout

Public docs sites are deployed in production, so you need `enableInProduction: true` — otherwise the widget is a no-op (snapfeed defaults to off in prod as a safety rail).

```tsx
// app/snapfeed-client.tsx (Next.js example; adapt for your framework)
'use client'

import type { ReactNode } from 'react'
import { FeedbackProvider } from 'snapfeed'

export function SnapfeedClient({ children }: { children: ReactNode }) {
  return (
    <FeedbackProvider
      appName="MyOSS Docs"
      apiUrl="/api/feedback"
      enableInProduction={true}
      autoScreenshot
    >
      {children}
    </FeedbackProvider>
  )
}
```

```tsx
// app/layout.tsx
import { SnapfeedClient } from './snapfeed-client'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SnapfeedClient>{children}</SnapfeedClient>
      </body>
    </html>
  )
}
```

## 5. Test from the deployed site

Deploy. Open your docs site. Press Ctrl+Shift+F. Type "test feedback from docs site". Send.

Within a few seconds, a new issue appears at `https://github.com/your-org/your-repo/issues`, titled `[Feedback] test feedback from docs site`, labeled `snapfeed` (the default `autoAdapters()` adds), with the page URL and metadata in the body.

The default category-to-label mapping (from `src/adapters/github.ts`):

- `bug` → `bug`
- `idea` → `enhancement`
- `question` → `question`
- `praise` → `feedback`
- `other` → `feedback`

If you want different labels, wire `githubAdapter` explicitly instead of going through `autoAdapters()`:

```ts
// app/api/feedback/route.ts
import { createFeedbackHandler } from 'snapfeed/server/nextjs'
import { githubAdapter } from 'snapfeed/adapters'

export const POST = createFeedbackHandler({
  adapters: [
    githubAdapter({
      token: process.env.SNAPFEED_GITHUB_TOKEN!,
      owner: 'your-org',
      repo: 'your-repo',
      labels: ['user-feedback', 'triage'],
    }),
  ],
})
```

## 6. Recommended: gate by viewer role

A public docs site means anyone can press the hotkey. That's usually fine — feedback is feedback. But if you want only maintainers to file issues directly (and route others to GitHub Discussions, for example):

```tsx
<FeedbackProvider
  enableInProduction={isMaintainer || isBetaTester}
  user={user ? { name: user.name, email: user.email } : undefined}
  apiUrl="/api/feedback"
>
```

`isMaintainer` and `isBetaTester` come from whatever auth your docs site has — Clerk, NextAuth, custom JWT, or a static maintainer list checked against the GitHub login.

If you keep it open to everyone, label feedback with the source so you can triage:

```ts
githubAdapter({
  token: process.env.SNAPFEED_GITHUB_TOKEN!,
  owner: 'your-org',
  repo: 'your-repo',
  labels: ['snapfeed', 'from-docs-site', 'needs-triage'],
})
```

## 7. Accepting community-contributed adapters

snapfeed's `CONTRIBUTING.md` has a section on adapter contributions. If your community wants to contribute a GitLab Issues adapter, a Gitea adapter, or anything else, point them at:

- `CONTRIBUTING.md` → "Adapter contribution guide" — interface, file location, factory pattern, error handling rules.
- `src/adapters/slack.ts` → cited as the canonical reference adapter (small, well-shaped, has happy + sad paths).
- The adapter checklist:
  - Lives in `src/adapters/<name>.ts`
  - Exports a `nameAdapter(options)` factory
  - Reads secrets from `options`, never `process.env` directly
  - Returns `{ ok: false, error }` on failure — never throws
  - Includes `deliveryId` when the destination returns one
  - Re-exports from `src/adapters/index.ts` and `src/index.ts`
  - Has at least one happy-path and one sad-path test

GitLab Issues, Gitea, Forgejo, Sourcehut, Pagure — all good first-adapter contributions. We'd merge them.

---

## Forking and customizing snapfeed

snapfeed is MIT, no CLA. Fork for any reason, including commercial. Common reasons to fork:

- You want a feature we don't have (custom widget UI, a destination we won't merge, a hard-coded brand)
- You want to remove an adapter or LLM provider (smaller bundle, fewer deps to audit)
- You want to brand the widget heavily (your logo, your color scheme, your hotkey)

### Fork cleanly

The codebase is laid out so customizations don't fight upstream merges:

```
src/
├── adapters/         ← built-in adapters; leave unchanged for clean merges
├── routing.ts        ← routing primitives; leave unchanged
├── llm/              ← BYOK LLM runner; leave unchanged
├── server/           ← Next.js + Express handlers; leave unchanged
├── FeedbackProvider/ ← React provider; usually leave unchanged
├── FeedbackWidget/   ← UI; this is what you'd touch for branding
└── custom/           ← put YOUR additions here (create this dir in your fork)
```

In your fork, add a `src/custom/` directory and a `src/custom/index.ts`. Re-export from there:

```ts
// src/custom/index.ts (in your fork)
export { acmeAdapter } from './acme-adapter'
export { acmeWidget } from './acme-widget'
```

Then add a build entry in `tsup.config.ts` for `custom/index`, and an `exports` entry in `package.json` for `./custom`. Now consumers of your fork import from `@your-org/snapfeed-fork/custom` and you've kept `src/` clean for upstream merges.

### Pulling upstream changes

```bash
git remote add upstream https://github.com/shimoverse/snapfeed.git
git fetch upstream
git merge upstream/main
# Or, on a release boundary:
git merge upstream/v0.5.0
```

If you only edited `src/custom/` and the widget styling, merges should be conflict-free. Conflicts in `src/adapters/` or `src/server/` mean you edited shared code — undo the local edit, push the change upstream as a PR instead.

### Branding the widget

Three knobs on `<FeedbackProvider>` cover most branding:

```tsx
<FeedbackProvider
  appName="Acme"
  hotkey="ctrl+shift+a"
  position="bottom-left"
  theme="dark"
  accentColor="#7C3AED"
>
```

For deeper changes (logo in header, custom font, removing the "Powered by snapfeed" text if you add one yourself), edit `src/FeedbackWidget/`. There are no public theming tokens in v0.4 — that's planned for a later release.

### Contributing back upstream

If your customization is general-purpose (a new adapter, a fix, an a11y improvement), open a PR against the upstream repo. The path:

1. Branch off your fork's `main`.
2. Implement the change in `src/`, not `src/custom/`.
3. Add tests under `tests/`.
4. Update `CHANGELOG.md` under `[Unreleased]`.
5. Open the PR against `shimoverse/snapfeed:main`.

`CONTRIBUTING.md` has the full PR checklist.

### Licensing notes

snapfeed is MIT. You can:

- Fork it, modify it, distribute the modified version
- Use it commercially (your fork or upstream) without paying us anything
- Re-license your fork under any compatible license (you can't strip the MIT notice from the original code)
- Strip the snapfeed branding entirely

You can't:

- Remove the upstream copyright notice from any file you didn't rewrite from scratch
- Use the snapfeed name to imply your fork is the official one (no trademark claim, but customary)

---

## Verify it works

For the install:

- A GitHub Issue appears in your repo within a few seconds of clicking Send in the widget.
- The issue title starts with `[Feedback]`.
- The body has a `## Feedback Details` section with the page URL, viewport, and reporter (or "Anonymous").
- The issue is labeled `snapfeed` (or whatever labels you wired explicitly).

For the fork (if you forked):

- `git remote -v` shows both `origin` (your fork) and `upstream` (shimoverse/snapfeed).
- `git fetch upstream && git log --oneline upstream/main ^HEAD | head` shows commits you haven't merged yet — confirms the upstream link works.
- `npm run build` in your fork produces a `dist/` with your `custom/` entry alongside the upstream entries.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| GitHub Issue not created, server logs `404 Not Found` | The repo in `SNAPFEED_GITHUB_REPO` is wrong, or the token's resource scope doesn't include that repo. Re-check both. The format is strictly `owner/repo` — not a URL, not with leading slash. |
| GitHub Issue not created, logs `403 Forbidden` | Token lacks `issues:write` scope. Edit the fine-grained PAT and grant Issues: Read and write on the target repo. |
| Widget visible to readers but you wanted maintainer-only | `enableInProduction={true}` is unconditional. Replace with a role check: `enableInProduction={isMaintainer}`. The widget compiles to a no-op when false; no runtime cost for non-maintainers. |
| Widget never appears even on dev | `npx create-next-app` includes `output: 'export'` in some templates — that produces a static site without API routes. Either remove `output: 'export'` or host the API route elsewhere and point `apiUrl` at it. |
| Issues created with `Anonymous` even when readers are signed in via your auth | The `user` prop on `<FeedbackProvider>` isn't wired. Pass `user={{ name, email }}` from your auth context. |
| Fork merge from upstream conflicts in `src/adapters/` | You edited a shared adapter in your fork. Undo the edit, move the change to `src/custom/` (or open it as a PR upstream so future merges are clean). |
