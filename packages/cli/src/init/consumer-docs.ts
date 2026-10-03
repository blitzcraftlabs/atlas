import { atlasDlx, atlasDlxForEnable, type EnableCliVersionOptions } from "./cli-release";
import { isKnownShippedConsumerDocumentation } from "./shipped-docs";

export { atlasDlx, atlasDlxForEnable };

export interface ConsumerDocVersionOptions extends EnableCliVersionOptions {
  atlasVersion: string;
}

export const CONSUMER_LOCAL_ATLAS_CLI = "pnpm atlas";

function cliPair(_options: ConsumerDocVersionOptions): { cli: string; enableCli: string } {
  return {
    cli: CONSUMER_LOCAL_ATLAS_CLI,
    enableCli: CONSUMER_LOCAL_ATLAS_CLI,
  };
}

export function buildConsumerAgentsMd(options: {
  projectName: string;
  atlasVersion: string;
  runningCliVersion?: string;
}): string {
  const { cli, enableCli } = cliPair(options);
  return `# Atlas — Agent Guide

This is **${options.projectName}**, an Atlas application generated from Atlas ${options.atlasVersion}.

Product code lives in this repository. Atlas does not host the application. Discover project state
from the published CLI — do not assume Atlas monorepo workspaces such as the evaluation harness or
CLI source package exist here.

Detailed workflow: [docs/how-we-build/agents.md](docs/how-we-build/agents.md)

---

## Discover the current project

\`\`\`bash
${cli} context
${cli} context --json
\`\`\`

\`atlas context\` resolves the project contract, ownership manifest, generators, Doctor
capabilities, upgrade semantics, validation commands, and documentation references.

---

## Structural scaffolding

\`\`\`bash
${cli} generate list --json
${cli} generate feature <name> [--query] [--mutation] [--form] [--tests]
${cli} generate page <route>
\`\`\`

Product logic inside generated shells is normal source editing.

---

## Validate architecture

\`\`\`bash
${cli} doctor
${cli} doctor --json
\`\`\`

Then run standard engineering validation:

\`\`\`bash
pnpm lint && pnpm typecheck && pnpm test
\`\`\`

\`atlas doctor\` checks Atlas-specific contract and architecture drift. It does not replace lint,
typecheck, tests, or build. See [doctor.md](docs/how-we-build/doctor.md).

Additional checks when relevant: \`pnpm build\`, \`pnpm validate:env\`, Playwright E2E — see
\`validation.recommended\` in \`${cli} context --json\`. Maintainer-only Atlas repo commands
(\`pnpm template:check\`, \`pnpm governance:check\`, \`pnpm docs:check\`) are not part of this
workspace.

---

## Upgrades and migrations

\`\`\`bash
${cli} upgrade --dry-run --json
\`\`\`

Treat \`merge-required\`, \`manual-review\`, and \`security-critical\` conflicts as blocking for
silent auto-resolution. See [upgrades.md](docs/how-we-build/upgrades.md).

---

## Optional tooling

The default generated baseline is Doctor, lint, typecheck, tests, and production build.

Heavier quality tooling is opt-in and consumer-owned after enablement:

\`\`\`bash
${enableCli} enable list --json
${enableCli} enable storybook --dry-run
${enableCli} enable storybook
\`\`\`

See [consumer tooling](docs/how-we-build/consumer-tooling.md). Use the pinned local CLI
(\`${enableCli} enable\`). \`atlas upgrade\` does not install optional tooling. Enablement skips
customized files instead of overwriting them.

---

## Documentation

Canonical conventions in this repository:

| Topic | Location |
| ----------------- | -------------------------------------------------------------------------- |
| Agent workflow | [docs/how-we-build/agents.md](docs/how-we-build/agents.md) |
| Atlas CLI | [docs/how-we-build/cli.md](docs/how-we-build/cli.md) |
| Consumer tooling | [docs/how-we-build/consumer-tooling.md](docs/how-we-build/consumer-tooling.md) |
| Reference patterns | [docs/how-we-build/reference-patterns.md](docs/how-we-build/reference-patterns.md) |
| Project contract | [docs/how-we-build/atlas-contract.md](docs/how-we-build/atlas-contract.md) |
| Authorization | [docs/how-we-build/authorization.md](docs/how-we-build/authorization.md) |
| API & React Query | [docs/how-we-build/api.md](docs/how-we-build/api.md) |
| Testing | [docs/how-we-build/testing.md](docs/how-we-build/testing.md) |

Public Atlas docs: https://github.com/blitzcraftlabs/atlas/blob/main/docs/public/README.md

---

## Workspace map

\`\`\`
${options.projectName}/
├── apps/web/           # Product application
├── packages/ui/        # @atlas/ui source
├── packages/consent/   # @atlas/consent source
├── packages/config/    # shared lint/ts/jest config
├── openapi/            # OpenAPI specification
└── docs/how-we-build/  # Architecture documentation
\`\`\`

This generated consumer does **not** include the Atlas evaluation harness or the published CLI
source workspace. Simulated authentication, reset endpoints, and failure-injection controls from the
Atlas reference harness are not part of this workspace.

---

## When to stop and ask

- Ownership is ambiguous (synced vs independent vs product-owned)
- Doctor reports architectural conflict on consumer-owned paths
- Upgrade dry-run contains \`merge-required\` or \`manual-review\` items
- Change touches shared infrastructure (\`packages/ui\`, core \`lib/\`) without clear scope
- Generator cannot represent the required structural shape

---

## Vendor adapters

Cursor rules/skills are optional conveniences (\`${enableCli} enable cursor\`). They must delegate to this
guide and the CLI. Generic \`AGENTS.md\`-compatible agents are the portable path.

---

## Judgment rules (brief)

- Prefer existing Atlas components and nearby patterns
- No raw \`fetch()\` in UI layers — use \`@/lib/api\`
- No direct \`process.env\` in application code — use \`@/config\`
- No cross-feature imports — extract to \`lib/\` if needed
- No business logic in \`app/\` route files
- Preserve accessibility and responsive layout
- Keep changes focused — no unrelated refactors
`;
}

