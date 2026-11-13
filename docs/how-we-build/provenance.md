# Provenance and redistribution audit

Engineering evidence for third-party code and asset provenance. This is **not legal advice** or a
compliance certification.

**Related:** Apache-2.0 [`LICENSE`](../../LICENSE),
[Releases and Governance](releases-and-governance.md),
[`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md),
[`license-exceptions.json`](../../license-exceptions.json).

---

## 1. Audit scope

### Current tree (HEAD)

| Surface                                                                                 | Reviewed                                |
| --------------------------------------------------------------------------------------- | --------------------------------------- |
| `LICENSE`, `package.json` manifests, workspace packages                                 | Yes                                     |
| `packages/ui/**` (shadcn/Base UI evolution)                                             | Yes — primary risk area                 |
| `packages/cli`, `packages/project`, `packages/config`, `packages/consent`               | Yes                                     |
| `apps/web`, `apps/reference` (`src/lib`, fixtures, providers)                           | Yes                                     |
| `docs/**`, `docs/_archive/**`                                                           | Yes                                     |
| `templates/**`, `.github/**`, `scripts/**`, `openapi/**`, `.storybook/**`, `.cursor/**` | Yes                                     |
| `public/**`, committed binary assets                                                    | Yes — **none at HEAD**                  |
| `.gitignore`, `.npmrc`, `pnpm-lock.yaml`, `renovate.json`                               | Yes                                     |
| Git LFS (`.gitattributes`)                                                              | **Not used** — no `.gitattributes` file |

### Git history

Risk-based sampling with reproducible commands (see §6). Full line-by-line provenance was **not**
performed for trivial Atlas-authored files. Historical evidence requires a **full Git clone** —
shallow checkouts cause `pnpm provenance:history` to fail with remediation instructions.

---

## 2. Current third-party provenance

| Surface                                                                                      | Upstream                   | Classification                                | License                              | Action                                      |
| -------------------------------------------------------------------------------------------- | -------------------------- | --------------------------------------------- | ------------------------------------ | ------------------------------------------- |
| `packages/ui/src/components/ui/*` (50+ files)                                                | shadcn/ui Vega preset      | shadcn-generated → Atlas-modified (see §3)    | shadcn MIT; Base UI MIT (dependency) | `THIRD_PARTY_NOTICES.md` shadcn MIT notice  |
| `@base-ui/react` imports                                                                     | MUI Base UI                | dependency-only                               | MIT                                  | `pnpm licenses:check`                       |
| `packages/ui` Atlas compositions (`empty-state`, `error-fallback`, `loader`, `theme-toggle`) | Atlas                      | Atlas-authored composition on shadcn surfaces | Apache-2.0                           | None                                        |
| `apps/*/src/lib/api/contracts/schema.ts`                                                     | openapi-typescript         | generated                                     | MIT (tool)                           | Header preserved                            |
| `apps/*/src/lib/**` (API, auth, CSP, telemetry)                                              | Atlas (+ framework idioms) | Atlas-authored                                | Apache-2.0                           | None                                        |
| `packages/cli` generators                                                                    | Atlas                      | Atlas-authored templates                      | Apache-2.0                           | None                                        |
| Docs archived Radix references                                                               | shadcn/Radix era docs      | historical-only prose                         | N/A                                  | Update stale claims (see §3)                |
| Fonts (Inter)                                                                                | `next/font/google`         | build-time fetch; self-hosted in build output | SIL OFL-1.1 (Inter)                  | No font binaries in Git; see §4 and notices |
| npm dependencies (transitive inventory)                                                      | npm registry               | dependency-only                               | See `pnpm licenses:report`           | Policy in `scripts/license-policy.mjs`      |

**Distinction:** dependency licenses (`pnpm licenses:check`) ≠ copied-source provenance (this doc +
`THIRD_PARTY_NOTICES.md`).

---

## 3. shadcn / Radix / Base UI

### Method

Provenance for `packages/ui/src/components/ui/**` was determined from **Git file origin and
history**, not from whether a component imports `@base-ui/react`. A native-DOM shadcn template is
still shadcn-derived.

Primary evidence:

| Source                                                                               | Use                                                           |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| Commit `3099c4b` (`feat(ui): reset @atlas/ui onto shadcn Base UI Vega preset (#42)`) | Bulk regenerate/refresh of upstream shadcn Vega primitives    |
| `packages/ui/components.json` (`style: base-vega`, schema from shadcn)               | Locked generation target                                      |
| Per-file `git log -- packages/ui/src/components/ui/<file>.tsx`                       | First introduction and later Atlas-only edits                 |
| `packages/ui/README.md`                                                              | Documents locked preset `bJzBPQGZc` and regeneration workflow |

**Key distinction:** copied/generated upstream source (shadcn MIT) vs independently Atlas-authored
source (Apache-2.0). Substantial Atlas modification does **not** reclassify shadcn-generated files
as Atlas-authored.

### Current HEAD — component classification

| File / group                                                                                                                                                                                                                                                                                                                                                                                                                                               | Origin evidence                                                                                                                                                                                                                                                                                     | Current primitive dependency                                                                                            | Classification                    | Notice                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------- | -------------------------- |
| **Base UI Vega preset — regenerated in `3099c4b`** (`accordion`, `alert-dialog`, `avatar`, `badge`, `breadcrumb`, `button`, `button-group`, `checkbox`, `collapsible`, `combobox`, `context-menu`, `dialog`, `drawer`, `dropdown-menu`, `hover-card`, `input`, `item`, `menubar`, `navigation-menu`, `popover`, `progress`, `radio-group`, `scroll-area`, `select`, `separator`, `sheet`, `slider`, `switch`, `tabs`, `toggle`, `toggle-group`, `tooltip`) | `3099c4b`; prior Radix/shadcn lineage from `abbc212` / `71f6516`                                                                                                                                                                                                                                    | `@base-ui/react/*`                                                                                                      | shadcn-generated → Atlas-modified | shadcn MIT                 |
| **Native/DOM Vega preset — regenerated in `3099c4b`** (`alert`, `aspect-ratio`, `card`, `empty`, `field`, `form`, `input-group`, `kbd`, `label`, `native-select`, `pagination`, `skeleton`, `sonner`, `spinner`, `table`, `textarea`)                                                                                                                                                                                                                      | `3099c4b`; several trace to earlier shadcn/Radix-era commits (`abbc212`, `71f6516`, `1437a64`, `4bdf1a0`, `705ceef`, `8a330d2`) but were **replaced/refreshed** from shadcn Vega in `3099c4b` (for example `field.tsx` diff removes `@radix-ui/react-slot` and adopts shadcn `data-slot` structure) | native DOM / wrapper only                                                                                               | shadcn-generated → Atlas-modified | shadcn MIT                 |
| **Extended shadcn — regenerated in `3099c4b`** (`calendar`, `carousel`, `chart`, `command`, `input-otp`, `resizable`)                                                                                                                                                                                                                                                                                                                                      | `3099c4b`; shadcn extended set                                                                                                                                                                                                                                                                      | `react-day-picker`, `embla-carousel-react`, `recharts`, `cmdk`, `input-otp`, `react-resizable-panels` (dependency-only) | shadcn-generated → Atlas-modified | shadcn MIT + npm inventory |
| **Atlas behavioral compositions** (`empty-state`, `error-fallback`, `loader`, `theme-toggle`)                                                                                                                                                                                                                                                                                                                                                              | Independent introduction: `ae4a70c` (app-state kit), `fb479db` (theme toggle); later adapted in `3099c4b` to compose canonical shadcn surfaces without replacing authorship                                                                                                                         | composes shadcn primitives (`Empty`, `Alert`, `Button`, `Spinner`, `DropdownMenu`, …)                                   | Atlas-authored composition        | Apache-2.0                 |

**How the conclusion was established:** `git show 3099c4b --stat -- packages/ui/src/components/ui/`
lists all Vega-regenerated primitives. Files such as `card.tsx` and `alert.tsx` use native DOM only
but were rewritten in `3099c4b` with shadcn Vega structure (`data-slot`, preset token classes). Only
the four composition files above retain independent Atlas introduction commits and composition logic
after the preset reset.

**Upstream licenses (verified 2026-08-27):**

| Upstream                                                                                      | License | Copied into repo?                                                                        |
| --------------------------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------- |
| [shadcn/ui](https://github.com/shadcn-ui/ui/blob/main/LICENSE.md)                             | MIT     | Yes — shadcn-generated/refreshed component source under `packages/ui/src/components/ui/` |
| [@base-ui/react](https://github.com/mui/base-ui/blob/master/LICENSE)                          | MIT     | **No** — npm dependency only                                                             |
| [Radix UI Primitives](https://www.radix-ui.com/primitives/docs/overview/introduction#license) | MIT     | Historical Git blobs only (pre-`3099c4b`)                                                |

**Required/prudent notices:** shadcn MIT text in
[`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md). Per-file MIT headers are **not**
duplicated across every component (not required for MIT when a central notice is maintained — legal
review may confirm for your distribution model).

**Apache-2.0 compatibility:** MIT upstream source is compatible with Atlas's Apache-2.0 license.

### Historical Radix-era source

| Item                        | Detail                                                                                             |
| --------------------------- | -------------------------------------------------------------------------------------------------- |
| First Radix-era UI commit   | `abbc212` (`feat: add new UI components and utilities`)                                            |
| Migration to Base UI preset | `3099c4b`                                                                                          |
| Evidence                    | Pre-migration `dialog.tsx` imported `@radix-ui/react-dialog`; current uses `@base-ui/react/dialog` |
| Classification              | historical-only copied source (shadcn Radix templates)                                             |
| License                     | MIT (Radix + shadcn ecosystem)                                                                     |
| HEAD action                 | None — replaced at source level                                                                    |
| Git history                 | Blobs remain recoverable; MIT-compatible                                                           |

**Stale documentation:** `docs/how-we-build/accessibility.md` previously claimed Radix primitives at
HEAD — corrected to Base UI. Archived docs under `docs/_archive/` still mention Radix-era setup.

### Base UI — dependency vs copied source

Atlas **does not** copy Base UI implementation source into the repo. Components import
`@base-ui/react/*` as npm dependencies. Copied/adapted material is the **shadcn component shell**
(Tailwind/CVA styling and composition), not Base UI internals.

---

## 4. Assets

### HEAD

`git ls-files` returns **zero** tracked files matching the binary/static asset extensions checked by
`pnpm provenance:check` (see `scripts/provenance-audit.mjs`). Reviewed assets may be explicitly
allowed via [`reviewed-assets.json`](../../reviewed-assets.json) when path and SHA-256 match. The
`license` field records the reviewed redistribution basis for Atlas-authored or commercial assets;
it is informational provenance metadata and is **not** interpreted by the dependency license
classifier (`pnpm licenses:check`).

No `apps/*/public/**` assets are committed. Favicons/icons are not vendored in-repo.

### Fonts

Atlas does **not** commit Inter font binaries to Git. Applications use `next/font/google`, which
obtains the font during the build and self-hosts the resulting font assets in the built application
([Next.js font optimization docs](https://nextjs.org/docs/app/building-your-application/optimizing/fonts)).
Inter is licensed under
[SIL Open Font License 1.1](https://github.com/rsms/inter/blob/master/LICENSE.txt).

| Field                               | Value                                                           |
| ----------------------------------- | --------------------------------------------------------------- |
| Font                                | Inter                                                           |
| License                             | SIL Open Font License 1.1                                       |
| Source                              | `next/font/google` (`import { Inter } from "next/font/google"`) |
| Committed to repository             | **No** — no `.woff`/`.woff2`/`.ttf` tracked at HEAD             |
| Present in built/deployed artifacts | **Yes** — Next.js emits self-hosted font files in build output  |
| Runtime download from Google        | **No** — not the current `next/font/google` model               |

Built artifacts may contain redistributed Inter font software. SIL OFL-1.1 attribution/license
preservation requirements should be respected in distributions containing those generated font
assets. Final notice obligations for specific deployment packaging are a **legal-review item** (see
§13).

### Historical binary assets

Ten PNG design-system screenshots under `packages/ui/design-system-screenshots/` (Atlas UI captures,
synthetic — no third-party dashboards). Removed from HEAD; **still in Git history** (largest ~34
KB).

---

## 5. Generated / vendored source

| Generator               | Output                                   | Classification                          |
| ----------------------- | ---------------------------------------- | --------------------------------------- |
| shadcn CLI              | `packages/ui/src/components/ui/*`        | generated → adapted                     |
| openapi-typescript      | `apps/*/src/lib/api/contracts/schema.ts` | generated                               |
| `@blitzcraftlabs/atlas` | feature/page scaffolds                   | Atlas-generated templates               |
| pnpm / turbo            | lockfiles, `.turbo` (ignored)            | generated — not redistributed as source |

**Vendored upstream directories:** none found (`vendor/`, `third_party/`, etc.).

---

## 6. Historical audit

### Commands executed (reproducible)

```bash
# Repository scale
git rev-list --all --count

# Deleted binary assets by extension
git log --all --diff-filter=D --name-only --pretty=format: | sort -u \
  | grep -E '\.(png|jpg|jpeg|webp|gif|svg|ico|woff|woff2|ttf|otf|pdf)$'

# Largest historical blobs (all objects ranked by size, extension classified afterward)
git rev-list --objects --all \
  | git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)' \
  | awk '/^blob/ {print $3, $4}' | sort -rn | head -20

