# Atlas Project Contract

> **Machine-readable architecture identity for Atlas tooling, agents, and automation.**

Human docs explain _why_ Atlas is shaped the way it is. The Atlas project contract states _what_
machine-relevant architecture this repository uses so CLI, generators, Doctor, and coding agents can
reason about the project without executing application code or inferring structure from scattered
config files.

For ownership semantics and consumer guidance, see
[architecture ownership](architecture-ownership.md). For enforcement details, see ESLint and tests —
the contract describes architectural facts; other systems enforce them.

---

## Contract location

| Artifact              | Path                                  | Role                                      |
| --------------------- | ------------------------------------- | ----------------------------------------- |
| Author-written config | `atlas.config.json` (repo root)       | Minimal declarative contract authors edit |
| Schema + loader       | `packages/project` (`@atlas/project`) | Parse, validate, resolve, serialize       |
| Resolved output       | via `serializeResolvedAtlasProject()` | Deterministic JSON for tooling/agents     |

Resolve the current repository contract:

```bash
pnpm atlas:resolve-contract
pnpm atlas --version
```

See [Atlas CLI](cli.md) for bootstrap and CLI boundaries.

Programmatic usage:

```typescript
import {
  loadAtlasProject,
  resolveAtlasProject,
  serializeResolvedAtlasProject,
} from "@atlas/project";

const repoRoot = "/path/to/atlas";
const resolved = resolveAtlasProject(repoRoot);
const json = serializeResolvedAtlasProject(resolved);
```

---

## Raw vs resolved representation

**Raw (`atlas.config.json`)** — author-written, may omit defaults. Atlas dogfoods a minimal
contract:

```json
{
  "schemaVersion": 1
}
```

**Resolved (`ResolvedAtlasProject`)** — deterministic, complete, serializable JSON returned by
`resolveAtlasProject()`. Paths are repository-relative POSIX strings with no absolute machine paths
and no `undefined` values.

The loader applies defaults, normalizes paths, validates schema version, and performs lightweight
structural checks on required project surfaces. It does **not** perform full repository conformance
diagnostics — that belongs to Atlas Doctor.

### Structural validation semantics

The loader distinguishes three kinds of declared paths:

| Kind                               | Examples                                                                              | Loader behavior                                                                        |
| ---------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **Required project structure**     | `application.root`, `features.product`, `ui.path`                                     | Must exist and be directories                                                          |
| **Reference/conventional paths**   | `features.reference`, `features.examples`, `reference.components`, `reference.routes` | Recorded in the resolved contract; may be absent if reference/example code was removed |
| **Capability-dependent structure** | `generated.openApi.spec`, `generated.openApi.schema`                                  | Required as files only when `capabilities.openApi` is `true`                           |

Reference paths express canonical placement for Atlas reference surfaces. Consumers may delete
reference/example code (see [architecture ownership](architecture-ownership.md)) without breaking
contract resolution — the paths remain machine-readable policy, not proof that reference code must
exist.

When `capabilities.openApi` is `false`, OpenAPI output paths remain in the resolved contract as
conventional locations but are not required to exist.

The loader also verifies that `ui.path/package.json` exists, parses cleanly, and that its `name`
matches `ui.package`. This keeps the resolved UI identity internally consistent without scanning the
whole workspace.

---

## Schema version semantics

The contract uses an independent **`schemaVersion`** (currently `1`). This is separate from Atlas
release SemVer (`0.1.0` in `package.json`).

| Topic                     | Behavior                                                                |
| ------------------------- | ----------------------------------------------------------------------- |
| Supported versions        | `1` only                                                                |
| Unknown future version    | Fail with `CONTRACT_UNSUPPORTED_VERSION` and a clear message            |
| Older unsupported version | Fail clearly — no silent guessing                                       |
| Unknown JSON keys         | Rejected (`strict` schema) — typos like `capabilties` fail validation   |
| Missing optional sections | Filled from `@atlas/project` defaults                                   |
| Breaking schema change    | Increment `schemaVersion`; migration tooling belongs to `atlas upgrade` |

Example unsupported-version error:

```text
Unsupported Atlas contract schema version 2.
This installation supports contract schema version 1.
```

---

## Field reference

