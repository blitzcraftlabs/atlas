---
"@blitzcraftlabs/atlas": patch
---

Fix: projects generated before 1.3.0 call the CLI through a pinned version in files they own (for
example `pnpm dlx @blitzcraftlabs/atlas@1.2.2 doctor` in CI). Upgrades never rewrite those files, so
the old CLI kept running and CI failed right after a clean upgrade. `atlas doctor` now reports these
pins in `.github/workflows/*`, `README.md`, `AGENTS.md` and `docs/how-we-build/*.md` through a new
`cli-references` check: a warning for docs, and an error for a CI workflow that pins a CLI older
than the project. `atlas upgrade --dry-run` lists the same files as non-blocking manual-review
items. When the source release is several releases behind the CLI's support window, the error now
points to the multi-release upgrade.
