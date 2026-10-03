import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { runInit } from "../commands/init";
import { enableConsumerCapability, listConsumerCapabilities } from "../enable/apply";
import { generatedFilesForCapability } from "../enable/patches";
import {
  CANONICAL_CHROME_FLAGS,
  CUSTOM_CHROME_FLAGS_REASON,
  LEGACY_CHROME_FLAGS_REASON,
} from "../enable/lighthouse-chrome-flags";
import { ENABLE_CLI_RELEASE_PLACEHOLDER } from "../init/cli-release";
import { selectConsumerPnpmOverrides } from "../init/consumer-overrides";
import { isKnownShippedConsumerDocumentation } from "../init/shipped-docs";
import { verifyGeneratedGitHook } from "./helpers/verify-generated-git-hook";

const GENERATED_TIMEOUT_MS = 60_000;
const SHIPPED_AGENTS = path.resolve(__dirname, "fixtures/shipped-1.1.0/AGENTS.md");
const SHIPPED_LIGHTHOUSE = path.resolve(__dirname, "fixtures/shipped-1.1.0/lighthouserc.json");
const CONSUMER_BASELINE_WITHOUT_ENABLE = "1.1.0";
const CLI_WITHOUT_ENABLE = "1.1.0";
const CLI_WITH_ENABLE = "99.0.0";

function snapshotTree(root: string, relative: string[]): Record<string, string | false> {
  const snapshot: Record<string, string | false> = {};
  for (const entry of relative) {
    const absolute = path.join(root, entry);
    snapshot[entry] = existsSync(absolute) ? readFileSync(absolute, "utf8") : false;
  }
  return snapshot;
}

function pinConsumerBaseline(repoRoot: string, atlasVersion: string): void {
  const contractPath = path.join(repoRoot, "atlas.config.json");
  const contract = JSON.parse(readFileSync(contractPath, "utf8")) as {
    platform?: { baseline?: { atlasVersion?: string } };
  };
  if (!contract.platform?.baseline) {
    throw new Error(`Expected platform.baseline in ${contractPath}`);
  }
  contract.platform.baseline.atlasVersion = atlasVersion;
  writeFileSync(contractPath, `${JSON.stringify(contract, null, 2)}\n`);
}

