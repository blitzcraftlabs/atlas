# Architecture Decision Records

> Document decisions, not just code. Future you will thank present you.

## What is an ADR?

An Architecture Decision Record captures a significant technical decision along with its context and
consequences. ADRs prevent decisions from disappearing into Slack threads and ensure new team
members understand _why_ the codebase looks the way it does.

## When to Write an ADR

Write an ADR when you:

- Choose a library/framework over alternatives
- Establish a pattern that the team must follow
- Deprecate or replace an existing pattern
- Make a decision that's hard to reverse

**Don't** write an ADR for:

- Bug fixes
- Minor refactors
- Obvious choices with no alternatives

## ADR Index

| #                                                                  | Title                                              | Status   |
| ------------------------------------------------------------------ | -------------------------------------------------- | -------- |
| [0000](0000-template.md)                                           | ADR Template                                       | Template |
| [0001](0001-tailwind-v4-css-first-theming.md)                      | Tailwind v4 CSS-First Theming                      | Accepted |
| [0002](0002-env-validation-t3-env.md)                              | Environment Validation with t3-env                 | Accepted |
| [0003](0003-data-fetching-react-query.md)                          | Data Fetching with React Query + OpenAPI           | Accepted |
| [0004](0004-oauth-google-pkce.md)                                  | OAuth with Google PKCE                             | Accepted |
| [0005](0005-observability-sentry.md)                               | Observability with Sentry                          | Accepted |
| [0006](0006-consent-management.md)                                 | Optional Consent Management                        | Accepted |
| [0007](0007-architecture-ownership-model.md)                       | Architecture Ownership Model                       | Accepted |
| [0008](0008-atlas-project-contract.md)                             | Atlas Project Architecture Contract                | Accepted |
| [0009](0009-starter-reference-template-sync.md)                    | Starter/Reference Template Sync                    | Accepted |
| [0010](0010-atlas-upgrades-downstream-propagation.md)              | Atlas Upgrades and Downstream Propagation          | Accepted |
| [0011](0011-distribution-v1-package-and-bootstrap-architecture.md) | Distribution v1 Package and Bootstrap Architecture | Accepted |
| [0012](0012-consumer-extension-points.md)                          | Consumer Extension Points                          | Accepted |
| [0013](0013-opt-in-usage-signal.md)                                | Opt-In Usage Signal                                | Proposed |

## Status Lifecycle

```
Proposed → Accepted → [Deprecated | Superseded]
```

- **Proposed**: Under discussion, not yet implemented
- **Accepted**: Decided and implemented
- **Deprecated**: No longer recommended, but still in codebase
- **Superseded by [ADR-XXXX]**: Replaced by a newer decision

## Creating a New ADR

1. Copy [0000-template.md](0000-template.md)
2. Rename to `NNNN-short-title.md` (next number in sequence)
3. Fill in all sections
4. Submit PR with the ADR and implementation together
5. Add to index above

## Format

Each ADR must include:

- **Title**: Clear, descriptive
- **Status**: Proposed | Accepted | Deprecated | Superseded
- **Context**: What situation led to this decision?
- **Decision**: What did we decide?
- **Alternatives Considered**: What else was evaluated?
- **Consequences**: What are the tradeoffs?
- **References**: Links to docs, PRs, discussions
