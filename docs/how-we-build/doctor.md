# Atlas Doctor

> **Atlas-specific architecture and configuration drift diagnostics.**

`atlas doctor` answers whether a checkout is still structurally a healthy Atlas project and, when it
is not, reports deterministic drift with remediation guidance.

Doctor is **not** a replacement for lint, typecheck, tests, build, or security tooling.

See also: [Atlas CLI](cli.md), [Atlas project contract](atlas-contract.md),
[Agent workflow](agents.md), [Architecture ownership](architecture-ownership.md).

---

## Responsibility boundary

| Tool             | Owns                                                             |
| ---------------- | ---------------------------------------------------------------- |
| `atlas doctor`   | Atlas contract validity, workspace structure, architecture drift |
| `pnpm lint`      | Source-level ESLint policy, including architecture enforcement   |
| `pnpm typecheck` | TypeScript correctness                                           |
| `pnpm test`      | Runtime behavior and regressions                                 |
| `pnpm build`     | Framework/bundling correctness                                   |
| Security tooling | Vulnerabilities, secrets, and security policy                    |

Doctor delegates architecture-boundary enforcement to the same ESLint policy used by `@atlas/web`
and translates tagged findings into stable Atlas diagnostics.

---

## Usage

```bash
pnpm --filter @blitzcraftlabs/atlas build
pnpm atlas doctor
pnpm atlas doctor --json
pnpm atlas doctor --cwd apps/web
```

---

## Report schema (v0.1)

Machine output uses the shared CLI JSON envelope:

```json
{
  "ok": true,
  "command": "doctor",
  "result": {
    "schemaVersion": 1,
    "status": "healthy",
    "atlasVersion": "0.1.0",
    "projectRoot": ".",
    "summary": {
      "checksPassed": 6,
      "checksWarned": 0,
      "checksFailed": 0,
      "checksSkipped": 0,
      "diagnosticWarnings": 0,
      "diagnosticErrors": 0
    },
    "checks": [],
    "diagnostics": []
  }
}
```

Top-level report status:

| Status    | Meaning                       |
| --------- | ----------------------------- |
| `healthy` | No error diagnostics          |
| `warning` | Warning diagnostics only      |
| `failed`  | One or more error diagnostics |

Check status vocabulary: `pass`, `warn`, `fail`, `skip`.

Diagnostic severity vocabulary: `warning`, `error`.

Paths are repository-relative POSIX paths. `projectRoot` is always `"."` and refers to the Atlas
repository root regardless of invocation cwd. Reports are deterministic: no timestamps, absolute
machine paths, or random values.

Summary counters use explicit units:

| Field                | Meaning                                |
| -------------------- | -------------------------------------- |
| `checksPassed`       | Number of checks with status `pass`    |
| `checksWarned`       | Number of checks with status `warn`    |
| `checksFailed`       | Number of checks with status `fail`    |
| `checksSkipped`      | Number of checks with status `skip`    |
| `diagnosticWarnings` | Number of warning-severity diagnostics |
| `diagnosticErrors`   | Number of error-severity diagnostics   |

Top-level report status derives from check failures and diagnostic severity. A failed required check
never produces a healthy report.

---

## Exit policy

| Exit code | Meaning                                                    |
| --------- | ---------------------------------------------------------- |
| `0`       | Healthy, or warnings only                                  |
| `8`       | Doctor completed and found architectural error diagnostics |

Usage errors, project discovery failures, and unexpected internal failures continue to use the
existing CLI exit-code contract (`2`, `3`, `1`, etc.).

Warnings do **not** fail CI in v0.1.

---

## Initial check registry

