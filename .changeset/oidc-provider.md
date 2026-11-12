---
"@blitzcraftlabs/atlas": minor
---

Add a generic OpenID Connect provider beside Google. Set `AUTH_OIDC_ISSUER` and
`AUTH_OIDC_CLIENT_ID` (plus an optional secret and scopes) to sign in through `/api/auth/oidc/start`
with any OIDC issuer. Endpoints come from the validated discovery document, and switching providers
no longer requires editing synced auth files.
