# @atlas/ui

Atlas UI foundation — a governed design system built on shadcn Base UI primitives with Atlas
semantic tokens. Atlas ships architecture, behavioral helpers, and a refined visual identity;
component APIs remain shadcn-compatible.

## Locked shadcn preset

| Setting           | Value               |
| ----------------- | ------------------- |
| Primitive library | **Base UI**         |
| Style             | **Vega**            |
| Base color        | **Neutral**         |
| Theme             | **Blue**            |
| Chart color       | **Neutral**         |
| Heading           | **Inter**           |
| Font              | **Inter**           |
| Icons             | **Lucide**          |
| Radius            | **Default**         |
| Menu              | **Default / Solid** |
| Menu accent       | **Subtle**          |

**Preset code:** `bJzBPQGZc`

Verify:

```bash
pnpm dlx shadcn@latest preset decode bJzBPQGZc --json
pnpm dlx shadcn@latest preset resolve -c packages/ui --json
```

Create URL: https://ui.shadcn.com/create?preset=bJzBPQGZc

## Architectural boundary

| Belongs in `@atlas/ui`                                                           | Belongs in `apps/web`      |
| -------------------------------------------------------------------------------- | -------------------------- |
| shadcn/Base UI primitives regenerated from the locked preset                     | Product layouts and shells |
| Behavioral helpers (`useZodForm`, server error mapping, theme preference)        | Domain-specific feature UI |
| Ergonomic compositions (`EmptyState`, `ErrorFallback`, `SkeletonList`, `Loader`) | Navigation wiring          |
| Theme preference + FOUC boot script                                              | Reference examples         |

Atlas differentiation lives in **architecture, semantic tokens, and conventions** — not in forking
component APIs.

## Design system tokens

Visual styling flows through semantic tokens defined in `packages/ui/src/styles/globals.css`:

```text
foundation tokens (:root / .dark)
      ↓
Atlas semantic tokens (--control-*, --surface-*, --border-*, status colors; focus uses shadcn --ring)
      ↓
component variants (CVA + shared control-styles)
      ↓
application UI
```

Retheme Atlas primarily by changing semantic tokens. Shared control geometry and focus treatment
live in `packages/ui/src/lib/control-styles.ts` (same `focus-visible:border-ring` + `ring-ring/50`
pattern as base-vega primitives). `--focus-ring` in `globals.css` is a deprecated alias of `--ring`
for custom classes only.

## shadcn configuration

- **Canonical config:** `packages/ui/components.json` (`style: base-vega`)
- **Global CSS:** `packages/ui/src/styles/globals.css` (generated preset tokens + monorepo `@source`
  directives)
- **Generation flow:** `packages/ui/components.json` → `packages/ui/src/components/ui` → `@atlas/ui`
  public API → `apps/web`

`apps/web` consumes `@atlas/ui` only. Do not generate a local `apps/web/src/components/ui` tree.

Refresh upstream primitives:

```bash
pnpm dlx shadcn@latest apply bJzBPQGZc -c packages/ui -y
pnpm dlx shadcn@latest add button -c packages/ui --overwrite -y
pnpm dlx shadcn@latest add dialog -c packages/ui --diff
```

After regenerating primitives, convert any new `@/` package-internal imports to relative paths
before committing. The app TypeScript config must not alias into `packages/ui/src`.

**Rule:** For upstream-derived primitives, preserve component semantics and APIs. Visual changes
should flow through semantic tokens and shared control styles — not scattered per-component hex
values. Change the preset or tokens deliberately, or compose in application code.

### Troubleshooting stale theme output

After changing the shadcn/Tailwind preset or global CSS, if local development appears to retain old
theme values:

```bash
rm -rf apps/web/.next .turbo
pnpm dev
```

## Public API

```tsx
import { Button, EmptyState } from "@atlas/ui";
import "@atlas/ui/globals.css";
import { getThemeBootScriptContent } from "@atlas/ui/theme-boot";
```

Heavy optional primitives (`Chart`, `Calendar`, `Command`, `Combobox`, `Carousel`, `InputOTP`,
`Resizable`) live on `@atlas/ui/extended` so default app bundles do not include their large runtime
dependencies unless a feature imports them explicitly:

```tsx
import { ChartContainer } from "@atlas/ui/extended";
```

Do not import from `packages/ui/src/**`.

## Consuming primitives

Use this package's Storybook stories (`pnpm storybook`) as the local canonical usage reference for
`@atlas/ui` primitives. For shadcn/Base UI-backed primitives, preserve upstream behavior defaults
unless the product deliberately requires an override.

For Base UI `Select` where option values differ from visible labels, pass the `items` mapping on
`Select` so `SelectValue` can resolve the selected label.

## Atlas-owned behavior (non-visual contracts)

- `useTheme` / `ThemeProvider` / theme boot script — preference + `.dark` only
- `useZodForm`, `applyServerFieldErrors`, `getFormErrorMessage`
- `FormField` wrapper — accessibility wiring over `Field` primitives
- `EmptyState`, `ErrorFallback`, `Loader`/`PageLoader` — ergonomic compositions over canonical
  primitives

## Testing

```bash
pnpm --filter @atlas/ui test
pnpm --filter @atlas/ui build-storybook
```

Storybook uses the same Inter + Vega baseline as the app
(`packages/ui/.storybook/preview-head.html`).

### Design system screenshots (local review)

Generated PNGs are not committed. To capture light/dark screenshots of the Atlas design-system
stories for PR review:

```bash
pnpm --filter @atlas/ui build-storybook
pnpm --filter @atlas/web exec playwright install chromium
node packages/ui/scripts/capture-design-system-screenshots.mjs
```

Output is written to `packages/ui/design-system-screenshots/` (gitignored).