describe("atlas enable", () => {
  it(
    "lists default vs opt-in capabilities with precise status",
    () => {
      const cwd = mkdtempSync(path.join(os.tmpdir(), "atlas-enable-list-"));
      try {
        runInit({ cwd, project: "test-app", reference: "keep", env: "skip" });
        const destination = path.join(cwd, "test-app");
        const listed = listConsumerCapabilities({ cwd: destination });
        const byId = Object.fromEntries(listed.capabilities.map((entry) => [entry.id, entry]));
        expect(listed.workspaceKind).toBe("consumer");
        expect(listed.statusMeaning).toMatch(/does not mean validationCommand passed/i);
        expect(byId.docs?.status).toBe("installed");
        expect(byId.docs?.filesMatch).toBe(true);
        expect(byId.docs?.tier).toBe("default");
        expect(byId.docs?.validationCommand).toContain("enable docs");
        expect(byId.storybook?.status).toBe("absent");
        expect(byId.storybook?.filesMatch).toBe(false);
        expect(byId.storybook?.heavier).toBe(true);
        expect(byId.storybook?.validationCommand).toContain("build-storybook");
        expect(byId.visual?.requires).toEqual(["storybook"]);
        expect(byId.visual?.validationCommand).toContain("test:visual:docker");
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    },
    GENERATED_TIMEOUT_MS
  );

  it(
    "enables coverage without overwriting a customized policy",
    () => {
      const cwd = mkdtempSync(path.join(os.tmpdir(), "atlas-enable-coverage-"));
      try {
        runInit({ cwd, project: "test-app", reference: "keep", env: "skip" });
        const destination = path.join(cwd, "test-app");
        const first = enableConsumerCapability({ cwd: destination, capability: "coverage" });
        expect(first.actions.some((action) => action.path === "coverage-policy.json")).toBe(true);
        expect(existsSync(path.join(destination, "coverage-policy.json"))).toBe(true);
        expect(existsSync(path.join(destination, "scripts/coverage-policy.mjs"))).toBe(true);

        const packageJson = JSON.parse(
          readFileSync(path.join(destination, "package.json"), "utf8")
        ) as {
          scripts: Record<string, string>;
        };
        expect(packageJson.scripts["test:risk-coverage"]).toContain("coverage-policy.mjs");

        writeFileSync(path.join(destination, "coverage-policy.json"), '{"custom":true}\n');
        const second = enableConsumerCapability({ cwd: destination, capability: "coverage" });
        const policyAction = second.actions.find(
          (action) => action.path === "coverage-policy.json"
        );
        expect(policyAction?.kind).toBe("conflict");
        expect(readFileSync(path.join(destination, "coverage-policy.json"), "utf8")).toBe(
          '{"custom":true}\n'
        );
        expect(
          listConsumerCapabilities({ cwd: destination }).capabilities.find(
            (entry) => entry.id === "coverage"
          )?.status
        ).toBe("conflicted");
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    },
    GENERATED_TIMEOUT_MS
  );

  it(
    "does not infer overwrite permission from documentation phrases",
    () => {
      const cwd = mkdtempSync(path.join(os.tmpdir(), "atlas-enable-phrase-"));
      try {
        runInit({ cwd, project: "test-app", reference: "keep", env: "skip" });
        const destination = path.join(cwd, "test-app");
        const phraseStale = `# Atlas\n\npnpm --filter @blitzcraftlabs/atlas build\npnpm atlas context --json\napps/reference is the executable reference application\n`;
        expect(isKnownShippedConsumerDocumentation("AGENTS.md", phraseStale)).toBe(false);
        writeFileSync(path.join(destination, "AGENTS.md"), phraseStale);

        const result = enableConsumerCapability({ cwd: destination, capability: "docs" });
        expect(result.actions.find((action) => action.path === "AGENTS.md")?.kind).toBe("conflict");
        expect(readFileSync(path.join(destination, "AGENTS.md"), "utf8")).toBe(phraseStale);
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    },
    GENERATED_TIMEOUT_MS
  );

  it(
    "replaces AGENTS.md only when the full contents match a known shipped copy",
    () => {
      const cwd = mkdtempSync(path.join(os.tmpdir(), "atlas-enable-docs-hash-"));
      try {
        runInit({ cwd, project: "test-app", reference: "keep", env: "skip" });
        const destination = path.join(cwd, "test-app");
        const shipped = readFileSync(SHIPPED_AGENTS, "utf8");
        expect(isKnownShippedConsumerDocumentation("AGENTS.md", shipped)).toBe(true);
        writeFileSync(path.join(destination, "AGENTS.md"), shipped);
        pinConsumerBaseline(destination, CONSUMER_BASELINE_WITHOUT_ENABLE);

        const replaced = enableConsumerCapability({
          cwd: destination,
          capability: "docs",
          runningCliVersion: CLI_WITHOUT_ENABLE,
        });
        const agentsAction = replaced.actions.find((action) => action.path === "AGENTS.md");
        expect(agentsAction?.kind).toBe("copy");
        const updated = readFileSync(path.join(destination, "AGENTS.md"), "utf8");
        expect(updated).toContain("enable list --json");
        expect(updated).toContain("pnpm atlas doctor");
        expect(updated).toContain("pnpm atlas enable list --json");
        expect(updated).not.toContain(
          `pnpm dlx @blitzcraftlabs/atlas@${CONSUMER_BASELINE_WITHOUT_ENABLE} enable`
        );
        expect(updated).not.toContain(`@${ENABLE_CLI_RELEASE_PLACEHOLDER}`);

        writeFileSync(path.join(destination, "AGENTS.md"), "# Custom agent notes\n");
        const preserved = enableConsumerCapability({
          cwd: destination,
          capability: "docs",
          runningCliVersion: CLI_WITHOUT_ENABLE,
        });
        expect(preserved.actions.find((action) => action.path === "AGENTS.md")?.kind).toBe(
          "conflict"
        );
        expect(readFileSync(path.join(destination, "AGENTS.md"), "utf8")).toBe(
          "# Custom agent notes\n"
        );
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    },
    GENERATED_TIMEOUT_MS
  );

  it(
    "leaves the tree unchanged on dry-run",
    () => {
      const cwd = mkdtempSync(path.join(os.tmpdir(), "atlas-enable-dry-"));
      try {
        runInit({ cwd, project: "test-app", reference: "keep", env: "skip" });
        const destination = path.join(cwd, "test-app");
        const watched = ["coverage-policy.json", "scripts/coverage-policy.mjs", "package.json"];
        const before = snapshotTree(destination, watched);
        const dryRun = enableConsumerCapability({
          cwd: destination,
          capability: "coverage",
          dryRun: true,
        });
        expect(dryRun.actions.some((action) => action.kind === "create")).toBe(true);
        expect(snapshotTree(destination, watched)).toEqual(before);
        expect(existsSync(path.join(destination, "coverage-policy.json"))).toBe(false);
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    },
    GENERATED_TIMEOUT_MS
  );

  it(
    "repeats enablement as skips when files already match",
    () => {
      const cwd = mkdtempSync(path.join(os.tmpdir(), "atlas-enable-repeat-"));
      try {
        runInit({ cwd, project: "test-app", reference: "keep", env: "skip" });
        const destination = path.join(cwd, "test-app");
        enableConsumerCapability({ cwd: destination, capability: "coverage" });
        const repeat = enableConsumerCapability({ cwd: destination, capability: "coverage" });
        expect(repeat.actions.every((action) => action.kind === "skip")).toBe(true);
        expect(
          listConsumerCapabilities({ cwd: destination }).capabilities.find(
            (entry) => entry.id === "coverage"
          )?.status
        ).toBe("installed");
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    },
    GENERATED_TIMEOUT_MS
  );

  it(
    "fills missing files on a partial installation without overwriting customizations",
    () => {
      const cwd = mkdtempSync(path.join(os.tmpdir(), "atlas-enable-partial-"));
      try {
        runInit({ cwd, project: "test-app", reference: "keep", env: "skip" });
        const destination = path.join(cwd, "test-app");
        enableConsumerCapability({ cwd: destination, capability: "coverage" });
        rmSync(path.join(destination, "scripts/coverage-policy.mjs"));
        writeFileSync(path.join(destination, "coverage-policy.json"), '{"custom":true}\n');
        expect(
          listConsumerCapabilities({ cwd: destination }).capabilities.find(
            (entry) => entry.id === "coverage"
          )?.status
        ).toBe("conflicted");

        const repaired = enableConsumerCapability({ cwd: destination, capability: "coverage" });
        expect(
          repaired.actions.find((action) => action.path === "scripts/coverage-policy.mjs")?.kind
        ).toBe("create");
        expect(
          repaired.actions.find((action) => action.path === "coverage-policy.json")?.kind
        ).toBe("conflict");
        expect(existsSync(path.join(destination, "scripts/coverage-policy.mjs"))).toBe(true);
        expect(readFileSync(path.join(destination, "coverage-policy.json"), "utf8")).toBe(
          '{"custom":true}\n'
        );
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    },
    GENERATED_TIMEOUT_MS
  );

  it(
    "reports package-key conflicts and still writes non-conflicting keys",
    () => {
      const cwd = mkdtempSync(path.join(os.tmpdir(), "atlas-enable-pkg-"));
      try {
        runInit({ cwd, project: "test-app", reference: "keep", env: "skip" });
        const destination = path.join(cwd, "test-app");
        const packageJsonPath = path.join(destination, "package.json");
        const manifest = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
          scripts: Record<string, string>;
        };
        manifest.scripts["test:risk-coverage"] = "echo custom";
        writeFileSync(packageJsonPath, `${JSON.stringify(manifest, null, 2)}\n`);

        const result = enableConsumerCapability({ cwd: destination, capability: "coverage" });
        const conflict = result.actions.find(
          (action) => action.path === "package.json#scripts.test:risk-coverage"
        );
        const created = result.actions.find(
          (action) => action.path === "package.json#scripts.test:coverage:all"
        );
        expect(conflict?.kind).toBe("conflict");
        expect(created?.kind).toBe("create");
        const next = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
          scripts: Record<string, string>;
        };
        expect(next.scripts["test:risk-coverage"]).toBe("echo custom");
        expect(next.scripts["test:coverage:all"]).toBe("turbo run test:coverage");
        expect(existsSync(path.join(destination, "coverage-policy.json"))).toBe(true);
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    },
    GENERATED_TIMEOUT_MS
  );

  it(
    "enables Storybook assets and restores UI scripts without shipping them by default",
    () => {
      const cwd = mkdtempSync(path.join(os.tmpdir(), "atlas-enable-storybook-"));
      try {
        runInit({ cwd, project: "test-app", reference: "keep", env: "skip" });
        const destination = path.join(cwd, "test-app");
        expect(existsSync(path.join(destination, "packages/ui/.storybook/main.ts"))).toBe(false);

        const result = enableConsumerCapability({ cwd: destination, capability: "storybook" });
        expect(result.actions.some((action) => action.kind === "conflict")).toBe(false);
        expect(existsSync(path.join(destination, "packages/ui/.storybook/main.ts"))).toBe(true);
        expect(
          existsSync(path.join(destination, "packages/ui/scripts/run-storybook-tests.mjs"))
        ).toBe(true);

        const ui = JSON.parse(
          readFileSync(path.join(destination, "packages/ui/package.json"), "utf8")
        ) as { scripts: Record<string, string>; devDependencies: Record<string, string> };
        expect(ui.scripts.storybook).toBeDefined();
        expect(ui.devDependencies.storybook).toBeDefined();
        expect(ui.devDependencies.vite).toBeDefined();
        expect(ui.scripts.prepare).toBeUndefined();

        const root = JSON.parse(readFileSync(path.join(destination, "package.json"), "utf8")) as {
          scripts: Record<string, string>;
          pnpm?: { overrides?: Record<string, string> };
        };
        expect(root.scripts.storybook).toBe("pnpm --filter @atlas/ui storybook");
        expect(root.pnpm?.overrides?.vite).toBeDefined();
        expect(root.pnpm?.overrides?.["@playwright/test"]).toBeDefined();
        expect(root.pnpm?.overrides?.playwright).toBeDefined();
        const web = JSON.parse(
          readFileSync(path.join(destination, "apps/web/package.json"), "utf8")
        ) as { devDependencies: Record<string, string> };
        expect(web.devDependencies["@playwright/test"]).toBe(
          ui.devDependencies["@playwright/test"]
        );
        expect(
          listConsumerCapabilities({ cwd: destination }).capabilities.find(
            (entry) => entry.id === "storybook"
          )?.status
        ).toBe("installed");
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    },
    GENERATED_TIMEOUT_MS
  );

  it(
    "uses the enable placeholder when the running CLI does not include the command",
    () => {
      const cwd = mkdtempSync(path.join(os.tmpdir(), "atlas-enable-placeholder-"));
      try {
        runInit({ cwd, project: "test-app", reference: "keep", env: "skip" });
        const destination = path.join(cwd, "test-app");
        const files = generatedFilesForCapability({
          capabilityId: "docs",
          repoRoot: destination,
          atlasVersion: CONSUMER_BASELINE_WITHOUT_ENABLE,
          runningCliVersion: CLI_WITHOUT_ENABLE,
        });
        const agents = files.find((file) => file.destination === "AGENTS.md");
        expect(agents?.content).toContain("pnpm atlas doctor");
        expect(agents?.content).toContain("pnpm atlas context --json");
        expect(agents?.content).toContain("pnpm atlas enable list --json");
        expect(agents?.content).not.toContain(ENABLE_CLI_RELEASE_PLACEHOLDER);
        expect(agents?.content).not.toContain(
          `pnpm dlx @blitzcraftlabs/atlas@${CONSUMER_BASELINE_WITHOUT_ENABLE} enable`
        );
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    },
    GENERATED_TIMEOUT_MS
  );

  it(
    "pins generated enable commands to a running CLI that includes enable, not the baseline",
    () => {
      const cwd = mkdtempSync(path.join(os.tmpdir(), "atlas-enable-cli-pin-"));
      try {
        runInit({ cwd, project: "test-app", reference: "keep", env: "skip" });
        const destination = path.join(cwd, "test-app");
        pinConsumerBaseline(destination, CONSUMER_BASELINE_WITHOUT_ENABLE);
        writeFileSync(path.join(destination, "AGENTS.md"), readFileSync(SHIPPED_AGENTS, "utf8"));
        const files = generatedFilesForCapability({
          capabilityId: "docs",
          repoRoot: destination,
          atlasVersion: CONSUMER_BASELINE_WITHOUT_ENABLE,
          runningCliVersion: CLI_WITH_ENABLE,
        });
        const agents = files.find((file) => file.destination === "AGENTS.md");
        expect(agents?.content).toContain("pnpm atlas doctor");
        expect(agents?.content).toContain("pnpm atlas context --json");
        expect(agents?.content).toContain("pnpm atlas enable list --json");
        expect(agents?.content).not.toContain(ENABLE_CLI_RELEASE_PLACEHOLDER);

        const applied = enableConsumerCapability({
          cwd: destination,
          capability: "docs",
          runningCliVersion: CLI_WITH_ENABLE,
        });
        expect(applied.actions.find((action) => action.path === "AGENTS.md")?.kind).toBe("copy");
        const updated = readFileSync(path.join(destination, "AGENTS.md"), "utf8");
        expect(updated).toContain("pnpm atlas doctor");
        expect(updated).toContain("pnpm atlas enable list --json");
        expect(updated).not.toContain(ENABLE_CLI_RELEASE_PLACEHOLDER);
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    },
    GENERATED_TIMEOUT_MS
  );

  it(
    "replaces the known Atlas web Playwright specifier and preserves custom pins",
    () => {
      const cwd = mkdtempSync(path.join(os.tmpdir(), "atlas-enable-pw-"));
      try {
        runInit({ cwd, project: "test-app", reference: "keep", env: "skip" });
        const destination = path.join(cwd, "test-app");
        const webPackageJson = path.join(destination, "apps/web/package.json");
        const readWeb = () =>
          JSON.parse(readFileSync(webPackageJson, "utf8")) as {
            devDependencies: Record<string, string>;
          };

        const stale = readWeb();
        stale.devDependencies["@playwright/test"] = "^1.61.0";
        writeFileSync(webPackageJson, `${JSON.stringify(stale, null, 2)}\n`);
        const replaced = enableConsumerCapability({ cwd: destination, capability: "storybook" });
        expect(
          replaced.actions.find(
            (action) => action.path === "apps/web/package.json#devDependencies.@playwright/test"
          )?.kind
        ).toBe("copy");
        const ui = JSON.parse(
          readFileSync(path.join(destination, "packages/ui/package.json"), "utf8")
        ) as { devDependencies: Record<string, string> };
        expect(readWeb().devDependencies["@playwright/test"]).toBe(
          ui.devDependencies["@playwright/test"]
        );

        const customized = readWeb();
        customized.devDependencies["@playwright/test"] = "1.99.0";
        writeFileSync(webPackageJson, `${JSON.stringify(customized, null, 2)}\n`);
        const preserved = enableConsumerCapability({ cwd: destination, capability: "storybook" });
        expect(
          preserved.actions.find(
            (action) => action.path === "apps/web/package.json#devDependencies.@playwright/test"
          )?.kind
        ).toBe("conflict");
        expect(readWeb().devDependencies["@playwright/test"]).toBe("1.99.0");
        expect(
          listConsumerCapabilities({ cwd: destination }).capabilities.find(
            (entry) => entry.id === "storybook"
          )?.status
        ).toBe("conflicted");
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    },
    GENERATED_TIMEOUT_MS
  );

  it(
    "refuses visual enablement until Storybook is fully installed",
    () => {
      const cwd = mkdtempSync(path.join(os.tmpdir(), "atlas-enable-visual-"));
      try {
        runInit({ cwd, project: "test-app", reference: "keep", env: "skip" });
        const destination = path.join(cwd, "test-app");
        expect(() => enableConsumerCapability({ cwd: destination, capability: "visual" })).toThrow(
          /requires storybook/
        );

        enableConsumerCapability({ cwd: destination, capability: "storybook" });
        rmSync(path.join(destination, "packages/ui/.storybook/main.ts"));
        expect(
          listConsumerCapabilities({ cwd: destination }).capabilities.find(
            (entry) => entry.id === "storybook"
          )?.status
        ).toBe("partial");
        expect(() => enableConsumerCapability({ cwd: destination, capability: "visual" })).toThrow(
          /status: partial/
        );
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    },
    GENERATED_TIMEOUT_MS
  );

  it("selects pnpm overrides only for packages the consumer actually depends on", () => {
    const selected = selectConsumerPnpmOverrides(
      { react: "19.0.0", vite: "6.4.3", "brace-expansion@1": "1.1.18" },
      ["react", "react-dom"]
    );
    expect(selected).toEqual({ react: "19.0.0" });
  });

  it("enables remaining opt-in capabilities without overwriting customized files", () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "atlas-enable-rest-"));
    try {
      runInit({ cwd, project: "test-app", reference: "keep", env: "skip" });
      const destination = path.join(cwd, "test-app");

      const remaining: { id: string; path: string }[] = [
        { id: "security", path: "scripts/security-audit.mjs" },
        { id: "updates", path: ".github/dependabot.yml" },
        { id: "hooks", path: ".husky/pre-commit" },
        { id: "cursor", path: ".cursor/rules/atlas-core.mdc" },
        { id: "docker", path: "docker-compose.yml" },
        { id: "perf-ci", path: ".github/workflows/perf-lighthouse.yml" },
      ];

      for (const capability of remaining) {
        const result = enableConsumerCapability({ cwd: destination, capability: capability.id });
        expect(result.actions.some((action) => action.kind === "conflict")).toBe(false);
        expect(existsSync(path.join(destination, capability.path))).toBe(true);
      }

      expect(existsSync(path.join(destination, "examples/compose/infra.yml"))).toBe(true);
      expect(existsSync(path.join(destination, "Dockerfile"))).toBe(true);
      expect(existsSync(path.join(destination, ".dockerignore"))).toBe(true);
      const dockerfile = readFileSync(path.join(destination, "Dockerfile"), "utf8");
      expect(dockerfile).toContain("COPY scripts/ensure-pnpm.js");
      expect(dockerfile).toContain("mkdir -p apps/web/public");
      const dockerignore = readFileSync(path.join(destination, ".dockerignore"), "utf8");
      expect(dockerignore).toContain("node_modules");
      const perfWorkflow = readFileSync(
        path.join(destination, ".github/workflows/perf-lighthouse.yml"),
        "utf8"
      );
      expect(perfWorkflow).toContain("browser-actions/setup-chrome@");
      expect(perfWorkflow).toContain("CHROME_PATH");
      const bundleWorkflow = readFileSync(
        path.join(destination, ".github/workflows/perf-bundle.yml"),
        "utf8"
      );
      expect(bundleWorkflow).toMatch(
        /github\.event\.pull_request\.head\.repo\.full_name\s*==\s*\n?\s*github\.repository/
      );
      expect(bundleWorkflow).not.toContain("pull_request_target");
      expect(bundleWorkflow).toMatch(/name: Comment on PR[\s\S]*full_name\s*==/);
      expect(bundleWorkflow).toContain("Fail if bundle check failed");
      const commentIndex = bundleWorkflow.indexOf("name: Comment on PR");
      const failIndex = bundleWorkflow.indexOf("name: Fail if bundle check failed");
      expect(commentIndex).toBeGreaterThan(-1);
      expect(failIndex).toBeGreaterThan(commentIndex);
      const commentBlock = bundleWorkflow.slice(commentIndex, failIndex);
      expect(commentBlock).toMatch(/full_name\s*==/);
      expect(commentBlock).toContain("github.event_name == 'pull_request'");
      const failBlock = bundleWorkflow.slice(failIndex);
      expect(failBlock).not.toMatch(/full_name/);
      expect(existsSync(path.join(destination, "lint-staged.config.mjs"))).toBe(true);
      expect(existsSync(path.join(destination, "scripts/lint-staged-eslint.mjs"))).toBe(true);
      expect(
        existsSync(path.join(destination, ".cursor/skills/build-atlas-feature/SKILL.md"))
      ).toBe(true);

      const cursorRule = readFileSync(
        path.join(destination, ".cursor/rules/atlas-core.mdc"),
        "utf8"
      );
      expect(cursorRule).toContain("pnpm atlas enable list --json");
      expect(cursorRule).not.toContain("pnpm dlx @blitzcraftlabs/atlas@");

      writeFileSync(path.join(destination, "docker-compose.yml"), "name: customized\n");
      const dockerAgain = enableConsumerCapability({ cwd: destination, capability: "docker" });
      expect(dockerAgain.actions.find((action) => action.path === "docker-compose.yml")?.kind).toBe(
        "conflict"
      );
      expect(readFileSync(path.join(destination, "docker-compose.yml"), "utf8")).toBe(
        "name: customized\n"
      );

      enableConsumerCapability({ cwd: destination, capability: "storybook" });
      const visual = enableConsumerCapability({ cwd: destination, capability: "visual" });
      expect(visual.actions.some((action) => action.kind === "conflict")).toBe(false);
      expect(existsSync(path.join(destination, "packages/ui/playwright.visual.config.ts"))).toBe(
        true
      );
      expect(
        existsSync(
          path.join(destination, "packages/ui/scripts/run-visual-in-playwright-docker.mjs")
        )
      ).toBe(true);
      const visualConfig = readFileSync(
        path.join(destination, "packages/ui/playwright.visual.config.ts"),
        "utf8"
      );
      expect(visualConfig).toContain("maxDiffPixelRatio: 0.005");
      expect(visualConfig).toContain("/ms-playwright");
      const visualWorkflow = readFileSync(
        path.join(destination, ".github/workflows/ui-visual.yml"),
        "utf8"
      );
      expect(visualWorkflow).toContain("pnpm --filter @atlas/ui test:visual:docker");
      expect(visualWorkflow).not.toContain("turing-ci");
      expect(visualWorkflow).not.toMatch(/^\s+run:.*--update-snapshots/m);
      const updateWorkflow = readFileSync(
        path.join(destination, ".github/workflows/update-visual-baselines.yml"),
        "utf8"
      );
      expect(updateWorkflow).toContain("workflow_dispatch");
      expect(updateWorkflow).toContain("run-visual-in-playwright-docker.mjs --update");
      expect(visual.warnings.some((warning) => warning.code === "VISUAL_DOCKER")).toBe(true);
      const root = JSON.parse(readFileSync(path.join(destination, "package.json"), "utf8")) as {
        scripts: Record<string, string>;
      };
      expect(root.scripts["test:visual"]).toBe("pnpm --filter @atlas/ui test:visual:docker");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 120_000);

  it(
    "converts the Atlas 1.1.0 lighthouse chromeFlags array during perf-ci enable",
    () => {
      const cwd = mkdtempSync(path.join(os.tmpdir(), "atlas-enable-lhci-"));
      try {
        runInit({ cwd, project: "test-app", reference: "keep", env: "skip" });
        const destination = path.join(cwd, "test-app");
        const lighthousePath = path.join(destination, "lighthouserc.json");
        const shipped = readFileSync(SHIPPED_LIGHTHOUSE, "utf8");
        writeFileSync(lighthousePath, shipped);

        const dryRun = enableConsumerCapability({
          cwd: destination,
          capability: "perf-ci",
          dryRun: true,
        });
        expect(dryRun.actions.find((action) => action.path === "lighthouserc.json")?.kind).toBe(
          "copy"
        );
        expect(dryRun.actions.find((action) => action.path === "lighthouserc.json")?.reason).toBe(
          LEGACY_CHROME_FLAGS_REASON
        );
        expect(readFileSync(lighthousePath, "utf8")).toBe(shipped);

        const applied = enableConsumerCapability({ cwd: destination, capability: "perf-ci" });
        expect(applied.actions.find((action) => action.path === "lighthouserc.json")?.kind).toBe(
          "copy"
        );
        const parsed = JSON.parse(readFileSync(lighthousePath, "utf8")) as {
          ci: {
            collect: {
              numberOfRuns: number;
              settings: { chromeFlags: unknown; preset: string; skipAudits: string[] };
            };
          };
        };
        expect(parsed.ci.collect.settings.chromeFlags).toBe(CANONICAL_CHROME_FLAGS);
        expect(parsed.ci.collect.settings.preset).toBe("desktop");
        expect(parsed.ci.collect.settings.skipAudits).toEqual([
          "uses-http2",
          "uses-long-cache-ttl",
        ]);
        expect(parsed.ci.collect.numberOfRuns).toBe(3);
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    },
    GENERATED_TIMEOUT_MS
  );

  it(
    "reports a conflict for unsupported custom lighthouse chromeFlags",
    () => {
      const cwd = mkdtempSync(path.join(os.tmpdir(), "atlas-enable-lhci-custom-"));
      try {
        runInit({ cwd, project: "test-app", reference: "keep", env: "skip" });
        const destination = path.join(cwd, "test-app");
        const lighthousePath = path.join(destination, "lighthouserc.json");
        const parsed = JSON.parse(readFileSync(lighthousePath, "utf8")) as {
          ci: { collect: { settings: { chromeFlags: unknown; preset: string } } };
        };
        parsed.ci.collect.settings.chromeFlags = ["--disable-dev-shm-usage"];
        writeFileSync(lighthousePath, `${JSON.stringify(parsed, null, 2)}\n`);

        const result = enableConsumerCapability({ cwd: destination, capability: "perf-ci" });
        const action = result.actions.find((entry) => entry.path === "lighthouserc.json");
        expect(action?.kind).toBe("conflict");
        expect(action?.reason).toBe(CUSTOM_CHROME_FLAGS_REASON);
        const after = JSON.parse(readFileSync(lighthousePath, "utf8")) as typeof parsed;
        expect(after.ci.collect.settings.chromeFlags).toEqual(["--disable-dev-shm-usage"]);
        expect(after.ci.collect.settings.preset).toBe("desktop");
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    },
    GENERATED_TIMEOUT_MS
  );

  it("blocks a commit on a workspace ESLint violation and passes after the file is corrected", () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "atlas-enable-hooks-"));
    try {
      runInit({ cwd, project: "test-app", reference: "keep", env: "skip" });
      const destination = path.join(cwd, "test-app");
      enableConsumerCapability({ cwd: destination, capability: "hooks" });
      verifyGeneratedGitHook(destination);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 120_000);
});
