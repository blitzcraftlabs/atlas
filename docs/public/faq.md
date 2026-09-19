# FAQ

> Common questions answered directly.

---

## General

### Is Atlas open source?

Yes. Atlas is **open source under Apache License 2.0**. The canonical public repository is
[`blitzcraftlabs/atlas`](https://github.com/blitzcraftlabs/atlas). Clone and fork are permitted
under the license.

See [Releases and Governance](../how-we-build/releases-and-governance.md) for licensing scope,
versioning, and support expectations. Workspace packages are not independently published to npm.

### Is Atlas a framework or a platform?

**Platform.** A framework gives you tools and lets you decide how to use them. A platform makes
those decisions for you. Atlas is opinionated about patterns, structure, and behavior. You work
within its conventions, not around them.

### Who is Atlas for?

Atlas is for:

- Product teams who want to ship features, not build infrastructure
- Organizations that value consistency over flexibility
- Engineers who believe conventions reduce cognitive load
- Teams building production applications who want a documented, opinionated starter

Atlas is **not for** teams that need an unopinionated kit, independently published npm packages, or
a contractual support SLA bundled with the repository.

### Can I use Atlas for my project?

Yes. Create a project with `pnpm dlx @blitzcraftlabs/atlas init my-app`, or clone or fork this
repository, under Apache License 2.0. Commercial engineering, support, or consulting is a separate
matter and is not required to use the source.

---

## Technical

### Why not NextAuth.js?

NextAuth.js is excellent for many use cases. Atlas uses a custom OAuth implementation because:

- **Full control** — Security-critical code benefits from direct ownership
- **Customization** — Specific requirements were easier to meet directly
- **Fewer layers** — Less abstraction means easier debugging
- **PKCE** — Easier to implement correctly without library constraints

The tradeoff is maintenance responsibility. For Atlas, that tradeoff is acceptable.

### Why not tRPC?

tRPC provides end-to-end type safety without code generation—it's a great tool. Atlas doesn't use it
because:

- **REST compatibility** — Atlas must work with existing REST APIs
- **OpenAPI ecosystem** — Many tools understand OpenAPI; fewer understand tRPC
- **Backend independence** — tRPC requires tRPC on the server; Atlas is frontend-first

If the backend were also built from scratch with TypeScript, tRPC would be compelling.

### Why not a CSS-in-JS solution?

CSS-in-JS (styled-components, emotion) offers component-scoped styles with JavaScript. Atlas uses
Tailwind CSS because:

- **Performance** — No runtime style generation
- **Consistency** — Design tokens in one place (CSS custom properties)
- **Tailwind ecosystem** — Widely understood, well-documented
- **v4 direction** — Tailwind v4's CSS-first approach aligns with platform philosophy

The tradeoff is less dynamic styling. For Atlas applications, that's rarely needed.

### Why not next-themes?

Atlas implements theming with Tailwind v4 CSS custom properties and a custom `useTheme` hook in
`@atlas/ui`—not with the `next-themes` package.

- **Tailwind v4** — CSS-first configuration fits native theme tokens
- **Control** — Exact behavior matches platform requirements (including FOUC prevention)
- **Fewer moving parts** — Theme state lives in platform code teams already own

For most Next.js applications, `next-themes` remains a fine choice. Atlas chose a CSS-first custom
implementation (see ADR-0001).

### Why cookie-based auth instead of tokens in localStorage?

Tokens in localStorage are convenient but vulnerable:

- **XSS exposure** — Any JavaScript can read localStorage
- **No httpOnly** — Can't protect tokens from scripts

Cookies with `httpOnly`, `Secure`, and `SameSite` attributes:

- **Inaccessible to JavaScript** — XSS can't steal tokens
- **Automatic transmission** — Browser handles auth headers

CSRF is a concern, but it's easier to mitigate than XSS.

### Why React Query instead of SWR?

Both are excellent. Atlas uses React Query because:

- **Mutation support** — Better patterns for write operations
- **DevTools** — Helpful for debugging cache behavior
- **Invalidation** — More granular control over cache updates

SWR is simpler and smaller. React Query is more powerful. Atlas needed the power.

---

## Architecture

### Why "frontend-first"?

Traditional architectures treat the frontend as a thin layer that displays what the backend
provides. This model is outdated:

- Frontend complexity has grown enormously
- Most user experience problems manifest in the frontend
- Teams with strong frontend foundations ship faster

"Frontend-first" means the frontend is the primary product surface, and architecture decisions
prioritize that reality.

### Can Atlas work with an existing backend?

Yes. Atlas defines contracts, not implementations. Any backend that conforms to the OpenAPI spec
works. The frontend doesn't care about backend implementation details—only that responses match the
contract.

### Can Atlas be adapted for full-stack applications?

Atlas is designed for frontend applications that consume APIs. It's not a full-stack framework. If
you need server-side business logic beyond authentication and proxying, you'd add a separate backend
service.

### Why a monorepo?

Monorepos simplify code sharing:

- Shared packages without npm publishing
- Consistent tooling across all code
- Atomic changes across packages
- Single source of truth for configuration

The tradeoff is tooling complexity. For Atlas, the benefits outweigh the costs.

---

## Process

### How are decisions made?

Significant technical decisions are documented in Architecture Decision Records (ADRs). Each ADR
captures:

- Context and problem
- Decision made
- Alternatives considered
- Tradeoffs accepted

This creates institutional memory. New team members understand not just what, but why.

### How is documentation maintained?

Documentation is treated as code:

- Changes to patterns require documentation updates
- Pull requests include relevant doc updates
- Material public claims are tracked in the [claims register](../audit/claims-register.md)
- Internal Markdown links are checked in CI (`pnpm docs:check`)

Outdated documentation is worse than no documentation. Atlas invests in keeping it current.

### What's the testing strategy?

Atlas uses a layered approach:

- **Unit tests** — Utilities, hooks, and UI package components
- **Component tests** — Rendering and interaction via Testing Library
- **E2E tests** — Playwright smoke coverage in CI

`@atlas/ui` enforces Jest coverage thresholds in CI. Broader risk-based coverage for auth, API, and
critical journeys is enforced by `pnpm test:risk-coverage` and `coverage-policy.json`. The public
Codecov percentage is a repository aggregate for visibility, not a merge gate. See
[Testing](../how-we-build/testing.md). Failing tests block merges.

---

## Philosophy

### Why is accessibility treated seriously?

Accessibility affects more users than you think:

- Users with disabilities (permanent)
- Users with injuries (temporary)
- Users on slow connections (situational)
- Power users who prefer keyboards

Atlas provides an accessibility-oriented baseline: semantic components, `eslint-plugin-jsx-a11y`
rules, Storybook a11y review, documented keyboard checks, and the **UI Quality** workflow for
representative `critical` compositions. This is **not** the same as formal WCAG conformance or
certification. See [Accessibility](../how-we-build/accessibility.md).

### Why are patterns so prescriptive?

Every pattern decision is cognitive load avoided. When the answer to "how should I do X?" is always
the same, developers think about product problems instead of infrastructure choices.

Flexibility has a cost. Consistency has a value. Atlas optimizes for consistency.

### Why document Atlas this way?

This documentation serves:

- **Onboarding** — Consumers start from the public CLI; contributors can work from a public clone
- **Evaluation** — Decision-makers can assess fit before adopting Atlas
- **Architecture reference** — Patterns are documented for recall
- **Evidence discipline** — Claims map to inspectable behavior where possible

---

## Miscellaneous

### What does "Atlas" mean?

Atlas is named for the Titan who held up the sky. The platform holds up the application, providing a
stable foundation so the product can focus on what matters.

### How long has Atlas been developed?

Atlas has evolved over time, incorporating lessons from production applications listed in the
[claims register](../audit/claims-register.md). It is not a greenfield experiment—product feedback
informed the platform—but detailed chronology is not fully published here.

### Is Atlas production-ready?

**Qualified yes.** Documented platform capabilities are production-ready when they meet the
definition in the [claims register](../audit/claims-register.md): supported scope, passing gates,
documented configuration, and known limitations.

Atlas has been **battle-tested** through named products (built from Atlas and migrated toward
Atlas). That does not mean every subsystem has the same operational evidence or that no production
defects occurred. Atlas does not currently publish production SLO or incident-response evidence.

---

## Further Reading

- [Decisions](decisions.md) — Detailed rationale for major choices
- [Architecture](architecture.md) — System design overview
- [Examples](examples.md) — See reference patterns in the template
- [Claims register](../audit/claims-register.md) — Evidence-backed claim definitions
