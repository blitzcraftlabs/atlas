---
"@blitzcraftlabs/atlas": minor
---

`atlas upgrade` now runs a three-way merge for synced files you modified that Atlas also changed.
Plans report `autoMerge: clean | conflict`. With `--merge`, clean merges are applied and no longer
block the upgrade; conflicting merges are written to `.atlas/merge/<path>.merge` for review.
Security-critical paths are never merged automatically.
