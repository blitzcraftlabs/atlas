# Repository integrations and GitHub settings

Maintainer-facing record of how the canonical public repository
[`blitzcraftlabs/atlas`](https://github.com/blitzcraftlabs/atlas) is connected to GitHub features
and third-party apps. Public contributors do not need this page to open issues or pull requests;
start from [CONTRIBUTING.md](../../CONTRIBUTING.md).

Inspected **2026-09-23** against repository ID `1366318006`. Do not assume pre-cutover settings from
a previous GitHub repository identity still apply. GitHub-native repository settings on this public
repo are **not** shipped to projects created with `atlas init`.

## Canonical remotes

Active Atlas development uses the public repository as `origin`:

```text
origin    git@github.com:blitzcraftlabs/atlas.git
```

A private archive remote may exist on maintainer clones for historical issues. It is **not** the
development, PR, or release origin.

Automation in this repository uses `github.repository` / `GITHUB_REPOSITORY` and defaults to
`blitzcraftlabs/atlas`. Release compare and tag URLs are hardcoded to the public repository.

## Integration matrix

| Integration / capability              | State                        | Scope                    | Verification                                                                                                              |
| ------------------------------------- | ---------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| GitHub Actions                        | active                       | public repo              | Workflows green on `main` at `cbd5828` (`v0.2.0` published)                                                               |
| Required checks                       | enabled                      | `main` branch protection | Governance, CI, Secrets Scan, Security Audit, UI Quality                                                                  |
| Private vulnerability reporting       | enabled                      | public repo              | `GET /repos/.../private-vulnerability-reporting` → `{"enabled":true}`                                                     |
| Secret scanning                       | enabled                      | public repo              | `security_and_analysis.secret_scanning`                                                                                   |
| Secret scanning push protection       | enabled                      | public repo              | `security_and_analysis.secret_scanning_push_protection`                                                                   |
| Secret scanning validity checks       | intentionally disabled       | public repo              | Optional provider-liveness check; Gitleaks + scanning + push protection already cover known secrets                       |
| Secret scanning non-provider patterns | intentionally disabled       | public repo              | Likely noise on a template with example credentials; Gitleaks remains the CI gate                                         |
| Dependabot vulnerability alerts       | enabled                      | public repo              | `GET /repos/.../vulnerability-alerts` → HTTP 204                                                                          |
| Dependabot security updates           | enabled                      | public repo              | Native GitHub security-update workflow; no `dependabot.yml` version-update file                                           |
| GitHub CodeQL code scanning           | enabled                      | public repo              | Default setup `configured` (2026-09-22); dynamic workflow `dynamic/github-code-scanning/codeql`; **not** a required check |
| GitHub Code Quality                   | not configured               | public repo              | `GET /code-quality/setup` → `not-configured`; distinct from CodeQL security scanning and Atlas UI Quality                 |
| Codecov                               | reporting                    | public repo              | CI uploads the repository aggregate; `fail_ci_if_error: false`; risk floors stay local                                    |
| Vercel GitHub App                     | intentionally not connected  | public Atlas repo        | No Vercel project linked to `blitzcraftlabs/atlas`; the marketing site lives in `shipwithatlas`                           |
| ChatGPT / Codex GitHub App            | manual verification required | selected-repo org app    | Org installation exists; user token cannot list selected repositories                                                     |
| Cursor GitHub App                     | organization-wide            | all org repos            | `repository_selection: all`; no repo-specific action                                                                      |

## Codecov

CI uploads coverage with `codecov/codecov-action` and `fail_ci_if_error: false`. That policy is
intentional: `coverage-policy.json` via `pnpm test:risk-coverage` (locally) /
`node scripts/coverage-policy.mjs` (CI, after `pnpm test:coverage:all`) is the blocking gate. See
[testing.md](testing.md).

Codecov is the **repository aggregate** used for the README coverage badge. It is not a merge gate
and not a quality score. `codecov.yml` disables project and patch status checks.

CI supplies Istanbul `coverage-final.json` from `@atlas/web`, `@atlas/reference`, `@atlas/ui`,
`@blitzcraftlabs/atlas` (CLI), `@atlas/project`, and `@atlas/consent`, plus LCOV from root
`scripts/**`. Confirm https://app.codecov.io/gh/blitzcraftlabs/atlas after uploads on `main`.

## Vercel

The BlitzCraft Vercel team has Git-linked projects for other repositories. None of them link to
`blitzcraftlabs/atlas`. Atlas itself is a forkable template; the public marketing site
[shipwithatlas.com](https://shipwithatlas.com) is built from
[`blitzcraftlabs/shipwithatlas`](https://github.com/blitzcraftlabs/shipwithatlas), an Atlas consumer
workspace. The earlier `atlas-showcase` repository is retired and archived.

Connecting Vercel to the public Atlas repository is **not required** for template CI or GitHub
Releases. Do not grant the Vercel GitHub App extra repositories unless a maintainer later wants
preview deploys of this repo.

## ChatGPT / Codex

The `chatgpt-codex-connector` GitHub App is installed on the `blitzcraftlabs` organization with
**selected-repository** access. Listing those repositories requires a GitHub App installation token,
which this audit did not have.

**Maintainer action (only if Codex should see public Atlas):** open
[GitHub App installations](https://github.com/organizations/blitzcraftlabs/settings/installations) →
ChatGPT Codex connector → confirm `blitzcraftlabs/atlas` (ID `1366318006`) is selected. Do not
broaden the app to every organization repository unless that is already intended.

## Scanning layers

Three different products can appear in GitHub's UI. Only the first set is an Atlas merge contract.

| Layer                       | Where it lives                                                               | Merge gate?                                        | Ships to `atlas init` consumers?                                   |
| --------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------ |
| Atlas-owned CI              | `.github/workflows/ci.yml`, `security-audit.yml`, `ui-quality.yml`           | Yes — required checks listed below                 | Portable `ci.yml` only; not these jobs' names or branch protection |
| GitHub CodeQL code scanning | GitHub default setup; dynamic workflow `dynamic/github-code-scanning/codeql` | No — PRs may show a **CodeQL** check; not required | No                                                                 |
| GitHub Code Quality         | Separate GitHub product (`/code-quality/setup`)                              | No — not configured                                | No                                                                 |

CodeQL security scanning and GitHub Code Quality both can use CodeQL queries, but they are different
GitHub products. Atlas **UI Quality** is a third, unrelated Storybook/a11y/visual workflow. Details:
[security engineering](security.md).

## GitHub-native security settings

| Setting                         | Disposition            | Rationale                                                                                                             |
| ------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Vulnerability alerts            | enabled                | Needed for Dependabot security updates                                                                                |
| Dependabot security updates     | enabled                | GitHub-native patches; Atlas still blocks HIGH/CRITICAL via `pnpm security:check`                                     |
| Private vulnerability reporting | enabled                | Public issue forms redirect here; see [SECURITY.md](../../SECURITY.md)                                                |
| Secret scanning                 | enabled                | Complements CI Gitleaks                                                                                               |
| Push protection                 | enabled                | Blocks known-provider secrets on push                                                                                 |
| Validity checks                 | intentionally disabled | Optional after a secret is found; enable in GitHub UI later if maintainers want liveness checks                       |
| Non-provider patterns           | intentionally disabled | High false-positive risk on example env/template files                                                                |
| Code scanning / CodeQL          | enabled                | Default setup on this public repo. Complements Atlas gates; **not** a required check and not consumer template CI     |
| GitHub Code Quality             | not configured         | Separate maintainability product. Do not confuse with CodeQL security scanning or Atlas **UI Quality**                |
| Branch protection on `main`     | enabled                | Classic protection (no rulesets). Required checks must stay: Governance, CI, Secrets Scan, Security Audit, UI Quality |
| Required reviews                | not applicable         | Unset; single maintainer. Do not add a review requirement that blocks the only admin                                  |
| Enforce admins                  | intentionally disabled | Current setting; do not weaken required checks. Enabling later is a maintainer choice                                 |
| Required signatures             | intentionally disabled | Not part of the Atlas contributor contract                                                                            |

Do **not** remove or rename the required checks listed above. Do **not** treat CodeQL or Code
Quality as required unless branch protection is updated to include them.

## Repository metadata

Expected public state (verified 2026-09-23):

- Public template repository, default branch `main`
- Homepage `https://shipwithatlas.com`
- Issues enabled; Discussions, Wiki, and Projects disabled
- Forking enabled; delete branch on merge enabled
- Topics: `nextjs`, `react`, `typescript`, `tailwindcss`, `monorepo`, `pnpm`, `design-system`,
  `accessibility`, `frontend`, `shadcn-ui`

## Community files

| File                                     | Role                                           |
| ---------------------------------------- | ---------------------------------------------- |
| `.github/ISSUE_TEMPLATE/config.yml`      | Issue chooser; blank issues off; security link |
| `.github/ISSUE_TEMPLATE/bug.yml`         | Public bug form                                |
| `.github/ISSUE_TEMPLATE/feature.yml`     | Public feature / improvement form              |
| `.github/ISSUE_TEMPLATE/docs.yml`        | Public documentation form                      |
| `.github/pull_request_template.md`       | Short PR contributor checklist                 |
| [SECURITY.md](../../SECURITY.md)         | Vulnerability reporting                        |
| [CONTRIBUTING.md](../../CONTRIBUTING.md) | Contributor workflow                           |

## Related

- [Continuous integration](ci.md)
- [Security engineering](security.md)
- [Releases and governance](releases-and-governance.md)
