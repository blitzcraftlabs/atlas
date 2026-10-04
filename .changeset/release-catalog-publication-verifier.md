---
"@atlas/ui": patch
"@atlas/config": patch
"@atlas/consent": patch
"@atlas/web": patch
"@atlas/reference": patch
"@atlas/project": patch
"@blitzcraftlabs/atlas": patch
---

Fix npm publication so the packed upgrade catalog is checked with the maintainer catalog rules
instead of CLI modules the build does not emit. GitHub-only releases, including 1.3.0, stay out of
the consumer upgrade window until they are published on npm. Consumers on 1.2.2 keep a recovery path
on the next published release.
