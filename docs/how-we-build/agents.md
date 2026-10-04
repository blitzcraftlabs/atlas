# Atlas agent workflow

> **Canonical workflow for humans and coding agents extending Atlas.**

Coding agents must use the same executable contracts as humans: project contract, CLI generators,
Doctor, upgrade planning, and standard engineering validation. Vendor-specific guidance (Cursor
rules, skills) is a thin adapter — never an alternate architecture.

See also: [Atlas CLI](cli.md), [Atlas Doctor](doctor.md), [Upgrades](upgrades.md),
[Architecture ownership](architecture-ownership.md).

---

## Source-of-truth hierarchy

When guidance conflicts, resolve in this order:

1. `atlas.config.json` / resolved Atlas project contract (`@atlas/project`)
2. Atlas CLI generators and command metadata
3. `atlas doctor` diagnostics
4. `atlas upgrade` plans and migration metadata
5. ADRs and canonical documentation in `docs/how-we-build/` and `docs/adr/`
6. `AGENTS.md` workflow and judgment guidance
7. Vendor-specific adapters (for example `.cursor/rules`, `.cursor/skills`)

If a Cursor rule contradicts Doctor or the resolved project contract, the Cursor rule is wrong.

---

## Generic agent entry point

Start from repository root **`AGENTS.md`**, then:

```bash
pnpm --filter @blitzcraftlabs/atlas build
pnpm atlas context --json
```

`atlas context` composes the resolved contract, ownership manifest, generator inventory, Doctor
capabilities, upgrade semantics, validation commands, and documentation references. It does not
introduce a second architecture schema.

Nested `AGENTS.md` files (for example under `apps/web/`) scope local application constraints. They
do not replace the root workflow.

**Portable path:** Generic `AGENTS.md`-compatible agents are the supported portable path. Thin
vendor adapters may exist (for example `CLAUDE.md` → `AGENTS.md`, `.cursor/skills/**`) but Atlas
remains fully operable without them.

---

## Discover → Plan → Implement → Validate → Review

### Discover

1. Read root `AGENTS.md` and this document.
2. Run or read `pnpm atlas context --json`.
3. Inspect relevant ADRs and `docs/how-we-build/` references returned by context.
4. Inspect nearby example or reference implementation before inventing patterns.

### Plan

Separate:

| Category               | Approach                                                    |
| ---------------------- | ----------------------------------------------------------- |
| Structural scaffolding | Use `atlas generate` when a generator exists                |
| Product logic          | Normal source editing in consumer-owned surfaces            |
| Ownership boundaries   | Contract + manifest + Doctor — not duplicated prose         |
| Validation             | Doctor + lint + typecheck + tests (+ build/E2E when needed) |

List supported generators:

```bash
pnpm atlas generate list --json
```

### Implement

**When Atlas has a generator for the structural operation, use it.**

```bash
pnpm atlas generate feature <name> [--query] [--mutation] [--form] [--tests]
pnpm atlas generate page <route>
```

Then implement product behavior in generated shells.

**Surface behavior:**

| Surface                       | Agent behavior                                                                         |
| ----------------------------- | -------------------------------------------------------------------------------------- |
| Generated artifact            | Regenerate with the canonical command; do not hand-edit unless documented              |
| Synced Atlas-managed template | Edits may be valid in the Atlas repo; downstream upgrades use baseline ownership rules |
| Independent / product surface | Edit when implementing product behavior; tooling must not normalize automatically      |

Do not overwrite independent or consumer-owned files based on assumptions.

### Validate

```bash
pnpm atlas doctor --json
pnpm lint && pnpm typecheck && pnpm test
pnpm dependencies:check
```

Run additional checks from `atlas context --json` → `validation.recommended` when your change
requires them (`pnpm build`, `pnpm api:check`, E2E, etc.).

Doctor validates Atlas architecture. It does not replace lint, typecheck, tests, or build.

### Review

Before claiming completion:

