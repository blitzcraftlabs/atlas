---
"@atlas/ui": minor
"@atlas/config": minor
"@atlas/consent": minor
"@atlas/web": minor
"@atlas/reference": minor
"@atlas/project": minor
"@blitzcraftlabs/atlas": minor
---

Fresh Atlas projects pin `@blitzcraftlabs/atlas` to the exact generated version and use `pnpm atlas`
for Doctor, context, generate, enable, and upgrade. `atlas upgrade` can resolve the latest stable
published release when `--to` is omitted, then hands the operation to that exact CLI. Upgrade
support follows published releases instead of unpublished snapshot directories, and this release
keeps a supported path for consumers stranded on Atlas 1.2.2.