| Field                      | Purpose                                           | Default (v1)                               |
| -------------------------- | ------------------------------------------------- | ------------------------------------------ |
| `schemaVersion`            | Contract compatibility                            | required                                   |
| `application.root`         | Locate the Atlas app                              | `apps/web`                                 |
| `features.product`         | Product feature generator target                  | `apps/web/src/features`                    |
| `features.reference`       | Reference application feature root                | `apps/reference/src/features`              |
| `features.examples`        | Example hook patterns                             | `apps/web/src/features/examples`           |
| `reference.components`     | Reference UI patterns                             | `apps/reference/src/features/components`   |
| `reference.routes`         | Reference App Router pages                        | `apps/reference/src/app`                   |
| `ui.package`               | Shared UI public import                           | `@atlas/ui`                                |
| `ui.path`                  | Workspace package path                            | `packages/ui`                              |
| `ui.sourceImports`         | App must not import package internals             | `false`                                    |
| `generated.openApi.spec`   | OpenAPI source spec                               | `openapi/openapi.json`                     |
| `generated.openApi.schema` | Machine-owned generated types (starter canonical) | `apps/web/src/lib/api/contracts/schema.ts` |
| `capabilities.*`           | Optional platform modules enabled in this project | see below                                  |
| `boundaries.*`             | Architectural facts tooling should understand     | see below                                  |
| `platform.baseline`        | Recorded Atlas snapshot + synced-path checksums   | optional; see [upgrades](upgrades.md)      |

### Platform baseline (schema v1)

Optional metadata for downstream upgrade planning. Recorded by `atlas init` when the infrastructure
manifest is present; init fails explicitly when baseline capture cannot complete. Refreshed after
upgrades by `atlas upgrade`.

```json
{
  "platform": {
    "baseline": {
      "atlasVersion": "0.1.0",
      "contractSchemaVersion": 1,
      "templateManifestSchemaVersion": 1,
      "syncedPathChecksums": {
        "src/lib/api/client.ts": "sha256:…"
      }
    }
  }
}
```

Checksums cover manifest `syncedPaths` relative to `application.root`. Optional
`repositorySyncedPathChecksums` cover repository-root templates such as `Dockerfile` and
`.dockerignore`. They detect consumer modifications — not enforce byte identity with the latest
Atlas main branch. Existing 1.2.0 contracts without repository checksums remain valid.

### Capabilities

Boolean flags only — no vendor configuration or secrets. A capability means the underlying
architectural module exists in this project, not that CLI/Doctor/generator commands are implemented.

| Capability      | When `true` in Atlas today                    |
| --------------- | --------------------------------------------- |
| `auth`          | Session/auth infrastructure in `lib/auth`     |
| `consent`       | `@atlas/consent` integrated                   |
| `analytics`     | Analytics adapter contract in `lib/analytics` |
| `featureFlags`  | Feature flag system in `lib/feature-flags`    |
| `i18n`          | Minimal typed `t()` convention in `lib/i18n`  |
| `openApi`       | OpenAPI spec + generated contracts            |
| `observability` | Sentry + web vitals telemetry conventions     |

Authorization/permissions is documented in [authorization.md](authorization.md) and is not a
contract capability flag.

### OpenAPI generated schema (schema v1)

`generated.openApi.schema` points at the **starter** application's generated types
(`apps/web/src/lib/api/contracts/schema.ts`). This is the canonical Atlas project-contract artifact
for tooling that reads a single schema path.

`apps/reference` owns a second generated copy at `apps/reference/src/lib/api/contracts/schema.ts`
because it is an independent consumer application. Both copies are generated from the same
`openapi/openapi.json` via root `pnpm api:gen`. CI runs `pnpm api:check` to ensure both stay
synchronized with the spec.

Generalizing the contract to multiple generated schema paths is deferred — see the repository issue
tracker for follow-up work.

### Custom generators (schema v1, optional)

`generators` declares consumer-owned structural generators. Each key is a kebab-case id (not
`feature`, `page`, or `list`). Every file under `templates` is rendered into `target`; paths and
contents may use `{{name}}`, `{{kebab}}`, `{{camel}}`, `{{pascal}}`, and `{{title}}`, and a trailing
`.tmpl` suffix is stripped. Existing files are conflicts and are never overwritten.

```json
{
  "generators": {
    "data-table": {
      "description": "Feature with a sortable data table.",
      "templates": "tools/generators/data-table",
      "target": "apps/web/src/features/{{kebab}}",
      "argument": { "name": "name", "description": "Table name in kebab-case." },
      "followUp": ["Export {{pascal}}Table from the feature index."]
    }
  }
}
```

`atlas generate list --json` and `atlas context --json` list custom generators with
`source: "custom"`, so coding agents discover them the same way as built-ins. Templates and output
are consumer-owned; `atlas upgrade` never touches them.

### Boundaries

Architectural facts for generators, Doctor, and agents — not ESLint rule implementations.

| Boundary                        | Meaning                                              | Default |
| ------------------------------- | ---------------------------------------------------- | ------- |
| `noFeatureToFeatureImports`     | Product features do not import other features        | `true`  |
| `noProductImportsFromReference` | Product features do not import reference modules     | `true`  |
| `uiPublicApiOnly`               | App code consumes `@atlas/ui` through its public API | `true`  |

