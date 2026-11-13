---
"@blitzcraftlabs/atlas": minor
---

Security: migrate Atlas to Zod 4.6.7 and `@hookform/resolvers` 5, fixing GHSA-mrhx-c7xc-m3w5 (High)
in every Atlas workspace (Zod 3 has no patched release).

`zod` (`apps/web`, `packages/ui`, `packages/project`, `packages/cli`) and `@hookform/resolvers`
(`packages/ui`) are now Atlas-owned manifest fields, so `atlas upgrade` moves them together with the
synced code that needs them. Projects still on the values every earlier release shipped (Zod 3.24.1,
resolvers ^4.1.3) are upgraded automatically; a project that changed either value gets a
manual-review item instead.

`useZodForm` now returns `UseFormReturn<z.input<S>, unknown, z.output<S>>`: field values use the
schema input type and `handleSubmit` receives the parsed output. Components typed against a single
form-value type (for example `Control<T>`) may need the input/output pair. `FormField` forwards the
transformed-values type.

Product code using Zod 3-only behavior needs migrating after upgrade. Most notably, `.default()` no
longer runs a preceding `.transform()`: use `.prefault()` for Zod 3 semantics (the Atlas env schemas
`AUTH_SESSION_TTL_SECONDS` and `ATLAS_REFERENCE_MODE` were migrated this way). See
https://zod.dev/v4/changelog.
