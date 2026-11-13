# @blitzcraftlabs/atlas

## 1.4.1

### Patch Changes

- 46e6107: Pin `atlas enable` fallbacks to 1.2.0, the first npm release that contains the command,
  instead of the `<next-cli-release>` placeholder, and refresh the CLI, consumer-tooling and upgrade
  docs to match the shipped command set.

## 1.4.0

### Minor Changes

- 3ce35c5: Custom generators: declare consumer-owned generators in `atlas.config.json#generators`
  (template directory, target path, placeholders such as `{{pascal}}`) and run them with
  `atlas generate <id> <name>`. `atlas generate list` and `atlas context` include them with
  `source: "custom"`.
- 2ef283f: Add `atlas enable upgrades`: a weekly consumer workflow that runs `pnpm atlas upgrade`,
  opens one pull request when a newer Atlas release applies cleanly, and opens one issue listing
  blocking files when it needs a human.
- bacb4be: `atlas upgrade` now upgrades consumers that are several published releases behind. It
  plans a path through every npm-published release (honoring recovery bridges such as 1.2.2 →
  1.3.1), runs each hop with that release's CLI, and stops at the first hop that needs attention.
  `--dry-run --json` reports the full path in `result.hops`.
- ef03f67: Add a generic OpenID Connect provider beside Google. Set `AUTH_OIDC_ISSUER` and
  `AUTH_OIDC_CLIENT_ID` (plus an optional secret and scopes) to sign in through
  `/api/auth/oidc/start` with any OIDC issuer. Endpoints come from the validated discovery document,
  and switching providers no longer requires editing synced auth files.
- 6abce86: `atlas upgrade` now runs a three-way merge for synced files you modified that Atlas also
  changed. Plans report `autoMerge: clean | conflict`. With `--merge`, clean merges are applied and
  no longer block the upgrade; conflicting merges are written to `.atlas/merge/<path>.merge` for
  review. Security-critical paths are never merged automatically.

### Patch Changes

- cb42d11: Migrate application test mocking from MSW v1 to MSW v2 (`http` handlers returning
  `HttpResponse`). Application Jest projects now run in `jest-fixed-jsdom` and compile MSW's
  ESM-only dependencies with `babel-jest`. A new test proves the shared MSW server intercepts
  requests. Consumers with custom MSW handlers should replace `rest.*((req, res, ctx) => …)` with
  `http.*(({ request, params }) => …)`.
- 96d6a1b: Fix: after `atlas upgrade`, `platform.baseline` now records the Atlas-shipped checksum
  for each application synced path instead of the consumer's file. Previously a customization of a
  file that Atlas did not change in that release became the new "unchanged" baseline, so the next
  release that changed the file overwrote it.

## 1.3.4

### Patch Changes

- 1e739c3: Release pipeline: GitHub Releases are created as drafts and made public only after the
  npm package is published and verified, and a daily consistency check fails on any public Release
  without a matching npm version.
- 167e8b4: Security: upgrade the starter's `@lhci/cli` from `^0.14.0` to `^0.16.0` (Lighthouse 13,
  `@puppeteer/browsers` 3), which removes `extract-zip@2.0.1` (GHSA-jmr9-qjv8-65gv,
  GHSA-7pqw-9j4j-h8q3) and `tmp@0.1.0` (GHSA-ph9p-34f9-6g65, GHSA-52f5-9888-hmc6) from the
  dependency tree. The consumer `security-audit` capability template no longer ships exceptions for
  those advisories. Existing consumers that enable the security audit while still on `@lhci/cli`
  0.14 should bump `@lhci/cli` to `^0.16.0` in `apps/web/package.json`; `@lhci/cli` 0.16 requires
  Node.js

  > = 22.19.

