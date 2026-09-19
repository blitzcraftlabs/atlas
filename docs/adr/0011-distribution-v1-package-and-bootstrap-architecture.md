# ADR-0011: Distribution v1 Package and Bootstrap Architecture

## Status

**Accepted**

**Launch update (2026-09-19):** `@blitzcraftlabs/atlas@1.0.1` is published on npm from canonical Git
tag `v1.0.1`. `pnpm dlx @blitzcraftlabs/atlas` is the supported public bootstrap. Canonical GitHub
`v1.0.0` remains the first stable platform release and is not retagged. npm Trusted Publishing is
configured for GitHub Actions `release.yml` on `@blitzcraftlabs/atlas`; later versions use OIDC. See
[releases-and-governance.md](../how-we-build/releases-and-governance.md).

## Context

Atlas is now a public, source-owned frontend platform, but its supported adoption path still assumes
a repository checkout. The CLI is implemented as the private `@atlas/cli` workspace and is invoked
through the root workspace. `atlas init` initializes metadata in an **existing compatible
checkout**; it does not create a project from an empty directory.

Distribution v1 needs a real external entry point without changing Atlas into a conventional runtime
framework or publishing every internal workspace as a stable npm API.

The current repository establishes several constraints:

- The CLI package is private, emits CommonJS into `dist`, exposes the `atlas` binary, and has one
  Atlas runtime dependency: `@atlas/project` via `workspace:*`.
- `@atlas/project` is also private. Its runtime dependency is only `zod`; its `@atlas/config`
  dependency is development-only.
- The starter application depends on local workspace packages such as `@atlas/ui` and
  `@atlas/consent`, and uses `@atlas/config` for repository/tooling configuration.
- `@atlas/ui`, `@atlas/consent`, and `@atlas/config` are currently designed as source-owned
  workspace packages. Their package identities are part of Atlas ownership/update metadata, but this
  does not by itself make them justified public npm APIs.
- The existing `atlas init` discovers an Atlas-compatible repository by `atlas.config.json` or by
  the structural presence of `package.json`, `apps/web`, and `packages/ui`. It then initializes the
  contract/baseline inside that checkout.
- Generators render source from code and operate against paths resolved from `atlas.config.json`;
  they do not require external template files for feature/page generation.
- Template synchronization and baseline capture read `templates/app-infrastructure.manifest.json`
  from the consumer repository.
- `atlas upgrade` loads production release snapshots from the installed `@blitzcraftlabs/atlas`
  package. `--releases-dir` remains an explicit fixture/maintainer override. Generated consumers do
  not carry Atlas's `releases/` history.
- Agent context currently references repository-local documentation and ADR paths.
- The root platform support contract is Node `>=22` and pnpm `>=10`; the workspace's materialized
  architecture matrix is Linux/macOS on x64/arm64.

The distribution problem is therefore larger than flipping `private: false` on `@atlas/cli`. The
published artifact needs a self-contained runtime, while the generated project must remain a
source-owned Atlas project that Doctor, generators, upgrades, and agents can reason about.

## Decision

### 1. Distribution v1 publishes one user-facing npm package

The initial public npm surface is **one package containing the Atlas CLI and its Atlas-specific
runtime implementation**.

The public npm identity is resolved:

```text
@blitzcraftlabs/atlas
```

with:

```json
{
  "bin": {
    "atlas": "./dist/cli.js"
  }
}
```

The intended user experience after the first registry publication is:

```bash
pnpm dlx @blitzcraftlabs/atlas init my-app
```

The `blitzcraftlabs` npm organization exists and is maintainer-controlled. This ADR no longer treats
the package name as provisional. **Registry publication of `@blitzcraftlabs/atlas@1.0.1` is live**,
and npm Trusted Publishing is configured for GitHub Actions `release.yml`.
`pnpm dlx @blitzcraftlabs/atlas` is the supported public bootstrap.

Internal workspace names may remain `@atlas/*` inside generated source. This ADR does not claim or
reserve the public npm `@atlas` scope.

### 2. `@atlas/project` remains an implementation package, not a v1 public API

