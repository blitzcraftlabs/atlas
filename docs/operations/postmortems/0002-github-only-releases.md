# Postmortem 0002 — GitHub-only Atlas releases (1.2.3, 1.3.0)

**Type:** Release pipeline failure  
**Affected versions:** `1.2.3` (snapshot, never published), `1.3.0` (tag and GitHub Release, never
on npm)  
**Customer impact:** Consumers recorded at `1.2.2` could not upgrade with the `1.2.4` CLI until a
recovery bridge shipped in `1.3.0`/`1.3.1`.  
**Tracking issue:** [#112](https://github.com/blitzcraftlabs/atlas/issues/112)

## Summary

The release workflow created the canonical tag and a **public** GitHub Release before npm
publication. Two releases failed after that point:

- `1.2.3` had a production snapshot and changelog section, but GitHub Release publication failed and
  the npm package was never published. The `1.2.4` upgrade catalog still treated `1.2.3` as the
  previous release, so `1.2.2` consumers had no supported source → target pair.
- `1.3.0` reached GitHub (tag and Release) but not npm. Readers saw a public Release they could not
  install.

## Root cause

Publication was split across jobs with no ordering guarantee between "visible on GitHub" and
"installable from npm". A green GitHub Release looked like a shipped release.

## Resolution

- `1.3.0`/`1.3.1` added a one-release recovery bridge for `1.2.2` consumers and made the upgrade
  catalog follow npm-published releases only.
- [#112](https://github.com/blitzcraftlabs/atlas/issues/112): GitHub Releases are created as
  **drafts**. The `finalize-release` job makes a draft public only after `npm-publish` and registry
  verification succeed (`scripts/finalize-atlas-release.mjs`).
- A daily **Release Consistency** workflow fails on any public GitHub Release without an npm version
  and on any npm version without a canonical tag (`scripts/check-release-consistency.mjs`).

## Follow-ups

- Wider upgrade windows so a single missing release cannot strand a cohort:
  [#110](https://github.com/blitzcraftlabs/atlas/issues/110).
