# Atlas security engineering

Canonical engineering notes for Atlas security gates, pins, and repository settings. Runtime abuse
cases belong in the [threat model](../security/threat-model.md). Reporting process lives in root
[`SECURITY.md`](../../SECURITY.md).

## Vulnerability policy

Atlas does **not** treat `pnpm audit`'s exit code as the security policy.

```text
pnpm audit --json
        ↓
raw advisory data
        ↓
scripts/security-audit.mjs
        ↓
security/policy.json + security-audit-exceptions.json
        ↓
human-readable summary
        ↓
exit 0 / exit 1
```

Checked-in policy ([`security/policy.json`](../../security/policy.json)):

- **Blocking threshold:** `high` (HIGH and CRITICAL)
- Remaining HIGH lockfile findings after in-range upgrades and `pnpm.overrides` are listed in
  [`security-audit-exceptions.json`](../../security-audit-exceptions.json) with owners,
  path-specific rationale, compensating controls, and an expiry of 2026-11-27. Removing or letting
  those expire re-blocks CI.
- Moderate and low findings are **reported** and do not block unless the policy file is changed
- `pnpm audit` is invoked **without** `--audit-level` filtering so the evaluator sees the full
  report
- Registry/JSON/schema failures **fail closed**
- Vulnerability-related `pnpm audit` exit `1` is expected input, not a green-CI bypass

Commands:

```bash
pnpm security:check
pnpm security:workflow-check
```

### Exceptions

[`security-audit-exceptions.json`](../../security-audit-exceptions.json) is fail-closed:

- required `owner`, `reason`, `compensatingControl`, `reviewedOn`, `expiresOn`
- precise `advisory` (`GHSA-…` or `CVE-…`) and `packageName`
- expired, malformed, wildcard, or mismatched entries fail
- stale exceptions (no matching current finding) fail

## Secret scanning

The **Secrets Scan** job in `.github/workflows/ci.yml` checks out with `fetch-depth: 0` and runs the
digest-pinned Gitleaks image (`gitleaks` v8.30.1 in `security/policy.json`) in git-aware mode:

```text
gitleaks git --redact --verbose --exit-code 1 /repo
```

Coverage is the Git history present in that checkout (commits reachable from the fetched refs GitHub
Actions materializes for the job). It is **not** a guarantee that every remote branch name that ever
existed on every fork is scanned if it was never fetched. Docker uses `--network=none`.

A synthetic GitHub-token-shaped fixture is assembled **at runtime**
(`scripts/gitleaks-fixture.mjs`): a temporary repository commits the token, deletes it, and asserts
the working tree is clean while Gitleaks still exits non-zero because the secret remains in history.
The token is never committed to Atlas.

## GitHub Actions pins

Remote `uses:` references must match `owner/repo[@/subpath]@<exactly 40 hex characters>`.
`pnpm security:workflow-check` is an allow-rule: tags, branches, and truncated SHAs fail, including
refs that are not in a known-mutable list (`@stable`, `@release`, `@abcdef1`, …).

Local `uses: ./…` actions are bound to the checked-out commit.

## Dependency review

GitHub-native Dependency Review / Dependency Graph SBOM export is **not currently treated as Atlas
evidence**. Atlas enforces an equivalent PR-time gate:

- `.github/workflows/security-audit.yml` runs on every pull request
- `pnpm security:check` evaluates the full `pnpm audit` document against Atlas policy

License classification remains `pnpm licenses:check` ([provenance.md](provenance.md)). This workflow
does not duplicate license policy.

## SBOM

Atlas generates an SPDX 2.3 JSON snapshot from `pnpm-lock.yaml` on `main` pushes,
version-tag-equivalent snapshots, and `workflow_dispatch` via the Release workflow. Artifacts are
named `atlas-sbom-<sha>` and retained for 90 days. This is **not** a GitHub Dependency Graph export.

```bash
pnpm sbom:generate
```

## Self-hosted runners

Push access to the canonical Atlas repository is part of the trusted self-hosted-runner boundary.
External fork pull requests **must not** run on persistent Atlas self-hosted machines.

Only `.github/workflows/trusted-self-hosted.yml` may target the `Blitzcraft Trusted CI` runner
group. Callers pin it with `trusted-self-hosted.yml@main` (the runner-group allowlist stays
`trusted-self-hosted.yml@refs/heads/main`) and compute `ATLAS_CI_USE_SELF_HOSTED` only when
`ATLAS_CI_RUNNER_PROFILE=self-hosted` **and**:

```text
github.event_name != 'pull_request'
  || github.event.pull_request.head.repo.full_name == github.repository
```

The trusted reusable workflow repeats the fork gate before scheduling self-hosted jobs. Fork PRs
always use GitHub-hosted runners. Atlas does not use `pull_request_target` to check out untrusted
code.

`pnpm security:workflow-check` fails if another workflow targets trusted runner infrastructure,
removes the fork trust gate, drops the GitHub-hosted fallback, or introduces `pull_request_target`.

## Branch protection / rulesets (expected)

Canonical inventory: [repository integrations](repository-integrations.md). Inspected **2026-09-12**
on public `blitzcraftlabs/atlas` (ID `1366318006`).

| Setting                           | Public-repo result                                       |
| --------------------------------- | -------------------------------------------------------- |
| Visibility                        | Public                                                   |
| Branch protection API             | Enabled on `main` (classic protection; no rulesets)      |
| Required status checks            | Governance, CI, Secrets Scan, Security Audit, UI Quality |
| Require branches up to date       | Yes (`strict: true`)                                     |
| Required conversation resolution  | Enabled                                                  |
| Force pushes / deleting `main`    | Disabled                                                 |
| Enforce admins                    | Disabled                                                 |
| Required pull request reviews     | Unset (single maintainer)                                |
| Private vulnerability reporting   | Enabled                                                  |
| Secret scanning + push protection | Enabled                                                  |
| Secret scanning validity checks   | Intentionally disabled                                   |
| Secret scanning non-provider      | Intentionally disabled                                   |
| Dependabot security updates       | Enabled                                                  |
| GitHub code scanning              | Not configured; not Atlas evidence                       |

**Do not remove or rename the required checks.** On the public repository, require:

- **Governance**
- **CI**
- **Secrets Scan**
- **Security Audit**
- **UI Quality**

Do not treat GitHub Dependency Graph, Advanced Security code scanning, or a formal penetration test
as currently proven Atlas evidence.

## Security-fix propagation

Documented in [`SECURITY.md`](../../SECURITY.md) and [upgrades.md](upgrades.md). Internal `@atlas/*`
workspace packages are not published to npm. `@blitzcraftlabs/atlas` is the public npm package
identity. npm distribution occurs after the canonical GitHub Release; registry availability is
verified separately. The first npm publication was a human-authenticated publish of
`@blitzcraftlabs/atlas@1.0.1` from the exact canonical tarball. Later releases use GitHub Actions
OIDC / npm Trusted Publishing (`release.yml`). Canonical GitHub Releases do not include signed
provenance or SLSA attestation. npm provenance on later Trusted Publishing releases is not a GitHub
Release attestation.

## Current limitations

| Topic                         | Current state                                                                 |
| ----------------------------- | ----------------------------------------------------------------------------- |
| Risk-based testing            | Enforced via `pnpm test:risk-coverage` and [testing.md](testing.md)           |
| Independent review / runbooks | Atlas does not currently publish production SLO or incident-response evidence |
| Formal certification          | Out of scope — no WCAG, SOC, or pentest certification is claimed              |
| GitHub Release publication    | Enabled after Version PR merge — first canonical public release is `v0.2.0`   |
