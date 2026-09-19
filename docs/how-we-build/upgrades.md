# Atlas Upgrades and Downstream Fix Propagation

> **How Atlas delivers platform improvements to forked consumers without overwriting product work.**

This document defines the v0.1 upgrade contract. It builds directly on
[architecture ownership](architecture-ownership.md) and
[ADR-0009 starter/reference template sync](../adr/0009-starter-reference-template-sync.md).
Executable migration commands belong to [`atlas upgrade`](cli.md) and
[ADR-0010](../adr/0010-atlas-upgrades-downstream-propagation.md).

See also: [releases and governance](releases-and-governance.md),
[Atlas project contract](atlas-contract.md), [Atlas Doctor](doctor.md), [Agent workflow](agents.md),
[ADR-0010](../adr/0010-atlas-upgrades-downstream-propagation.md).

---

## Mental model

```text
Atlas gives you source
      ↓
you own the product
      ↓
Atlas records enough about the baseline (platform.baseline)
      ↓
future Atlas releases propose safe changes per ownership channel
      ↓
your changes always win unless you explicitly merge Atlas changes
```

Atlas optimizes for **predictability and preservation**, not zero human involvement.

---

## Ownership / update matrix

Paths use the starter application (`apps/web`) unless noted. “Consumer customization” describes
typical fork behavior — not requirements.

