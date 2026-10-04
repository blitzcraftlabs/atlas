---
"@blitzcraftlabs/atlas": patch
---

Make release and Doctor manifest-alignment tests derive the current checkout version from the
repository instead of hardcoding the previous release, so Version PR generation stays protected by
pre-push validation after Changesets bumps workspace versions.