- eac827b: Security: the starter's Sentry tunnel route (`apps/web/src/app/monitoring/route.ts`) no
  longer builds its upstream URL from the `o`/`r` query parameters, which allowed unauthenticated
  requests to make the server POST to arbitrary HTTPS hosts (SSRF / open proxy). The tunnel now
  forwards only to the ingest endpoints of the app's configured DSNs (`NEXT_PUBLIC_SENTRY_DSN`,
  `SENTRY_DSN`), rejects other projects with 403, caps envelopes at 2 MiB (logging a
  `sentry_tunnel_envelope_rejected` warning when it drops one), and forwards bodies as bytes.
  Projects generated from earlier Atlas versions own this route and should copy the fix
  (`src/app/monitoring/route.ts` and `src/config/sentry-tunnel.ts`).

## 1.3.3

### Patch Changes

- Security remediation: upgrade Next.js and eslint-config-next to 16.4.5, @sentry/nextjs to 10.78.0,
  Storybook to 8.6.19, Vite to 6.4.5 and shadcn to 4.23.0, and refresh pnpm overrides for patched
  transitive dependencies (handlebars, sharp, proxy-addr, body-parser, compression,
  follow-redirects, joi, source-map-js, systeminformation, zod 4). The Web Vitals telemetry route
  now enforces its body size limit on bytes actually read and rejects oversized metric batches
  before schema validation.

## 1.3.2

### Patch Changes

- 29422b0: Fix Atlas upgrades so every Atlas-owned package manifest field adopts the target release,
  including `@atlas/web` and platform dependency pins, while preserving consumer-owned dependencies.
  Doctor now reports that drift from local release evidence, and the 1.3.1 partial-upgrade state can
  be repaired.
- a6af931: Make release and Doctor manifest-alignment tests derive the current checkout version from
  the repository instead of hardcoding the previous release, so Version PR generation stays
  protected by pre-push validation after Changesets bumps workspace versions.

## 1.3.1

### Patch Changes

- a2042ea: Fix npm publication so the packed upgrade catalog is checked with the maintainer catalog
  rules instead of CLI modules the build does not emit. GitHub-only releases, including 1.3.0, stay
  out of the consumer upgrade window until they are published on npm. Consumers on 1.2.2 keep a
  recovery path on the next published release.

## 1.3.0

### Minor Changes

- f322df1: Fresh Atlas projects pin `@blitzcraftlabs/atlas` to the exact generated version and use
  `pnpm atlas` for Doctor, context, generate, enable, and upgrade. `atlas upgrade` can resolve the
  latest stable published release when `--to` is omitted, then hands the operation to that exact
  CLI. Upgrade support follows published releases instead of unpublished snapshot directories, and
  this release keeps a supported path for consumers stranded on Atlas 1.2.2. If install or Doctor
  fails after Atlas has written the target files, rerunning that same upgrade adopts content that
  already matches the target release instead of treating it as a consumer conflict.

## 1.2.4

### Patch Changes

- 37975d1: Upgrade Next.js from 16.3.3 to 16.3.8 so generated consumers can keep
  `output: "standalone"` when a deployment build adapter is active (fixes missing
  `.next/next-server.js.nft.json` on Vercel).

## 1.2.3

## 1.2.2

## 1.2.1

### Patch Changes

- e7c785c: Ship working Docker build files to generated Atlas consumers and add safe upgrade
  handling for repository-level Docker infrastructure.
- dbab657: Harden Atlas distribution builds so clean-room CLI builds prepare required workspace
  dependencies and cached builds restore required npm package metadata and legal files.
- 36d5124: Use cryptographically secure Web Vitals session identifiers instead of Math.random() so
  telemetry grouping IDs meet security scanning expectations in supported browsers.

## 1.2.0

### Minor Changes