export function buildConsumerAgentsWorkflow(options: {
  atlasVersion: string;
  runningCliVersion?: string;
}): string {
  const { cli, enableCli } = cliPair(options);
  return `# Atlas agent workflow

> **Canonical workflow for humans and coding agents in a generated Atlas consumer.**

This file is generated for a consumer workspace. It is not the Atlas platform monorepo guide.

Coding agents must use the same executable contracts as humans: project contract, CLI generators,
Doctor, upgrade planning, and standard engineering validation. Vendor-specific guidance (Cursor
rules, skills) is a thin adapter — never an alternate architecture.

See also: [Atlas CLI](cli.md), [Atlas Doctor](doctor.md), [Upgrades](upgrades.md),
[Consumer tooling](consumer-tooling.md), [Architecture ownership](architecture-ownership.md).

---

## Source-of-truth hierarchy

When guidance conflicts, resolve in this order:

1. \`atlas.config.json\` / resolved Atlas project contract (\`@atlas/project\`)
2. Atlas CLI generators and command metadata
3. \`atlas doctor\` diagnostics
4. \`atlas upgrade\` plans and migration metadata
5. ADRs and canonical documentation in \`docs/how-we-build/\` and \`docs/adr/\`
6. \`AGENTS.md\` workflow and judgment guidance
7. Vendor-specific adapters (for example \`.cursor/rules\`, \`.cursor/skills\`)

If a Cursor rule contradicts Doctor or the resolved project contract, the Cursor rule is wrong.

---

## Generic agent entry point

Start from repository root **\`AGENTS.md\`**, then:

\`\`\`bash
${cli} context --json
\`\`\`

Do **not** run \`pnpm --filter @blitzcraftlabs/atlas build\` or a workspace-linked \`atlas\` binary —
those commands exist only in the Atlas platform checkout. This generated consumer invokes the
published CLI.

Nested \`AGENTS.md\` files (for example under \`apps/web/\`) scope local application constraints.
They do not replace the root workflow.

---

## Discover → Plan → Implement → Validate → Review

### Discover

1. Read root \`AGENTS.md\` and this document.
2. Run \`${cli} context --json\`.
3. Inspect relevant ADRs and \`docs/how-we-build/\` references returned by context.
4. Inspect nearby examples under \`apps/web/src/app/examples/\` before inventing patterns.
5. For settings, permission-aware CRUD, and diagnostics recipes, see [reference-patterns.md](reference-patterns.md).

### Plan

| Category | Approach |
| ---------------------- | ----------------------------------------------------------- |
| Structural scaffolding | Use \`atlas generate\` when a generator exists |
| Product logic | Normal source editing in consumer-owned surfaces |
| Optional quality tooling | \`${enableCli} enable <capability>\` — never a silent upgrade write |
| Ownership boundaries | Contract + manifest + Doctor — not duplicated prose |
| Validation | Doctor + lint + typecheck + tests (+ build/E2E when needed) |

\`\`\`bash
${cli} generate list --json
${enableCli} enable list --json
\`\`\`

### Implement

\`\`\`bash
${cli} generate feature <name> [--query] [--mutation] [--form] [--tests]
${cli} generate page <route>
\`\`\`

Then implement product behavior in generated shells.

Do not overwrite independent or consumer-owned files based on assumptions. \`atlas enable\` skips
customized destinations and reports conflicts.

### Validate

\`\`\`bash
${cli} doctor --json
pnpm lint && pnpm typecheck && pnpm test
\`\`\`

Run additional checks from \`atlas context --json\` → \`validation.recommended\` when your change
requires them. That list is filtered to commands this workspace actually owns.

Doctor validates Atlas architecture. It does not replace lint, typecheck, tests, or build.

### Review

Before claiming completion:

- Contract and ownership compliance
- No unintended generated drift
- Doctor result (if architecture-sensitive)
- Test evidence for the change scope

---

## Responding to Doctor diagnostics

| Class | Examples | Agent behavior |
| ----------------------- | --------------------------------- | ------------------------------------------------------------------------------ |
| Mechanical / local | Stale generated OpenAPI client | Run canonical generator (\`pnpm api:gen\`); rerun Doctor |
| Architectural conflict | Ownership or boundary violation | Do not overwrite consumer-owned files; inspect contract/docs; surface conflict |
| Consumer / product decision | Independent wiring differs from baseline | Do not normalize automatically |
| Unknown / unsafe | Ambiguous ownership | Stop and ask for human judgment |

**Do not** encode “always fix every Doctor diagnostic.” Auto-fix only when remediation is
deterministic and inside authorized change scope.

---

## Upgrade and migration workflow

\`\`\`bash
${cli} upgrade --dry-run --json
\`\`\`

Do not infer blocking from \`category\` alone. The upgrade command decides whether an upgrade is
safe, blocked, manual, or actionable from plan items (\`conflict\`), result \`status\`, and
unresolved migration or package work.

Optional tooling (Storybook, visual tests, performance CI, security workflows, Dependabot, coverage
floors, Git hooks, Cursor adapters, Docker) is **not** applied by \`atlas upgrade\`. Adopt those
with \`${enableCli} enable <capability>\` after reviewing the dry-run.

See [upgrades.md](upgrades.md) and [consumer-tooling.md](consumer-tooling.md).

---

## Machine interfaces summary

| Need | Command |
| -------------------- | -------------------------------------------------------------- |
| Resolved project state | \`${cli} context --json\` |
| Generator inventory | \`${cli} generate list --json\` |
| Architecture validation | \`${cli} doctor --json\` |
| Upgrade planning | \`${cli} upgrade --dry-run --json\` |
| Optional tooling | \`${enableCli} enable list --json\` |

Do not scrape Markdown or CLI help prose for critical structural state when these commands exist.
`;
}