`@atlas/project` is required by the CLI at runtime today, but external users do not need to import
it to use Atlas. Distribution v1 will therefore **internalize it into the published CLI artifact**
rather than publish it as a second npm package.

Implementation may use a bundler or another build-time internalization strategy, provided the packed
CLI has no unresolved `workspace:*` runtime dependency. The source workspace remains separate in the
monorepo for maintainability and testing.

The public package must not expose `@atlas/project` as a stable import contract in v1. Its schema
and resolved project model remain Atlas implementation details surfaced through:

- `atlas.config.json`;
- CLI commands and JSON output;
- generated source;
- documented contract semantics.

A future issue may justify publishing a project-contract library if real consumers need programmatic
imports independent of the CLI.

### 3. `@atlas/ui`, `@atlas/consent`, and `@atlas/config` stay source-owned in v1

Distribution v1 does **not** publish these packages to npm merely because the starter uses them.
Instead, `atlas init` creates a **small source-owned Atlas monorepo** containing the workspaces the
starter needs.

The generated project keeps local workspace identities such as:

```text
apps/web
packages/ui
packages/consent
packages/config
```

This preserves Atlas's existing ownership model:

- product/application code is editable source;
- Atlas platform packages are inspectable and customizable source in the consumer repository;
- package versions can remain part of Atlas baseline/upgrade metadata;
- no premature stable npm API is promised for UI/config/consent.

`@atlas/project` and the CLI source workspace are **not required** in a generated consumer
repository unless a later implementation proves a consumer-side source copy is necessary. The
installed public CLI owns contract parsing/Doctor/generator/upgrade execution.

### 4. `atlas init <project>` becomes a real bootstrap command

The current `atlas init` behavior (initialize an existing compatible checkout) remains useful but is
not sufficient for Distribution v1.

The command gains an explicit empty-directory/project-name bootstrap path. Conceptually:

```text
atlas init my-app
  -> create my-app/
  -> materialize the supported Atlas starter baseline
  -> write atlas.config.json with current Atlas baseline identity
  -> leave the project ready for pnpm install/build/Doctor
```

The generated project is **not** a copy of the entire Atlas repository.

The bootstrap contract should include only the source and configuration required for a usable Atlas
consumer, including at minimum:

- root `package.json` / `pnpm-workspace.yaml` and required tool configuration;
- `apps/web` starter application;
- source-owned workspaces required by that application (`packages/ui`, `packages/consent`,
  `packages/config` as applicable to the final dependency closure);
- `atlas.config.json`;
- `templates/app-infrastructure.manifest.json` or its Distribution-v1 successor needed for ownership
  and baseline semantics;
- OpenAPI seed/spec and generation configuration if OpenAPI remains enabled in the generated
  baseline;
- minimal repository policy/config files required for lint/typecheck/build/Doctor to agree;
- a focused `AGENTS.md` and the subset of architecture documentation required by `atlas context` if
  those paths remain repository-local;
- license/notices required for copied Atlas source.

The bootstrap contract should deliberately exclude:

- `apps/reference` unless the user explicitly asks for reference/demo content;
- Atlas maintainer-only CI/release tooling;
- private/internal audit fixtures;
- Storybook/visual baselines not required by the generated starter contract;
- historical GitHub metadata;
- the full Atlas documentation corpus;
- the full Atlas release-history tree when upgrade metadata can be supplied by the CLI artifact.

The exact file manifest belongs in implementation code/tests, not only prose.

### 5. Bootstrap assets are versioned package assets, not repository-relative lookups

Feature/page generator templates are already code-generated and should stay compiled into the CLI.
Distribution v1 adds a **versioned bootstrap asset manifest** inside the public package for the
files that must be materialized into a new project.

The CLI must locate packaged assets relative to its installed package root, never relative to the
Atlas source-repository root or the caller's current directory.

`pnpm pack --dry-run` and clean-room tests must prove every required bootstrap asset is included.

### 6. Upgrade release snapshots move to the CLI distribution boundary

A generated consumer should not need to carry Atlas's entire `releases/` directory solely so a later
CLI can upgrade it.

