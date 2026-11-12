# ADR-0013: Opt-In Usage Signal

## Status

**Proposed** — awaiting a maintainer decision. Nothing in this ADR is implemented.

## Context

Atlas has no way to know who uses it or which versions consumers run. npm download counts include CI
installs and mirrors and say nothing about versions in use. That matters for concrete decisions:

- how wide the upgrade window must be ([#110](https://github.com/blitzcraftlabs/atlas/issues/110)),
- when a recovery bridge or migration can be retired,
- whether a security fix needs backporting.

Telemetry in developer tools is also a trust question. Atlas positions itself as source-owned: the
application lives in the consumer's repository and Atlas does not host it.

## Options

1. **No telemetry.** Rely on npm downloads, `ADOPTERS.md`, Discussions, and issues.
2. **Opt-in anonymous ping.** Off by default. Enabled only by `ATLAS_TELEMETRY=1` or
   `atlas.config.json#telemetry: true`. Sends
   `{ atlasVersion, command, exitCode, cliVersion, nodeMajor }` — no paths, file names, repository
   names, code, environment values, or IPs stored. Documented endpoint, public schema, and
   `atlas telemetry status`.
3. **Opt-out ping.** On by default with a disable switch.

## Recommendation

Option 1 now, revisit Option 2 once there are external adopters asking for longer support windows.
Option 3 is rejected: on-by-default telemetry contradicts the source-owned positioning and would
need a privacy review Atlas is not set up for.

## Consequences

- Option 1 keeps the trust story simple and costs nothing to run.
- Support-window decisions keep relying on adopters reporting their versions (ADOPTERS.md and the
  upgrade bot's issues/PRs in public repositories).
- If Option 2 is accepted later, it needs: an endpoint, a retention policy, a public schema, a
  `SECURITY.md`/privacy note, and tests that prove nothing is sent unless enabled.
