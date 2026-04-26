# Release Process

How maintainers cut a snapfeed release. Written so a contributor can do it without DM-ing the lead.

> Versioning policy lives in [VERSIONING.md](./VERSIONING.md). Read that first if you're unsure whether your change is a patch, minor, or major bump.

---

## Pre-release checklist

Run through this list **before** starting the cut. Each item must pass.

- [ ] `npm run build` is clean (no TypeScript errors, no warnings).
- [ ] `npm run type-check` is clean.
- [ ] `npm test` passes (270+ tests as of v0.4).
- [ ] `npm audit` shows no high/critical vulnerabilities. If new advisories landed, address them or document why they're accepted before cutting.
- [ ] `CHANGELOG.md` has an `[Unreleased]` section that accurately describes everything since the last tag.
- [ ] `README.md` adapter table reflects the actual shipped state (no "✅ vX.Y" entries that haven't shipped yet, no missing rows for adapters that did ship).
- [ ] `SECURITY.md` checklist boxes are accurate for the version being cut (move planned items from "Coming in later releases" to the main list when they ship).
- [ ] Each example app in `examples/` builds and runs (`cd examples/nextjs && npm install && npm run build`; same for `examples/admin`).
- [ ] `package.json` `files` array includes any new top-level docs or directories that should ship with the npm package.
- [ ] `tsup.config.ts` has entries for any new subpath exports.
- [ ] `package.json` `exports` map has entries for any new subpath exports.
- [ ] No uncommitted changes in the working tree (`git status` clean).

If any item fails, fix and re-run the relevant check before continuing.

---

## Cutting the release

Replace `X.Y.Z` with the actual version (e.g. `0.5.0`).

1. **Update the changelog.** Move everything under `## [Unreleased]` to a new section `## [X.Y.Z] — YYYY-MM-DD`. Leave an empty `## [Unreleased]` header in place for the next cycle.

2. **Bump the version** in `package.json`:
   ```bash
   npm version X.Y.Z --no-git-tag-version
   ```
   The `--no-git-tag-version` flag prevents npm from tagging immediately — we want the changelog edit and the bump in one commit, then tag separately.

3. **Commit the bump:**
   ```bash
   git add package.json package-lock.json CHANGELOG.md
   git commit -m "chore(release): vX.Y.Z"
   ```
   No `Co-Authored-By` trailer on release commits.

4. **Tag:**
   ```bash
   git tag vX.Y.Z
   ```
   Annotated tag preferred:
   ```bash
   git tag -a vX.Y.Z -m "snapfeed vX.Y.Z"
   ```

5. **Push commit and tag:**
   ```bash
   git push origin main --tags
   ```

6. **Publish to npm** (only if you have publish rights):
   ```bash
   npm publish --access public --otp <OTP>
   ```
   `--access public` is required for the first publish of any new scoped package; harmless on subsequent publishes.

7. **Verify:**
   - Check `https://www.npmjs.com/package/snapfeed` shows the new version with the correct `README.md` rendered.
   - Check `https://github.com/shimoverse/snapfeed/releases` — GitHub auto-creates a release draft from the new tag. Edit the draft to paste the relevant CHANGELOG section (see template below) and publish.
   - Run `npm install snapfeed@X.Y.Z` in a scratch project and confirm the install works and the types resolve.

---

## Hotfix releases

For an urgent security or correctness fix that cannot wait for the next minor:

1. Branch from the affected tag:
   ```bash
   git checkout -b hotfix/X.Y.Z+1 vX.Y.Z
   ```

2. Apply the fix as a single commit (or a tight series). Keep it scoped — no unrelated changes.

3. Update `CHANGELOG.md` with a new `## [X.Y.Z+1] — YYYY-MM-DD` section above the existing `[X.Y.Z]`.

4. Bump version, commit, tag, push, publish per steps 2–7 above.

5. **Cherry-pick to `main`:**
   ```bash
   git checkout main
   git cherry-pick <hotfix-sha>
   git push origin main
   ```
   If main has diverged enough that the cherry-pick conflicts, resolve the conflict in a follow-up commit on main rather than rewriting the hotfix tag.

6. If the hotfix was for a security issue, update `SECURITY.md` advisories section (planned in v0.5) and notify subscribers per the responsible-disclosure policy.

---

## Release notes template

Paste this into the GitHub release draft after publishing the tag, populating from `CHANGELOG.md`.

```markdown
## snapfeed vX.Y.Z

> One-line summary of what this release is about (e.g. "MS Teams + Notion adapters; LLM scaffolding; Docker self-host stack").

### Highlights

- Most-important shipped feature (link to docs)
- Second most-important
- Third

### Added

(copy from CHANGELOG)

### Changed

(copy from CHANGELOG)

### Fixed

(copy from CHANGELOG)

### Breaking changes

- None *(or list with migration notes)*

### Upgrade

```bash
npm install snapfeed@X.Y.Z
```

If you're upgrading from < X.Y.0 see the migration notes in CHANGELOG.

### Thanks

Contributors this release: @user1, @user2, @user3
```