| Surface                                            | Ownership category               | Current update channel                                    | Downstream customization expectation               | Future upgrade mechanism                               |
| -------------------------------------------------- | -------------------------------- | --------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------ |
| `@atlas/ui`                                        | Versioned package                | Workspace version bump + changelog                        | Theme/composition in app code; not primitive forks | Package upgrade in monorepo/snapshot                   |
| `@atlas/consent`                                   | Versioned package                | Workspace version bump                                    | Enable/disable via app config                      | Package upgrade                                        |
| `@atlas/config`                                    | Versioned package                | Workspace version bump                                    | Rare; ESLint/TS extends                            | Package upgrade                                        |
| `@atlas/project`                                   | Versioned package                | Workspace version bump                                    | `atlas.config.json` author fields                  | Package upgrade + contract migration (`atlas upgrade`) |
| `@blitzcraftlabs/atlas`                            | Versioned package                | Workspace link / future snapshot                          | None in consumer apps                              | Install matching CLI snapshot                          |
| CLI generators                                     | Structural contract              | `atlas generate …`                                        | Generated files become consumer-owned              | Regenerate/add; no silent overwrite (`atlas upgrade`)  |
| Doctor                                             | Versioned package + conventions  | `atlas doctor`                                            | None                                               | New diagnostics via CLI upgrade                        |
| `atlas.config.json`                                | Structural contract              | Author + `atlas init`                                     | Feature roots, capabilities                        | Contract migration (`atlas upgrade`)                   |
| `platform.baseline`                                | Structural contract              | `atlas init` / future upgrade (`atlas upgrade`)           | Updated after successful upgrade                   | Checksum refresh (`atlas upgrade`)                     |
| OpenAPI `openapi.json`                             | Consumer-owned (typical)         | Author maintains spec                                     | Replace with product API                           | Manual merge; triggers regeneration                    |
| `lib/api/contracts/schema.ts`                      | Generated artifact               | `pnpm api:gen`, `pnpm api:check`                          | Never hand-edit                                    | Regenerate per app                                     |
| `lib/api/contracts/index.ts`                       | Atlas-managed template           | Manifest `syncedPaths`                                    | Rare customization                                 | Baseline checksum replace                              |
| Manifest `syncedPaths` (`lib/api`, auth, RQ, etc.) | Atlas-managed template           | Canonical starter + `atlas sync infrastructure`           | Possible but discouraged                           | Baseline checksum replace                              |
| Manifest `independentPaths`                        | Consumer-owned wiring            | Per-app edit                                              | Expected (authz, breadcrumbs, analytics glue)      | Manual review only                                     |
| Manifest `generatedPaths`                          | Generated artifact               | `pnpm api:gen`                                            | Never hand-edit                                    | Regenerate                                             |
| Manifest `referenceOnlyPaths`                      | Reference-only                   | `apps/reference` only                                     | N/A in starter-only forks                          | Optional delete                                        |
| Manifest `starterOnlyPaths`                        | Starter-only                     | `apps/web`                                                | Delete when building product                       | Optional delete                                        |
| Auth session core (`lib/auth/session.ts`)          | Atlas-managed template           | Synced path                                               | **High-risk customization**                        | Merge-required if customized                           |
| Google OAuth routes/providers                      | Starter reference                | Synced + examples                                         | Replace with consumer IdP                          | Manual replacement                                     |
| Authorization core (`lib/authz/**`)                | Atlas-managed template           | Synced path                                               | Policy composition in `lib/application/authz.ts`   | Checksum replace + manual wiring review                |
| React Query infrastructure                         | Atlas-managed template           | Synced path                                               | Extend via feature hooks                           | Checksum replace                                       |
| Feature flags                                      | Atlas-managed template           | Synced path                                               | Define keys in `flags.ts`                          | Checksum replace + key review                          |
| Analytics adapters                                 | Reference integration + template | Synced adapters; app `lib/analytics/index.ts` independent | Vendor choice                                      | Package/template paths                                 |
| Telemetry / Sentry                                 | Atlas-managed template           | Synced + root Sentry configs                              | DSN via config only                                | Checksum replace                                       |
| Security helpers (`lib/security/**`)               | Atlas-managed template           | Synced path                                               | Rare; high scrutiny                                | Security-critical checksum replace                     |
| Config facade (`src/config/**`)                    | Mixed                            | Synced client/index; schema/server often independent      | Env fields per product                             | Partial manual                                         |
| Providers                                          | App-owned composition            | Manifest synced stack; wiring varies                      | Expected                                           | Manual composition review                              |
| `src/features/*` (non-examples)                    | Consumer-owned source            | Product development                                       | Full ownership                                     | Never auto-touch                                       |
| `src/app/*` (non-examples)                         | Consumer-owned source            | Route composition                                         | Full ownership                                     | Never auto-touch                                       |
| `src/components/*` (product)                       | Consumer-owned source            | App compositions                                          | Full ownership                                     | Never auto-touch                                       |
| CI workflows (`.github/**`)                        | Documentation/procedure          | Copy from Atlas release notes                             | Consumer pipelines                                 | Manual merge                                           |
| ESLint / architecture policy                       | Structural contract              | Per-app `eslint.config.mjs`                               | Policy tuning                                      | Doctor + manual                                        |
| Storybook (`@atlas/ui`)                            | Versioned package + docs         | Package scripts                                           | Visual overrides in app                            | Package upgrade                                        |
| Testing infrastructure                             | Structural contract              | `@atlas/config`, app test utils                           | Consumer tests                                     | Manual merge                                           |
| Docs / conventions                                 | Documentation/procedure          | Follow when building                                      | N/A                                                | Read upgrade guide                                     |
| `apps/reference/**`                                | Reference-only                   | Optional workspace                                        | Delete or keep independently                       | Out of starter upgrade scope                           |
| `/examples` starter routes                         | Starter reference                | Optional                                                  | Delete with examples                               | Out of scope                                           |
| Deployment / Vercel                                | Consumer-owned                   | Platform docs                                             | Full ownership                                     | Manual                                                 |

### Classification legend

