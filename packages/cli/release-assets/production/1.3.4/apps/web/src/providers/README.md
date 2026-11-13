# Provider composition

Providers in this directory wire **platform infrastructure** from `@/lib/*` and `@atlas/*` into the
React tree. They are **app-owned composition** — consumers rearrange, extend, or replace them for
their product.

## Classification

| Provider             | Classification               | Role                                                          |
| -------------------- | ---------------------------- | ------------------------------------------------------------- |
| `MainProvider`       | App-owned composition        | Root stack: feature flags, theme, toasts, consent, web vitals |
| `ThemeProvider`      | Re-export of `@atlas/ui`     | Thin alias for app import consistency                         |
| `ToasterProvider`    | App-owned composition        | Mounts Sonner toaster + notification host                     |
| `ConsentBridge`      | App-owned composition        | Maps app config → `@atlas/consent` + analytics consent        |
| `AnalyticsProvider`  | App-owned composition        | Lazy-inits analytics adapters from config                     |
| `DataProviderLayout` | Reference-scoped composition | React Query provider for `/examples` routes only              |

## What is not a platform primitive

Not every React wrapper here is reusable platform code. `MainProvider` is the **reference app's**
provider stack. Consumers may split, rename, or relocate these files when building their product.

Platform contracts live in `@/lib/*` (auth, analytics, feature-flags, react-query, etc.) and
`@atlas/*` packages. Providers connect those contracts to React.
