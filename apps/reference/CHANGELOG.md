# @atlas/reference

## 1.3.0

### Minor Changes

- f322df1: Fresh Atlas projects pin `@blitzcraftlabs/atlas` to the exact generated version and use
  `pnpm atlas` for Doctor, context, generate, enable, and upgrade. `atlas upgrade` can resolve the
  latest stable published release when `--to` is omitted, then hands the operation to that exact
  CLI. Upgrade support follows published releases instead of unpublished snapshot directories, and
  this release keeps a supported path for consumers stranded on Atlas 1.2.2. If install or Doctor
  fails after Atlas has written the target files, rerunning that same upgrade adopts content that
  already matches the target release instead of treating it as a consumer conflict.

### Patch Changes

- Updated dependencies [f322df1]
  - @atlas/ui@1.3.0
  - @atlas/consent@1.3.0

## 1.2.4

### Patch Changes

- 37975d1: Upgrade Next.js from 16.3.3 to 16.3.8 so generated consumers can keep
  `output: "standalone"` when a deployment build adapter is active (fixes missing
  `.next/next-server.js.nft.json` on Vercel).
- Updated dependencies [37975d1]
  - @atlas/ui@1.2.4
  - @atlas/consent@1.2.4

## 1.2.3

### Patch Changes

- Updated dependencies [a6c1a93]
  - @atlas/ui@1.2.3
  - @atlas/consent@1.2.3

## 1.2.2

### Patch Changes

- Updated dependencies [2817138]
- Updated dependencies [abecddc]
  - @atlas/ui@1.2.2
  - @atlas/consent@1.2.2

## 1.2.1

### Patch Changes

- @atlas/ui@1.2.1
- @atlas/consent@1.2.1

## 1.2.0

### Patch Changes

- @atlas/ui@1.2.0
- @atlas/consent@1.2.0

## 1.1.0

### Patch Changes

- 78f4f02: Stabilize reference harness control mutations, keep reset preview cache consistent with
  server state, retain Playwright traces on CI failure, and drop unused Next.js `optimizeCss` from
  starter config so consumer and maintainer CI no longer depend on missing Critters.
  - @atlas/ui@1.1.0
  - @atlas/consent@1.1.0

## 1.0.1

### Patch Changes

- @atlas/ui@1.0.1
- @atlas/consent@1.0.1

## 1.0.0

### Patch Changes

- @atlas/ui@1.0.0
- @atlas/consent@1.0.0

## 0.5.0

### Patch Changes

- @atlas/ui@0.5.0
- @atlas/consent@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies [aaebdf3]
  - @atlas/ui@0.4.0
  - @atlas/consent@0.4.0

## 0.3.0

### Patch Changes

- @atlas/ui@0.3.0
- @atlas/consent@0.3.0

## 0.2.1

### Patch Changes

- @atlas/ui@0.2.1
- @atlas/consent@0.2.1

## 0.2.0

### Patch Changes

- Updated dependencies [dbafd6b]
  - @atlas/ui@0.2.0
  - @atlas/consent@0.2.0
