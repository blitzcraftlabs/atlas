# ADR-0012: Consumer Extension Points (Custom Generators and OIDC Providers)

## Status

**Accepted**

## Context

Teams adopting Atlas hit two walls ([#113](https://github.com/blitzcraftlabs/atlas/issues/113)):

1. **Generators were fixed** to `feature` and `page`. Teams could not codify their own structural
   patterns in a form that Doctor, `atlas generate list`, and `atlas context` understand, so agents
   and humans fell back to copy-paste.
2. **Authentication was Google-only.** Most teams use an enterprise or SaaS identity provider.
   Swapping providers meant editing synced auth paths, which then became `merge-required` on every
   upgrade.

## Decision

### Custom generators live in the contract

`atlas.config.json#generators.<id>` declares a template directory, a target path, an optional
argument description, and follow-up steps. `atlas generate <id> <name>` renders every template file
with a small fixed placeholder set (`{{name}}`, `{{kebab}}`, `{{camel}}`, `{{pascal}}`, `{{title}}`)
and reuses the built-in generator engine (conflicts fail, rollback on error).

- Templates and output are **consumer-owned**; `atlas upgrade` never touches them.
- No template language beyond fixed placeholders. Logic belongs in product code, not in generators.
- Generators are discoverable through the same machine interfaces as built-ins (`source: "custom"`).

### Identity providers plug in beside the provider-neutral session core

The encrypted session core (`lib/auth/session.ts`) was already provider-neutral. Providers are
modules under `lib/auth/providers/<id>` that implement authorize URL, code exchange, refresh, and
user info, plus a `session-refresh` module. Atlas ships:

- `google` (existing reference integration), and
- `oidc` — a **generic OpenID Connect** provider configured only through `AUTH_OIDC_*` environment
  variables. Endpoints come from the issuer's discovery document, which is validated (issuer match,
  required endpoints, PKCE S256, https).

Selecting a provider is configuration plus a route (`/api/auth/<id>/start|callback`), so consumers
do not edit synced files and upgrade checksums stay intact.

## Consequences

### Positive

- Teams codify their own structure without forking generator code.
- Any OIDC-compliant IdP (Auth0, Okta, Entra ID, Keycloak, Zitadel, Cognito, ...) works without
  vendor code.
- Synced auth paths stay unmodified for consumers who switch providers.

### Negative

- Two provider modules to maintain in the synced auth surface.
- Custom generator templates are not validated beyond rendering; consumers own their correctness.
- User identity uses the UserInfo endpoint, not local ID-token signature verification (same
  trade-off as the Google provider).

## References

- [ADR-0004: OAuth with Google PKCE](0004-oauth-google-pkce.md)
- [ADR-0008: Atlas Project Architecture Contract](0008-atlas-project-contract.md)
- [Atlas contract — custom generators](../how-we-build/atlas-contract.md)