---

## Example resolved representation

```json
{
  "application": {
    "root": "apps/web"
  },
  "boundaries": {
    "noFeatureToFeatureImports": true,
    "noProductImportsFromReference": true,
    "uiPublicApiOnly": true
  },
  "capabilities": {
    "analytics": true,
    "auth": true,
    "consent": true,
    "featureFlags": true,
    "i18n": true,
    "observability": true,
    "openApi": true
  },
  "features": {
    "examples": "apps/web/src/features/examples",
    "product": "apps/web/src/features",
    "reference": "apps/reference/src/features"
  },
  "generated": {
    "openApi": {
      "schema": "apps/web/src/lib/api/contracts/schema.ts",
      "spec": "openapi/openapi.json"
    }
  },
  "reference": {
    "components": "apps/reference/src/features/components",
    "routes": "apps/reference/src/app"
  },
  "schemaVersion": 1,
  "ui": {
    "package": "@atlas/ui",
    "path": "packages/ui",
    "sourceImports": false
  }
}
```

Property order in real output is stable but sorted alphabetically by the serializer.

---

## What belongs in the contract vs elsewhere

| Belongs in contract             | Does not belong in contract    |
| ------------------------------- | ------------------------------ |
| Feature/reference/example roots | ESLint AST selectors           |
| Shared UI package identity      | TypeScript compiler flags      |
| Generated OpenAPI output path   | Full OpenAPI schema            |
| Capability on/off flags         | Provider API keys / DSN values |
| Boundary facts                  | Prettier/Tailwind/Next config  |
| Application root                | Package dependency versions    |

| System                                 | Role                                  |
| -------------------------------------- | ------------------------------------- |
| `docs/how-we-build/**`, ADRs           | Why architecture exists               |
| `atlas.config.json` + `@atlas/project` | What machine-relevant architecture is |
| ESLint / tests                         | What is enforced and how              |
| Atlas Doctor                           | Whether the repo currently conforms   |

---

## Design inventory (v1)

| Architectural fact          | Current source of truth           | Needed by tooling? | Encoded in contract? | Reason                                      |
| --------------------------- | --------------------------------- | ------------------ | -------------------- | ------------------------------------------- |
| Application root            | repo layout + folder-structure.md | yes                | yes                  | CLI/Doctor must locate app                  |
| Product feature root        | architecture-ownership.md         | yes                | yes                  | Generators must not scaffold into reference |
| Reference feature root      | architecture-ownership.md         | yes                | yes                  | Doctor/generators distinguish reference     |
| Example feature root        | architecture-ownership.md         | yes                | yes                  | Example hooks separated from product        |
| Reference component root    | architecture-ownership.md         | yes                | yes                  | Reference UI boundary                       |
| Example routes root         | folder-structure.md               | yes                | yes                  | Example page location                       |
| Shared UI package           | workspace packages                | yes                | yes                  | Public import + package path                |
| OpenAPI generated schema    | architecture-ownership.md         | yes                | yes                  | Machine-owned surface                       |
| Auth/consent/analytics/etc. | lib/\* modules                    | yes                | yes (capabilities)   | Doctor/checks differ when disabled          |
| Import boundaries           | ESLint                            | yes conceptually   | yes (boundary flags) | Facts only — ESLint enforces syntax         |
| Raw fetch prohibition       | ESLint                            | yes conceptually   | no                   | ESLint remains enforcement owner            |
| Env/config values           | env schema                        | no                 | no                   | Configuration, not architecture             |
| Next.js version             | package.json                      | no                 | no                   | Package manager owns versions               |
| Monorepo release version    | root package.json                 | no                 | no                   | Unrelated to contract compatibility         |

---

## Tooling consumers

| Tooling          | Uses contract for                                                  |
| ---------------- | ------------------------------------------------------------------ |
| CLI / bootstrap  | Discover repo, load one authoritative project definition           |
| Generators       | Product feature destination, reference avoidance, capabilities     |
| Doctor           | Capabilities, boundaries, generated paths, structural expectations |
| `atlas upgrade`  | Contract schema version upgrades; baseline refresh                 |
| Upgrade contract | Baseline metadata, conflict policy, rehearsal evidence             |
| Agent workflows  | Vendor-neutral resolved JSON architecture context                  |

All future tooling should import `@atlas/project` rather than reimplementing config discovery.

---

## Related docs

- [Architecture ownership](architecture-ownership.md)
- [Folder structure](folder-structure.md)
- [ADR-0007: Architecture ownership model](../adr/0007-architecture-ownership-model.md)
- [AGENTS.md](../../AGENTS.md)
