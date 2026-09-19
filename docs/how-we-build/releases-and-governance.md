# Atlas Releases and Governance

> **Canonical source of truth** for Atlas licensing, versioning, releases, support, breaking
> changes, and migration policy. Other documentation links here rather than restating these rules.

---

## Licensing

Atlas is **open source under Apache License 2.0**. The canonical public repository is
[`blitzcraftlabs/atlas`](https://github.com/blitzcraftlabs/atlas).

| Item                         | Policy                                                                                                     |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **License file**             | Root [`LICENSE`](../../LICENSE)                                                                            |
| **Scope**                    | In-repository source, documentation, configuration, and other materials unless explicitly marked otherwise |
| **Workspace packages**       | `@atlas/ui`, `@atlas/config`, `@atlas/consent`, `@atlas/web` are **internal workspace packages**           |
| **Third-party dependencies** | Retain their own licenses                                                                                  |
| **Third-party provenance**   | [provenance.md](provenance.md), [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md)                   |

The repository is public. Internal `@atlas/*` workspace packages remain unpublished npm internals
(`private: true`). The public CLI package identity is `@blitzcraftlabs/atlas`. Canonical GitHub
Releases are published automatically after a Version PR merges to `main`. npm publication of that
same Atlas version is a separate fail-closed job on the same workflow. The first registry version
was a human-authenticated publish of the validated `.tgz` from canonical **`v1.0.1`**. Later
versions use GitHub Actions OIDC / npm Trusted Publishing, which is configured for `release.yml`. Do
not retag `v1.0.0`. Do not bootstrap npm with `0.5.0` or `1.0.0`.

---

## What is versioned?

**Atlas itself** — a **repository/platform snapshot**, not independent npm products.

| Package                  | Role                         | Published to npm?                                             | Independently supported? |
| ------------------------ | ---------------------------- | ------------------------------------------------------------- | ------------------------ |
| `@atlas/monorepo` (root) | Canonical Atlas version      | No                                                            | This is Atlas            |
| `@atlas/web`             | Template application         | No                                                            | Part of Atlas snapshot   |
| `@atlas/reference`       | Executable reference app     | No                                                            | Part of Atlas snapshot   |
| `@atlas/ui`              | Internal UI primitives       | No                                                            | Part of Atlas snapshot   |
| `@atlas/config`          | Internal tooling config      | No                                                            | Part of Atlas snapshot   |
| `@atlas/consent`         | Optional consent module      | No                                                            | Part of Atlas snapshot   |
| `@atlas/project`         | Architecture contract loader | No                                                            | Part of Atlas snapshot   |
| `@blitzcraftlabs/atlas`  | Public Atlas CLI             | First version: manual validated tarball; later versions: OIDC | Part of Atlas snapshot   |

Workspace `package.json` version fields mirror the Atlas release for tooling only.

---

## Versioning policy

Atlas uses **[Semantic Versioning](https://semver.org/)** for repository releases.

| Version             | Meaning                                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| **Major (`X.0.0`)** | Breaking change to a public 1.0 contract, or the explicit `0.5.0` → `1.0.0` public-distribution jump |
| **Minor (`x.Y.0`)** | Compatible new capability after 1.0; while 0.x, also used for breaking proving-line changes          |
| **Patch (`x.y.Z`)** | Bug fixes and low-risk adjustments within the current line                                           |

## Atlas 1.0 stability contract

Atlas **0.x** GitHub releases were the platform-development and proving line. They remain historical
repository snapshots. They are **not** the first public npm distribution.

Atlas **1.0.0** is the first supported public GitHub/platform release and the first stable public
contract:

- Public CLI, generated-project, upgrade, and distribution contracts below are treated as stable.
- Breaking those public contracts after 1.0 requires a **major** version.
- Internal implementation may continue evolving without a major release.
- Compatible feature additions use **minor**; fixes use **patch**.
- There is **no LTS programme**. Atlas does not claim formal security certification, independent
  audit completion, or perfect backward compatibility forever.

Canonical `v1.0.0` is immutable. The first npm registry version is
**`@blitzcraftlabs/atlas@1.0.1`**, packed from canonical Git tag `v1.0.1` after that GitHub Release
existed. Do not invent a `0.5.1` or `0.6.0` public npm bootstrap, and do not retag `v1.0.0`.

### What 1.0 treats as stable

| Surface           | Stable contract                                                                                                                                                        |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI commands      | `atlas init`, `atlas doctor`, `atlas generate`, `atlas context`, `atlas upgrade`, plus `--help` / `--version`                                                          |
| CLI flags         | `--json`, `--cwd`, `--dry-run`, `upgrade --to`, generate `--query` / `--mutation` / `--form` / `--tests`                                                               |
| CLI behavior      | Documented exit codes; JSON envelopes `{ ok, command, result \| error }`                                                                                               |
| Generated project | Workspace layout (`apps/web`, `packages/ui`, `packages/config`, `packages/consent`), `atlas.config.json` baseline, ownership/template-sync model, root package scripts |
| Upgrade           | Packaged snapshots, adjacent current+previous catalog, fail-closed missing evidence, no silent overwrite of consumer-modified synced paths                             |
| Distribution      | Package `@blitzcraftlabs/atlas`, binary `atlas`, Node `>=22`, pnpm `>=10`, GitHub tag `vX.Y.Z` equals npm version                                                      |
| Architecture      | Consumer-visible `@atlas/ui` / `@atlas/config` / `@atlas/consent` stay source-owned and private; Doctor and generators follow the project contract                     |

### What 1.0 does **not** freeze

- Internal `@atlas/project` loader implementation and unpublished workspace internals
- Doctor diagnostic code inventory beyond fail-closed contract drift
- UI component visuals, Storybook, and docs copy that are not CLI/project/upgrade/distribution
  contracts
- `atlas sync infrastructure` checkout-repair details (supported, but not the public onboarding API)
- Generator file interiors after the shell is written (product code is consumer-owned)

### Changeset convention after this decision

| Change type                         | Changeset bump            | Example         |
| ----------------------------------- | ------------------------- | --------------- |
| Bug fix / small non-breaking        | **patch**                 | `1.0.0 → 1.0.1` |
| Compatible feature                  | **minor**                 | `1.0.0 → 1.1.0` |
| Breaking public 1.0 contract        | **major**                 | `1.0.0 → 2.0.0` |
| `0.5.0` → first public distribution | **major** (this decision) | `0.5.0 → 1.0.0` |

### Historical / internal tags

| Tag                | Meaning                                                    |
| ------------------ | ---------------------------------------------------------- |
| `v0.1.0-pre-split` | Internal pre-split snapshot                                |
| `v1.0.0-platform`  | Internal milestone — **not** the public `v1.0.0` tag       |
| `v0.2.0`–`v0.5.0`  | Proving-line GitHub Releases; not the first npm package    |
| `v1.0.0`           | First stable GitHub/platform release; not published to npm |

Canonical release tags: `v{MAJOR}.{MINOR}.{PATCH}` (e.g. `v1.0.0`). `0.1.0` remains a historical
internal snapshot and must not receive a public tag. `v1.0.0-platform` is not `v1.0.0`.

---

## What constitutes an Atlas release?

A deliberate tagged snapshot at one SemVer version. Intended contents:

| Artifact            | Status                  | Notes                                                                          |
| ------------------- | ----------------------- | ------------------------------------------------------------------------------ |
| Git tag `vX.Y.Z`    | After Version PR merge  | Never retagged; never `v0.1.0`                                                 |
| GitHub Release      | After Version PR merge  | Fail-closed notes + SBOM                                                       |
| npm package         | After GitHub Release    | Exact validated `@blitzcraftlabs/atlas` tarball; OIDC after first publication  |
| Root `CHANGELOG.md` | Yes                     | Canonical history                                                              |
| Migration notes     | When needed             | `docs/migrations/`                                                             |
| SPDX SBOM snapshot  | Yes                     | Workflow artifact and GitHub Release asset; 90-day workflow retention          |
| CI evidence         | Required before publish | Publication waits for CI, Security Audit, and UI Quality on the release commit |

---

## Tag format

| Item                | Format            | Example       |
| ------------------- | ----------------- | ------------- |
| Canonical tag       | `vX.Y.Z`          | `v1.0.0`      |
| GitHub Release name | `Atlas {version}` | `Atlas 1.0.0` |
| Not used            | `@atlas/ui@x.y.z` | Misleading    |

### GitHub Release prerelease semantics

- `1.0.0` is a **normal** SemVer release — **not** a GitHub prerelease.
- Only versions with a SemVer **prerelease component** are GitHub prereleases, e.g. `1.0.0-rc.1`.

GitHub Release publication uses the SemVer prerelease component, not the major line alone.

---

## Release process

### Day-to-day

1. Add a changeset in your PR: `pnpm changeset`
2. Use the post-1.0 bump convention above (this decision uses **major** to reach `1.0.0`).
3. Include migration steps in the changeset body for breaking changes.

### Version PR (automated on `main`)

When changesets merge to `main`, the Release workflow opens/updates a Version PR:

- Title: `chore(release): atlas version`
- Bumps all workspace packages to the same version (fixed group)
- Consolidates release notes into root [`CHANGELOG.md`](../../CHANGELOG.md)
- Consumes changeset files
- Generates the production release snapshot for the new version (including `1.0.0`)

The Version PR must pass normal CI and Governance. It does not create a Git tag. While the Version
PR job reports pending changesets, the Publish GitHub Release job is skipped. Publication still
refuses `PENDING_CHANGESETS` if the publisher is invoked against unconsumed changeset state.

Changesets Version PRs are created by GitHub Actions. Depending on repository or GitHub organization
policy, GitHub may require a maintainer to approve workflow execution on an automation-created pull
request. If checks do not start on the Version PR, review the generated PR and use **Approve
workflows to run** when GitHub presents that option. This is not guaranteed on every repository — it
depends on your settings.

Publication still waits for required checks on the release commit before creating the canonical tag
or GitHub Release. After those checks succeed, the publisher reloads GitHub state and re-evaluates
the same target SHA immediately before mutation, so a moved `main` or a tag/Release that appeared
while waiting cannot publish a stale decision. Workflow concurrency settings are not a substitute
for that revalidation.

Required checks use the latest workflow run/attempt on the exact SHA. A later successful retry
passes; a later failure or in-progress retry overrides an older success.

### GitHub Release publication

After the Version PR merges to `main`, the Release workflow publishes fail-closed:

1. Confirm root/workspace versions match and `CHANGELOG.md` contains that version
2. Refuse historical `0.1.0` (never create `v0.1.0`; pending changesets are a safe no-op)
3. Refuse publication when release-bearing `.changeset/*.md` files remain after a Version PR
4. Refuse retagging or recreating a release when an existing `vX.Y.Z` tag is not the target SHA and
   is not a proven ancestor of current `main`
5. Wait for required **CI**, **Security Audit**, and **UI Quality** checks on the release commit
6. Reload GitHub tags, Releases, assets, and current `main`, then re-evaluate the original target
   SHA
7. Create `vX.Y.Z` at that SHA only when the fresh decision is still `publish`
8. Create the GitHub Release with changelog-derived notes, SBOM, and license notice
9. No-op when the current version is already published with required assets at this SHA, or at a
   proven ancestor of current `main` after post-release commits
10. Repair a missing Release or missing required SBOM at the same SHA without retagging
11. The `npm-publish` job queries npm for the current Atlas version. If that exact version already
    exists, it no-ops without packing. If the package or version is missing, it requires HEAD to be
    the exact canonical `vX.Y.Z` tag, packs one `@blitzcraftlabs/atlas` tarball from that checkout,
    validates it, and either requires the first-publish bootstrap or publishes that exact file with
    OIDC. Untagged later `main` commits cannot publish a missing version.

The npm job is not a second versioning system. It distributes the same Atlas version that the GitHub
Release already recorded.

Internal `@atlas/*` workspace packages are not published to npm. `@blitzcraftlabs/atlas` is the only
public npm package. After the GitHub Release job completes, a separate `npm-publish` job:

1. **No-op** if `@blitzcraftlabs/atlas@<version>` already exists on npm — without rebuilding or
   uploading a new tarball from later `main`
2. **Bootstrap skip** if the package does not exist yet (Trusted Publishing cannot create the first
   package). The job still packs only from the exact canonical tag. Maintainers publish that
   validated `.tgz` with a human-authenticated `npm publish` of that file — never a rebuilt copy of
   `packages/cli` and never a `0.5.0` or `1.0.0` artifact
3. **OIDC publish** of that same `.tgz` with npm provenance when the package exists, the version is
   unpublished, and HEAD is the exact matching `vX.Y.Z` tag. npm provenance is not a GitHub Release
   attestation and is not SLSA

The npm job requests `id-token: write` only. It does not use `NPM_TOKEN`, does not run on pull
requests or `workflow_dispatch`, and does not publish internal `@atlas/*` workspaces.

### First npm publication

The first public npm version is **`@blitzcraftlabs/atlas@1.0.1`**, packed from canonical Git tag
`v1.0.1` after the GitHub Release existed. Canonical `v1.0.0` remains the first stable GitHub
platform release and must not be retagged. Do not publish `0.5.0` or `1.0.0`. That first version was
a human-authenticated publish of the validated tarball because Trusted Publishing cannot create a
package that does not yet exist.

npm Trusted Publishing is configured on `@blitzcraftlabs/atlas` for GitHub Actions `release.yml`:

| Field             | Value                                 |
| ----------------- | ------------------------------------- |
| Provider          | GitHub Actions                        |
| Organization/user | `blitzcraftlabs`                      |
| Repository        | `atlas`                               |
| Workflow filename | `release.yml`                         |
| Environment       | none                                  |
| Permissions       | `npm publish` and `npm stage publish` |

Subsequent Atlas versions publish from GitHub Actions OIDC. Do not store a long-lived `NPM_TOKEN`
for this workflow.

Publication does not claim SLSA or a formal security audit. npm provenance is generated
automatically for OIDC publishes from this public repository.

### Rehearsal

```bash
pnpm governance:check   # policy invariants
pnpm release:rehearse   # isolated worktree; version transform + publication dry-run
```

GitHub Actions: run the **Release** workflow via `workflow_dispatch`. That path generates SBOM and
release notes and must not create a Git tag or GitHub Release.

### Commands

```bash
pnpm changeset
pnpm changeset:status
pnpm changeset:version   # local only; CI uses this in Version PR
pnpm governance:check
pnpm release:rehearse
pnpm distribution:prepare-publish --require-release-tag
pnpm distribution:publish-npm --dry-run
pnpm distribution:verify-registry <version>
pnpm docs:check          # documentation links
```

---

## Changelog

Root [`CHANGELOG.md`](../../CHANGELOG.md) is the **canonical Atlas release history**.

Workspace `CHANGELOG.md` files under `apps/web` and `packages/*` are **Changesets-generated
implementation artifacts**. They must remain on disk after `pnpm changeset:version` because
`changesets/action@v1` reads each changed package changelog **after** the custom version command
returns. They are not independently supported package release histories.

After `changeset version`, `scripts/consolidate-atlas-release.mjs`:

1. Reads workspace package changelogs written by Changesets
2. Parses those sections into structured entries instead of concatenating raw Markdown bodies
3. Drops dependency-only and package-version-propagation bullets (workspace changelogs keep them)
4. Maps remaining descriptions to Keep a Changelog categories (`Added`, `Changed`, `Fixed`,
   `Security`, …) rather than Changesets bump headings
5. Moves root `[Unreleased]` into the new release section, merging with workspace entries and
   dropping near-duplicate bullets, then resets `[Unreleased]` to empty
6. Replaces an existing same-version root section in place so a second run is idempotent
7. Updates root `CHANGELOG.md` **without discarding prior release sections or link references**
8. Advances the `[Unreleased]` compare link and adds/updates the new version link reference
9. Syncs versions across root and workspaces
10. Builds `@atlas/project` (package exports point at `dist/`), then generates the production
    release snapshot for the new Atlas version when one does not already exist
    (`packages/cli/release-assets/production/<version>/`)
11. **Does not delete** workspace package changelogs (required by `changesets/action`)

---

## Support policy

| Topic                          | Policy                                                                           |
| ------------------------------ | -------------------------------------------------------------------------------- |
| Supported line                 | Current Atlas release plus the immediately previous supported production release |
| Security / compatibility fixes | Prioritized for the latest supported release                                     |
| Older 0.x snapshots            | Rehearsal `0.1.0` / `0.2.0` are not production upgrade support                   |
| Adjacent 1.0 upgrade           | `0.5.0` → `1.0.0` once both production snapshots are packaged                    |
| LTS                            | **No LTS programme** at this stage                                               |
| npm CLI                        | First public version is `@blitzcraftlabs/atlas@1.0.1` from GitHub `v1.0.1`       |

---

## Breaking changes and migrations

Breaking changes must document:

- what changed; affected surfaces; who is affected; migration steps; compatibility constraints;
  deprecation/removal timeline where applicable.

### Where to document

1. Changeset body (**major** bump after 1.0; **minor** was the 0.x proving-line convention)
2. Root changelog under `### Breaking Changes`
3. `docs/migrations/` when steps are non-trivial

### Deprecation

| Stage          | Expectation                                                |
| -------------- | ---------------------------------------------------------- |
| Announced      | Changelog + `@deprecated` JSDoc when applicable            |
| Minimum notice | At least one minor release before removal when practicable |
| Owner          | PR author or named maintainer in migration doc             |

See [`docs/migrations/README.md`](../migrations/README.md).

---

## Changesets rationale

Retained to collect per-PR metadata and drive Version PRs — **not** to publish independent npm
products. All workspace packages share one version via a **fixed** changeset group.

---

## Related documentation

| Topic                      | Canonical source                                                    |
| -------------------------- | ------------------------------------------------------------------- |
| Security release artifacts | [security.md](security.md), `.github/workflows/security-audit.yml`  |
| Upgrade rehearsal          | [upgrades.md](upgrades.md)                                          |
| Third-party provenance     | [provenance.md](provenance.md)                                      |
| GitHub Release status      | Published after Version PR merge; rehearsal via `workflow_dispatch` |

---

## Quick reference

| Question                     | Answer                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------ |
| License?                     | Apache-2.0 ([`LICENSE`](../../LICENSE))                                              |
| Public repo today?           | Yes — [`blitzcraftlabs/atlas`](https://github.com/blitzcraftlabs/atlas)              |
| Versioned product?           | Atlas repository snapshot                                                            |
| Tag format?                  | `vX.Y.Z`                                                                             |
| Next canonical release?      | Changesets Version PR after `1.0.1`                                                  |
| Breaking change bump (1.0+)? | **major** changeset                                                                  |
| npm publish?                 | `@blitzcraftlabs/atlas` only; first version was canonical `v1.0.1` tarball bootstrap |
| GitHub Release today?        | After Version PR merge (`vX.Y.Z`); never `v0.1.0`                                    |