export function buildConsumerFolderStructure(options: { projectName: string }): string {
  return `# Folder structure

> Where code lives in this generated consumer workspace.

This document describes **${options.projectName}**, not the Atlas platform monorepo. The Atlas
evaluation harness (\`apps/reference\`) and CLI source (\`packages/cli\`) are not part of this
repository.

## Workspace layout

\`\`\`
${options.projectName}/
├── apps/
│   └── web/                    # Product application (@atlas/web)
│       ├── src/
│       │   ├── app/            # Next.js App Router pages & routes
│       │   ├── components/     # Shared app-level components
│       │   ├── features/       # Product + example feature modules
│       │   ├── lib/            # Shared utilities & infrastructure
│       │   ├── providers/      # React context providers
│       │   └── schemas/        # Zod validation schemas
│       ├── e2e/                # Playwright E2E tests
│       └── scripts/            # Build & validation scripts
├── packages/
│   ├── ui/                     # Shared UI component library
│   ├── consent/                # Optional consent package
│   └── config/                 # Shared ESLint / TypeScript / Jest config
├── docs/
│   ├── how-we-build/           # Architecture documentation
│   └── adr/                    # Architecture Decision Records
├── openapi/                    # OpenAPI specification
└── .github/workflows/ci.yml    # Consumer-owned GitHub-hosted quality baseline
\`\`\`

\`atlas init\` writes \`.github/workflows/ci.yml\`. It is not Atlas maintainer CI. Optional
workflows (performance, security) are added only through \`atlas enable\`.

## \`apps/web/src/app/\`

Next.js App Router pages and API routes.

**Rules:**

- Pages and layouts only — no business logic
- Use route groups \`(folder)\` for shared layouts
- API routes can use \`fetch()\` directly (they are API boundaries)
- Do not put reusable components here

Starter \`app/examples/\` routes are removable pattern pages. See [examples.md](examples.md).

## \`apps/web/src/features/\`

Product feature modules. Use \`atlas generate feature\` for structural shells. Do not import across
features; extract shared code to \`src/lib/\`.

## \`packages/ui\`

Source-owned design system. Storybook, visual regression, and Playwright story tests are **not**
installed by default. Enable them with \`atlas enable storybook\` (and \`atlas enable visual\` if
you want screenshot baselines).

See [consumer-tooling.md](consumer-tooling.md) and [architecture-ownership.md](architecture-ownership.md).
`;
}

