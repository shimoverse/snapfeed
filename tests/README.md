# snapfeed tests

Vitest-based test suite covering the critical, non-React paths of snapfeed.

## Running

```bash
npm test              # one-shot run
npm run test:watch    # watch mode
npm run test:coverage # with v8 coverage report (text + lcov)
```

> **Note:** the `test`, `test:watch`, and `test:coverage` scripts and the
> `vitest` / `@vitest/coverage-v8` devDependencies still need to be added to
> `package.json` before these commands work. See the test scaffolding handoff
> note for the exact entries.

## Layout

```
tests/
  server/
    security.test.ts    payload validation, origin allowlist, rate-limit store, secret redaction
  adapters/
    console.test.ts     log level routing, pretty vs raw object output
    webhook.test.ts     POST shape, custom headers, transform, 2xx/non-2xx/network-error handling
    file.test.ts        JSONL appends, screenshot redaction, pretty separator, deliveryId, dir auto-create
    auto.test.ts        env-var → adapter wiring, dev fallback, prod warn, detection order
  routing.test.ts       URL glob matching, rule resolution, defineRouting identity, mergeDestinations semantics
```

Vitest config: [`vitest.config.ts`](../vitest.config.ts). Test environment is
Node; coverage is collected from `src/**/*.ts` (excluding `*.tsx` React
components and `src/cli.ts`).

## What is covered

- **Server security** (`src/server/security.ts`): `validatePayload`,
  `checkOrigin`, `defaultRateLimitStore`, and the secret-redaction patterns
  applied to `metadata.consoleErrors`.
- **Adapters** (`src/adapters/*.ts`): `console`, `webhook`, `file`, and the
  env-driven `auto` aggregator. Network calls are mocked via
  `vi.stubGlobal('fetch', ...)`; file I/O uses real temp paths under
  `os.tmpdir()` and cleans up in `afterAll`.
- **Routing** (`src/routing.ts`): URL glob matching (`*`, `**`, origin/query
  stripping), rule resolution (first-match-wins, all-conditions-required,
  default fallback), and the `mergeDestinations` policy (overrides win,
  arrays are *replaced* not concatenated).

## What is NOT covered (yet)

- **React components** (`FeedbackProvider`, `FeedbackWidget`,
  `FeedbackButton`, `FeedbackInbox`, `AnnotationCanvas`). UI testing needs
  `jsdom` + `@testing-library/react` and is on the **v0.4 roadmap**. The
  vitest config currently excludes `*.tsx` from coverage to keep the report
  honest.
- **Adapters** beyond the four above (`slack`, `discord`, `github`, `jira`,
  `telegram`, `supabase`). They share the same fetch-mock pattern as
  `webhook.test.ts` and can be added incrementally.
- **`src/server/nextjs.ts` and `src/server/express.ts`** request handlers —
  integration-style tests deferred until v0.4.
- **`src/cli.ts`** — excluded from coverage; CLI tests are low priority for
  the POC.

## Conventions

- Tests use **named imports** from `vitest` (`describe`, `it`, `expect`, `vi`)
  rather than globals — matches the `globals: false` setting in the config.
- One file per source module under test; mirror the `src/` directory layout
  inside `tests/`.
- Mock module-level globals (`fetch`, `process.env`) per test and restore in
  `afterEach`. Never let one test leak state into the next.
- File-system tests use unique paths under `os.tmpdir()` and clean up in
  `afterAll`.
