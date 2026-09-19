# Atlas CLI

> **Atlas-specific command-line workflows for project contract awareness and bootstrap.**

The Atlas CLI exists only for workflows where Atlas owns meaningful semantics. It does **not**
replace pnpm, Next.js, Turborepo, Git, Changesets, shadcn, ESLint, TypeScript, or Playwright.

See also: [Atlas project contract](atlas-contract.md), [Agent workflow](agents.md),
[Releases and Governance](releases-and-governance.md).

---

## What the Atlas CLI owns

| Concern                | Example                                                                             |
| ---------------------- | ----------------------------------------------------------------------------------- |
| Atlas project contract | Load `atlas.config.json` through `@atlas/project`                                   |
| Platform version       | `atlas --version` reports the installed `@blitzcraftlabs/atlas` platform snapshot   |
| Project bootstrap      | `atlas init <project>` creates a consumer repo; `atlas init` initializes a checkout |
| Atlas generators       | `atlas generate feature …`, `atlas generate page …`, `atlas generate list --json`   |
| Agent project context  | `atlas context` / `atlas context --json`                                            |
| Architecture Doctor    | `atlas doctor` reports contract, boundary, and workspace drift                      |
| Upgrade workflows      | `atlas upgrade --to <version>` plans and applies supported release upgrades         |

---

## What the Atlas CLI does **not** own

Use the underlying tools directly:

| Instead of         | Use                                                        |
| ------------------ | ---------------------------------------------------------- |
| `atlas install`    | `pnpm install`                                             |
| `atlas dev`        | `pnpm dev`                                                 |
| `atlas test`       | `pnpm test`                                                |
| `atlas build`      | `pnpm build`                                               |
| `atlas lint`       | `pnpm lint`                                                |
| `atlas git …`      | `git …`                                                    |
| `atlas deploy`     | Your deployment platform                                   |
| `atlas add-button` | `pnpm dlx shadcn@latest add button` (or Atlas UI patterns) |
| `atlas release`    | Changesets + repository release workflow                   |

---

## Repository-local usage

The CLI is the public workspace package (`@blitzcraftlabs/atlas`) with an `atlas` binary.
Maintainers and contributors invoke the linked workspace binary from a clone:

```bash
pnpm install
pnpm --filter @blitzcraftlabs/atlas build
pnpm atlas --help
pnpm atlas --version
pnpm atlas init --dry-run
pnpm atlas init my-app --dry-run
pnpm atlas generate feature users --dry-run
pnpm atlas generate page settings/profile --json
```

The root `pnpm atlas` script runs the linked workspace binary via `pnpm exec atlas`.

---

## Public package identity

The distributable CLI package identity is `@blitzcraftlabs/atlas`. The supported public bootstrap
is:

```bash
pnpm dlx @blitzcraftlabs/atlas init my-app
cd my-app
pnpm install
pnpm dev
```

