# Release Process

How maintainers cut a snapfeed release. Written so a contributor can do it without DM-ing the lead.

> Versioning policy lives in [VERSIONING.md](./VERSIONING.md). Read that first if you're unsure whether your change is a patch, minor, or major bump.

---

## Three-command automated release (the happy path)

After the [one-time setup](#one-time-setup-for-the-automated-flow) below, every release is three commands:

```bash
# 1. Edit CHANGELOG.md — move [Unreleased] section to a new ## [X.Y.Z] — YYYY-MM-DD
git commit -am "changelog: vX.Y.Z"

# 2. Bump version + create the git tag in one shot
npm version patch    # or: npm version minor / npm version major

# 3. Push commit and tag — the Release workflow takes over
git push origin main --follow-tags
```

The [`Release` workflow](./.github/workflows/release.yml) on GitHub Actions then:

1. Verifies `package.json` version matches the git tag (catches "tagged but forgot to bump").
2. Runs the same gates as CI: build + type-check + test + lint + pack-shape sanity.
3. Publishes to npm with [provenance](https://docs.npmjs.com/generating-provenance-statements) (Sigstore-signed attestation visible on npmjs.com).
4. Creates a GitHub Release with the new CHANGELOG section as the body and the `.tgz` attached.

Watch it at <https://github.com/shimoverse/snapfeed/actions>. Takes ~3 minutes end-to-end.

> If anything in the workflow fails, see [§ When something goes wrong](#when-something-goes-wrong-in-the-automated-flow) below — usually it's a CHANGELOG section the workflow couldn't find or a tag/version mismatch. The detailed manual flow further down is the fallback.

---

### One-time setup for the automated flow

You only do these once per maintainer / once per repo.

**1. Claim the npm package name** (only the very first time, before the workflow has anything to publish to):

```bash
npm login
npm publish --dry-run                    # confirm package shape
npm publish --access public              # the first publish — you become the owner
```

If `snapfeed` is already taken on npm, fall back to `@shimoverse/snapfeed` (change `name` in `package.json`, then re-publish).

**2. Generate an npm automation token.** <https://www.npmjs.com/settings/~/tokens> → **Generate New Token** → **Automation** type → name it `snapfeed-github-actions`. Copy the token.

**3. Add the token to GitHub Actions secrets.** Repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**:

- Name: `NPM_TOKEN`
- Value: paste the automation token

**4. (Optional, recommended) Enable npm trusted publishing.** Once the package exists on npm, go to <https://www.npmjs.com/settings/~/packages/snapfeed/access> → **Trusted Publisher** → **Add GitHub Actions**. Repository: `shimoverse/snapfeed`. Workflow: `release.yml`. After this, you can delete the `NPM_TOKEN` secret — the workflow's `id-token: write` permission proves identity to npm via OIDC.

---

### When something goes wrong in the automated flow

| Symptom | Fix |
|---|---|
| Workflow fails at "Verify version match" with *"package.json is X but tag is vY"* | You ran `git tag` manually instead of `npm version`. Delete the tag (`git tag -d vY && git push origin :refs/tags/vY`), bump `package.json` to the right value, retag with `npm version`. |
| Workflow fails at "Publish to npm" with auth error | `NPM_TOKEN` secret is missing/expired. Re-do step 3 of one-time setup, OR set up the trusted-publisher path (step 4) and remove the token entirely. |
| Workflow fails at "Test" but the same tests pass locally | New devDep wasn't checked into `package-lock.json`, or test depends on TZ / wallclock. Read the workflow logs, fix on `main`, then re-tag. |
| Workflow not triggered after pushing a tag | Tag doesn't match `v[0-9]+.[0-9]+.[0-9]+` or `v...-...`. If you tagged `release-X.Y.Z` (no `v` prefix), retag. |
| Already published the wrong version | npm allows **deprecating** but not deleting once propagated. `npm deprecate snapfeed@X.Y.Z "Bad release — use X.Y.Z+1"`, then bump and republish. |

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
