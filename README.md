# Atlas

Atlas is an open-source frontend platform for Next.js teams. It gives you a production-shaped
workspace, executable architecture contracts, generators, quality gates, and versioned upgrades —
while keeping your application in your repository and under your control.

[![CI](https://img.shields.io/github/actions/workflow/status/blitzcraftlabs/atlas/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/blitzcraftlabs/atlas/actions/workflows/ci.yml)
[![coverage](https://img.shields.io/codecov/c/github/blitzcraftlabs/atlas/main?style=flat-square&label=coverage)](https://app.codecov.io/gh/blitzcraftlabs/atlas)
[![UI Quality](https://img.shields.io/github/actions/workflow/status/blitzcraftlabs/atlas/ui-quality.yml?branch=main&style=flat-square&label=UI%20Quality)](https://github.com/blitzcraftlabs/atlas/actions/workflows/ui-quality.yml)
[![Security Audit](https://img.shields.io/github/actions/workflow/status/blitzcraftlabs/atlas/security-audit.yml?branch=main&style=flat-square&label=Security%20Audit)](https://github.com/blitzcraftlabs/atlas/actions/workflows/security-audit.yml)
[![release](https://img.shields.io/github/v/release/blitzcraftlabs/atlas?style=flat-square&label=release)](https://github.com/blitzcraftlabs/atlas/releases)
[![license](https://img.shields.io/github/license/blitzcraftlabs/atlas?style=flat-square)](LICENSE)

[Website](https://shipwithatlas.com) · [Documentation](docs/public/README.md) ·
[Releases](https://github.com/blitzcraftlabs/atlas/releases)

## What is Atlas?

Atlas is a **frontend platform**, not a hosted service and not a Next.js replacement. You operate it
through the `atlas` CLI and an `atlas.config.json` project contract. That contract is executable:
Doctor, generators, context, and upgrades all read the same source of truth instead of inferring
structure from documentation.

The generated application stays **source-owned**. Your Next.js app, UI packages, and configuration
live in your repository and remain under your control. Atlas does not publish a public collection of
`@atlas/*` packages. The public package is `@blitzcraftlabs/atlas`.

## Quick start

```bash
pnpm dlx @blitzcraftlabs/atlas init my-app
cd my-app
pnpm install
pnpm dev
```

Requires Node.js `>=22` and pnpm `>=10`. The public CLI is
[`@blitzcraftlabs/atlas`](https://www.npmjs.com/package/@blitzcraftlabs/atlas). Published versions
are listed on npm and [GitHub Releases](https://github.com/blitzcraftlabs/atlas/releases). Canonical
GitHub `v1.0.0` remains the first stable platform release; `v1.0.1` is the first npm-published Atlas
release.

```text
Open http://localhost:3000
```

### Clone this repository

Contributors and evaluators can still work from a checkout of this repository:

```bash
git clone https://github.com/blitzcraftlabs/atlas.git
cd atlas
corepack enable
pnpm install
cp apps/web/.env.example apps/web/.env.local
pnpm --filter @atlas/web dev
```

## What you get

| Capability                                                       | What it does                                                                                 |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| [`atlas init`](docs/how-we-build/cli.md)                         | Create a source-owned Atlas project from packaged bootstrap assets                           |
| [`atlas doctor`](docs/how-we-build/doctor.md)                    | Check contract, ownership, and architecture drift                                            |
| [`atlas generate`](docs/how-we-build/cli.md)                     | Scaffold features and App Router pages from the same contract                                |
| [`atlas context --json`](docs/how-we-build/agents.md)            | Expose the executable project contract to humans and coding agents                           |
| [`atlas upgrade`](docs/how-we-build/upgrades.md)                 | Plan versioned upgrades without silently overwriting consumer changes                        |
| [`atlas.config.json`](docs/how-we-build/atlas-contract.md)       | Author-written project contract shared by CLI, Doctor, generators, and upgrades              |
| [Source ownership](docs/how-we-build/architecture-ownership.md)  | Generated code lives in your repo; upgrade planning detects consumer modifications           |
| [UI quality gates](.github/workflows/ui-quality.yml)             | Storybook interaction, accessibility, and visual checks on critical compositions             |
| [Security policy and gates](SECURITY.md)                         | Private vulnerability reporting plus blocking HIGH/CRITICAL dependency policy                |
| [Clean-room distribution verification](docs/how-we-build/cli.md) | Packed CLI must init, install, build, and diagnose a generated project outside this checkout |

## Why Atlas?

Atlas is more than a one-time starter template.

| Typical starter                              | Atlas                                 |
| -------------------------------------------- | ------------------------------------- |
| Initial scaffold                             | Maintained platform lifecycle         |
| Conventions in docs                          | Executable architecture contract      |
| Architecture can drift silently              | Doctor checks drift                   |
| One-time scaffolding                         | Supported generators                  |
| Manual template updates                      | Versioned upgrade planning            |
| Agent infers structure                       | `atlas context` exposes the contract  |
| Consumer changes can be overwritten manually | Upgrade planner detects modifications |

Atlas is not a component library, a hosted PaaS, or a certified security/WCAG/LTS product.

## How Atlas works

```text
init
→ build product
→ doctor
→ generate
→ context
→ upgrade
```

`atlas init` materializes a complete Next.js workspace into a directory you own. You then build
product code in that repository. Doctor checks that the project still matches the Atlas contract.
Generators add structural surfaces without inventing a second architecture. `atlas context --json`
exposes the same contract to agents. `atlas upgrade` plans the next Atlas version from packaged
release evidence and refuses to overwrite files you have modified.

The generated project remains source-owned: Atlas ships with your application, it does not host it.

## Evaluate Atlas

`apps/reference` is the **executable reference application**. It is not the consumer bootstrap. Use
it to inspect a finished Atlas product with auth, API, authorization, and platform diagnostics.

From a clone of this repository:

```bash
cp apps/reference/.env.example apps/reference/.env.local
pnpm --filter @atlas/reference dev
```

Open `http://localhost:3001`. The developer harness is at `/harness`.

The consumer starting surface created by `atlas init` is `apps/web`, not `apps/reference`.

## Documentation

| Audience     | Start here                                                                                |
| ------------ | ----------------------------------------------------------------------------------------- |
| Public docs  | [Overview](docs/public/README.md) · [Quickstart](docs/public/quickstart.md)               |
| Architecture | [Architecture](docs/public/architecture.md) · [Capabilities](docs/public/capabilities.md) |
| Examples     | [Examples](docs/public/examples.md) · [FAQ](docs/public/faq.md)                           |
| How We Build | [Conventions](docs/how-we-build/README.md) · [ADRs](docs/adr/README.md)                   |
| Releases     | [Releases and governance](docs/how-we-build/releases-and-governance.md)                   |
| Contribute   | [CONTRIBUTING.md](CONTRIBUTING.md)                                                        |
| Security     | [SECURITY.md](SECURITY.md)                                                                |

## Contributing

Atlas is open source under Apache License 2.0. Clone, fork, and pull requests are welcome. See
[CONTRIBUTING.md](CONTRIBUTING.md) for the access model, validation, and PR expectations.

## Security

Report vulnerabilities privately through GitHub Private Vulnerability Reporting. See
[SECURITY.md](SECURITY.md). Atlas includes documented security controls and blocking dependency
policy; it is not independently audited and does not claim certification.

## License

Apache License 2.0. See [`LICENSE`](LICENSE).

The public npm package is `@blitzcraftlabs/atlas`. Internal `@atlas/*` workspaces are source-owned
internals and are **not** independently published to npm.