Published versions are listed on [npm](https://www.npmjs.com/package/@blitzcraftlabs/atlas). The
first npm-published Atlas release is `@blitzcraftlabs/atlas@1.0.1` from Git tag `v1.0.1`. Canonical
GitHub `v1.0.0` remains the first stable platform release and is not retagged. Subsequent versions
use the documented GitHub Release pipeline, then npm publication of that same Atlas version.

`pnpm pack` from `packages/cli` produces a tarball that installs and runs outside this repository.
The packed artifact internalizes `@atlas/project` and must not depend on unpublished `@atlas/*`
workspaces at runtime. It also contains a **versioned bootstrap asset tree** derived from canonical
Atlas source:

```text
package/
├── package.json
├── LICENSE
├── dist/
└── assets/bootstrap/
    ├── manifest.json
    └── files/
        ├── apps/web/...
        ├── packages/ui/...
        ├── packages/consent/...
        ├── packages/config/...
        └── selected root files
```

The Atlas repository remains the source of truth. The CLI does not maintain a second hand-copied
starter tree. `packages/cli/bootstrap/manifest.json` is the Distribution v1 allowlist;
`pnpm --filter @blitzcraftlabs/atlas build` materializes `packages/cli/assets/bootstrap/` from those
source paths, and that generated tree is packed inside the tarball.

Installed CLI code locates the tree from the `@blitzcraftlabs/atlas` package root — never from
process cwd, Git metadata, or `../../..` into this monorepo.

The bootstrap allowlist is not the same contract as `templates/app-infrastructure.manifest.json`:

| Manifest                                                        | Responsibility                                                                             |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Distribution bootstrap (`packages/cli/bootstrap/manifest.json`) | Which canonical files are packaged as the supported new-project starting surface           |
| Template-sync (`templates/app-infrastructure.manifest.json`)    | How Atlas-owned application infrastructure is classified and synced after a project exists |

Files listed in template-sync `syncedPaths`, `generatedPaths`, and `starterOnlyPaths` are included
in the bootstrap tree. `apps/reference` stays out of the default starter; template-sync then skips
when those consumers are absent. `atlas.config.json`, the root `package.json`, and `pnpm-lock.yaml`
are generated later by `atlas init`, not copied from this repository.

The packaged UI workspace omits Storybook, visual baselines, Husky, `packages/ui/scripts/**`, and
`packages/ui/README.md` (canonical UI docs still describe those maintainer-only commands). Bootstrap
generation derives a consumer-safe `packages/ui/package.json` from the maintainer manifest so
scripts and unused Storybook/visual/Husky `devDependencies` match that trimmed tree. Root
`CONTRIBUTING.md` is repository/maintainer-only and is not packaged. `lighthouserc.json` is packaged
so `apps/web`'s `perf:lhci` script resolves.

`atlas init <project>` materializes that packaged tree into a new directory. It does not clone
GitHub, copy the canonical monorepo, or read starter files from the caller's Atlas checkout.

Maintainers still use `pnpm atlas` from a clone of this repository. Consumers use
`pnpm dlx @blitzcraftlabs/atlas`. `atlas --version` reports the installed CLI package version, which
is distinct from a target checkout's Atlas version.

### Maintainer clean-room verification

`pnpm distribution:verify` is the Distribution v1 acceptance check for a packed CLI. It does **not**
publish to npm. The command builds `@blitzcraftlabs/atlas` through the repository build, proves
`npm publish --dry-run --access public` would accept the package structurally, packs the tarball,
installs that tarball into a temporary harness outside this checkout, and then runs the generated
consumer lifecycle against the installed binary:

```text
/tmp/atlas-clean-room-XXXX/
  harness/     # pnpm install of the packed @blitzcraftlabs/atlas tarball
  test-app/    # atlas init test-app
```

```bash
pnpm --filter @blitzcraftlabs/atlas build
pnpm distribution:publish-dry-run     # npm pack --dry-run + npm publish --dry-run --access public
pnpm pack                             # from packages/cli into the clean-room artifacts directory
<harness>/node_modules/.bin/atlas init test-app
pnpm install                      # cwd: test-app
pnpm build                        # cwd: test-app
<installed-atlas> doctor --json --cwd test-app
<installed-atlas> generate feature inventory-audit --cwd test-app
<installed-atlas> generate page ops/health --cwd test-app
pnpm typecheck                    # cwd: test-app
<installed-atlas> context --json --cwd test-app
# When the packaged catalog contains previous + current production versions:
# reconstruct previous-release Atlas-owned state from packaged snapshots, then
<installed-atlas> upgrade --to <current> --dry-run --json --cwd test-app   # status must be planned
<installed-atlas> upgrade --to <current> --json --cwd test-app
<installed-atlas> doctor --json --cwd test-app
pnpm typecheck                    # cwd: test-app
pnpm build                        # cwd: test-app
```

`pnpm distribution:publish-dry-run` runs `npm pack --dry-run` and
`npm publish --dry-run --access public` against `packages/cli`. It does not authenticate, create an
npm package, or publish a version. npm may warn that a real publish would require login; that
warning is expected without credentials. The check fails if the package is private, the name or
`publishConfig.access` is wrong, required packed files are missing, runtime `workspace:*`
dependencies leak, or npm exits non-zero / `ENEEDAUTH`.

The verifier sanitizes `NODE_PATH`, source-repo `node_modules/.bin` PATH entries, Atlas CI/dev
environment variables, and cwd-related variables that could point back at this checkout. It invokes
Atlas only via the absolute installed binary path — never `pnpm atlas`,
`pnpm --filter @blitzcraftlabs/atlas`, or `packages/cli/dist/cli.js` for consumer lifecycle
commands.

Keep `packages/cli` pack E2E as the faster artifact/init check. Use `pnpm distribution:verify` when
the generated project's install/build/Doctor/generator lifecycle must be proven self-contained.
After a version exists on npm, `pnpm distribution:verify-registry <version>` repeats that lifecycle
from the registry and must not fall back to a local tarball.

The first npm publication of `@blitzcraftlabs/atlas` was a human-authenticated publish of the
validated `v1.0.1` tarball. Later missing versions of that existing package publish with OIDC via
npm Trusted Publishing on GitHub Actions `release.yml`. Do not republish an existing version, retag
`v1.0.0`, or bootstrap npm with `0.5.0` or `1.0.0`.

The one-time bootstrap procedure for a **new** unpublished package name remains:

```bash
git fetch --tags
git worktree add /tmp/atlas-vX.Y.Z vX.Y.Z
cd /tmp/atlas-vX.Y.Z
pnpm install --frozen-lockfile
pnpm distribution:prepare-publish --require-release-tag
# human: npm publish <printed-tarball> --access public --ignore-scripts
pnpm distribution:verify-registry <version>
```

Temp-directory retention:

- `--keep` or `ATLAS_KEEP_CLEAN_ROOM=1` preserves the directory on success and failure.
- In CI (`CI=true`) without explicit keep, the directory is always removed.
- Locally without explicit keep, failures preserve the directory for debugging and successes remove
  it.

Failures print command, cwd, exit status, stdout, and stderr for the failing stage, then either
`[clean-room] preserved <path>` or `[clean-room] cleaned <path>`.

---

## Global options

| Option            | Description                                            |
| ----------------- | ------------------------------------------------------ |
| `--help`, `-h`    | Show help                                              |
| `--version`, `-v` | Show installed Atlas CLI/platform snapshot version     |
| `--json`          | Emit machine-readable JSON on stdout                   |
| `--cwd <path>`    | Resolve the Atlas repository from a starting directory |
| `--debug`         | Include stack traces for unexpected internal errors    |
| `--dry-run`       | Preview planned actions without writing files          |

---

## Commands (v0.1)

### `atlas init`

Atlas init has two explicit modes.

#### Empty-directory bootstrap — `atlas init <project>`

Create a new Atlas consumer project from the bootstrap assets packaged inside the installed CLI:

```bash
atlas init my-app
cd my-app
pnpm install
pnpm dev
```

`<project>` is resolved relative to the caller cwd (or `--cwd`). Nested relative destinations such
as `nested/my-app` are allowed when every segment is kebab-case. Absolute paths, parent segments,
and symbolic-link destinations are rejected.

The destination must not exist, or must already exist and be empty. Init never merges into a
non-empty directory and never overwrites an already generated project.

Bootstrap copies only manifest-declared packaged files, verifies checksums first, preserves recorded
POSIX modes, and promotes a staging directory into place so a failure does not leave a convincing
half-created project.

Generated-at-init files are written deliberately rather than copied from the Atlas monorepo:

| Path                  | Responsibility                                                                                 |
| --------------------- | ---------------------------------------------------------------------------------------------- |
| `package.json`        | Consumer workspace manifest (`apps/web`, `packages/ui`, `packages/consent`, `packages/config`) |
| `atlas.config.json`   | Project contract + `platform.baseline` checksums using the packaged Atlas version              |
| `README.md`           | Short consumer quickstart                                                                      |
| `jest.config.js`      | Jest projects for the generated workspace (no `apps/reference`)                                |
| `pnpm-lock.yaml`      | Left absent until the consumer runs `pnpm install`                                             |
| `apps/web/.env.local` | Absent by default; `--env copy` copies `.env.example` when present                             |

`--reference` is checkout-init only. The generated project does not include `apps/reference`.

`atlas init` does **not** publish to npm. The public install path is
`pnpm dlx @blitzcraftlabs/atlas`.

#### Checkout init — `atlas init`

Initialize Atlas metadata in an **existing compatible checkout**. This command:

- Validates Node/pnpm prerequisites from root `package.json` `engines`
- Discovers the repository root (walks upward for `atlas.config.json` or structural layout)
- Resolves existing `atlas.config.json` through `@atlas/project` before treating the project as
  initialized
- Validates a proposed contract through `@atlas/project` before writing any files on first init
- Creates `atlas.config.json` when absent (minimal contract with `openApi: false` when OpenAPI
  artifacts are absent)
- Records `platform.baseline` (checkout Atlas version + synced-path checksums) when the
  infrastructure manifest is present — see [upgrades](upgrades.md). When the manifest is present,
  baseline capture is **strict**: init fails rather than writing incomplete or silently absent
  upgrade evidence.
- Never silently overwrites an existing contract
- Plans all actions before writing files

Customization options (`--reference`, `--env`) apply **only during first checkout initialization**.
Re-running `atlas init` on an already initialized valid Atlas project performs no mutations, even
when those flags are supplied.

| Init option   | Values           | Default | Mode          |
| ------------- | ---------------- | ------- | ------------- |
| `--reference` | `keep`, `remove` | `keep`  | Checkout only |
| `--env`       | `skip`, `copy`   | `skip`  | Both          |

`--env copy` copies `apps/web/.env.example` → `apps/web/.env.local` only when `.env.local` is
absent. Atlas never invents secrets or overwrites existing env files.

`--reference remove` deletes canonical reference/example surfaces declared by the contract defaults.
Reference removal requires an explicit flag; the default retains reference content. It is rejected
during empty-directory bootstrap because that starter does not include `apps/reference`.

There is **no** `create-atlas` command. Empty-directory creation is `atlas init <project>`.

### `atlas generate feature <name>`

Generate the minimum Atlas **product feature** structure under `project.features.product` from the
resolved contract. The generator loads architecture through `@atlas/project` — it does not hard-code
`apps/web/src/features`.

| Input            | Rule                                                             |
| ---------------- | ---------------------------------------------------------------- |
| Feature name     | kebab-case domain name (`users`, `billing-history`)              |
| Reserved names   | Rejects names that collide with contract reference/example roots |
| Existing feature | Conflict when `<features.product>/<name>/` already exists        |

**Default files**

| Path                           | Purpose                                             |
| ------------------------------ | --------------------------------------------------- |
| `components/<Name>Feature.tsx` | Route-facing feature composition shell              |
| `index.ts`                     | Public feature boundary exporting the feature shell |

**Optional flags**

| Flag         | Adds                                                                                     |
| ------------ | ---------------------------------------------------------------------------------------- |
| `--query`    | `keys.ts`, `queries.ts`, query hook scaffold with explicit domain-owned fetch seam       |
| `--mutation` | `keys.ts`, `mutations.ts`, mutation hook scaffold with explicit domain-owned create seam |
| `--form`     | `schema.ts`, `components/<Name>Form.tsx` using `@atlas/ui` forms                         |
| `--tests`    | Deterministic query-key test scaffold (`__tests__/keys.test.ts`); requires `--query`     |

Optional flags augment the default feature structure. They do not replace the generated feature
component or public boundary.

Query and mutation scaffolds intentionally do **not** invent URLs, payload types, or CRUD semantics.
Generated network hooks contain explicit domain-owned implementation seams until the product API
contract is known.

When `capabilities.openApi` is `true`, query/mutation scaffolds remain compile-safe explicit seams
and do not fabricate typed OpenAPI client members.

**Examples**

```bash
atlas generate feature users
atlas generate feature billing-history --query --mutation
atlas generate feature account-settings --form --dry-run --json
```

**Not generated:** business logic, navigation wiring, fake CRUD APIs, reference/example modules, or
cross-feature imports.

### `atlas generate page <route>`

Generate a thin App Router page under `<application.root>/src/app/<route>/page.tsx`.

| Input          | Rule                                                                 |
| -------------- | -------------------------------------------------------------------- |
| Route          | Relative App Router fragment (`settings`, `settings/profile`)        |
| Dynamic routes | Identifier-safe segments such as `[id]` and `[userId]` are supported |
| Existing route | May add `page.tsx` when sibling route files already exist            |
| Conflict       | Fails when the intended `page.tsx` already exists (no overwrite)     |

**Examples**

```bash
atlas generate page settings/profile
atlas generate page admin/users --dry-run
```

**Not generated:** layouts, loading/error files, navigation updates, or domain logic inside the
route file.

Both generators:

- Require a valid initialized Atlas project (`atlas.config.json` + `@atlas/project`)
- Plan all files before writing; abort without mutation on conflict
- Support `--dry-run` and `--json` using the shared CLI output model
- Emit repository-relative paths and `followUpActions` for automation

### `atlas generate list`

List supported generators with machine-readable metadata for humans and coding agents.

```bash
atlas generate list
atlas generate list --json
```

JSON output includes generator `id`, `description`, `usage`, `targetOwnership`, `conflictBehavior`,
required/optional arguments, and supported flags. The same inventory is also available via
`atlas context --json` → `commands.generators`.

### `atlas context`

Emit resolved Atlas project state for humans and coding agents. This command composes the project
contract, ownership manifest, generator inventory, Doctor capabilities, upgrade semantics,
validation commands, and documentation references. It does not introduce a separate agent
architecture schema.

```bash
pnpm atlas context
pnpm atlas context --json
```

See [Agent workflow](agents.md) for how coding agents should use this output.

Machine output includes:

| Field                      | Purpose                                                   |
| -------------------------- | --------------------------------------------------------- |
| `contract`                 | Resolved `atlas.config.json` via `@atlas/project`         |
| `ownership`                | Manifest synced/generated/independent path classification |
| `commands.generators`      | Supported structural generators                           |
| `commands.doctor.checkIds` | Registered Doctor checks                                  |
| `commands.upgrade`         | Upgrade command capabilities and dry-run decision source  |
| `validation.recommended`   | Standard engineering validation commands                  |
| `documentation`            | Workflow doc, ADR references, canonical doc links         |

Reports are deterministic: stable `schemaVersion`, sorted paths, no timestamps.

`atlasVersion` is the project's Atlas identity. Generated consumer projects use
`platform.baseline.atlasVersion` from `atlas.config.json` so the application `package.json` version
can stay independent. Source checkouts that still vendor `@blitzcraftlabs/atlas` continue to use the
root package version, including when a historical upgrade baseline is present.

### `atlas doctor`

Diagnose Atlas-specific architecture and configuration drift. Doctor validates the project contract,
workspace structure, architecture boundaries, high-confidence undeclared application dependencies,
generated OpenAPI freshness (when enabled), template infrastructure synchronization (when both
starter and reference applications are present), and Atlas version consistency.

Doctor does **not** replace `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, or security
audits. See [Atlas Doctor](doctor.md).

```bash
pnpm atlas doctor
pnpm atlas doctor --json
pnpm atlas doctor --cwd apps/web
```

Exit `0` for healthy or warning-only reports. Exit `8` when one or more error diagnostics are
present.

### `atlas sync infrastructure`

Synchronize duplicated Atlas template infrastructure from the canonical starter (`apps/web`) into
consumer applications (currently `apps/reference`) according to
`templates/app-infrastructure.manifest.json`.

```bash
pnpm template:check   # atlas sync infrastructure --check
pnpm template:sync    # atlas sync infrastructure
atlas sync infrastructure --dry-run --json
```

Use `--check` in CI to detect drift without copying files. Application-owned paths listed in the
manifest `independentPaths` are allowed to diverge (and may remain byte-identical to the starter).
`--dry-run` reports planned copies without writing files; both `--check` and `--dry-run` exit
non-zero when drift or unresolved structural issues exist. A mutating run re-validates after copies
and exits `0` when repairable drift is cleared. See
[architecture ownership](architecture-ownership.md#duplicated-starterreference-infrastructure).

### `atlas upgrade`

Plan and apply supported Atlas release upgrades using `platform.baseline` checksum evidence and
**package-owned** production release snapshots from the installed `@blitzcraftlabs/atlas` CLI.

```bash
atlas upgrade --to 1.0.0 --dry-run
atlas upgrade --to 1.0.0
atlas upgrade --to 1.0.0 --json
```

`--releases-dir` is an explicit fixture/maintainer override. Normal installed-package usage does not
read a consumer `releases/` tree. Missing packaged evidence fails closed.

The 1.0 support window is the current Atlas release plus the immediately previous supported
production release (adjacent upgrades only). After `1.0.0` that window is `0.5.0` → `1.0.0`.
Repository `releases/0.1.0` and `releases/0.2.0` are rehearsal-only and are not public support.

| Option              | Description                                                                  |
| ------------------- | ---------------------------------------------------------------------------- |
| `--to <version>`    | Target Atlas release version (required)                                      |
| `--dry-run`         | Full planning path without filesystem mutations                              |
| `--json`            | Machine-readable plan and result on stdout                                   |
| `--allow-dirty`     | Allow mutations when the Git worktree has uncommitted changes                |
| `--skip-validation` | Skip post-upgrade `atlas doctor` (fixture/CI only)                           |
| `--releases-dir`    | Explicit fixture/maintainer snapshot directory; not used for normal upgrades |

Blocking conflicts refuse all mutations. `platform.baseline` advances only after a fully successful
apply and `atlas doctor` validation. See [upgrades](upgrades.md) and
[release snapshots](../../releases/README.md).

---

## Exit codes

| Code | Meaning                                                  |
| ---- | -------------------------------------------------------- |
| `0`  | Success                                                  |
| `1`  | Unexpected internal error                                |
| `2`  | Invalid CLI usage                                        |
| `3`  | Atlas project / contract not found                       |
| `4`  | Invalid Atlas contract or project                        |
| `5`  | Bootstrap conflict / incompatible checkout               |
| `6`  | Missing prerequisite (Node, pnpm)                        |
| `7`  | Generator conflict (destination exists)                  |
| `8`  | Doctor found architectural error diagnostics             |
| `9`  | Upgrade blocked (conflicts or dirty worktree)            |
| `10` | Upgrade prerequisite failure (baseline, snapshot, chain) |

---

## Output conventions

| Stream     | Contents                                        |
| ---------- | ----------------------------------------------- |
| **stdout** | Successful command output and `--json` payloads |
| **stderr** | Errors, warnings, diagnostics                   |

`--json` output is valid JSON only — no ANSI color, spinners, or decorative logging mixed into
stdout. Errors use:

```json
{
  "ok": false,
  "command": "init",
  "error": {
    "code": "PROJECT_NOT_FOUND",
    "message": "…"
  }
}
```

Success responses use:

```json
{
  "ok": true,
  "command": "init",
  "result": {}
}
```

---

## Project root discovery

1. Start from `--cwd` when provided, otherwise `process.cwd()`.
2. Walk upward (max 32 levels) for `atlas.config.json`.
3. For `init` only, fall back to structural detection (`package.json` + `apps/web` + `packages/ui`).
4. Stop at filesystem root; never search outside the resolved path chain.
5. Do not silently choose among unrelated contracts — the nearest ancestor wins.

Structural discovery only identifies candidate checkouts. `@atlas/project` validates both existing
and proposed contracts before `init` reports success or performs mutations.

---

## Version source

`atlas --version` reports the **installed `@blitzcraftlabs/atlas` platform snapshot** SemVer from
the CLI package metadata. It works outside an Atlas project and does not depend on the current
working directory.

During **checkout** `atlas init`, the CLI reports the **checkout/source snapshot** version from the
target repository root `package.json`. During **bootstrap** `atlas init <project>`, the recorded
Atlas version is the packaged bootstrap/`@blitzcraftlabs/atlas` version — not a checkout that did
not exist yet. Those identities are independent of contract `schemaVersion`.

Machine-readable `--json` output may include:

```json
{
  "atlasVersion": "0.1.0",
  "contractSchemaVersion": 1,
  "cliPackage": "@blitzcraftlabs/atlas"
}
```

---

## Current CLI commands

| Command                | Capability                                             | Status in v0.1 |
| ---------------------- | ------------------------------------------------------ | -------------- |
| `atlas init <project>` | Empty-directory bootstrap from packaged assets         | Implemented    |
| `atlas init`           | Initialize metadata in an existing compatible checkout | Implemented    |
| `atlas generate …`     | Feature + page shells                                  | Implemented    |
| `atlas doctor`         | Diagnostics                                            | Implemented    |
| `atlas upgrade`        | Planning, dry-run, apply, JSON output                  | Implemented    |
| Upgrade contract       | Baseline + rehearsal; see [upgrades](upgrades.md)      | Implemented    |

The CLI exposes explicit command registration, shared context loading, exit codes, and output
conventions so additional commands can be added without redesigning the foundation.

---

## Related docs

- [Atlas project contract](atlas-contract.md)
- [Atlas Doctor](doctor.md)
- [Architecture ownership](architecture-ownership.md)
- [AGENTS.md](../../AGENTS.md)