export function buildConsumerExamplesDoc(options: {
  atlasVersion: string;
  runningCliVersion?: string;
}): string {
  const { cli } = cliPair(options);
  return `# Reference examples

> Minimal patterns you can copy when building on Atlas.

This generated consumer ships the starter \`/examples\` route group. It does **not** include the
Atlas \`apps/reference\` evaluation harness.

## Purpose

The \`/examples\` route group is intentionally small:

- **Data fetching** — React Query hooks, query key factories, loading/empty/error/success states
- **Forms** — Zod validation, \`useZodForm\`, and server field error mapping

Delete \`app/examples/\`, \`features/examples/\`, and \`app/api/examples/\` when you start building
your product.

## Routes

| Page | Route | What it shows |
| -------- | ---------------- | ---------------------------------------------------------- |
| Overview | \`/examples\` | Links to reference pages |
| Data states | \`/examples/data\` | Mode switching via \`?mode=success\\|empty\\|error\\|slow\` |
| Forms | \`/examples/form\` | Create item with client + server validation |

## API

In-memory mock routes (reset on server restart):

- \`GET /api/examples/items?mode=...\`
- \`POST /api/examples/items\`
- \`PATCH /api/examples/items/[id]\`

## Settings, CRUD, and diagnostics

Do not copy \`apps/reference\` into this repository. For production-shaped settings,
permission-aware CRUD, and platform diagnostics, follow
[reference-patterns.md](reference-patterns.md). Scaffold structure with:

\`\`\`bash
${cli} generate feature <name> --query --mutation --form --tests
${cli} generate page settings
\`\`\`

Simulated authentication, reset endpoints, and failure-injection controls stay confined to the Atlas
repository's development-only reference harness. They are not an enablement target.

## Related docs

- [API & data fetching](api.md)
- [Testing](testing.md)
- [Folder structure](folder-structure.md)
- [Consumer tooling](consumer-tooling.md)
`;
}

