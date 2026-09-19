# Contributing to Atlas

Atlas is an **open-source frontend platform for Next.js teams**. It is **open source under Apache
License 2.0**. The canonical repository is
[`blitzcraftlabs/atlas`](https://github.com/blitzcraftlabs/atlas). Anyone can clone, fork, and
propose changes.

This guide is for Atlas maintainers, external contributors, and downstream consumers who fork Atlas
into a product.

## Repository purpose and access

- **Maintainers** own platform direction, releases, and canonical documentation.
- **External contributors** open pull requests against this public repository for features, fixes,
  docs, and reviews.
- **Downstream consumers** typically start from `pnpm dlx @blitzcraftlabs/atlas init my-app`. Fork
  or clone this repository when contributing or evaluating the full monorepo, and upstream fixes
  with provenance.

Licensing, versioning, and support expectations are in
[Releases and Governance](docs/how-we-build/releases-and-governance.md). Atlas is **licensed under
Apache-2.0**; the source is public. Workspace packages are npm-`private` and are not independent npm
products.

Canonical engineering guidance:

| Document                                                              | Use for                                           |
| --------------------------------------------------------------------- | ------------------------------------------------- |
| [AGENTS.md](AGENTS.md)                                                | Coding agents and day-to-day implementation rules |
| [docs/how-we-build/](docs/how-we-build/README.md)                     | Platform conventions                              |
| [docs/public/](docs/public/README.md)                                 | External-facing capability descriptions           |
| [docs/adr/](docs/adr/README.md)                                       | Significant technical decisions                   |
| [docs/audit/claims-register.md](docs/audit/claims-register.md)        | Material claims and evidence                      |
| [Releases & Governance](docs/how-we-build/releases-and-governance.md) | Versioning, licensing, releases, support          |

**Do not** treat `docs/_archive/` as current implementation guidance (see
`docs/_archive/README.md`).

## Prerequisites

- Node.js **>= 22**
- pnpm **>= 10** (`corepack enable`)

```bash
git clone https://github.com/blitzcraftlabs/atlas.git
cd atlas
corepack enable
pnpm install
cp apps/web/.env.example apps/web/.env.local
pnpm validate:env
pnpm dev
```

## Branch and worktree practices

- Branch from `main` using conventional prefixes: `feat/`, `fix/`, `docs/`, `chore/`, `refactor/`.
- Keep pull requests focused; prefer multiple small PRs over one large mixed change.
- Use a separate worktree when parallel work would conflict with local experiments:

```bash
git fetch origin main
git worktree add ../atlas-my-feature -b feat/my-feature origin/main
```

- Do not force-push to `main`.
- Preserve unrelated local branches and uncommitted work when switching tasks.

## Commit conventions

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
docs: align FAQ with accessibility enforcement evidence
fix(web): handle expired OAuth state
chore: update pnpm lockfile
```

- One logical change per commit when practical.
- Let pre-commit hooks run; do not skip hooks unless explicitly agreed with a maintainer.

## Pull request expectations

1. Link a GitHub issue when one exists in this public repository. Do not cite private-era issue
   numbers as if they belonged here.
2. Update documentation when behavior, capabilities, or CI gates change.
3. Update [claims register](docs/audit/claims-register.md) when public claims change.
4. Add or update an ADR for significant architectural decisions (see below).
5. Describe validation commands run and their results.
6. Note downstream-fix provenance when porting a fix from a product fork.

Use the [pull request template](.github/pull_request_template.md) and
[review checklist](.github/PULL_REQUEST_REVIEW_CHECKLIST.md).

## Required validation

Minimum bar before requesting review:

```bash
pnpm lint && pnpm typecheck && pnpm test
```

Also run when your change touches the affected areas:

| Change type                     | Additional commands                                      |
| ------------------------------- | -------------------------------------------------------- |
| Security / CI workflows         | `pnpm security:check` and `pnpm security:workflow-check` |
| Documentation / Markdown links  | `pnpm docs:check`                                        |
| Release governance              | `pnpm governance:check`                                  |
| Formatting                      | `pnpm format` or `pnpm format:write`                     |
| Build-affecting code            | `pnpm build`                                             |
| User-facing flows               | `pnpm --filter @atlas/web test:e2e`                      |
| Shared UI / auth / API coverage | `pnpm test:risk-coverage`                                |
| Repository coverage reports     | `pnpm test:coverage:all`                                 |

CI runs internal documentation link checks on every pull request. External URL checks are optional
locally: `pnpm docs:check --external`.

## Documentation updates

- Public capability claims must map to evidence in the
  [claims register](docs/audit/claims-register.md).
- Follow [documentation policy](docs/how-we-build/documentation-policy.md).
- Canonical docs must not link into `docs/_archive/` except from audit notes that explicitly discuss
  history.
- Planned work belongs in issues and ADRs—not as if it were shipped.
- Cite durable implementation, tests, workflows, and docs — not historical project-management
  numbers from Atlas's private development period.

## Changesets and release impact

Atlas versions the **repository/platform snapshot** as one line. Changesets collect release metadata
and open **Version PRs**. They do **not** publish npm packages. After a Version PR merges,
automation publishes the canonical Git tag and GitHub Release. Canonical `v1.0.0` is the first
stable GitHub/platform release. The next canonical release is **1.0.1** (launch-surface polish and
first npm registry distribution).

Canonical policy: [Releases and Governance](docs/how-we-build/releases-and-governance.md).

- Add a changeset when your change should appear in the Atlas changelog or receive a version bump.
- Workspace packages are npm-`private`; they share the Atlas version and are not independent npm
  products.
- **Bump convention after 1.0:**
  - **patch** — bug fixes and small non-breaking work (`1.0.0 → 1.0.1`)
  - **minor** — compatible features (`1.0.0 → 1.1.0`)
  - **major** — breaking public-contract changes (`1.0.0 → 2.0.0`)
- This 1.0 decision used **major** to advance `0.5.0` → `1.0.0`.
- Breaking changes require migration notes in the changeset body and changelog; add
  `docs/migrations/` guides when steps are non-trivial.

```bash
pnpm changeset
pnpm changeset:status
pnpm governance:check   # when touching release/licensing files
pnpm release:rehearse     # optional; isolated version transformation dry-run
```

## Issue reports

Use the public issue forms for non-sensitive work:

- **Bug report** — defects in Atlas itself
- **Feature or improvement** — focused platform requests
- **Documentation issue** — unclear, incorrect, or missing docs

Do not use a blank issue. Product-specific support for an app built from Atlas belongs in that
product's tracker.

## Security reporting

- **Do not** open public issues for unpatched security vulnerabilities.
- Use
  [GitHub Private Vulnerability Reporting](https://github.com/blitzcraftlabs/atlas/security/advisories/new)
  on this repository. See [SECURITY.md](SECURITY.md).
- Do not commit secrets, `.env.local`, or credentials. Gitleaks runs in CI.
- Consumer applications own their deployment hardening, WAF rules, and data classification.

## Accessibility expectations

- Use semantic HTML, labels, keyboard support, and visible `focus-visible` styles.
- Fix `eslint-plugin-jsx-a11y` violations before merge.
- Manually exercise keyboard flows for interactive UI; use Storybook a11y addon for components.
- Representative `critical` Storybook compositions are gated by the **UI Quality** workflow (axe,
  interaction, and visual checks). This is **not** formal WCAG certification. See
  [Accessibility](docs/how-we-build/accessibility.md) and [Testing](docs/how-we-build/testing.md).

## ADR requirements

Create an ADR in `docs/adr/` when you:

- choose a library over alternatives for a cross-cutting concern;
- establish a pattern the whole platform must follow;
- deprecate or replace an existing pattern;
- make a decision that is hard to reverse.

Use [ADR-0000 template](docs/adr/0000-template.md). Submit the ADR with the implementation in the
same PR when possible.

## Downstream fixes and upstreaming

Product forks may land fixes before the platform template. When upstreaming:

1. Record the originating product and symptom in the PR description.
2. Prefer platform-level fixes over product-specific workarounds.
3. Link related public Atlas issues when available.
4. Do not include secrets, proprietary URLs, or private customer data.

Upgrade and propagation policy: [Upgrades](docs/how-we-build/upgrades.md) and
[ADR-0010](docs/adr/0010-atlas-upgrades-downstream-propagation.md).

## Coding agents

[AGENTS.md](AGENTS.md) is authoritative for automated coding agents working in this repository.
Agents must:

- use `@/lib/api` and feature-module patterns—not raw `fetch()` in UI layers;
- use `useConfig()` / `getServerConfig()`—not `process.env`;
- handle loading, empty, error, and success states;
- run relevant validation before claiming completion.

If agent instructions conflict with `docs/_archive/`, **AGENTS.md and current docs win**.

## Maintainer vs contributor differences

| Topic         | Maintainers                                                   | External contributors / downstream forks                       |
| ------------- | ------------------------------------------------------------- | -------------------------------------------------------------- |
| Merge rights  | Yes, per CODEOWNERS                                           | Via PR to this repository, or via the product fork             |
| Public claims | Must update claims register                                   | Should not change public positioning without maintainer review |
| ADRs          | Required for platform decisions                               | Optional in a fork; upstream significant decisions             |
| Release tags  | Own platform releases                                         | Own product release cadence                                    |
| Showcase copy | Coordinate via [shipwithatlas.com](https://shipwithatlas.com) | N/A                                                            |

## Questions

Open a GitHub issue with the Bug, Feature, or Documentation form for non-sensitive platform work. Do
not disclose security vulnerabilities in public issues — see [SECURITY.md](SECURITY.md).