| Check ID                       | Owns / delegates                                          | Possible diagnostics                                                                     | Failure policy        |
| ------------------------------ | --------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------- |
| `project-contract`             | `@atlas/project`                                          | `ATLAS_CONTRACT_*`                                                                       | error                 |
| `workspace-structure`          | Doctor + manifests                                        | `ATLAS_WORKSPACE_*`                                                                      | error                 |
| `architecture-boundaries`      | ESLint policy + Doctor ownership scan                     | `ATLAS_BOUNDARY_*`, `ATLAS_ARCHITECTURE_POLICY_*`, `ATLAS_DOCTOR_CHECK_EXECUTION_FAILED` | error                 |
| `dependency-declarations`      | Doctor (configured application only)                      | `ATLAS_DEPENDENCY_UNDECLARED`                                                            | error                 |
| `generated-openapi`            | openapi-typescript compare (read-only)                    | `ATLAS_GENERATED_OPENAPI_*`                                                              | error / skip          |
| `template-infrastructure-sync` | Manifest compare (read-only)                              | `ATLAS_TEMPLATE_SYNC_*`                                                                  | error / skip          |
| `upgrade-baseline`             | Contract `platform.baseline` metadata                     | `ATLAS_UPGRADE_BASELINE_*`                                                               | warning / fail / skip |
| `atlas-version`                | CLI vs checkout version metadata                          | `ATLAS_VERSION_MISMATCH`, `ATLAS_ROOT_PACKAGE_METADATA_INVALID`                          | warning / error       |
| `manifest-alignment`           | Installed release snapshot vs Atlas-owned manifest fields | `ATLAS_MANIFEST_ALIGNMENT_DRIFT`, `ATLAS_MANIFEST_ALIGNMENT_EVIDENCE_INVALID`            | error / skip          |

---

## Diagnostic codes

| Code                                           | Severity | Suggested remediation                                                  |
| ---------------------------------------------- | -------- | ---------------------------------------------------------------------- |
| `ATLAS_CONTRACT_MISSING`                       | error    | Create `atlas.config.json` or run `atlas init`                         |
| `ATLAS_CONTRACT_INVALID`                       | error    | Fix contract validation/structure via `@atlas/project`                 |
| `ATLAS_CONTRACT_UNSUPPORTED`                   | error    | Use a supported contract `schemaVersion`                               |
| `ATLAS_BOUNDARY_PRIVATE_IMPORT`                | error    | Import from public package entry points such as `@atlas/ui`            |
| `ATLAS_BOUNDARY_DIRECT_ENV`                    | error    | Use `getServerConfig()` / `useConfig()`                                |
| `ATLAS_BOUNDARY_RAW_NETWORK`                   | error    | Use `@/lib/api` instead of raw `fetch()`                               |
| `ATLAS_BOUNDARY_REFERENCE_IMPORT`              | error    | Do not import reference/example modules from product features          |
| `ATLAS_BOUNDARY_CROSS_FEATURE_IMPORT`          | error    | Extract shared logic to `src/lib/`                                     |
| `ATLAS_BOUNDARY_ANALYTICS_VENDOR`              | error    | Use `@/lib/analytics` adapter                                          |
| `ATLAS_ARCHITECTURE_POLICY_MISSING`            | error    | Restore application ESLint config and architecture policy files        |
| `ATLAS_ARCHITECTURE_POLICY_UNSUPPORTED_ROOT`   | error    | Move product features under `<application.root>/src` or extend tooling |
| `ATLAS_DEPENDENCY_UNDECLARED`                  | error    | Declare imported packages in the owning workspace `package.json`       |
| `ATLAS_GENERATED_OPENAPI_STALE`                | error    | Run `pnpm api:gen` and commit both generated schemas                   |
| `ATLAS_GENERATED_OPENAPI_INVALID`              | error    | Fix the OpenAPI source or generator error, then rerun Doctor           |
| `ATLAS_TEMPLATE_SYNC_DRIFT`                    | error    | Run `pnpm template:sync` or document divergence in the manifest        |
| `ATLAS_TEMPLATE_SYNC_CANONICAL_MISSING`        | error    | Restore missing canonical starter path or update manifest syncedPaths  |
| `ATLAS_TEMPLATE_SYNC_STRUCTURE`                | error    | Restore required module or update manifest ownership entries           |
| `ATLAS_TEMPLATE_SYNC_MANIFEST_INVALID`         | error    | Fix `templates/app-infrastructure.manifest.json`                       |
| `ATLAS_UPGRADE_BASELINE_MISSING`               | warning  | Record `platform.baseline` via `atlas init` or upgrade helpers         |
| `ATLAS_UPGRADE_BASELINE_STALE`                 | warning  | Complete supported upgrade and refresh baseline metadata               |
| `ATLAS_UPGRADE_BASELINE_INCOMPLETE`            | error    | Re-capture baseline after restoring all manifest syncedPaths           |
| `ATLAS_UPGRADE_BASELINE_CHECKSUM_INVALID`      | error    | Fix malformed checksum values or re-run baseline capture               |
| `ATLAS_UPGRADE_BASELINE_MANIFEST_INCOMPATIBLE` | warning  | Refresh baseline after manifest schema migration                       |
| `ATLAS_UPGRADE_BASELINE_STALE_ENTRY`           | warning  | Remove stale baseline entries or re-capture after manifest changes     |
| `ATLAS_VERSION_MISMATCH`                       | warning  | Align CLI/checkout Atlas snapshot versions                             |
| `ATLAS_ROOT_PACKAGE_METADATA_INVALID`          | error    | Restore valid root `package.json` version metadata                     |
| `ATLAS_WORKSPACE_CONFIG_MISSING`               | error    | Restore `pnpm-workspace.yaml` with configured workspace roots          |
| `ATLAS_WORKSPACE_PACKAGE_MANIFEST_MISSING`     | error    | Add missing workspace `package.json`                                   |
| `ATLAS_WORKSPACE_NOT_INCLUDED`                 | error    | Include configured roots in `pnpm-workspace.yaml`                      |
| `ATLAS_DOCTOR_CHECK_EXECUTION_FAILED`          | error    | Inspect tooling/config errors or report an Atlas CLI defect            |
| `ATLAS_MANIFEST_ALIGNMENT_DRIFT`               | error    | Run `pnpm atlas upgrade` so Atlas-owned manifest fields match baseline |
| `ATLAS_MANIFEST_ALIGNMENT_EVIDENCE_INVALID`    | error    | Reinstall the Atlas CLI so local release evidence can be read          |

