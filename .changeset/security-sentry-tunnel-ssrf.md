---
"@blitzcraftlabs/atlas": patch
---

Security: the starter's Sentry tunnel route (`apps/web/src/app/monitoring/route.ts`) no longer
builds its upstream URL from the `o`/`r` query parameters, which allowed unauthenticated requests to
make the server POST to arbitrary HTTPS hosts (SSRF / open proxy). The tunnel now forwards only to
the ingest endpoints of the app's configured DSNs (`NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_DSN`), rejects
other projects with 403, caps envelopes at 2 MiB (logging a `sentry_tunnel_envelope_rejected`
warning when it drops one), and forwards bodies as bytes. Projects generated from earlier Atlas
versions own this route and should copy the fix (`src/app/monitoring/route.ts` and
`src/config/sentry-tunnel.ts`).
