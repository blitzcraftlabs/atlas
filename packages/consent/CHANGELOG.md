# @atlas/consent

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

## 1.2.0

## 1.1.0

## 1.0.1

## 1.0.0

## 0.5.0

## 0.4.0

## 0.3.0

## 0.2.1

## 0.2.0