Only implemented codes are emitted.

---

## Product feature root support

Atlas Doctor applies the product feature architecture policy to configured feature roots under
`<application.root>/src`. Custom roots such as `apps/web/src/domains` receive the same effective
feature-layer enforcement as the default `apps/web/src/features` root: import restrictions,
reference/examples ownership boundaries, direct `process.env` prohibition, and raw `fetch`
prohibition.

Product feature roots outside the application source tree are not currently supported by the web
architecture-policy evaluator. Doctor emits `ATLAS_ARCHITECTURE_POLICY_UNSUPPORTED_ROOT` and fails
the `architecture-boundaries` check. This is an architecture-policy capability diagnostic — it does
not mean `@atlas/project` rejects the configured path.

Custom roots are linted with the application's real ESLint configuration and TypeScript parser
setup, with a runtime product-feature policy override for the configured root. Fatal ESLint parser
or configuration execution failures fail the `architecture-boundaries` check with
`ATLAS_DOCTOR_CHECK_EXECUTION_FAILED` instead of being ignored.

---

## Deferred scope

| Topic                                        | Doctor behavior                                                                                                                                                 |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dependency normalization / version alignment | Doctor checks Atlas-owned manifest fields against the installed release snapshot. It does not normalize consumer-owned dependencies or undeclared import ranges |
| Migrations                                   | Doctor may emit version drift warnings but does not mutate metadata or run migrations                                                                           |

---

## CI usage

```bash
pnpm --filter @blitzcraftlabs/atlas build
pnpm atlas doctor --json
```

Error diagnostics fail the step. Warnings remain non-fatal in v0.1.

---

## Coding agent workflow

Coding agents should run Doctor rather than duplicating architecture checks in prompts:

```bash
pnpm atlas doctor --json
```

Classify diagnostics before auto-fixing:

| Class              | Example                                          | Agent behavior                              |
| ------------------ | ------------------------------------------------ | ------------------------------------------- |
| Mechanical         | `ATLAS_GENERATED_OPENAPI_STALE`                  | Run `pnpm api:gen`; rerun Doctor            |
| Ownership conflict | Boundary or template sync error on consumer path | Do not overwrite; inspect contract/manifest |
| Consumer decision  | Independent wiring differs from baseline         | Do not normalize automatically              |
| Ambiguous          | Unclear ownership                                | Stop and ask                                |

Full workflow: [Agent workflow](agents.md). Machine context inventory: `pnpm atlas context --json`.

---

## Related docs

- [Agent workflow](agents.md)
- [Atlas CLI](cli.md)
- [Atlas project contract](atlas-contract.md)
- [Architecture ownership](architecture-ownership.md)
- [API & data fetching](api.md)