For Distribution v1, supported release snapshots and migration metadata become **CLI distribution
assets**. A newer CLI must be able to load the source/target snapshots required for its documented
upgrade window from its installed package.

The consumer continues to store only its own baseline evidence in `atlas.config.json`, including:

- Atlas version;
- contract schema version;
- template manifest schema version;
- synced-path checksums.

This keeps the existing safety rule intact: consumer modifications win unless Atlas can prove a
patch-safe replacement. It changes only where canonical Atlas release evidence is loaded from.

Repository-local `releases/` remains useful for Atlas development/rehearsal, but external consumers
must not depend on a clone of that directory.

### 7. `atlas context` remains deterministic, but its docs references must be distributable

The current agent context references repository-local paths such as `docs/how-we-build/*.md`, ADRs,
and `AGENTS.md`.

Distribution v1 must choose one of two implementation shapes for each reference:

1. materialize that document into the generated project because it is part of the consumer contract;
   or
2. emit a stable public documentation URL instead of a missing local path.

The bootstrap manifest and clean-room test must ensure `atlas context --json` never advertises a
local documentation path that the generated project does not contain.

### 8. The public package has a strict pack allowlist

The npm package must use an explicit `files` allowlist (or equivalent pack manifest) rather than
publishing whatever happens to be under `packages/cli`.

Expected contents:

