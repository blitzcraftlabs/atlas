# @atlas/ui

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

### Patch Changes

- a6c1a93: Keep focused and invalid control borders above hover by using compound selectors instead
  of CSS source order.

## 1.2.2

### Patch Changes

- 2817138: Stop animating box-shadow on shared Atlas controls so focus and invalid rings appear and
  disappear immediately; color, background, and border transitions are unchanged.
- abecddc: Align shared control focus styles with shadcn base-vega (`border-ring`, `ring-3`,
  `ring-ring/50`) so Input, Button, and related controls match registry primitives and input-group
  focus treatment.

## 1.2.1

## 1.2.0

## 1.1.0

## 1.0.1

## 1.0.0

## 0.5.0

## 0.4.0

### Patch Changes

- aaebdf3: Declare `@types/node` on `@atlas/ui` and include Node in the UI typecheck tsconfig so
  generated projects do not depend on source-monorepo hoisting or omitted Vite types.

## 0.3.0

## 0.2.1

## 0.2.0

### Patch Changes

- dbafd6b: Improve search input styling, badge alignment, and server-safe theme boot constants.

  - Suppress native WebKit search controls on `Input` when `type="search"` so apps can provide a
    single explicit clear button.
  - Center badge text with `leading-none` and give `xs` badges a stable fixed height.
  - Export server-safe theme constants and a shared boot script helper for root layouts.