export function buildConsumerToolingDoc(options: {
  atlasVersion: string;
  runningCliVersion?: string;
}): string {
  const { cli, enableCli } = cliPair(options);
  return `# Consumer tooling

> Optional development and quality tooling for generated Atlas applications.

The default \`atlas init\` baseline is practical: Doctor, lint, typecheck, unit tests, production
build, and local Lighthouse/bundle commands. Heavier tooling is **opt-in** through \`atlas enable\`.
Atlas publishing, release rehearsal, internal governance, and BlitzCraft runners stay
maintainer-only.

## Default baseline (always present)

| Capability | How |
| ---------------------- | ------------------------------------------------------------ |
| Atlas Doctor | \`${cli} doctor\` |
| Lint / typecheck / test / build | \`pnpm lint\`, \`pnpm typecheck\`, \`pnpm test\`, \`pnpm build\` |
| Consumer GitHub CI | \`.github/workflows/ci.yml\` (GitHub-hosted Ubuntu) |
| Local performance | \`pnpm perf:lhci\`, \`pnpm perf:analyze\` (no CI workflows) |
| OpenAPI client | \`pnpm api:gen\` |

Playwright E2E scripts exist on \`@atlas/web\` but are omitted from default CI until you install
browsers and run the app.

## Opt-in capabilities

\`\`\`bash
${enableCli} enable list --json
${enableCli} enable <id> --dry-run --json
${enableCli} enable <id>
\`\`\`

| Id | What it adds | Notes |
| ---------- | ------------------------------------------------ | ------------------------------------------------------------ |
| \`docs\` | Consumer AGENTS.md and workflow docs | Already generated at init; use to adopt on existing apps |
| \`storybook\` | \`.storybook\`, interaction + axe tests | Heavier; restore UI scripts/devDependencies |
| \`visual\` | Playwright screenshot baselines + Docker comparison CI | Requires \`storybook\`. Compare only in \`mcr.microsoft.com/playwright:v<playwright-version>-noble\` via \`pnpm --filter @atlas/ui test:visual:docker\`. Do not recapture on a laptop. |
| \`perf-ci\` | Lighthouse + bundle GitHub workflows | Local perf commands already exist |
| \`security\` | \`pnpm audit\` script + workflow | Not Gitleaks/SBOM/governance. High/critical findings fail unless a documented advisory/version/path exception matches every finding path. |
| \`updates\` | Dependabot for npm and Actions | Consumer-owned; swap for Renovate if you want |
| \`coverage\` | Critical-subsystem coverage floors | Auth, API, UI form infrastructure |
| \`hooks\` | Husky + lint-staged | No Docker/Gitleaks requirement |
| \`cursor\` | Cursor rule + skill adapters | Delegates to AGENTS.md and this CLI |
| \`docker\` | Compose scaffold and infra example | Dockerfile and \`.dockerignore\` already ship with \`atlas init\`. Atlas needs no database by default |

After \`storybook\`, install Playwright browsers for interaction and accessibility tests:

\`\`\`bash
pnpm install
pnpm --filter @atlas/ui exec playwright install
\`\`\`

After \`visual\`, shipped PNG baselines are compared only inside
\`mcr.microsoft.com/playwright:v<playwright-version>-noble\`:

\`\`\`bash
pnpm --filter @atlas/ui build-storybook
pnpm --filter @atlas/ui test:visual:docker
\`\`\`

Host Chromium will not match those PNGs (font metrics differ). Do not use \`--update-snapshots\` to
silence a host or CI failure. To recapture after an intentional UI change, run the generated
**Update Visual Baselines** workflow (or \`node packages/ui/scripts/run-visual-in-playwright-docker.mjs --update\`),
review every PNG, then commit. The comparison workflow never updates snapshots.

The Docker Compose capability is opt-in. Root \`Dockerfile\` and \`.dockerignore\` already ship with
\`atlas init\` and use \`pnpm install --frozen-lockfile\`. Commit \`pnpm-lock.yaml\` before building the
image. Customized Dockerfiles are never overwritten by \`atlas upgrade\`. Lighthouse CI accepts an
optional \`LHCI_GITHUB_APP_TOKEN\` secret. The generated Lighthouse workflow installs Chrome and
sets \`CHROME_PATH\`. Local \`pnpm perf:lhci\` needs Chrome or Chromium on \`PATH\` or \`CHROME_PATH\`.

Enablement **does not overwrite customized files**. Existing destinations that differ from the
packaged asset are reported as \`conflict\` and left untouched. Identical files are skipped.
\`package.json\` scripts and devDependencies are merged only when the key is absent or already
matches.

## Existing-consumer adoption

After \`atlas init\`, the pinned local CLI is \`${cli}\`. Bootstrap a brand-new repository with
\`pnpm dlx @blitzcraftlabs/atlas init <name>\` before that script exists. Optional tooling is not
installed by \`atlas upgrade\`. Historical npm \`1.1.0\` did not contain \`atlas enable\`; projects
created or upgraded by a CLI that includes \`enable\` run it through \`${enableCli}\`.

1. Preview and apply platform upgrades with \`${cli} upgrade --dry-run\` and \`${cli} upgrade\`.
   That step does not add Storybook, coverage, or other opt-in files.
2. \`${enableCli} enable docs --dry-run --json\` — replace \`AGENTS.md\` (and related workflow docs)
   only when the file is an unmodified copy shipped by a known published CLI. Customized docs and
   any other content are reported as \`conflict\` and left untouched.
3. Enable each extra capability you want. Review conflicts before deleting or merging files.
4. Run \`pnpm install\` after enables that add dependencies (Storybook, hooks).
5. Run the capability's \`validationCommand\` from \`enable list --json\`. File presence is not
   proof that the tool works.
6. Re-run \`${cli} doctor --json\` and \`pnpm lint && pnpm typecheck && pnpm test\`.

## Maintainer-only (not offered here)

- Atlas npm publication and release rehearsal
- BlitzCraft / self-hosted runner profiles
- \`pnpm governance:check\`, \`pnpm docs:check\`, \`pnpm template:check\`
- Gitleaks history fixtures and workflow-pin enforcement used in the Atlas repo
- The entire \`apps/reference\` harness

## Related docs

- [Agent workflow](agents.md)
- [Testing](testing.md)
- [Reference patterns](reference-patterns.md)
- [Upgrades](upgrades.md)
`;
}