| #   | Channel                 | Automatic?     | Conflicts possible? | Versioning            | Migration tooling                 | Manual review       |
| --- | ----------------------- | -------------- | ------------------- | --------------------- | --------------------------------- | ------------------- |
| 1   | Versioned package       | Partial (bump) | API breaks          | Yes (monorepo SemVer) | `atlas upgrade` for breaking APIs | On major changes    |
| 2   | Generated artifact      | Yes (regen)    | If spec customized  | No (regen from spec)  | Regen command                     | If spec conflict    |
| 3   | Atlas-managed template  | Conditional    | **Yes**             | Baseline checksums    | `atlas upgrade` planner           | On conflict         |
| 4   | Consumer-owned source   | No             | No                  | N/A                   | No                                | Always consumer     |
| 5   | Structural contract     | No             | Schema breaks       | Contract schema       | `atlas upgrade`                   | On breaking changes |
| 6   | Migration-managed       | No             | Yes                 | Migration id          | `atlas upgrade`                   | Yes                 |
| 7   | Documentation/procedure | No             | N/A                 | N/A                   | Guides                            | Yes                 |
| 8   | Reference-only          | No             | N/A                 | N/A                   | Optional remove                   | Optional            |

---

## Lifecycle contract

### At bootstrap (`atlas init`)

| Question                       | Answer (v0.1)                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------------- |
| What version is recorded?      | Root `@atlas/monorepo` SemVer → `platform.baseline.atlasVersion`                                        |
| Where stored?                  | `atlas.config.json` → `platform.baseline`                                                               |
| CLI vs template vs contract?   | **Atlas release** is primary; contract `schemaVersion` and manifest `schemaVersion` recorded separately |
| Enough metadata?               | Yes — version triple + per-synced-path checksums                                                        |
| Strict when manifest present?  | Yes — missing synced paths or invalid manifest/version setup fail init rather than omitting baseline    |
| Atlas-managed after bootstrap? | Manifest `syncedPaths`, generated paths, workspace packages                                             |
| Immediately consumer-owned?    | Product features, routes, shell, env, deployment, independent paths                                     |

### During normal development

| Question                                  | Answer                                                                      |
| ----------------------------------------- | --------------------------------------------------------------------------- |
| Can consumers edit synced template files? | **Yes** — source-owned platform                                             |
| Effect on upgrades?                       | Checksum diverges from baseline → future replace becomes **merge-required** |
| Ownership transition?                     | **No silent transition** — manifest classifies; checksums detect edits      |
| Three-way merge?                          | Manual until `atlas upgrade` provides release snapshots                     |
| Silent overwrites?                        | **Forbidden** for synced paths when checksum differs                        |

### During upgrade (by channel)

| Channel                                | Operation                                                 |
| -------------------------------------- | --------------------------------------------------------- |
| Versioned package                      | Bump workspace/package versions; read changelog           |
| Generated artifact                     | Update spec if needed → `pnpm api:gen` → `pnpm api:check` |
| Unchanged synced file (checksum match) | Replace from target Atlas snapshot                        |
| Consumer-modified synced file          | **Conflict** — manual merge                               |
| Independent / consumer-owned           | Never overwrite; optional review notes                    |
| Structural convention                  | Doctor + migration docs                                   |
| Breaking architecture                  | Migration guide + `atlas upgrade` codemod                 |
| Documentation only                     | Read `docs/migrations/` + changelog                       |

---

## Baseline / version strategy

```text
consumer current baseline (platform.baseline + manifest policy)
+
target Atlas release (snapshot / tag / merged main)
=
upgrade plan (patch-safe | merge-required | migration-required | manual)
```

**Determine consumer baseline:**

1. Read `platform.baseline.atlasVersion`
2. Load `syncedPathChecksums` for modification detection
3. Consult manifest for independent/generated/reference classifications

**Determine required work:**

1. Diff target Atlas synced paths against baseline-era content (planner; `atlas upgrade` automates)
2. Classify each item using checksum + ownership channel
3. Validate with `atlas doctor`, `pnpm api:check`, `pnpm template:check`, tests, build

---

## Conflict policy

1. **Record** checksums at bootstrap / post-upgrade (`atlas upgrade`). Capture must be **strict** —
   missing manifest synced paths fail baseline recording rather than producing incomplete evidence.
