import { existsSync } from "node:fs";
import path from "node:path";

import {
  ATLAS_CONTRACT_FILENAME,
  DEFAULT_ATLAS_PROJECT_CONTRACT,
  LATEST_SCHEMA_VERSION,
  type RawAtlasProjectContract,
} from "@atlas/project";

import { CONSUMER_GENERATED_DOCUMENTATION_PATHS } from "../context/documentation-registry";

import type { PlannedAction } from "../types/result";
import type { EnvPolicy } from "./types";

export const CONSUMER_NODE_ENGINE = ">=22.0.0";
export const CONSUMER_PNPM_ENGINE = ">=10.0.0";
export const CONSUMER_PACKAGE_MANAGER = "pnpm@10.19.0";

const CONSUMER_ROOT_DEV_DEPENDENCIES = {
  "@eslint/js": "^9.39.2",
  globals: "^16.5.0",
  prettier: "3.4.2",
  "prettier-plugin-tailwindcss": "0.6.10",
  turbo: "2.3.3",
} as const;

export function buildConsumerPackageManifest(options: {
  projectName: string;
  atlasVersion: string;
  includePerfCommands?: boolean;
  pnpmOverrides?: Record<string, string>;
}): string {
  const scripts: Record<string, string> = {
    preinstall: "node scripts/ensure-pnpm.js",
    atlas: "atlas",
    dev: "turbo run dev",
    build: "turbo run build",
    lint: "turbo run lint",
    "lint:fix": "turbo run lint:fix",
    format: 'prettier --check "**/*.{ts,tsx,js,jsx,json,md,yml,yaml}"',
    "format:write": 'prettier --write "**/*.{ts,tsx,js,jsx,json,md,yml,yaml}"',
    "format:check": "turbo run format:check",
    typecheck: "turbo run typecheck",
    test: "turbo run test",
    "test:watch": "turbo run test:watch",
    "test:e2e": "turbo run test:e2e",
    clean: "turbo run clean && rm -rf node_modules",
    "api:gen": "pnpm --filter @atlas/web api:gen",
    "validate:env": "pnpm --filter @atlas/web validate:env",
  };

  if (options.includePerfCommands) {
    scripts.start = "pnpm --filter @atlas/web start";
    scripts["perf:lhci"] = "pnpm --filter @atlas/web perf:lhci";
    scripts["perf:analyze"] = "pnpm --filter @atlas/web perf:analyze";
  }

  const manifest = {
    name: options.projectName,
    version: "0.1.0",
    private: true,
    license: "Apache-2.0",
    description: `Atlas application generated from Atlas ${options.atlasVersion}`,
    engines: {
      node: CONSUMER_NODE_ENGINE,
      pnpm: CONSUMER_PNPM_ENGINE,
    },
    packageManager: CONSUMER_PACKAGE_MANAGER,
    scripts,
    devDependencies: {
      "@blitzcraftlabs/atlas": options.atlasVersion,
      ...CONSUMER_ROOT_DEV_DEPENDENCIES,
    },
    ...(options.pnpmOverrides && Object.keys(options.pnpmOverrides).length > 0
      ? { pnpm: { overrides: options.pnpmOverrides } }
      : {}),
  };

  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function buildConsumerReadme(options: {
  projectName: string;
  atlasVersion: string;
  runningCliVersion?: string;
}): string {
  return `# ${options.projectName}

This project was generated from Atlas ${options.atlasVersion}.

The generated application stays in this repository. Atlas does not host your application.

## Getting started

\`\`\`bash
pnpm install
pnpm dev
\`\`\`

## Atlas CLI

This project pins \`@blitzcraftlabs/atlas\` at the generated baseline and exposes it as \`pnpm atlas\`.
Ordinary commands use that local CLI. They do not download a floating \`@latest\` package.

\`\`\`bash
pnpm install
pnpm atlas doctor
pnpm atlas context --json
pnpm atlas generate list --json
pnpm atlas enable list --json
pnpm atlas upgrade --dry-run
pnpm atlas upgrade
\`\`\`

Create a new project before this repository exists with \`pnpm dlx @blitzcraftlabs/atlas init <name>\`.
After init, stay on \`pnpm atlas\`.

\`atlas upgrade\` resolves the latest stable release when \`--to\` is omitted and hands the operation
to that exact CLI. \`--to <version>\` remains the deterministic override.

Optional Storybook, visual tests, performance CI, security auditing, Dependabot, coverage floors,
Git hooks, Cursor adapters, and Docker Compose are **opt-in**. See
\`docs/how-we-build/consumer-tooling.md\`. Enable them with \`pnpm atlas enable\`. Enablement does
not overwrite customized files, and \`atlas upgrade\` does not install optional tooling.

Existing apps generated from an older CLI should run \`enable docs\` only against a known unmodified
shipped \`AGENTS.md\` copy. Customized agent docs are left untouched.

## Continuous integration

\`.github/workflows/ci.yml\` is generated with this project and is source-owned afterward. It runs
on GitHub-hosted Ubuntu, needs no repository secrets, and does not use BlitzCraft infrastructure.
Replace it with your own GitHub, GitLab, Buildkite, or self-hosted pipeline if you prefer.

The default workflow is the supported quality baseline (Doctor, lint, typecheck, tests, production
build). It is not Atlas maintainer CI. Playwright E2E is omitted until you add browsers and a
running app. Commit \`pnpm-lock.yaml\` after \`pnpm install\` so \`--frozen-lockfile\` succeeds.

## Documentation

- Atlas public docs: https://github.com/blitzcraftlabs/atlas/blob/main/docs/public/README.md
- Atlas Doctor: https://github.com/blitzcraftlabs/atlas/blob/main/docs/how-we-build/doctor.md
- Consumer tooling: docs/how-we-build/consumer-tooling.md
- Reference patterns: docs/how-we-build/reference-patterns.md
`;
}

export function buildConsumerJestConfig(): string {
  return `/**
 * Root Jest configuration for the generated Atlas workspace.
 */
module.exports = {
  projects: ["<rootDir>/apps/web", "<rootDir>/packages/ui", "<rootDir>/packages/consent"],
  collectCoverageFrom: [
    "apps/*/src/**/*.{ts,tsx}",
    "packages/*/src/**/*.{ts,tsx}",
    "!**/*.d.ts",
    "!**/*.stories.tsx",
    "!**/index.ts",
    "!**/node_modules/**",
  ],
};
`;
}

export function buildConsumerContract(options: { repoRoot: string }): RawAtlasProjectContract {
  const specPath = path.join(
    options.repoRoot,
    DEFAULT_ATLAS_PROJECT_CONTRACT.generated.openApi.spec
  );
  const schemaPath = path.join(
    options.repoRoot,
    DEFAULT_ATLAS_PROJECT_CONTRACT.generated.openApi.schema
  );
  const hasOpenApi = existsSync(specPath) && existsSync(schemaPath);

  const contract: RawAtlasProjectContract = hasOpenApi
    ? { schemaVersion: LATEST_SCHEMA_VERSION }
    : {
        schemaVersion: LATEST_SCHEMA_VERSION,
        capabilities: {
          openApi: false,
        },
      };

  return contract;
}

export function planGeneratedAtInitActions(env: EnvPolicy): PlannedAction[] {
  const envTarget = path.posix.join(DEFAULT_ATLAS_PROJECT_CONTRACT.application.root, ".env.local");

  return [
    {
      kind: "create",
      path: ATLAS_CONTRACT_FILENAME,
      reason: "Generate Atlas project contract and platform.baseline checksums",
    },
    {
      kind: "create",
      path: "package.json",
      reason: "Generate consumer workspace manifest",
    },
    {
      kind: "skip",
      path: "pnpm-lock.yaml",
      reason:
        "Left absent until the consumer runs pnpm install; Atlas does not fabricate a lockfile",
    },
    {
      kind: "create",
      path: "README.md",
      reason: "Generate consumer-facing quickstart",
    },
    {
      kind: "create",
      path: "jest.config.js",
      reason: "Generate Jest projects for the materialized workspace",
    },
    ...CONSUMER_GENERATED_DOCUMENTATION_PATHS.map((destination) => ({
      kind: "create" as const,
      path: destination,
      reason:
        destination === "AGENTS.md"
          ? "Generate consumer agent guidance for the published CLI"
          : "Generate consumer documentation for the published CLI",
    })),
    env === "copy"
      ? {
          kind: "copy" as const,
          path: envTarget,
          reason: "Copy .env.example to .env.local",
        }
      : {
          kind: "skip" as const,
          path: envTarget,
          reason:
            "Environment setup skipped (--env skip); .env.example remains the documented template",
        },
  ];
}