```text
package.json
README / package usage documentation
LICENSE
THIRD_PARTY_NOTICES or package-relevant notices
compiled CLI/runtime (`dist/**`)
bootstrap asset manifest + bootstrap assets
supported release snapshots/migration assets required by the documented upgrade window
source maps/types only where intentionally supported
```

Expected exclusions:

```text
src/**
__tests__/**
test fixtures
coverage
jest/eslint development config
maintainer-only scripts
repository credentials/config
unrelated apps/packages/docs
Git metadata
```

The package must contain no `workspace:*` entry in runtime dependencies after packing.

### 9. Clean-room verification is the release gate for npm distribution

Before any npm publish step exists, CI must prove the packed artifact in a directory outside the
workspace.

The minimum test flow is:

```text
build public CLI artifact
-> pnpm pack
-> create empty temporary directory outside the monorepo
-> install/invoke the tarball
-> atlas init test-app
-> cd test-app
-> pnpm install --frozen-lockfile (or the documented first-install equivalent)
-> pnpm build
-> atlas doctor
-> prove installed upgrade assets resolve from the package, not consumer releases/
```

The test should also run at least one generator and `atlas context --json` so package assets,
contract loading, generator behavior, and documentation references are exercised outside workspace
linking.

The test must fail on:

- unresolved `workspace:*` runtime dependencies;
- repository-relative asset reads;
- missing packaged templates/snapshots;
- generated projects that require unpublished npm packages;
- Doctor assumptions that only hold in the Atlas source monorepo.

### 10. Initial compatibility contract stays narrow

Distribution v1 supports only what Atlas already validates confidently:

| Surface             | Initial support                                                                                |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| Node                | `>=22`                                                                                         |
| Package manager     | pnpm `>=10`; documented/tested path is `pnpm dlx` + pnpm workspace                             |
| OS                  | Linux and macOS                                                                                |
| CPU                 | x64 and arm64                                                                                  |
| CLI module format   | CommonJS artifact is acceptable for v1; no public module-format API promise                    |
| Atlas API stability | 1.0 public CLI/project/upgrade/distribution contracts; breaking those requires a major version |

Windows may work in individual code paths but is not a Distribution-v1 support claim until it is in
the clean-room CI matrix.

npm/npx/bun/yarn invocation may be evaluated later. Distribution v1 does not broaden package-manager
support beyond pnpm merely because npm can install the package.

### 11. Atlas release identity and npm publication stay coupled

The public npm package version follows the canonical Atlas release version. Distribution v1 does not
create an independent CLI release train.

The existing Changesets/fixed-version model can continue to prepare Atlas versions while package
publication is added as a separate, fail-closed release action after clean-room validation.

Implementation uses `.changeset/config.json` `access: public` together with package-level
`publishConfig.access: public` on `@blitzcraftlabs/atlas`. Other workspaces remain `private: true`
and are not npm packages. Changesets prefers `publishConfig.access` when present.

No npm publication workflow should be added until:

- package naming/scope ownership is confirmed externally;
- pack contents are deterministic;
- clean-room bootstrap is green;
- the release workflow can prove that the package version matches the canonical Atlas release.

## Proposed external runtime closure

Distribution v1 should converge on this external shape:

```text
npm registry
└── @blitzcraftlabs/atlas
    ├── atlas binary
    ├── compiled CLI
    ├── internalized project-contract runtime
    ├── generator implementations/templates
    ├── Doctor
    ├── bootstrap asset manifest/assets
    ├── migration metadata
    └── supported release snapshots

consumer repository
├── atlas.config.json
├── apps/web
├── packages/ui
├── packages/consent
├── packages/config
├── templates/app-infrastructure.manifest.json (or successor)
├── openapi/... (when enabled)
├── focused agent/docs contract
└── normal app/tooling configuration
```

No consumer runtime import from the npm CLI package is required for the web application itself. The
published package is a **tooling/distribution boundary**, while the generated application remains
source-owned.

## Alternatives Considered

### Alternative 1: Publish all current `@atlas/*` workspaces

**Pros:**

- Minimal restructuring of workspace dependency declarations.
- Conventional package-manager dependency graph.

**Cons:**

- Prematurely creates public API/support obligations for UI, config, consent, and project internals.
- Conflicts with Atlas's source-owned template model and existing ADR-0009/0010 reasoning.
- Makes consumer customization and synchronized template ownership harder to explain.

**Why not chosen:** Distribution should solve adoption, not convert implementation boundaries into
public products without evidence that consumers need those APIs.

### Alternative 2: Publish `@atlas/cli` + `@atlas/project`

**Pros:**

- Very small code change from the current runtime dependency graph.
- Avoids bundling project-contract code.

**Cons:**

- Exposes `@atlas/project` as a public package even though the supported user flow does not require
  direct imports.
- Creates another versioned public API that must remain compatible independently.

**Why not chosen:** The project contract is semantically important but can remain an internal CLI
runtime in v1. Public JSON/CLI contracts are sufficient for current consumers.

### Alternative 3: Publish a tarball of the whole Atlas monorepo

**Pros:**

- Almost no bootstrap selection work.
- Exact parity with source repository.

**Cons:**

- Huge, noisy artifact with maintainer-only apps, fixtures, docs, CI, and release machinery.
- Does not define a stable consumer baseline.
- Makes install/upgrade behavior depend on repository layout accidents.

**Why not chosen:** Distribution v1 needs an intentional product boundary, not a compressed GitHub
checkout.

### Alternative 4: `atlas init` clones GitHub

**Pros:**

- Small npm package.
- Reuses the existing public repository as the template source.

**Cons:**

- Requires Git/network access after CLI installation.
- Couples bootstrap to moving branch/tag/repository semantics.
- Harder to prove artifact/release identity and deterministic offline-ish behavior.
- Makes the npm package a thin wrapper around `git clone`, not a real distribution artifact.

**Why not chosen:** A released Atlas CLI should contain the exact baseline it claims to bootstrap.

### Alternative 5: Generate every source file from TypeScript string templates

**Pros:**

- No copied template assets.
- Everything compiled into one JS artifact.

**Cons:**

- Poor maintainability for a large source-owned starter.
- Duplicates real starter source into string templates.
- Makes code review and sync with `apps/web` unnecessarily difficult.

**Why not chosen:** Code-generation is appropriate for small feature/page generators; the starter
baseline should be a manifest-selected asset tree derived from real source.

## Consequences

### Positive

- One obvious installation surface for users.
- No premature public API explosion.
- Preserves Atlas's source-owned architecture and upgrade ownership model.
- Makes the CLI independently installable and testable.
- Clean-room testing becomes the proof that Distribution v1 works outside the monorepo.
- Release snapshots/migrations follow the tooling that consumes them instead of burdening consumer
  repositories with Atlas history.

### Negative

- CLI build becomes more sophisticated because `@atlas/project` and data assets must be
  internalized.
- Bootstrap needs an explicit manifest and copy pipeline.
- Existing `atlas init`, upgrade snapshot resolution, agent docs references, and some Doctor
  assumptions require refactoring.
- Public npm publication adds another supply-chain surface to govern.

### Neutral

- `@atlas/ui`, `@atlas/consent`, and `@atlas/config` continue to exist as workspace packages inside
  Atlas and generated consumers.
- GitHub Releases remain canonical platform release records; npm becomes an additional distribution
  channel for the same Atlas version.
- Future evidence may justify publishing additional packages, but that is a separate decision.

## Implementation Sequence

After this ADR is accepted, Distribution v1 should proceed in dependency order. **Items 1–6 plus the
1.0 public-contract audit and in-repo npm publication machinery are complete.** GitHub `v1.0.0` is
the immutable first stable platform release. Remaining work is Version PR `1.0.1` → GitHub `v1.0.1`
→ first human npm publish of that exact artifact → registry verification → Trusted Publisher →
public one-command quickstart.

**Launch sequencing update:** do not publish or retag `v1.0.0` as the first npm package. The first
registry version is `@blitzcraftlabs/atlas@1.0.1`.

1. **Packable CLI boundary**
   - internalize `@atlas/project`;
   - add package metadata/`files` allowlist;
   - make `pnpm pack --dry-run` deterministic;
   - verify no runtime `workspace:*` dependency remains.
2. **Bootstrap asset manifest**
   - define the exact generated source-owned project tree;
   - derive/copy assets from canonical Atlas source without copying the entire repository.
3. **`atlas init <project>` bootstrap**
   - support empty-directory creation while preserving existing checkout initialization semantics
     where useful;
   - record Atlas baseline identity.
4. **Distribution-owned upgrade assets**
   - resolve supported release snapshots from the installed CLI package;
   - keep `--releases-dir` as an explicit fixture/maintainer override.
5. **Agent/docs distribution cleanup**
   - materialize required local docs or emit stable public URLs;
   - prove `atlas context --json` references exist.
6. **Clean-room CI**
   - pack/install/init/install/build/Doctor/generate/context outside the monorepo;
   - matrix Linux/macOS x64/arm64 as infrastructure permits.
7. **npm namespace + trusted publishing setup** — **complete**. The public package identity
   `@blitzcraftlabs/atlas` is resolved. npm Trusted Publishing is configured for GitHub Actions
   `release.yml` (no environment; `npm publish` and `npm stage publish`). The first npm version is
   **1.0.1**, published by a human from the exact canonical `v1.0.1` tarball because Trusted
   Publishing cannot create a package that does not yet exist. Do not bootstrap npm with `0.5.0` or
   `1.0.0`, and do not retag `v1.0.0`.
8. **Release integration** — **in-repo complete for 1.0.1**. Publication is tied to the canonical
   Atlas version after GitHub Release. Fail closed on identity mismatch, existing versions, a dirty
   checkout, or a substituted artifact. `@blitzcraftlabs/atlas@1.0.1` exists on npm after the
   bootstrap publish and `pnpm distribution:verify-registry 1.0.1`.
9. **Public quickstart** — **live**. Consumer onboarding uses `pnpm dlx @blitzcraftlabs/atlas`. The
   clone path remains for contributors and evaluation.
10. **Selective package review**
    - separately evaluate whether any source-owned workspace deserves a public npm API.

## References

- [Issue #13 — Distribution v1 epic](https://github.com/blitzcraftlabs/atlas/issues/13)
- [Issue #14 — Distribution architecture](https://github.com/blitzcraftlabs/atlas/issues/14)
- [ADR-0007 — Architecture ownership model](0007-architecture-ownership-model.md)
- [ADR-0008 — Atlas project architecture contract](0008-atlas-project-contract.md)
- [ADR-0009 — Starter/reference template sync](0009-starter-reference-template-sync.md)
- [ADR-0010 — Atlas upgrades and downstream propagation](0010-atlas-upgrades-downstream-propagation.md)
- [Atlas CLI](../how-we-build/cli.md)
- [Atlas upgrades](../how-we-build/upgrades.md)
