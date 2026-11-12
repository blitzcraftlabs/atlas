# Atlas Showcase follow-up audit

**Date:** 2026-08-16 (original); **access-model update:** 2026-09-11; **closed:** 2026-11-12  
**Status:** **Closed.** The `atlas-showcase` repository is retired and archived.
[shipwithatlas.com](https://shipwithatlas.com) is now built from
[`blitzcraftlabs/shipwithatlas`](https://github.com/blitzcraftlabs/shipwithatlas), and its copy was
verified against the checklist below on 2026-11-12. Keep this document as the historical record.
Track future marketing-copy alignment in the [claims register](claims-register.md).

This document lists Showcase claims and CTAs that require alignment with Atlas repository evidence.
Exact Showcase paths may drift; verify against the current showcase repository before editing.

Private-era Atlas issue numbers are not part of the public repository's evidence model. Cite durable
docs, workflows, and the [claims register](claims-register.md).

## Summary

| Theme                              | Atlas evidence to cite                                                        | Showcase action                          |
| ---------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------- |
| Repository access                  | Public Apache-2.0 repo (`README.md`, `CONTRIBUTING.md`, `docs/public/faq.md`) | GitHub CTAs may link the public clone    |
| Forkable / inspectable             | [Claims register — C-001](claims-register.md), C-002                          | Public clone/fork under Apache-2.0       |
| Production / battle-tested         | Approved product categories in claims register                                | Qualify with product lists + limitations |
| Accessibility / security / testing | Qualified claims C-006, C-007, C-014                                          | Remove absolute language                 |
| Licensing                          | Root [`LICENSE`](../../LICENSE) is Apache-2.0                                 | Apache-2.0, not MIT                      |

## Items requiring separate Showcase changes

### 1. Public repository and Docs links

**Typical Showcase copy (paraphrased):** “View source on GitHub”, “Read the docs”, or equivalent
links that assume anonymous access.

**Current Atlas state:** The canonical repository is public. Anonymous clone and fork are permitted
under Apache-2.0.

**Recommended replacement:** Link [`blitzcraftlabs/atlas`](https://github.com/blitzcraftlabs/atlas)
and public docs. Do not imply an engagement is required to read the source.

**Atlas evidence:** `README.md`; `CONTRIBUTING.md`; `docs/public/faq.md`.

### 2. “Forkable” and “inspectable” wording

**Typical Showcase copy:** “Fork Atlas today”, “inspect the codebase”, “open-source template”.

**Problem:** Historical Showcase copy assumed a private, engagement-only template
([claims register C-004](claims-register.md), status `remove`).

**Recommended replacement:** “Forkable under Apache License 2.0” / “Clone the public repository”. Do
not imply a support SLA or npm-published packages.

**Atlas evidence:** [Claims register — Forkable definition](claims-register.md#forkable);
`README.md`.

### 3. Production-ready and battle-tested hero copy

**Typical Showcase copy:** Unqualified “production-ready”, “battle-tested”, “runs in production
everywhere”.

**Problem:** Product-level evidence is not fully published in Atlas; capabilities vary by subsystem
([C-008](claims-register.md), [C-009](claims-register.md)).

**Recommended replacement:** “Battle-tested through named client products (see case studies)” with
explicit **built from Atlas** vs **migrated toward Atlas** categories.

**Atlas evidence:** Production history table in [claims-register.md](claims-register.md). Case-study
copy belongs in [shipwithatlas.com](https://shipwithatlas.com).

**Approved product lists:**

- **Built from Atlas:** Aviatopia; BlitzCraft Studio (Publishing Platform); Ax402 Clients;
  thedanielmark-site; xgas-station-app; bridge-indexer-frontend
- **Migrated toward Atlas:** gitmyabi-app; cha-ching-app

### 4. Product-adoption categories

**Typical Showcase copy:** Single undifferentiated “powered by Atlas” or “Atlas customers” list.

**Problem:** Collapses greenfield builds and incremental migrations.

**Recommended replacement:** Two labeled sections matching the claims register categories; note
where chronology or metrics are unavailable.

**Atlas evidence:**
[claims-register.md — Production history](claims-register.md#production-history).

### 5. Accessibility claims

**Typical Showcase copy:** “WCAG compliant”, “accessibility enforced in CI”, “violations fail the
build”.

**Problem:** Atlas enforces jsx-a11y via ESLint and gates representative `critical` Storybook
compositions in the UI Quality workflow; this is not WCAG certification
([C-006](claims-register.md)).

**Recommended replacement:** “Accessibility-oriented baseline: semantic components, jsx-a11y
linting, Storybook axe on critical compositions; not formal WCAG conformance.”

**Atlas evidence:** `docs/how-we-build/accessibility.md`; UI Quality workflow.

### 6. Security claims

**Typical Showcase copy:** “Enterprise security”, “audited dependencies block releases”, “secure by
default” without qualification.

**Problem:** Atlas has a blocking HIGH/CRITICAL dependency policy; that is not a formal security
audit or certification ([C-014](claims-register.md)).

**Recommended replacement:** “Documented secure defaults (httpOnly sessions, PKCE, env separation);
HIGH/CRITICAL dependency findings block CI. No pentest or certification claim.”

**Atlas evidence:** `docs/public/capabilities.md` (Security section);
`.github/workflows/security-audit.yml`; [security.md](../how-we-build/security.md).

### 7. Testing and coverage claims

**Typical Showcase copy:** “High test coverage”, “critical paths fully tested”, “coverage enforced
in CI”.

**Problem:** Coverage is risk-based by subsystem, not a repo-wide 80% claim
([C-007](claims-register.md), [C-013](claims-register.md)).

**Recommended replacement:** “Automated unit, UI-package coverage, risk-based subsystem floors, and
Playwright E2E in CI.”

**Atlas evidence:** `.github/workflows/ci.yml`; `coverage-policy.json`;
[testing.md](../how-we-build/testing.md).

### 8. Proof section wording

**Typical Showcase copy:** Proof panels that imply independent verification, uptime metrics, or
client endorsements without citations.

**Problem:** No in-repo substantiation for metrics or endorsements.

**Recommended replacement:** Label evidence type: **production product**, **repository CI**,
**synthetic example**, or **planned**; link to atlas-showcase case studies when published.

**Atlas evidence:** [claims-register.md](claims-register.md);
[shipwithatlas.com](https://shipwithatlas.com).

### 9. MIT / open license badges

**Typical Showcase copy:** MIT badge or “free to fork” license language.

**Problem:** Historical copy implied MIT or “free to fork” without Apache-2.0.

**Recommended replacement:** “Apache License 2.0” with a link to [`LICENSE`](../../LICENSE).

**Atlas evidence:** [C-003](claims-register.md) (MIT claim removed); [C-018](claims-register.md).

### 10. Relationship to the public showcase

Commercial CTO journey and hire-Daniel conversion path work belongs in
**[shipwithatlas.com](https://shipwithatlas.com)**. This Atlas document only documents the evidence
Showcase should reference; it does not implement the buyer journey.

Coordinate Showcase copy so it does not outpace Atlas evidence in the claims register.

## Verification after Showcase PR merges

Verified on 2026-11-12 against `blitzcraftlabs/shipwithatlas` (`apps/web/src/lib/marketing/**`,
`apps/web/src/components/**`):

- [x] No CTA implies a private or engagement-only source repository. GitHub CTAs link the public
      `blitzcraftlabs/atlas` repository.
- [x] Hero claims use qualified terminology. There is no unqualified "production-ready",
      "battle-tested", "WCAG compliant", "enterprise security" or coverage claim.
- [x] Product lists use exact built-from vs migrated-toward categories (`BUILT_WITH_PRODUCTS`
      `status` / `statusLabel`). **Open:** the site lists Launa as "Built from Atlas", but Launa is
      not in the claims register [production history](claims-register.md#production-history). Add it
      to the register with evidence, or remove it from the site.
- [x] Proof sections label evidence provenance. No uptime, adoption or independent-verification
      claims appear.
- [x] Licensing language matches Apache-2.0 (marketing footer). No MIT badge remains.

## Completion

The original completion condition (a separate `atlas-showcase` pull request) no longer applies: that
repository was retired rather than corrected. Completion was verified directly against the
`shipwithatlas` source above.
