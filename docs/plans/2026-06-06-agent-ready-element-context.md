# Agent-Ready Element Context Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task if delegating.

**Goal:** Add Agentation-inspired element-level context to snapfeed payloads so coding agents can identify the exact UI element behind feedback.

**Architecture:** Capture the last non-snapfeed DOM element the reviewer interacted with, serialize a safe bounded `target` object, and include it in widget/headless/API payloads. Keep snapfeed's broader workflow positioning: element context augments screenshots/URL/console/build context, while webhook/adapters/orchestrators remain the feedback-to-fix path.

**Tech Stack:** React 18, TypeScript, Vitest/jsdom, existing snapfeed adapter architecture.

---

### Task 1: Add typed target context and pure DOM serialization

**Objective:** Introduce a public optional `FeedbackPayload.target` shape and a tested helper that converts an `Element` into selector/path/accessibility context.

**Files:**
- Modify: `src/types.ts`
- Create: `src/element-context.ts`
- Create: `tests/element-context.test.ts`

**Steps:**
1. Write failing tests for selector generation, text truncation, role/aria capture, bounding rect, and ignoring snapfeed UI elements.
2. Run: `npm test -- tests/element-context.test.ts` and verify RED.
3. Implement `buildElementContext(element)` and `shouldIgnoreElementForSnapfeedContext(element)`.
4. Export the types from `src/index.ts` and `src/adapters/types.ts` if needed.
5. Run the specific test and verify GREEN.

### Task 2: Capture last interacted element in the provider

**Objective:** Track the last meaningful app element via capture-phase `pointerdown` and `focusin`, and merge it into submitted payloads when `collectElementContext` is enabled.

**Files:**
- Modify: `src/types.ts`
- Modify: `src/FeedbackProvider.tsx`
- Modify: `src/FeedbackButton.tsx`
- Modify: `src/FeedbackWidget.tsx`
- Test: `tests/feedback-provider-element-context.test.tsx`

**Steps:**
1. Write a failing jsdom test rendering `<FeedbackProvider>` with a custom adapter, click a host element, open snapfeed, submit, and assert `payload.target.selector` points at the host element rather than snapfeed UI.
2. Add `collectElementContext?: boolean` provider config, default true.
3. Mark snapfeed-owned DOM with `data-snapfeed-ui` so provider tracking ignores the widget and trigger.
4. Merge `partial.target ?? buildElementContext(lastTargetRef.current)` into `submit()`.
5. Run specific test and verify GREEN.

### Task 3: Preserve target context in storage/adapters and human-readable issue output

**Objective:** Ensure routed destinations do not lose the new target object, especially agent/orchestrator paths.

**Files:**
- Modify: `src/adapters/supabase.ts`
- Modify: `src/adapters/github.ts`
- Modify: `src/adapters/slack.ts`
- Test: relevant adapter tests

**Steps:**
1. Add failing tests showing Supabase `metadata.target` is stored and GitHub/Slack include selector/path in context.
2. Implement minimal adapter formatting.
3. Run specific adapter tests.

### Task 4: Update docs and positioning

**Objective:** Document the feature as Snapfeed's bridge between broad feedback routing and precise coding-agent handoff.

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `docs/PLAYBOOK.md` or `docs/ARCHITECTURE.md`

**Steps:**
1. Add a concise “Element context for coding agents” section.
2. Document payload shape and override behavior.
3. Keep the boundary explicit: snapfeed captures/routes context; the orchestrator/coding agent fixes.

### Task 5: Verify and ship

**Objective:** Prove the implementation works and prepare a PR.

**Commands:**
- `npm test -- tests/element-context.test.ts tests/feedback-provider-element-context.test.tsx tests/adapters/github.test.ts tests/adapters/slack.test.ts tests/adapters/supabase.test.ts`
- `npm run type-check`
- `npm run build`
- `npm pack --dry-run --json`

**Done when:** all relevant tests/type/build pass, docs are included in pack dry-run, branch is pushed, PR opened, and CI is green before merge.
