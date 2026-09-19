# Quickstart

> What to expect when you run Atlas for the first time.

---

## Overview

Atlas is an open-source frontend platform for Next.js teams. When you run it, you get:

- A Next.js application with TypeScript strict mode
- Source-owned UI, config, and consent packages in your repository
- An executable `atlas.config.json` project contract
- Configured tooling (linting, testing, type checking)
- A **starter application** (`apps/web`) with minimal `/examples` pattern pages
- A separate **reference application** (`apps/reference`) that demonstrates a finished Atlas product

`apps/reference` is the evaluation harness. It is not the consumer bootstrap created by
`atlas init`.

---

## Public CLI

```bash
pnpm dlx @blitzcraftlabs/atlas init my-app
cd my-app
pnpm install
pnpm dev
```

Requires Node.js `>=22` and pnpm `>=10`. `@blitzcraftlabs/atlas` is live on npm. Current versions
are listed on [npm](https://www.npmjs.com/package/@blitzcraftlabs/atlas) and
[GitHub Releases](https://github.com/blitzcraftlabs/atlas/releases). Canonical GitHub `v1.0.0`
remains the first stable platform release; `v1.0.1` is the first npm-published Atlas release.

---

## Clone this repository

Contributors and evaluators can still work from a checkout:

- **Node.js 22+**
- **pnpm 10+**

```bash
git clone https://github.com/blitzcraftlabs/atlas.git
cd atlas
corepack enable
pnpm install
```

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for contributor workflow.

---

## Starter workflow

`apps/web` is the clean consumer starting point. It contains only the removable `/examples` pattern
pages — use it when you want to build your own product on Atlas.

```bash
cp apps/web/.env.example apps/web/.env.local
pnpm --filter @atlas/web dev
```

The starter launches at `http://localhost:3000`.

The default `.env.local` copy runs `/examples` with same-origin mock APIs under `/api/examples/*` —
no OAuth setup required.

---

## Reference application workflow

The reference application provides the complete zero-credential evaluation journey:

- `anonymous`
- `reference-user`
- `reference-admin`

plus deterministic API scenarios.

```bash
cp apps/reference/.env.example apps/reference/.env.local
pnpm --filter @atlas/reference dev
```

The reference application launches at `http://localhost:3001`.

Developer harness: `http://localhost:3001/harness`

### Reference routes

| Route            | Demonstrates                                                |
| ---------------- | ----------------------------------------------------------- |
| `/`              | Capability map — truthful runtime coverage with links       |
| `/users`         | Primary OpenAPI + React Query + forms domain example        |
| `/profile`       | Session contract consumption                                |
| `/settings`      | Theme preference, consent integration, i18n convention      |
| `/authorization` | Permission checks and resource-policy enforcement           |
| `/platform`      | Safe runtime diagnostics (config, analytics, observability) |
| `/harness`       | Developer-only persona and API scenario simulation          |

`apps/reference` demonstrates **runtime application capabilities**. Atlas CLI, Doctor, generators,
CI workflows, governance, Storybook, and bundle budgets are validated separately — they are
intentionally not represented as fake application screens.

Use the harness to switch personas and API scenarios without Google OAuth or an external backend.
Development and reference only — **not** evidence of production OAuth or API security.

See [Reference harness](../how-we-build/reference-harness.md) for personas, scenarios, reset, and
test helpers.

---

## Real Google OAuth and external API

For production-like auth in your product, configure Google OAuth credentials and point
`NEXT_PUBLIC_API_URL` at your backend. OAuth routes live under `/api/auth/google/*` in the starter
when wired in.

See the canonical [environment variables](../how-we-build/env.md) guide (OAuth profile) and
[ADR 0004: Google OAuth with PKCE](../adr/0004-oauth-google-pkce.md).

---

## What You'll See

### Home page

Landing page with a link to **View examples** and platform overview copy.

### Examples (`/examples`)

Small reference section included in the starter template:

| Route            | What it demonstrates                      |
| ---------------- | ----------------------------------------- |
| `/examples`      | Overview                                  |
| `/examples/data` | React Query + loading/empty/error/success |
| `/examples/form` | Zod validation + server field errors      |

Examples use in-memory mock APIs under `/api/examples/*`. State resets on server restart.

### Data state modes

Force UI states via query param on the data example:

- `/examples/data?mode=success`
- `/examples/data?mode=empty`
- `/examples/data?mode=error`
- `/examples/data?mode=slow`

---

## Developer tools

- **React Query Devtools** — when examples routes mount `DataProviderLayout`
- **Storybook** — `pnpm storybook` → `http://localhost:6006`
- **`/__flags`** — feature flag dev panel (development only)

---

## What comes next

1. Run `apps/web` if you want the starter, or `apps/reference` if you want to inspect a finished
   Atlas application
2. Read [Architecture](architecture.md) for the system mental model
3. Delete `app/examples/`, `features/examples/`, and `api/examples/` when you start your product
4. Add features under `apps/web/src/features/` following `apps/reference/src/features/users/` for
   OpenAPI APIs

See [Examples](examples.md) for more detail.
