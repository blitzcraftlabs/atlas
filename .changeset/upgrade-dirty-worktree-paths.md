---
"@blitzcraftlabs/atlas": patch
---

Fix: when `atlas upgrade` refuses to run on a dirty Git worktree, it now lists changed files with
their full paths. Previously the first two characters of any file with only unstaged changes were
cut off (`src/app.ts` was reported as `rc/app.ts`).