2. **Before any synced-path write**, compare consumer checksum to baseline checksum.
3. **Equal** (proven unchanged) → consumer has not edited since baseline → safe replace allowed.
4. **Unequal** (proven modified) → `merge-required` → emit deterministic conflict; do not write.
5. **Missing/invalid baseline checksum or missing consumer file** → `unknown` evidence → manual
   review; do not write.
6. **Independent paths** → never auto-written regardless of checksum.
7. **Product paths** → out of scope for template upgrade planner.

Internal planner: `packages/cli/src/upgrade/plan.ts` (test-only in v0.1). Security-relevant path
detection in the planner is a **rehearsal heuristic**; canonical security classification belongs to
advisory metadata. `atlas upgrade` must not treat the heuristic as policy.

---

## Security propagation

Aligns with [security engineering](security.md) (advisories). The upgrade contract defines local
contracts only.

| Step                      | Behavior                                                            |
| ------------------------- | ------------------------------------------------------------------- |
| Affected versions         | Future advisories map to Atlas SemVer ranges                        |
| Detection                 | Compare `platform.baseline.atlasVersion`; Doctor baseline warnings  |
| Package fixes             | Bump `@atlas/*` workspace versions                                  |
| Template fixes            | Patch-safe replace on untouched synced security paths               |
| Customized security files | `merge-required` + security-critical — operator must merge urgently |
| Urgency                   | Security fixes may ship outside normal deprecation windows          |
| Advisory backend          | **Not in the upgrade contract** — see [security.md](security.md)    |

---

## Downstream → upstream

| Step             | Action                                                                             |
| ---------------- | ---------------------------------------------------------------------------------- |
| 1. Classify      | Use ownership matrix — is the bug in package, synced template, generator, or docs? |
| 2. Reproduce     | Minimal repro in `apps/web` and/or `apps/reference`                                |
| 3. Fix canonical | Apply fix to package or starter synced path — not client fork                      |
| 4. Test          | Regression in owning package/app/CLI tests                                         |
| 5. Release       | New Atlas snapshot + changelog/migration notes                                     |
| 6. Propagate     | Consumers upgrade via this contract                                                |

Use the [downstream fix intake template](../governance/downstream-fix-intake.md) when filing
upstream work from a consumer discovery.

Cherry-picking client commits is **not** the supported model.

---

## Upgrade rehearsal

### Synthetic fixture

Fixture: `packages/cli/src/__tests__/fixtures/upgrade-rehearsal/`

Test suite: `packages/cli/src/__tests__/upgrade-rehearsal.test.ts`

Simulated consumer at Atlas `0.1.0`:

- Unchanged `lib/api/errors.ts` → receives `0.2.0` fix automatically (test apply helper)
- Customized `lib/auth/session.ts` → conflict; consumer content preserved
- Generated `schema.ts` → regenerate action
- Independent `lib/application/authz.ts` → manual review
- Product `features/billing` → untouched

### Historical upgrade rehearsal findings

Materialized fixtures: `packages/cli/src/__tests__/fixtures/upgrade-rehearsal/historical/`

Test suite: `packages/cli/src/__tests__/upgrade-historical-rehearsal.test.ts`

| Field         | Value                                                                                                                                                                         |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source commit | `8ce8fa39fd5c3ec497d7319e2f8ed046ddbfbaa4`                                                                                                                                    |
| Source date   | 2026-08-21 (reference harness era)                                                                                                                                            |
| Target commit | `34400006d93f0e3d86de4f4e4cc5ec4b3cc62524` (v0.1 upgrade contract)                                                                                                            |
| Why chosen    | Predates the reference app split, UI foundation reset, template manifest, and baseline metadata — enough real infrastructure drift without being the immediately prior commit |

**Files rehearsed (manifest subset):**