# Radix-era UI migration
git log --all -S '@radix-ui/react-dialog' --oneline -- packages/ui
git show abbc212:packages/ui/src/components/ui/dialog.tsx | head

# Copyright / license header search (no third-party headers in UI source)
git grep -l 'Copyright\|SPDX-License-Identifier' $(git rev-list --all) -- ':!LICENSE' ':!THIRD_PARTY_NOTICES.md'

# Client / proprietary naming spot check
git grep -iE 'attio|proprietary|confidential' $(git rev-list --all --max-count=30)

# Secrets spot check (supporting evidence only)
git grep -iE 'sk_live_|Bearer [a-zA-Z0-9]{20,}' $(git rev-list --all --max-count=50) \
  | grep -v test | grep -v mock | grep -v README
```

Automated wrapper: `pnpm provenance:history` → `node scripts/provenance-audit.mjs --history`

**Reliability:** `pnpm provenance:history` exits non-zero when:

- the repository is a shallow clone (`git rev-parse --is-shallow-repository` → `true`);
- an audit command itself fails (invalid revision, missing tooling, unexpected non-zero status).

Each Git invocation is checked independently; filtering, deduplication, sorting, and ranking happen
in JavaScript only after successful Git output. Expected empty filtered results print `(no matches)`
— they are **not** treated as command failures.

### Sampling strategy

1. Prioritized `packages/ui` (current + Radix → Base UI migration).
2. Enumerated all deleted binary paths.
3. Ranked historical blobs by size (only design-system PNGs surfaced).
4. Spot-checked secrets/client naming — no production credentials found; example placeholders only.

---

## 7. History purge candidates

| Path                                                     | History location                     | Reason                                                                                  | History action                                                    |
| -------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `packages/ui/design-system-screenshots/*.png` (10 files) | Committed then deleted; blobs remain | Low risk (Atlas UI captures) but optional noise for public history                      | **Optional** — purge only if clean history desired; not a blocker |
| —                                                        | —                                    | No proprietary client assets, credentials, or commercial fonts found in sampled history | **`none` required**                                               |

Product/client names appear in `docs/audit/claims-register.md` as **marketing lists**, not copied
client code or assets.

---

## 8. Attribution / notices

| Artifact                                                   | Purpose                                             |
| ---------------------------------------------------------- | --------------------------------------------------- |
| [`LICENSE`](../../LICENSE)                                 | Atlas Apache-2.0                                    |
| [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md)   | shadcn MIT + historical Radix note + generated code |
| This document                                              | Audit methodology, classifications, purge list      |
| [`license-exceptions.json`](../../license-exceptions.json) | Reviewed dependency license dispositions            |

Upstream per-file copyright headers were **not** present in shadcn-generated components; none were
stripped. No bogus per-file attribution added to Atlas-authored helpers.

---

## 9. Dependency-license inventory

**Audit snapshot:** regenerate evidence for the commit under review:

```bash
AUDITED_COMMIT="$(git rev-parse HEAD)"
pnpm install --frozen-lockfile
pnpm licenses:check
pnpm licenses:report
node scripts/audit-licenses.mjs --report --json > "/tmp/atlas-licenses-${AUDITED_COMMIT}.json"
```

Record in PR/issue closure:

- Audit date (UTC)
- Audited commit (`git rev-parse HEAD`)
- Inventory schema version (`scripts/audit-licenses.mjs` → `INVENTORY_SCHEMA_VERSION`)

**Data source:** installed package `package.json` manifests under `node_modules/` (hoisted layout
per `.npmrc` `node-linker=hoisted`). Not lockfile metadata alone.

**Audit universe:** `pnpm-workspace.yaml` → `supportedArchitectures` materializes optional
platform-specific dependencies for Atlas-supported dev/build architectures (`linux` + `darwin`,
`x64` + `arm64`). A frozen install on any host therefore enumerates the same cross-platform
dependency set; CI on Ubuntu is not limited to Linux-only optional packages.

```bash
pnpm install --frozen-lockfile
pnpm licenses:check     # CI gate — fails on unknown/disallowed/unreviewed
pnpm licenses:report    # Human-readable full inventory
node scripts/audit-licenses.mjs --report --json  # Stable machine-readable inventory
```

**Policy:** `scripts/license-policy.mjs` — SPDX classifications: `allowed`, `review-required`,
`disallowed`, `unknown`. Atlas evaluates multi-license expressions conservatively for gating
(stricter than SPDX `OR` selection semantics); reviewed exceptions may document acceptable cases.

**Reviewed exceptions:** [`license-exceptions.json`](../../license-exceptions.json) entries must
include `status: "reviewed"`, `disposition: "accepted"`, non-empty `reason`, and valid `reviewedOn`
(`YYYY-MM-DD`). When manifest license metadata is missing or nonstandard, exceptions must also
include `effectiveLicense` and `source` (and the effective license must be allowed or
review-required with acceptance). Disallowed licenses cannot be overridden. Stale exceptions for
packages no longer in the audit universe fail `pnpm licenses:check`.

**Workspace packages:** `@atlas/*` excluded from third-party enumeration.

Example snapshot results (replace by re-running the commands above at audit time):

| Status                     | Count                           |
| -------------------------- | ------------------------------- |
| allowed                    | _(from `pnpm licenses:report`)_ |
| reviewed/accepted          | _(from `pnpm licenses:report`)_ |
| review-required unresolved | 0 expected at HEAD              |
| unknown                    | 0 expected at HEAD              |
| disallowed                 | 0 expected at HEAD              |

---

## 10. Unknown / review-required licenses

All review-required packages at HEAD have explicit entries in
[`license-exceptions.json`](../../license-exceptions.json) (24 packages):

| Package family         | Declared license        | Disposition                               |
| ---------------------- | ----------------------- | ----------------------------------------- |
| `harmony-reflect`      | (Apache-2.0 OR MPL-1.1) | Reviewed — transitive dual-license        |
| `@img/sharp-libvips-*` | LGPL-3.0-or-later       | Reviewed — optional native transitive dep |
| `@sentry/cli*`         | FSL-1.1-MIT             | Reviewed — optional dev/build tool        |
| `sentry`               | FSL-1.1-Apache-2.0      | Reviewed — dev-only LHCI transitive       |
| `axe-core`             | MPL-2.0                 | Reviewed — Storybook a11y transitive      |
| `caniuse-lite`         | CC-BY-4.0               | Reviewed — build-time data                |
| `lightningcss*`        | MPL-2.0                 | Reviewed — Tailwind build chain           |
| `posthog-js`           | SEE LICENSE IN LICENSE  | Reviewed — Apache-2.0 per LICENSE file    |
| `spawndamnit`          | SEE LICENSE IN LICENSE  | Reviewed — MIT per LICENSE file           |
| `browser-assert`       | (missing)               | Reviewed — MIT per package LICENSE file   |

---

## 11. Public-release blockers

| Item                                        | Severity                                                                    |
| ------------------------------------------- | --------------------------------------------------------------------------- |
| Missing Apache-2.0 `LICENSE`                | **Blocker** — resolved at HEAD                                              |
| Unreviewed dependency licenses              | **Blocker** — gated by `pnpm licenses:check`                                |
| shadcn copied source without notice         | **Blocker** — resolved via `THIRD_PARTY_NOTICES.md`                         |
| Historical Radix MIT blobs in history       | **Non-blocker** (MIT-compatible) — documented in this audit                 |
| Design-system PNGs in history               | **Non-blocker** — optional history purge                                    |
| Private npm/git dependencies in lockfile    | **Blocker** — none found (`dependencies:check`)                             |
| Committed proprietary fonts/binaries        | **Blocker** — none at HEAD                                                  |
| Trademark/logo files (GitHub, Vercel, etc.) | **Non-blocker** — none committed; names in docs only                        |
| Final notice wording vs Apache-2.0          | **Legal-review item** — Apache-2.0 aligned; counsel may refine NOTICE scope |
| Full history purge of client material       | **None required** from this audit                                           |

---

## 12. Automated checks

| Command                                           | Purpose                                                                              |
| ------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `pnpm licenses:check`                             | Dependency license policy                                                            |
| `pnpm licenses:report`                            | Human-readable full dependency inventory                                             |
| `node scripts/audit-licenses.mjs --report --json` | Stable machine-readable inventory                                                    |
| `pnpm provenance:check`                           | HEAD: reviewed assets gate, required docs, no stale Radix deps                       |
| `pnpm provenance:history`                         | Print historical audit commands/output; **fails on shallow clone or command errors** |
| `pnpm dependencies:check`                         | Private/git/file dependency sources                                                  |
| `pnpm governance:check`                           | Apache-2.0 governance                                                                |

Tests: `scripts/__tests__/audit-licenses.test.mjs`, `scripts/__tests__/provenance-audit.test.mjs`

---

## 13. Legal-review boundary

**Engineering judgment (this audit):**

- Classification of shadcn/Base UI/Radix surfaces
- Dependency license enumeration and policy tiers
- Absence of committed binary assets at HEAD
- Identification of historical blobs and optional purge candidates

**Requires qualified legal review:**

- Whether central `THIRD_PARTY_NOTICES.md` satisfies MIT attribution for your distribution model
- Whether built-application Inter/OFL notice handling is sufficient for your deployment packaging
- FSL / LGPL / MPL dispositions for specific deployment scenarios
- Trademark use of third-party names in public docs/marketing
- Whether remaining Git history contains any engagement-specific commits outside this sample

---

## 14. Maintenance

When refreshing shadcn primitives:

1. Regenerate from `packages/ui/components.json`.
2. Re-run `pnpm provenance:check` and `pnpm licenses:check`.
3. Update this doc if component classification changes materially.

When adding committed assets: document provenance here **before** merge; binary files require
explicit redistribution basis.

---

## 15. Provenance acceptance checklist

| Criterion                                             | Status                                               |
| ----------------------------------------------------- | ---------------------------------------------------- |
| Current source/assets reviewed                        | **PASS**                                             |
| Historical Git blobs searched/sampled                 | **PASS**                                             |
| shadcn/Radix provenance documented                    | **PASS**                                             |
| Required notices preserved                            | **PASS**                                             |
| No proprietary/commercial asset exposed at HEAD       | **PASS**                                             |
| History purge candidates identified                   | **PASS** (`none` required; optional PNG purge noted) |
| Dependency licenses reproducibly enumerable           | **PASS**                                             |
| Unknown/incompatible license disposition explicit     | **PASS**                                             |
| LICENSE/notices consistent with Apache-2.0            | **PASS** (Apache-2.0)                                |
| Closing report includes unresolved legal-review items | **PASS** (§13)                                       |

**Merge recommendation:** Engineering artifacts are in tree. Optional history surgery remains a
maintainer decision and is not required by this audit.