export function buildConsumerReferencePatternsDoc(options: {
  atlasVersion: string;
  runningCliVersion?: string;
}): string {
  const { cli } = cliPair(options);
  return `# Reference patterns

> Adopt settings, permission-aware CRUD, and diagnostics without importing the Atlas reference app.

\`apps/reference\` in the Atlas repository is an evaluation harness. It is **not** this generated
consumer, and it is not added by \`atlas enable\`. Use it as an upstream illustration, then implement
product-owned modules here.

Upstream source (read-only): https://github.com/blitzcraftlabs/atlas/tree/main/apps/reference/src/features

## Settings

Build a product settings surface from starter primitives already in \`apps/web\`:

1. \`${cli} generate page settings\`
2. Compose consent (\`@atlas/consent\`), theme (\`@atlas/ui\` theme hooks), and i18n strings in a
   feature module — not in the route file.
3. Keep environment access behind \`@/config\`. Do not read \`process.env\` in UI.

A structural illustration lives upstream in \`apps/reference/src/features/components/ReferenceSettingsView.tsx\`.
Copy the *composition* (consent + theme + copy), not harness-only controls.

## Permission-aware CRUD

1. \`${cli} generate feature <name> --query --mutation --form --tests\`
2. Register permissions in \`src/lib/application/authz.ts\` (independent / product-owned).
3. Gate UI with \`Can\` / \`usePermission\` and server routes with \`requirePermission\` /
   \`requireResourcePermission\`. See [authorization.md](authorization.md).
4. Handle loading, empty, error, and success with \`@atlas/ui\` app-state components.

Upstream illustration: \`apps/reference/src/features/users/\` (OpenAPI-backed users CRUD). Implement
against your API contract; do not import reference feature modules.

## Platform diagnostics

Read runtime config, feature flags, and telemetry through the existing facades (\`@/config\`,
\`src/lib/feature-flags\`, \`src/lib/telemetry\`). A product “status” page can display **non-secret**
capability state for operators.

Do **not** copy these harness-only controls into a product app:

- Simulated authentication / persona switchers
- Reset endpoints that wipe in-memory stores
- Failure-injection or scenario switches intended for the evaluation harness
- \`ATLAS_REFERENCE_MODE\` and \`src/lib/reference/**\`

Those remain development-only in the Atlas repository. They are not packaged, not enableable, and
must not ship in production consumers.

## Related docs

- [Examples](examples.md)
- [Authorization](authorization.md)
- [API](api.md)
- [Consumer tooling](consumer-tooling.md)
`;
}

export function buildConsumerCursorRule(options: {
  atlasVersion: string;
  runningCliVersion?: string;
}): string {
  const { cli, enableCli } = cliPair(options);
  return `---
description: Non-negotiable Atlas constraints for this generated consumer
alwaysApply: true
---

# Atlas core constraints

**Canonical sources:** [AGENTS.md](../../AGENTS.md), [agent workflow](../../docs/how-we-build/agents.md), resolved contract via \`${cli} context --json\`.

Vendor guidance never overrides the executable contract or Doctor. If this rule contradicts Doctor or \`atlas context\`, this rule is wrong.

## Before architectural changes

1. Read root \`AGENTS.md\` and run \`${cli} context --json\`.
2. For structural scaffolding, use \`${cli} generate …\` when a generator exists.
3. Inspect the closest example under \`apps/web/src/app/examples/\`.

## Workflow

- **Validate** — \`${cli} doctor --json\`, then \`pnpm lint\`, \`pnpm typecheck\`, \`pnpm test\`.
- **Upgrades** — \`${cli} upgrade --dry-run --json\`; do not silently resolve merge-required conflicts.
- **Optional tooling** — \`${enableCli} enable list --json\`; do not copy Atlas maintainer workflows.
- **Doctor failures** — Auto-fix only deterministic mechanical issues. Do not overwrite consumer-owned files.

## Judgment

- Prefer existing abstractions; no speculative package extraction.
- Product code stays in the configured application feature roots; reusable primitives in \`@atlas/ui\`.
- Every data-driven UI handles loading, empty, error, and success.
- Forms: \`useZodForm\`, \`FormField\`, \`applyServerFieldErrors\`.
- Preserve accessibility and responsive layout.
`;
}

