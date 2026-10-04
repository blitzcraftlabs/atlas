---
"@blitzcraftlabs/atlas": patch
---

Fix Atlas upgrades so every Atlas-owned package manifest field adopts the target release, including
`@atlas/web` and platform dependency pins, while preserving consumer-owned dependencies. Doctor now
reports that drift from local release evidence, and the 1.3.1 partial-upgrade state can be repaired.
