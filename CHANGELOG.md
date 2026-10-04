# Changelog

All notable changes to **Atlas** (the repository/platform snapshot) are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and Atlas follows
[Semantic Versioning](https://semver.org/) for repository releases. See
[Releases and Governance](docs/how-we-build/releases-and-governance.md) for the full policy.

## [Unreleased]

## [1.3.1] - 2026-10-04

### Fixed

- Fix npm publication so the packed upgrade catalog is checked with the maintainer catalog rules
  instead of CLI modules the build does not emit. GitHub-only releases, including 1.3.0, stay out of
  the consumer upgrade window until they are published on npm. Consumers on 1.2.2 keep a recovery
  path on the next published release.

## [1.3.0] - 2026-10-03

### Changed

- Fresh Atlas projects pin `@blitzcraftlabs/atlas` to the exact generated version and use
  `pnpm atlas` for Doctor, context, generate, enable, and upgrade. `atlas upgrade` can resolve the
  latest stable published release when `--to` is omitted, then hands the operation to that exact
  CLI. Upgrade support follows published releases instead of unpublished snapshot directories, and
  this release keeps a supported path for consumers stranded on Atlas 1.2.2. If install or Doctor
  fails after Atlas has written the target files, rerunning that same upgrade adopts content that
  already matches the target release instead of treating it as a consumer conflict.

## [1.2.4] - 2026-10-03

### Changed

- Upgrade Next.js from 16.3.3 to 16.3.8 so generated consumers can keep `output: "standalone"` when
  a deployment build adapter is active (fixes missing `.next/next-server.js.nft.json` on Vercel).

## [1.2.3] - 2026-09-30

### Changed

- Keep focused and invalid control borders above hover by using compound selectors instead of CSS
  source order.

## [1.2.2] - 2026-09-30

### Changed

- Stop animating box-shadow on shared Atlas controls so focus and invalid rings appear and disappear
  immediately; color, background, and border transitions are unchanged.
- Align shared control focus styles with shadcn base-vega (`border-ring`, `ring-3`, `ring-ring/50`)
  so Input, Button, and related controls match registry primitives and input-group focus treatment.

## [1.2.1] - 2026-09-25

### Changed

- Ship working Docker build files to generated Atlas consumers and add safe upgrade handling for
  repository-level Docker infrastructure.
- Harden Atlas distribution builds so clean-room CLI builds prepare required workspace dependencies
  and cached builds restore required npm package metadata and legal files.

### Security

- Use cryptographically secure Web Vitals session identifiers instead of Math.random() so telemetry
  grouping IDs meet security scanning expectations in supported browsers.

## [1.2.0] - 2026-09-22

### Changed

- Add `atlas enable` for opt-in consumer tooling, and fix first-commit hooks plus Playwright
  alignment. Published npm 1.1.0 does not include `enable`. This changeset is how that command (and
  the consumer-tooling follow-ups) enter the next CLI release. Generated enable invocations keep
  `<next-cli-release>` until this Version PR assigns a version that is not in
  `CLI_RELEASES_WITHOUT_ENABLE`; they pin that assigned CLI for `enable` even when a consumer
  baseline is still 1.1.0. Doctor/generate stay on the consumer baseline. Do not treat `enable` as
  live on npm until that release is published.

## [1.1.0] - 2026-09-19

### Added

- `atlas init` now ships a portable GitHub Actions workflow at `.github/workflows/ci.yml`. It runs
  on GitHub-hosted Ubuntu (Doctor, lint, typecheck, tests, production build) and is consumer-owned
  after generation. It is not Atlas maintainer CI and does not include Playwright E2E.

### Changed

- Stabilize reference harness control mutations, keep reset preview cache consistent with server
  state, retain Playwright traces on CI failure, and drop unused Next.js `optimizeCss` from starter
  config so consumer and maintainer CI no longer depend on missing Critters.
- Generate a portable GitHub Actions CI workflow in projects created by `atlas init`.

### Fixed

- Serialize reference harness persona/scenario/reset mutations so completion feedback cannot be
  overwritten by overlapping controls or slow users-preview requests.
- Remove unused Next.js `experimental.optimizeCss` from starter and reference apps (it required
  `critters`, which is not a dependency).
- Run starter and reference Playwright suites sequentially on both CI runner profiles, and upload
  reports/traces for both apps.

## [1.0.1] - 2026-09-19

### Changed

- Polish the public launch surface so Atlas 1.0.1 can be the first npm-published version. Canonical
  GitHub v1.0.0 remains the immutable first stable platform release.

## [1.0.0] - 2026-09-17

### Security

- Atlas 1.0 is the first supported public distribution. The 0.x GitHub releases were the
  platform-development and proving line. 1.0.0 is the first supported public npm contract for
  `@blitzcraftlabs/atlas`. Public CLI, generated-project, upgrade, and distribution contracts are
  now treated as stable; breaking those contracts after 1.0 requires a major version. Internal
  implementation may keep evolving without a major release. 1.0 includes the production-proven Atlas
  platform model already shipped on the 0.x proving line: `atlas init`, deterministic bootstrap
  assets, clean-room consumer lifecycle, Doctor, generators, context, upgrade/version lifecycle, UI
  quality gates, and security/release governance. It also prepares fail-closed npm Trusted
  Publishing after GitHub Releases, including a one-time first publish of the exact canonical
  `v1.0.0` tarball. The package is not on the registry yet. Do not treat
  `pnpm dlx @blitzcraftlabs/atlas` as live until `pnpm distribution:verify-registry 1.0.0` passes.
  Do not bootstrap npm with `0.5.0`.

## [0.5.0] - 2026-09-17

### Changed

- Prepare `@blitzcraftlabs/atlas` as Atlas's public npm CLI package. The `atlas` binary, pack
  allowlist, and GitHub Release workflow stay the same; this change makes the package identity and
  metadata publication-ready without publishing to the registry.
- Load production upgrade snapshots from the installed `@blitzcraftlabs/atlas` package instead of a
  consumer `releases/` tree, and fail closed for unsupported or missing packaged release evidence.
- Build `@atlas/project` before generating a production release snapshot so Version PRs succeed
  after `pnpm install --frozen-lockfile` without a prior workspace build.

## [0.4.0] - 2026-09-15

### Changed

- Declare `@types/node` on `@atlas/ui` and include Node in the UI typecheck tsconfig so generated
  projects do not depend on source-monorepo hoisting or omitted Vite types.
- Add empty-directory `atlas init <project>` so an installed CLI can materialize a consumer project
  from packaged bootstrap assets.

### Fixed

- Make repository dependency scanning resilient to source files that disappear during concurrent
  generator validation, while continuing to fail on real filesystem and import-analysis errors.

## [0.3.0] - 2026-09-14

### Changed

- Package a versioned Atlas bootstrap asset tree inside the CLI so an installed tarball can locate
  the supported starter baseline without the monorepo.
- Make the Atlas CLI independently packable by internalizing the project-contract runtime so a
  tarball can install and run outside the monorepo without unpublished workspace dependencies.

## [0.2.1] - 2026-09-12

### Fixed

- Fix release publication after an existing canonical release so post-release `main` commits no-op
  when the published tag is a proven ancestor instead of attempting to retag it.

## [0.2.0] - 2026-09-12

### Added

- Repository-level release governance: Apache-2.0 license, versioning policy, support expectations,
  breaking-change process, Version PR workflow, and fail-closed GitHub Release publication.
- Public documentation aligned to the Apache-2.0 GitHub repository: clone/fork access, contribution
  model, and durable evidence in place of private-era issue numbers.

### Changed

- Improve search input styling, badge alignment, and server-safe theme boot constants.

### Fixed

- Repair release automation so Version PRs validate at the new Atlas line and fail-closed GitHub
  Release publication can create the first canonical public `vX.Y.Z` tag after the Version PR
  merges.

### Security

- Make Atlas security checks blocking: HIGH/CRITICAL dependency policy, pinned Actions and Gitleaks,
  SPDX snapshots, and a published threat model.

## 0.1.0 - 2026-08-19

> Historical internal Atlas snapshot. No canonical public Git tag or GitHub Release was published
> for this version.

### Added

- Initial pre-1.0 platform snapshot baseline.
- Enterprise frontend platform monorepo: `@atlas/web` template app, `@atlas/ui`, `@atlas/config`,
  `@atlas/consent`, conventions, and documentation.

[Unreleased]: https://github.com/blitzcraftlabs/atlas/compare/v1.3.1...HEAD
[1.3.1]: https://github.com/blitzcraftlabs/atlas/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/blitzcraftlabs/atlas/compare/v1.2.4...v1.3.0
[1.2.4]: https://github.com/blitzcraftlabs/atlas/compare/v1.2.3...v1.2.4
[1.2.3]: https://github.com/blitzcraftlabs/atlas/compare/v1.2.2...v1.2.3
[1.2.2]: https://github.com/blitzcraftlabs/atlas/compare/v1.2.1...v1.2.2
[1.2.1]: https://github.com/blitzcraftlabs/atlas/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/blitzcraftlabs/atlas/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/blitzcraftlabs/atlas/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/blitzcraftlabs/atlas/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/blitzcraftlabs/atlas/compare/v0.5.0...v1.0.0
[0.5.0]: https://github.com/blitzcraftlabs/atlas/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/blitzcraftlabs/atlas/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/blitzcraftlabs/atlas/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/blitzcraftlabs/atlas/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/blitzcraftlabs/atlas/releases/tag/v0.2.0
