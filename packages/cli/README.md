# `@blitzcraftlabs/atlas`

Atlas is an open-source frontend platform for Next.js teams. It gives you a production-shaped
workspace, executable architecture contracts, generators, quality gates, and versioned upgrades —
while keeping your application in your repository and under your control.

This package is the public **Atlas CLI**: `atlas`. Internal `@atlas/*` workspaces stay private
source inside Atlas and generated projects. They are not published to npm.

## Quick start

```bash
pnpm dlx @blitzcraftlabs/atlas init my-app
cd my-app
pnpm install
pnpm atlas doctor
pnpm dev
```

`pnpm dlx` bootstraps a new repository. After init, the project pins `@blitzcraftlabs/atlas` and the
normal command is `pnpm atlas`.

Requires Node.js `>=22` and pnpm `>=10`.

You can also install the CLI globally:

```bash
pnpm add -g @blitzcraftlabs/atlas
atlas init my-app
```

The generated project stays in the directory you created. Atlas does not host your application.

## Requirements

- Node.js `>=22`
- pnpm `>=10` for the supported Atlas workflow

## What Atlas creates

`atlas init my-app` materializes a complete source-owned workspace:

- `apps/web` — the Next.js App Router product application
- source-owned UI, config, and consent packages inside the generated repository
- `atlas.config.json` — the executable project contract
- `.github/workflows/ci.yml` — a portable GitHub-hosted quality baseline
- Atlas ownership and sync metadata used by Doctor and upgrades

The generated application, packages, and configuration live in your repository. You modify them
there. Atlas does not replace Next.js, and it does not publish those internal `@atlas/*` packages as
independent npm products.

## CLI

```bash
atlas init my-app
atlas doctor
atlas generate feature users --query --mutation --form
pnpm atlas doctor
pnpm atlas context --json
pnpm atlas enable list --json
pnpm atlas upgrade --dry-run
pnpm atlas upgrade
```

Inside a generated project those commands use the pinned CLI. `pnpm dlx @blitzcraftlabs/atlas init`
is only for creating the repository.

| Command                        | Purpose                                                                    |
| ------------------------------ | -------------------------------------------------------------------------- |
| `atlas init <project>`         | Create a source-owned Atlas project from packaged bootstrap assets         |
| `atlas doctor`                 | Check Atlas contract and architecture drift                                |
| `atlas generate feature\|page` | Scaffold structural product surfaces                                       |
| `atlas context [--json]`       | Resolve the executable project contract for agents                         |
| `atlas enable <id>`            | Opt in to Storybook, coverage, hooks, Docker, and other tooling            |
| `pnpm atlas upgrade`           | Plan or apply an upgrade to the latest stable release, or `--to <version>` |

`atlas enable` is part of the pinned local CLI. Historical npm 1.1.0 did not include it.
`atlas upgrade` does not install optional tooling.

Selected supported flags:

- `atlas init`: `--dry-run`, `--json`, `--env skip|copy`
- `atlas doctor`: `--json`, `--cwd <path>`
- `atlas generate`: `--query`, `--mutation`, `--form`, `--tests`, `--dry-run`, `--json`
- `atlas context`: `--json`, `--cwd <path>`
- `atlas enable`: `--dry-run`, `--json`, `--cwd <path>`
- `atlas upgrade`: `--to <version>`, `--dry-run`, `--json`, `--allow-dirty`

Which surfaces are SemVer-frozen is defined by the
[1.0 stability contract](https://github.com/blitzcraftlabs/atlas/blob/main/docs/how-we-build/releases-and-governance.md#atlas-10-stability-contract).

Run `atlas <command> --help` for the full command surface.

## Architecture contract

Doctor, generators, and context share the same executable project contract (`atlas.config.json`,
resolved through Atlas's contract loader). They do not infer architecture from documentation or
ad-hoc file layout.

That is why `atlas context --json` is the agent entry point, `atlas generate` scaffolds into
contract-defined locations, and `atlas doctor` reports drift against the same ownership and
workspace rules.

## Upgrades

`atlas upgrade --to <version>` loads production release evidence from **this installed package**,
not from a consumer `releases/` tree.

- The support window is the current Atlas release plus the immediately previous supported production
  release, adjacent upgrades only.
- Consumer-owned and modified synced paths are never overwritten automatically.
- Missing packaged evidence fails closed.

After 1.0, breaking public-contract changes require a major version.

## What this package is not

- Not a Next.js replacement
- Not a hosted SaaS or PaaS
- Not a public collection of `@atlas/*` npm packages
- Not a component library published independently of the Atlas workspace

Internal `@atlas/*` packages are source-owned internals that ship inside generated projects. The
only public npm package is `@blitzcraftlabs/atlas`.

## Links

- GitHub: [https://github.com/blitzcraftlabs/atlas](https://github.com/blitzcraftlabs/atlas)
- Website: [https://shipwithatlas.com](https://shipwithatlas.com)
- Documentation:
  [https://github.com/blitzcraftlabs/atlas/blob/main/docs/public/README.md](https://github.com/blitzcraftlabs/atlas/blob/main/docs/public/README.md)
- Issues:
  [https://github.com/blitzcraftlabs/atlas/issues](https://github.com/blitzcraftlabs/atlas/issues)
- License: [Apache-2.0](https://github.com/blitzcraftlabs/atlas/blob/main/LICENSE)