| Path                              | Role in rehearsal                                                                                              |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `src/lib/api/hooks.ts`            | Unmodified synced path; Atlas added `useTypedApiClient()` → **patch-safe replace**                             |
| `src/lib/api/config.ts`           | Unmodified synced path; documentation/comments evolved → **patch-safe replace**                                |
| `src/lib/auth/useSession.ts`      | Consumer customized session hook docs/behavior; Atlas added `principalId` / `permissions` → **merge-required** |
| `src/lib/api/contracts/schema.ts` | Generated artifact; OpenAPI **unchanged** between snapshots → **skip** (no regen)                              |
| `src/lib/application/authz.ts`    | Independent wiring introduced after source baseline → **manual review**                                        |
| `src/features/billing/index.tsx`  | Product-owned feature added by consumer → **never in plan**                                                    |

**What the historical rehearsal taught (beyond the synthetic fixture):**

1. **Real file size and import graphs matter** — rehearsing on actual `hooks.ts` / `useSession.ts`
   surfaces merge complexity that miniature strings hide (client hook composition, session state
   shape).
2. **New independent paths need explicit planner handling** — `lib/application/authz.ts` did not
   exist at the source snapshot; the planner now emits manual review when Atlas introduces
   independent wiring rather than silently skipping.
3. **OpenAPI stability is not guaranteed every release** — this window had no spec drift, so
   regenerate actions did not fire; `atlas upgrade` must still treat spec changes as the primary
   regen trigger.
4. **Fail-closed baseline is essential on real trees** — a partial baseline on a 100+ path manifest
   would have looked “valid” while permitting unsafe replaces; completeness validation and
   missing-checksum `unknown` status are required in production tooling.
5. **Security classification remains heuristic in the upgrade contract** — `session.ts` security
   relevance is still path-substring based in the internal planner; canonical classification belongs
   to advisory metadata (`atlas upgrade` should not hardcode path lists as policy).

**Manual work still required in this upgrade window:**

- Merge Atlas `useSession` permission/principal fields with consumer billing-portal session
  customization.
- Review newly introduced `lib/application/authz.ts` wiring pattern before adopting Atlas
  composition changes.
- Run full validation (`atlas doctor`, `pnpm api:check`, `pnpm template:check`, tests) after any
  manual merges.

**Implications for `atlas upgrade`:**

- Planner must treat **new independent paths** as manual-review items.
- Release snapshots must include **source-era content** for paths added after consumer baseline (not
  only current manifest paths).
- Baseline capture must remain **strict** on canonical checkouts; incomplete baselines must block
  automated replace paths.
- Do not assume every upgrade triggers OpenAPI regeneration — gate regen on spec diff.

---

## Supported upgrade promise (1.0)

The first npm-distributed Atlas CLI (`@blitzcraftlabs/atlas@1.0.1`, published from canonical
`v1.0.1`) supports:

| Promise               | Detail                                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------- |
| **We support**        | Adjacent upgrades between the current Atlas release and the immediately previous supported production release |
| **We support**        | Deterministic conflict detection for synced template infrastructure                                           |
| **We support**        | Regeneration for generated artifacts                                                                          |
| **We do not support** | Unlimited historical upgrades, including rehearsal snapshots `0.1.0` / `0.2.0`                                |
| **We do not support** | Silent overwrite of consumer-modified synced files                                                            |
| **We do not support** | Perpetual automatic upgrades with zero review                                                                 |
| Pre-1.0 proving line  | Breaking changes were allowed with changelog + migration docs; they are historical                            |
| 1.0 public contract   | Breaking public CLI/project/upgrade/distribution contracts require a major version                            |
| Migration retention   | Best-effort; at least one minor release deprecation notice when practicable                                   |

Release evidence is **package-owned**. `atlas upgrade --to <version>` loads snapshots from the
installed `@blitzcraftlabs/atlas` package catalog. `--releases-dir` is an explicit
fixture/maintainer override. Generated consumers do not carry an Atlas `releases/` tree. Missing or
corrupt packaged evidence fails closed.