- Contract and ownership compliance
- No unintended generated drift
- Doctor result (if architecture-sensitive)
- Test evidence for the change scope

---

## Responding to Doctor diagnostics

Classify failures before auto-fixing:

| Class                       | Examples                                 | Agent behavior                                                                 |
| --------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------ |
| Mechanical / local          | Stale generated OpenAPI client           | Run canonical generator (`pnpm api:gen`); rerun Doctor                         |
| Architectural conflict      | Ownership or boundary violation          | Do not overwrite consumer-owned files; inspect contract/docs; surface conflict |
| Consumer / product decision | Independent wiring differs from baseline | Do not normalize automatically                                                 |
| Unknown / unsafe            | Ambiguous ownership                      | Stop and ask for human judgment                                                |

**Do not** encode “always fix every Doctor diagnostic.” Auto-fix only when remediation is
deterministic and inside authorized change scope.

Doctor JSON includes `code`, `severity`, `message`, `suggestedFix`, optional `documentation`, and
`path`. See [doctor.md](doctor.md).

---

## Upgrade and migration workflow

Upgrade state comes from the CLI, not from guessing from Git diffs. Treat the dry-run plan and
result as authoritative:

```bash
pnpm atlas upgrade --dry-run --json
```

Do not infer blocking from `category` alone. The upgrade command decides whether an upgrade is safe,
blocked, manual, or actionable from plan items (`conflict`), result `status`, and unresolved
migration or package work.

| Signal                                 | Agent behavior                                                                   |
| -------------------------------------- | -------------------------------------------------------------------------------- |
| `manual-review`                        | Do not silently overwrite; may or may not block the whole upgrade                |
| `security-critical`                    | Elevated importance — inspect `conflict` and result `status`, not category alone |
| `conflict: true`                       | Unresolved conflict requiring attention; dry-run `status` is typically `blocked` |
| `replace`, `create`, `package-upgrade` | Atlas-owned deterministic actions when the plan allows applying                  |
| `regenerate`, `migration`              | Follow registered migration or regeneration command                              |
| Unknown baseline evidence              | Stop; do not apply                                                               |

When the dry-run result blocks, inspect source/baseline/target context, propose a merge, and
implement only when intent is clear — otherwise surface the decision.

See [upgrades.md](upgrades.md) and [ADR-0010](../adr/0010-atlas-upgrades-downstream-propagation.md).

---

## Judgment guidance (not machine rules)

Keep these as human/agent judgment — do not duplicate mechanically:

- Prefer existing abstractions and nearby patterns
- Avoid unnecessary platform layers or speculative package extraction
- Keep consumer product decisions consumer-owned
- Do not refactor unrelated areas
- Stop when ownership is ambiguous

---

## Cursor and other vendor adapters

| Canonical                  | Adapter (convenience only)                    |
| -------------------------- | --------------------------------------------- |
| `AGENTS.md`, this document | `.cursor/rules/atlas-core.mdc`                |
| Executable CLI + context   | `.cursor/skills/build-atlas-feature/SKILL.md` |
| `AGENTS.md`                | `apps/*/CLAUDE.md` (`@AGENTS.md`)             |

Adapters link and delegate to canonical sources. If Cursor disappears tomorrow, Atlas remains
operable via `AGENTS.md`, `pnpm atlas context`, and the CLI.

**Non-goals:** MCP server, hosted Atlas API, autonomous remediation agents, prompt marketplace.

---

## Machine interfaces summary

| Need                    | Command                               |
| ----------------------- | ------------------------------------- |
| Resolved project state  | `pnpm atlas context --json`           |
| Generator inventory     | `pnpm atlas generate list --json`     |
| Architecture validation | `pnpm atlas doctor --json`            |
| Upgrade planning        | `pnpm atlas upgrade --dry-run --json` |
| Contract resolution     | `pnpm atlas:resolve-contract`         |

Do not scrape Markdown or CLI help prose for critical structural state when these commands exist.
