# Atlas

Atlas is an open-source frontend platform for Next.js teams. It gives you a production-shaped
workspace, executable architecture contracts, generators, quality gates, and versioned upgrades —
while keeping your application in your repository and under your control.

---

## What is Atlas?

Atlas is a **frontend platform**, not a hosted service and not a Next.js replacement. You operate it
through the `atlas` CLI and an `atlas.config.json` project contract. That contract is executable:
Doctor, generators, context, and upgrades all read the same source of truth.

The generated application stays **source-owned**. Your Next.js app, UI packages, and configuration
live in your repository. Atlas does not publish a public collection of `@atlas/*` packages. The
public package is `@blitzcraftlabs/atlas`.

Start from the public CLI (`pnpm dlx @blitzcraftlabs/atlas init my-app`), or from a clone of this
repository. Explore `apps/reference` to see a finished Atlas product, then delete `/examples` and
build on the platform primitives.

### Two applications

| Application      | Role                                                                 |
| ---------------- | -------------------------------------------------------------------- |
| `apps/web`       | Clean consumer starter — removable `/examples` pattern pages only    |
| `apps/reference` | Executable finished reference product — full Atlas architecture demo |

`apps/reference` is the evaluation harness. It is **not** the consumer bootstrap created by
`atlas init`.

```bash
pnpm --filter @atlas/reference dev
```

Reference application URL: `http://localhost:3001` (developer harness at `/harness`).

---

## Who is Atlas for?

- **Product teams** who want a maintained platform lifecycle, not a one-time starter
- **Frontend engineers** who want executable architecture instead of conventions that live only in
  docs
- **Organizations** adopting Atlas as a public Apache-2.0, source-owned workspace

Atlas is a public open-source platform. Commercial engineering or support is optional and separate
from using the source.

---

## Documentation

| Document                                                            | What You'll Learn                          |
| ------------------------------------------------------------------- | ------------------------------------------ |
| [Quickstart](quickstart.md)                                         | Public CLI, clone path, evaluation         |
| [Architecture](architecture.md)                                     | System design and mental model             |
| [Examples](examples.md)                                             | Reference patterns in the template         |
| [Capabilities](capabilities.md)                                     | What Atlas solves and why it matters       |
| [Decisions](decisions.md)                                           | Key engineering choices and tradeoffs      |
| [FAQ](faq.md)                                                       | Common questions answered                  |
| [Releases & Governance](../how-we-build/releases-and-governance.md) | Versioning, licensing, support (canonical) |

---

## Reference examples

The template includes `/examples` — thin pages for data states and forms. Delete them when you start
building. The interactive showcase is maintained at [shipwithatlas.com](https://shipwithatlas.com).

See [Examples](examples.md).

---

## Production history (summary)

Atlas has been exercised through real products. Use these categories exactly. This is qualified
historical evidence, not a landing-page claim about current adoption metrics.

| Category                  | Products                                                                                                                         |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Built from Atlas**      | Aviatopia; BlitzCraft Studio (Publishing Platform); Ax402 Clients; thedanielmark-site; xgas-station-app; bridge-indexer-frontend |
| **Migrated toward Atlas** | gitmyabi-app; cha-ching-app                                                                                                      |

Per-product metrics, chronology, and endorsements are not fully published in this repository. See
the [claims register](../audit/claims-register.md) for qualified terminology and evidence limits.
