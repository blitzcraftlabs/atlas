import type { CapabilityDefinition } from "./types";

export const CONSUMER_CAPABILITIES: CapabilityDefinition[] = [
  {
    id: "docs",
    title: "Consumer agent documentation",
    description:
      "Generate AGENTS.md, agent workflow, folder map, examples, tooling, and reference-pattern docs that match a generated consumer workspace.",
    tier: "default",
    heavier: false,
    requires: [],
    detectPath: "AGENTS.md",
    files: [],
    generated: true,
    validationCommand: "atlas enable docs --dry-run --json",
  },
  {
    id: "storybook",
    title: "Storybook",
    description:
      "Component workshop plus interaction and accessibility checks for @atlas/ui. Heavier than the default unit-test baseline.",
    tier: "opt-in",
    heavier: true,
    requires: [],
    detectPath: "packages/ui/.storybook/main.ts",
    restoreUiScriptNames: [
      "storybook",
      "build-storybook",
      "test:storybook",
      "test:storybook:cross-browser",
    ],
    rootScripts: {
      storybook: "pnpm --filter @atlas/ui storybook",
      "storybook:build": "pnpm --filter @atlas/ui build-storybook",
    },
    files: [
      { source: "packages/ui/.storybook", destination: "packages/ui/.storybook" },
      {
        source: "packages/ui/scripts/run-storybook-tests.mjs",
        destination: "packages/ui/scripts/run-storybook-tests.mjs",
      },
      {
        source: "packages/ui/scripts/serve-storybook-static.mjs",
        destination: "packages/ui/scripts/serve-storybook-static.mjs",
      },
      {
        source: "packages/ui/playwright.storybook.config.ts",
        destination: "packages/ui/playwright.storybook.config.ts",
      },
    ],
    validationCommand:
      "pnpm --filter @atlas/ui build-storybook && pnpm --filter @atlas/ui test:storybook",
  },
  {
    id: "visual",
    title: "Visual regression tests",
    description:
      "Playwright screenshot baselines for @atlas/ui, compared only in mcr.microsoft.com/playwright:v<playwright-version>-noble. Requires Storybook. Do not recapture on a developer laptop.",
    tier: "opt-in",
    heavier: true,
    requires: ["storybook"],
    detectPath: "packages/ui/playwright.visual.config.ts",
    restoreUiScriptNames: [
      "test:visual",
      "test:visual:update",
      "test:visual:docker",
      "test:ui-quality",
    ],
    rootScripts: {
      "test:visual": "pnpm --filter @atlas/ui test:visual:docker",
    },
    files: [
      { source: "packages/ui/visual-tests", destination: "packages/ui/visual-tests" },
      {
        source: "packages/ui/playwright.visual.config.ts",
        destination: "packages/ui/playwright.visual.config.ts",
      },
      {
        source: "packages/ui/scripts/run-visual-in-playwright-docker.mjs",
        destination: "packages/ui/scripts/run-visual-in-playwright-docker.mjs",
      },
      {
        source: "packages/cli/bootstrap/capabilities/templates/ui-visual.yml",
        destination: ".github/workflows/ui-visual.yml",
      },
      {
        source: "packages/cli/bootstrap/capabilities/templates/update-visual-baselines.yml",
        destination: ".github/workflows/update-visual-baselines.yml",
      },
    ],
    validationCommand:
      "pnpm --filter @atlas/ui build-storybook && pnpm --filter @atlas/ui test:visual:docker",
  },
  {
    id: "perf-ci",
    title: "Performance CI",
    description:
      "GitHub Actions workflows for Lighthouse CI and bundle budgets. Local `pnpm perf:lhci` / `pnpm perf:analyze` already ship in the default starter.",
    tier: "opt-in",
    heavier: true,
    requires: [],
    detectPath: ".github/workflows/perf-lighthouse.yml",
    rootScripts: {
      start: "pnpm --filter @atlas/web start",
    },
    files: [
      {
        source: "packages/cli/bootstrap/capabilities/templates/perf-lighthouse.yml",
        destination: ".github/workflows/perf-lighthouse.yml",
      },
      {
        source: "packages/cli/bootstrap/capabilities/templates/perf-bundle.yml",
        destination: ".github/workflows/perf-bundle.yml",
      },
    ],
    validationCommand: "pnpm perf:lhci && pnpm --filter @atlas/web perf:analyze",
  },
  {
    id: "security",
    title: "Dependency security audit",
    description:
      "Consumer-safe `pnpm audit` gate and optional GitHub workflow. Does not copy Atlas maintainer Gitleaks, SBOM, or governance checks.",
    tier: "opt-in",
    heavier: false,
    requires: [],
    detectPath: "scripts/security-audit.mjs",
    rootScripts: {
      "security:check": "node scripts/security-audit.mjs",
    },
    files: [
      {
        source: "packages/cli/bootstrap/capabilities/templates/security-audit.mjs",
        destination: "scripts/security-audit.mjs",
      },
      {
        source: "packages/cli/bootstrap/capabilities/templates/security-audit.yml",
        destination: ".github/workflows/security-audit.yml",
      },
    ],
    validationCommand: "pnpm security:check",
  },
  {
    id: "updates",
    title: "Dependency update PRs",
    description:
      "GitHub Dependabot for npm and GitHub Actions. Consumer-owned; replace with Renovate if you prefer.",
    tier: "opt-in",
    heavier: false,
    requires: [],
    detectPath: ".github/dependabot.yml",
    files: [
      {
        source: "packages/cli/bootstrap/capabilities/templates/dependabot.yml",
        destination: ".github/dependabot.yml",
      },
    ],
    validationCommand: "test -f .github/dependabot.yml",
  },
  {
    id: "upgrades",
    title: "Atlas upgrade PRs",
    description:
      "Weekly GitHub workflow that runs `pnpm atlas upgrade`, opens one pull request when a newer Atlas release applies cleanly, and opens one issue when the upgrade needs a human. Consumer-owned.",
    tier: "opt-in",
    heavier: false,
    requires: [],
    detectPath: ".github/workflows/atlas-upgrade.yml",
    rootScripts: {
      "atlas:upgrade-pr": "node scripts/atlas-upgrade-pr.mjs",
    },
    files: [
      {
        source: "packages/cli/bootstrap/capabilities/templates/atlas-upgrade.yml",
        destination: ".github/workflows/atlas-upgrade.yml",
      },
      {
        source: "packages/cli/bootstrap/capabilities/templates/atlas-upgrade-pr.mjs",
        destination: "scripts/atlas-upgrade-pr.mjs",
      },
    ],
    validationCommand: "pnpm atlas upgrade --dry-run --json",
  },
  {
    id: "coverage",
    title: "Critical-subsystem coverage",
    description:
      "Istanbul coverage floors for auth, API, and UI form infrastructure. Opt-in because it requires coverage runs on every check.",
    tier: "opt-in",
    heavier: false,
    requires: [],
    detectPath: "coverage-policy.json",
    rootScripts: {
      "test:coverage:all": "turbo run test:coverage",
      "test:risk-coverage":
        "pnpm --filter @atlas/web test:coverage && pnpm --filter @atlas/ui test:coverage && node scripts/coverage-policy.mjs",
    },
    files: [
      { source: "coverage-policy.json", destination: "coverage-policy.json" },
      { source: "scripts/coverage-policy.mjs", destination: "scripts/coverage-policy.mjs" },
    ],
    validationCommand: "pnpm test:risk-coverage",
  },
  {
    id: "hooks",
    title: "Git hooks",
    description: "Husky + lint-staged on commit. Does not require Docker or Gitleaks.",
    tier: "opt-in",
    heavier: false,
    requires: [],
    detectPath: ".husky/pre-commit",
    rootScripts: {
      prepare: "husky",
    },
    rootDevDependencies: {
      husky: "9.1.7",
      "lint-staged": "15.2.10",
    },
    files: [
      {
        source: "packages/cli/bootstrap/capabilities/templates/pre-commit",
        destination: ".husky/pre-commit",
      },
      { source: "lint-staged.config.mjs", destination: "lint-staged.config.mjs" },
      {
        source: "scripts/lint-staged-utils.mjs",
        destination: "scripts/lint-staged-utils.mjs",
      },
      {
        source: "scripts/lint-staged-eslint.mjs",
        destination: "scripts/lint-staged-eslint.mjs",
      },
    ],
    validationCommand: "pnpm exec husky && pnpm exec lint-staged",
  },
  {
    id: "cursor",
    title: "Cursor adapters",
    description:
      "Thin Cursor rules and skill that delegate to consumer AGENTS.md and the published CLI.",
    tier: "opt-in",
    heavier: false,
    requires: [],
    detectPath: ".cursor/rules/atlas-core.mdc",
    files: [],
    generated: true,
    validationCommand: "atlas enable cursor --dry-run --json",
  },
  {
    id: "docker",
    title: "Docker Compose",
    description:
      "Local Compose scaffold and optional Postgres/Redis example. Dockerfile and .dockerignore already ship with atlas init.",
    tier: "opt-in",
    heavier: false,
    requires: [],
    detectPath: "docker-compose.yml",
    files: [
      { source: "docker-compose.yml", destination: "docker-compose.yml" },
      {
        source: "examples/compose/infra.yml",
        destination: "examples/compose/infra.yml",
      },
      {
        source: "docs/how-we-build/local-dev-composition.md",
        destination: "docs/how-we-build/local-dev-composition.md",
      },
      {
        source: "Dockerfile",
        destination: "Dockerfile",
      },
      {
        source: ".dockerignore",
        destination: ".dockerignore",
      },
    ],
    validationCommand: "docker build -t atlas-web . && docker run --rm -p 3000:3000 atlas-web",
  },
];

export function listCapabilityDefinitions(): CapabilityDefinition[] {
  return CONSUMER_CAPABILITIES.map((capability) => ({
    ...capability,
    requires: [...capability.requires],
    files: capability.files.map((file) => ({
      ...file,
      exclude: file.exclude ? [...file.exclude] : undefined,
    })),
    restoreUiScriptNames: capability.restoreUiScriptNames
      ? [...capability.restoreUiScriptNames]
      : undefined,
    rootScripts: capability.rootScripts ? { ...capability.rootScripts } : undefined,
    rootDevDependencies: capability.rootDevDependencies
      ? { ...capability.rootDevDependencies }
      : undefined,
  }));
}

export function getCapabilityDefinition(id: string): CapabilityDefinition | undefined {
  return CONSUMER_CAPABILITIES.find((capability) => capability.id === id);
}