- 9cc01cf: Add `atlas enable` for opt-in consumer tooling, and fix first-commit hooks plus
  Playwright alignment.

  Published npm 1.1.0 does not include `enable`. This changeset is how that command (and the
  consumer-tooling follow-ups) enter the next CLI release. Generated enable invocations keep
  `<next-cli-release>` until this Version PR assigns a version that is not in
  `CLI_RELEASES_WITHOUT_ENABLE`; they pin that assigned CLI for `enable` even when a consumer
  baseline is still 1.1.0. Doctor/generate stay on the consumer baseline. Do not treat `enable` as
  live on npm until that release is published.

## 1.1.0

### Minor Changes

- 7231f0a: Generate a portable GitHub Actions CI workflow in projects created by `atlas init`.

## 1.0.1

### Patch Changes

- b1351c4: Polish the public launch surface so Atlas 1.0.1 can be the first npm-published version.
  Canonical GitHub v1.0.0 remains the immutable first stable platform release.

## 1.0.0

### Major Changes

- b341368: Atlas 1.0 is the first supported public distribution.

  The 0.x GitHub releases were the platform-development and proving line. 1.0.0 is the first
  supported public npm contract for `@blitzcraftlabs/atlas`. Public CLI, generated-project, upgrade,
  and distribution contracts are now treated as stable; breaking those contracts after 1.0 requires
  a major version. Internal implementation may keep evolving without a major release.

  1.0 includes the production-proven Atlas platform model already shipped on the 0.x proving line:
  `atlas init`, deterministic bootstrap assets, clean-room consumer lifecycle, Doctor, generators,
  context, upgrade/version lifecycle, UI quality gates, and security/release governance. It also
  prepares fail-closed npm Trusted Publishing after GitHub Releases, including a one-time first
  publish of the exact canonical `v1.0.0` tarball.

  The package is not on the registry yet. Do not treat `pnpm dlx @blitzcraftlabs/atlas` as live
  until `pnpm distribution:verify-registry 1.0.0` passes. Do not bootstrap npm with `0.5.0`.

## 0.5.0

### Minor Changes

- e64f4ce: Prepare `@blitzcraftlabs/atlas` as Atlas's public npm CLI package. The `atlas` binary,
  pack allowlist, and GitHub Release workflow stay the same; this change makes the package identity
  and metadata publication-ready without publishing to the registry.

### Patch Changes

- 52baf97: Load production upgrade snapshots from the installed `@blitzcraftlabs/atlas` package
  instead of a consumer `releases/` tree, and fail closed for unsupported or missing packaged
  release evidence.
- b37e3f7: Build `@atlas/project` before generating a production release snapshot so Version PRs
  succeed after `pnpm install --frozen-lockfile` without a prior workspace build.

## 0.4.0

### Minor Changes

- ac8ef12: Add empty-directory `atlas init <project>` so an installed CLI can materialize a consumer
  project from packaged bootstrap assets.

### Patch Changes

- Make repository dependency scanning resilient to source files that disappear during concurrent
  generator validation, while continuing to fail on real filesystem and import-analysis errors.

## 0.3.0

### Minor Changes

- ea0e911: Package a versioned Atlas bootstrap asset tree inside the CLI so an installed tarball can
  locate the supported starter baseline without the monorepo.
- 282048e: Make the Atlas CLI independently packable by internalizing the project-contract runtime
  so a tarball can install and run outside the monorepo without unpublished workspace dependencies.

## 0.2.1

### Patch Changes

- c5b6e82: Fix release publication after an existing canonical release so post-release `main`
  commits no-op when the published tag is a proven ancestor instead of attempting to retag it.
  - @atlas/project@0.2.1

## 0.2.0

### Minor Changes

- 95b0be9: Repair release automation so Version PRs validate at the new Atlas line and fail-closed
  GitHub Release publication can create the first canonical public `vX.Y.Z` tag after the Version PR
  merges.
- 96cc938: Make Atlas security checks blocking: HIGH/CRITICAL dependency policy, pinned Actions and
  Gitleaks, SPDX snapshots, and a published threat model.

### Patch Changes

- @atlas/project@0.2.0
