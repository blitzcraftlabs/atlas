---
"@blitzcraftlabs/atlas": patch
---

Fix: after `atlas upgrade`, `platform.baseline` now records the Atlas-shipped checksum for each
application synced path instead of the consumer's file. Previously a customization of a file that
Atlas did not change in that release became the new "unchanged" baseline, so the next release that
changed the file overwrote it.