export function buildConsumerCursorSkill(options: {
  atlasVersion: string;
  runningCliVersion?: string;
}): string {
  const { cli, enableCli } = cliPair(options);
  return `---
name: build-atlas-feature
description:
  Builds or modifies production-quality frontend features in this generated Atlas app. Delegates
  architecture to Atlas CLI contracts — not duplicated prose rules.
---

# Build Atlas Feature

Canonical workflow: [docs/how-we-build/agents.md](../../../docs/how-we-build/agents.md)

## 1. Discover

\`\`\`bash
${cli} context --json
${cli} generate list --json
${enableCli} enable list --json
\`\`\`

1. Read root [AGENTS.md](../../../AGENTS.md).
2. Use \`documentation.references\` from context for relevant \`docs/how-we-build/\` topics.
3. Inspect nearest example under \`apps/web/src/app/examples/\`.

## 2. Plan

Report: route, feature module, **generator command** (if structural), components to reuse, API
contract, hooks, UI states, tests, files to change.

## 3. Implement

\`\`\`bash
${cli} generate feature <name> [--query] [--mutation] [--form] [--tests]
${cli} generate page <route>
\`\`\`

Then implement domain behavior in consumer-owned surfaces. Do not overwrite independent files.

## 4. Validate

\`\`\`bash
${cli} doctor --json
pnpm lint && pnpm typecheck && pnpm test
\`\`\`

### Doctor response

| Class | Action |
| ----------------------------- | ------------------------------------------------- |
| Stale generated artifact | Run canonical generator; rerun Doctor |
| Ownership / boundary conflict | Do not overwrite consumer files; surface conflict |
| Independent wiring differs | Do not normalize automatically |
| Ambiguous | Stop and ask |

## 5. Review

Contract compliance, ownership, no unintended generated drift, Doctor result, test evidence.
`;
}

export interface GeneratedConsumerDoc {
  destination: string;
  content: string;
  isReplaceable?: (existing: string) => boolean;
}

export function listGeneratedConsumerDocs(options: {
  projectName: string;
  atlasVersion: string;
  runningCliVersion?: string;
}): GeneratedConsumerDoc[] {
  return [
    {
      destination: "AGENTS.md",
      content: buildConsumerAgentsMd(options),
      isReplaceable: (existing) => isKnownShippedConsumerDocumentation("AGENTS.md", existing),
    },
    {
      destination: "docs/how-we-build/agents.md",
      content: buildConsumerAgentsWorkflow(options),
      isReplaceable: (existing) =>
        isKnownShippedConsumerDocumentation("docs/how-we-build/agents.md", existing),
    },
    {
      destination: "docs/how-we-build/folder-structure.md",
      content: buildConsumerFolderStructure(options),
      isReplaceable: (existing) =>
        isKnownShippedConsumerDocumentation("docs/how-we-build/folder-structure.md", existing),
    },
    {
      destination: "docs/how-we-build/examples.md",
      content: buildConsumerExamplesDoc(options),
      isReplaceable: (existing) =>
        isKnownShippedConsumerDocumentation("docs/how-we-build/examples.md", existing),
    },
    {
      destination: "docs/how-we-build/consumer-tooling.md",
      content: buildConsumerToolingDoc(options),
    },
    {
      destination: "docs/how-we-build/reference-patterns.md",
      content: buildConsumerReferencePatternsDoc(options),
    },
  ];
}

export function listGeneratedCursorFiles(options: {
  atlasVersion: string;
  runningCliVersion?: string;
}): GeneratedConsumerDoc[] {
  return [
    {
      destination: ".cursor/rules/atlas-core.mdc",
      content: buildConsumerCursorRule(options),
    },
    {
      destination: ".cursor/skills/build-atlas-feature/SKILL.md",
      content: buildConsumerCursorSkill(options),
    },
  ];
}
