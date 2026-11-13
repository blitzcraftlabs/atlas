---
"@blitzcraftlabs/atlas": minor
---

`atlas upgrade` now upgrades consumers that are several published releases behind. It plans a path
through every npm-published release (honoring recovery bridges such as 1.2.2 → 1.3.1), runs each hop
with that release's CLI, and stops at the first hop that needs attention. `--dry-run --json` reports
the full path in `result.hops`.