The canonical `v0.5.0` tag is the previous production baseline for the first public npm CLI. GitHub
`v1.0.0` is the first stable platform release. The first npm registry version is `1.0.1`. Do not
publish `0.5.0` or `1.0.0` to npm, and do not retag `v1.0.0`.

---

## `atlas upgrade` requirements checklist

Discovered during upgrade rehearsal — `atlas upgrade` implements:

- [x] `atlas upgrade` command with `--dry-run` and `--json`
- [x] Detect consumer modifications via `platform.baseline.syncedPathChecksums` before overwrite
- [x] Fail closed when baseline checksum evidence is missing or incomplete (never treat absence as
      safe)
- [x] Preserve consumer-owned and independent paths
- [x] Emit manual review when Atlas introduces new independent wiring paths absent from source
      snapshot
- [x] Regenerate generated surfaces (`pnpm api:gen`) when generator inputs changed — not on every
      upgrade
- [x] Represent conflicts explicitly (`merge-required` items)
- [x] Support stepping through migration chain for non-adjacent versions
- [x] Refresh `platform.baseline` after successful upgrade
- [x] Load release snapshot artifacts for planning (source + target era content)
- [x] Package upgrade planning for workspace `@atlas/*` versions
- [x] Security-critical metadata support via planner categories (canonical advisories remain in
      [security.md](security.md))
- [x] Final validation hook (`atlas doctor`) in upgrade workflow
- [x] Contract schema migrations flagged as `migration-required` (automatic chain when registered)
- [x] Executable migrations with registered IDs (production registry; fixture evidence in CLI tests)
- [x] Source-release baseline validation (target-only path additions do not invalidate baseline)
- [x] Explicit synced-path transitions (new / removed / ownership change)
- [x] Advance root `package.json` version with `platform.baseline.atlasVersion` on success
- [x] Machine-readable upgrade plan output for agents/CI

Registered production migrations are documented under `docs/migrations/`. When no structural
migration is required for a release pair, the production registry remains empty and template sync
handles the upgrade.

**Partial / deferred within `atlas upgrade`:**

- Full three-way merge engine (merge-required + conflict context only)
- Cross-published-version clean-room proof (`0.4.0 → 0.5.0`) remains deferred only while the
  packaged catalog contains a single production version. Once a second production snapshot exists,
  `pnpm distribution:verify` reconstructs previous-release Atlas-owned state from packaged snapshots
  and requires a planned, applied, and validated installed upgrade.

**Expert flag:** `--skip-validation` skips post-upgrade `atlas doctor` only. It never skips
migration completion checks, required package update checks, strict target baseline capture, or
release identity consistency. Use for fixture/CI isolation only.

**Release identity:** After a successful upgrade, root `package.json` `version` and
`platform.baseline.atlasVersion` advance together so Doctor's upgrade-baseline check stays coherent.

**Explicitly not `atlas upgrade`:** public advisory feed, npm publication.

---

## Scenario validation

| Scenario                        | Expected outcome                                           |
| ------------------------------- | ---------------------------------------------------------- |
| A — untouched consumer          | Mostly patch-safe replaces + regen + package bumps         |
| B — heavy product customization | Infrastructure still upgrades; product untouched           |
| C — customized auth             | Merge-required on auth synced paths; no silent fix         |
| D — security vulnerability      | Affected baseline identifiable; untouched paths patch-safe |
| E — long-lived client           | Migration chain or clear unsupported/manual report         |
| F — consumer fixed Atlas bug    | Fix lands in canonical Atlas with regression test          |

---

## Related docs

- [architecture-ownership.md](architecture-ownership.md)
- [atlas-contract.md](atlas-contract.md) — `platform.baseline` field
- [cli.md](cli.md) — init records baseline
- [doctor.md](doctor.md) — `upgrade-baseline` check
- [releases-and-governance.md](releases-and-governance.md)
- [migrations/README.md](../migrations/README.md)
