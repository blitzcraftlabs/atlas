# Documentation Policy

> Keep docs authoritative. Kill duplication. Require ADRs for major decisions.

## Where Documentation Lives

| Type                        | Location             | Examples                                      |
| --------------------------- | -------------------- | --------------------------------------------- |
| **Platform conventions**    | `docs/how-we-build/` | folder-structure, architecture-ownership, api |
| **Architecture decisions**  | `docs/adr/`          | Why we chose X over Y                         |
| **Public capabilities**     | `docs/public/`       | FAQ, architecture, capabilities               |
| **Claims and evidence**     | `docs/audit/`        | claims-register, showcase follow-up           |
| **Contributing**            | `CONTRIBUTING.md`    | Access model, PRs, validation                 |
| **Security reporting**      | `SECURITY.md`        | Private vulnerability reporting               |
| **Agent rules**             | `AGENTS.md`          | Coding agent authority                        |
| **Component docs**          | Storybook            | UI components with examples                   |
| **API contracts**           | `openapi/`           | OpenAPI specification                         |
| **Public product landing**  | Root `README.md`     | OSS product page: identity, quick start, docs |
| **Historical/experimental** | `docs/_archive/`     | Superseded documentation (non-canonical)      |

## Rules

### 1. Single Source of Truth

- Each topic has **one** canonical document
- `docs/how-we-build/` is the authoritative source for internal conventions
- `docs/public/` is the authoritative source for external capability descriptions
- Don't create alternate docs that cover the same topic

### 2. ADRs for Major Decisions

Create an ADR when you:

- Choose a library over alternatives
- Establish a pattern the team must follow
- Deprecate or replace an existing pattern
- Make a decision that's hard to reverse

### 3. Root README is the public product landing page

The root `README.md` is Atlas's **public product landing page**. Deep architecture, contributor
procedures, and implementation conventions remain canonical in docs.

The landing page should:

- state the product identity clearly;
- show the public CLI path, and the clone path as contributor/evaluation workflow;
- summarize verified capabilities with links into docs;
- not duplicate contributor command dumps, example route tables, or How We Build indexes.

### 4. Archive, Don't Delete

When documentation becomes outdated:

1. Move to `docs/_archive/[YYYY-MM]-[description]/`
2. Don't modify the archived content (except archive banners)
3. Update links in canonical docs
4. Keep git history intact (use `git mv`)

Canonical docs **must not** link into `docs/_archive/`. `pnpm docs:check` enforces this.

### 5. Root CONTRIBUTING.md

`CONTRIBUTING.md` at the repository root is the canonical contribution guide. Do not duplicate it in
`docs/how-we-build/` unless linking to specific sections.

### 6. Experimental Docs Go to Archive First

AI-generated or experimental documentation:

1. Start in `docs/_archive/[YYYY-MM]-experimental/`
2. Review and validate against codebase
3. If accurate, promote to canonical docs
4. If not, leave archived with a note

### 7. Claims Register Reviews

Update [claims-register.md](../audit/claims-register.md) when public claims, CI gates, or Showcase
copy change. Review policy:

- on relevant PRs;
- quarterly;
- before every tagged release.

### 8. No Infrastructure Without Features

Do not add infrastructure services (Postgres, Redis, etc.) to the default Docker Compose unless:

- A shipped feature or demo requires it
- It's behind a profile (never starts by default)
- It's documented in [local-dev-composition.md](local-dev-composition.md)

Atlas is a pure frontend platform. Keep `pnpm dev` fast.

## Maintaining Documentation

### When Adding a Feature

1. Update relevant `docs/how-we-build/` or `docs/public/` doc
2. Update the claims register if capabilities or positioning change
3. Create ADR if it's a significant pattern change
4. Update Storybook if it involves UI
5. Run `pnpm docs:check`

### When Reviewing PRs

Check that:

- New patterns are documented
- Existing docs are updated if behavior changes
- No duplicate documentation created
- Claims register updated for material public claims
- No new links from canonical docs to `docs/_archive/`

### When Docs Conflict

If you find conflicting information:

1. Determine which is correct (check the code)
2. Update canonical doc in `docs/how-we-build/` or `docs/public/`
3. Archive the outdated version
4. Update the claims register
5. Note the resolution in PR description

## Link checking

`pnpm docs:check` validates internal Markdown links and heading fragments. It:

- scans maintained surfaces: root `README.md`, `AGENTS.md`, `CONTRIBUTING.md`, `docs/public`,
  `docs/how-we-build`, `docs/adr`, `docs/audit`, and `.github`;
- excludes `docs/_archive`, nested package READMEs, `.cursor`, and build artifacts;
- strips fenced code and inline code before extracting links;
- flags missing files and fragments;
- flags canonical → archive links.

It does **not** check external HTTP links unless you pass `--external` (best-effort; may flake).

## Quick Reference

```
README.md             ← Public product landing page
CONTRIBUTING.md       ← How to contribute
AGENTS.md             ← Coding agent authority
docs/
├── public/           ← External capability docs
├── how-we-build/     ← Internal conventions
├── adr/              ← Architecture decisions
├── audit/            ← Claims register and audits
└── _archive/         ← Historical only (non-canonical)
```

**The root README is Atlas's public product landing page. Canonical platform guidance lives in
`AGENTS.md`, `docs/public`, and `docs/how-we-build/`.**
