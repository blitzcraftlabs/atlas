import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildBootstrapAssets, readSourceBootstrapManifest } from "../bootstrap/build";
import { buildCapabilityAssets } from "../bootstrap/build-capabilities";
import { SOURCE_BOOTSTRAP_MANIFEST_RELATIVE_PATH } from "../bootstrap/constants";
import {
  CONSUMER_CI_ATLAS_VERSION_PLACEHOLDER,
  CONSUMER_CI_WORKFLOW_DESTINATION,
  CONSUMER_CI_WORKFLOW_SOURCE,
  toConsumerCiWorkflow,
} from "../bootstrap/consumer-ci";
import {
  CONSUMER_UI_PACKAGE_JSON_DESTINATION,
  shouldOmitConsumerUiDevDependency,
  shouldOmitConsumerUiScript,
  toConsumerUiPackageManifest,
} from "../bootstrap/consumer-ui-manifest";
import { verifyPackagedBootstrapTree } from "../bootstrap/integrity";
import { serializePackagedBootstrapManifest } from "../bootstrap/schema";
import {
  AGENT_ADR_REFERENCES,
  listPackagedConsumerDocumentationReferences,
} from "../context/documentation-registry";
import { loadAppInfrastructureManifest } from "../template-sync/manifest";
import { readCliAtlasVersion } from "../version";
import { MAINTAINER_CI_LEAK_MARKERS } from "./helpers/pack-artifact";
import { getRepoRoot } from "./helpers/run-cli";

const CLI_PACKAGE_ROOT = path.resolve(__dirname, "../..");
const BUILD_TIMEOUT_MS = 120_000;

function listDestinations(outputDir: string): string[] {
  const manifest = JSON.parse(readFileSync(path.join(outputDir, "manifest.json"), "utf8")) as {
    entries: { destination: string }[];
  };
  return manifest.entries.map((entry) => entry.destination);
}

describe("bootstrap asset build", () => {
  const repoRoot = getRepoRoot();

  it(
    "builds a deterministic packaged tree from canonical Atlas source",
    () => {
      const first = mkdtempSync(path.join(os.tmpdir(), "atlas-bootstrap-a-"));
      const second = mkdtempSync(path.join(os.tmpdir(), "atlas-bootstrap-b-"));

      try {
        const firstManifest = buildBootstrapAssets({
          repoRoot,
          packageRoot: CLI_PACKAGE_ROOT,
          outputDir: first,
        });
        const secondManifest = buildBootstrapAssets({
          repoRoot,
          packageRoot: CLI_PACKAGE_ROOT,
          outputDir: second,
        });

        expect(serializePackagedBootstrapManifest(firstManifest)).toBe(
          serializePackagedBootstrapManifest(secondManifest)
        );
        expect(listDestinations(first)).toEqual(listDestinations(second));
        expect(firstManifest.entries.map((entry) => entry.sha256)).toEqual(
          secondManifest.entries.map((entry) => entry.sha256)
        );

        verifyPackagedBootstrapTree(first);
        verifyPackagedBootstrapTree(second);
      } finally {
        rmSync(first, { recursive: true, force: true });
        rmSync(second, { recursive: true, force: true });
      }
    },
    BUILD_TIMEOUT_MS
  );

  it(
    "replaces stale generated bootstrap files on rebuild",
    () => {
      const outputDir = mkdtempSync(path.join(os.tmpdir(), "atlas-bootstrap-stale-"));
      try {
        buildBootstrapAssets({
          repoRoot,
          packageRoot: CLI_PACKAGE_ROOT,
          outputDir,
        });
        const stalePath = path.join(outputDir, "files", "stale-generated.txt");
        mkdirSync(path.dirname(stalePath), { recursive: true });
        writeFileSync(stalePath, "stale\n");

        buildBootstrapAssets({
          repoRoot,
          packageRoot: CLI_PACKAGE_ROOT,
          outputDir,
        });

        expect(existsSync(stalePath)).toBe(false);
        verifyPackagedBootstrapTree(outputDir);
      } finally {
        rmSync(outputDir, { recursive: true, force: true });
      }
    },
    BUILD_TIMEOUT_MS
  );

  it(
    "keeps template-sync owned starter paths inside the bootstrap allowlist",
    () => {
      const outputDir = mkdtempSync(path.join(os.tmpdir(), "atlas-bootstrap-ownership-"));
      try {
        const packaged = buildBootstrapAssets({
          repoRoot,
          packageRoot: CLI_PACKAGE_ROOT,
          outputDir,
        });
        const destinations = new Set(packaged.entries.map((entry) => entry.destination));
        const templateManifest = loadAppInfrastructureManifest(repoRoot);
        const required = [
          ...templateManifest.syncedPaths,
          ...templateManifest.generatedPaths,
          ...templateManifest.starterOnlyPaths,
          ...(templateManifest.structuralConformance?.requiredInfrastructureModules ?? []),
        ];

        const missing = required
          .map((relativePath) => `${templateManifest.canonicalApplication}/${relativePath}`)
          .filter((destination) => !destinations.has(destination));

        expect(missing).toEqual([]);
        expect(destinations.has("apps/reference/package.json")).toBe(false);
        for (const repositoryPath of templateManifest.repositorySyncedPaths) {
          expect(destinations.has(repositoryPath)).toBe(true);
        }
        expect(destinations.has("Dockerfile")).toBe(true);
        expect(destinations.has(".dockerignore")).toBe(true);
        expect(destinations.has("scripts/ensure-pnpm.js")).toBe(true);
      } finally {
        rmSync(outputDir, { recursive: true, force: true });
      }
    },
    BUILD_TIMEOUT_MS
  );

  it("packages the documentation paths advertised by atlas context that are not generated at init", () => {
    const source = readSourceBootstrapManifest(
      path.join(CLI_PACKAGE_ROOT, SOURCE_BOOTSTRAP_MANIFEST_RELATIVE_PATH)
    );
    const destinations = new Set(source.entries.map((entry) => entry.destination));
    const generated = new Set(source.generatedAtInit.map((entry) => entry.destination));

    for (const reference of listPackagedConsumerDocumentationReferences()) {
      expect(destinations.has(reference.path)).toBe(true);
    }
    for (const reference of AGENT_ADR_REFERENCES) {
      expect(destinations.has(reference.path)).toBe(true);
    }
    expect(generated.has("AGENTS.md")).toBe(true);
    expect(generated.has("docs/how-we-build/agents.md")).toBe(true);
    expect(destinations.has("AGENTS.md")).toBe(false);
    expect(destinations.has("docs/how-we-build/agents.md")).toBe(false);
  });

  it(
    "packages a consumer-safe UI manifest and the Lighthouse config the web script references",
    () => {
      const outputDir = mkdtempSync(path.join(os.tmpdir(), "atlas-bootstrap-coherence-"));
      try {
        const packaged = buildBootstrapAssets({
          repoRoot,
          packageRoot: CLI_PACKAGE_ROOT,
          outputDir,
        });
        const destinations = new Set(packaged.entries.map((entry) => entry.destination));
        const filesRoot = path.join(outputDir, "files");
        const packagedUiPath = path.join(
          filesRoot,
          ...CONSUMER_UI_PACKAGE_JSON_DESTINATION.split("/")
        );
        const canonicalUiRaw = readFileSync(
          path.join(repoRoot, CONSUMER_UI_PACKAGE_JSON_DESTINATION),
          "utf8"
        );
        const packagedUiRaw = readFileSync(packagedUiPath, "utf8");
        const packagedUi = JSON.parse(packagedUiRaw) as {
          scripts?: Record<string, string>;
          devDependencies?: Record<string, string>;
        };

        const canonicalUi = JSON.parse(canonicalUiRaw) as {
          scripts?: Record<string, string>;
        };
        expect(packagedUiRaw).toBe(toConsumerUiPackageManifest(canonicalUiRaw));
        expect(packagedUiRaw).not.toBe(canonicalUiRaw);
        expect(canonicalUi.scripts?.storybook).toBeDefined();

        for (const [name, value] of Object.entries(packagedUi.scripts ?? {})) {
          expect(shouldOmitConsumerUiScript(name, value)).toBe(false);
        }
        expect(
          Object.keys(packagedUi.devDependencies ?? {}).filter((name) =>
            shouldOmitConsumerUiDevDependency(name)
          )
        ).toEqual([]);
        expect(packagedUi.scripts?.lint).toBeDefined();
        expect(packagedUi.scripts?.typecheck).toBeDefined();
        expect(packagedUi.scripts?.test).toBeDefined();
        expect(packagedUi.devDependencies?.["@playwright/test"]).toBeUndefined();
        expect(packagedUi.devDependencies?.storybook).toBeUndefined();
        expect(packagedUi.devDependencies?.husky).toBeUndefined();

        expect(destinations.has("lighthouserc.json")).toBe(true);
        expect(existsSync(path.join(filesRoot, "lighthouserc.json"))).toBe(true);

        const webPackage = JSON.parse(
          readFileSync(path.join(filesRoot, "apps", "web", "package.json"), "utf8")
        ) as { scripts?: Record<string, string> };
        const lhciScript = webPackage.scripts?.["perf:lhci"];
        expect(lhciScript).toMatch(/--config=/);
        const configMatch = lhciScript?.match(/--config=(\S+)/);
        expect(configMatch?.[1]).toBeDefined();
        const resolvedConfig = path.posix.normalize(
          path.posix.join("apps/web", configMatch?.[1] as string)
        );
        expect(resolvedConfig.startsWith("../")).toBe(false);
        expect(destinations.has(resolvedConfig)).toBe(true);
        expect(existsSync(path.join(filesRoot, ...resolvedConfig.split("/")))).toBe(true);
      } finally {
        rmSync(outputDir, { recursive: true, force: true });
      }
    },
    BUILD_TIMEOUT_MS
  );

  it("does not package generated-at-init or repository-only surfaces", () => {
    const source = readSourceBootstrapManifest(
      path.join(CLI_PACKAGE_ROOT, SOURCE_BOOTSTRAP_MANIFEST_RELATIVE_PATH)
    );
    const destinations = new Set(source.entries.map((entry) => entry.destination));
    const generated = new Set(source.generatedAtInit.map((entry) => entry.destination));

    expect(generated.has("atlas.config.json")).toBe(true);
    expect(generated.has("package.json")).toBe(true);
    expect(generated.has("pnpm-lock.yaml")).toBe(true);
    expect(destinations.has("atlas.config.json")).toBe(false);
    expect(destinations.has("package.json")).toBe(false);
    expect(destinations.has("pnpm-lock.yaml")).toBe(false);
    expect(destinations.has("apps/reference")).toBe(false);
    expect(destinations.has("packages/cli")).toBe(false);
    expect(destinations.has("packages/project")).toBe(false);
    expect(destinations.has("CONTRIBUTING.md")).toBe(false);
    expect(destinations.has("lighthouserc.json")).toBe(true);
    expect(destinations.has(CONSUMER_CI_WORKFLOW_DESTINATION)).toBe(true);
  });

  it(
    "omits maintainer-only documentation that is invalid in the trimmed consumer starter",
    () => {
      const outputDir = mkdtempSync(path.join(os.tmpdir(), "atlas-bootstrap-docs-"));
      try {
        const packaged = buildBootstrapAssets({
          repoRoot,
          packageRoot: CLI_PACKAGE_ROOT,
          outputDir,
        });
        const destinations = new Set(packaged.entries.map((entry) => entry.destination));
        const source = readSourceBootstrapManifest(
          path.join(CLI_PACKAGE_ROOT, SOURCE_BOOTSTRAP_MANIFEST_RELATIVE_PATH)
        );
        const sourceDestinations = new Set(source.entries.map((entry) => entry.destination));
        const filesRoot = path.join(outputDir, "files");

        expect(existsSync(path.join(repoRoot, "packages", "ui", "README.md"))).toBe(true);
        expect(existsSync(path.join(repoRoot, "CONTRIBUTING.md"))).toBe(true);

        expect(sourceDestinations.has("CONTRIBUTING.md")).toBe(false);
        expect(destinations.has("CONTRIBUTING.md")).toBe(false);
        expect(destinations.has("packages/ui/README.md")).toBe(false);
        expect(existsSync(path.join(filesRoot, "CONTRIBUTING.md"))).toBe(false);
        expect(existsSync(path.join(filesRoot, "packages", "ui", "README.md"))).toBe(false);
      } finally {
        rmSync(outputDir, { recursive: true, force: true });
      }
    },
    BUILD_TIMEOUT_MS
  );

  it(
    "packages a portable consumer CI workflow instead of Atlas maintainer CI",
    () => {
      const outputDir = mkdtempSync(path.join(os.tmpdir(), "atlas-bootstrap-ci-"));
      try {
        const packaged = buildBootstrapAssets({
          repoRoot,
          packageRoot: CLI_PACKAGE_ROOT,
          outputDir,
        });
        const atlasVersion = readCliAtlasVersion();
        const sourceWorkflow = readFileSync(
          path.join(repoRoot, CONSUMER_CI_WORKFLOW_SOURCE),
          "utf8"
        );
        const maintainerWorkflow = readFileSync(
          path.join(repoRoot, ".github", "workflows", "ci.yml"),
          "utf8"
        );
        const packagedWorkflow = readFileSync(
          path.join(outputDir, "files", ...CONSUMER_CI_WORKFLOW_DESTINATION.split("/")),
          "utf8"
        );

        expect(
          packaged.entries.some((entry) => entry.destination === CONSUMER_CI_WORKFLOW_DESTINATION)
        ).toBe(true);
        expect(sourceWorkflow).toContain("pnpm atlas doctor");
        expect(sourceWorkflow).not.toContain(CONSUMER_CI_ATLAS_VERSION_PLACEHOLDER);
        expect(packagedWorkflow).toBe(toConsumerCiWorkflow(sourceWorkflow, atlasVersion));
        expect(packagedWorkflow).toContain("pnpm atlas doctor");
        expect(packagedWorkflow).not.toBe(maintainerWorkflow);
        expect(maintainerWorkflow).toContain("ATLAS_CI_RUNNER_PROFILE");
        expect(packagedWorkflow).toContain("runs-on: ubuntu-latest");
        expect(packagedWorkflow).not.toContain("pnpm dlx @blitzcraftlabs/atlas@");
        expect(packagedWorkflow).toMatch(/^\s+run: pnpm lint$/m);
        expect(packagedWorkflow).toMatch(/^\s+run: pnpm typecheck$/m);
        expect(packagedWorkflow).toMatch(/^\s+run: pnpm test$/m);
        expect(packagedWorkflow).toMatch(/^\s+run: pnpm build$/m);
        expect(packagedWorkflow).not.toMatch(/test:e2e/);
        for (const marker of MAINTAINER_CI_LEAK_MARKERS) {
          expect(packagedWorkflow).not.toContain(marker);
        }
      } finally {
        rmSync(outputDir, { recursive: true, force: true });
      }
    },
    BUILD_TIMEOUT_MS
  );
});

describe("capability asset build", () => {
  const repoRoot = getRepoRoot();

  it(
    "packages opt-in capability files separately from the default starter",
    () => {
      const outputDir = mkdtempSync(path.join(os.tmpdir(), "atlas-capability-build-"));
      try {
        const packaged = buildCapabilityAssets({
          repoRoot,
          packageRoot: CLI_PACKAGE_ROOT,
          outputDir,
        });
        const storybook = packaged.capabilities.find((capability) => capability.id === "storybook");
        const visual = packaged.capabilities.find((capability) => capability.id === "visual");
        expect(
          storybook?.entries.some((entry) => entry.destination === "packages/ui/.storybook/main.ts")
        ).toBe(true);
        expect(visual?.requires).toEqual(["storybook"]);
        expect(
          existsSync(
            path.join(outputDir, "files", "storybook", "packages", "ui", ".storybook", "main.ts")
          )
        ).toBe(true);
        expect(existsSync(path.join(outputDir, "files", "coverage", "coverage-policy.json"))).toBe(
          true
        );
        expect(storybook?.packagePatches).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              path: "apps/web/package.json",
              replaceableDevDependencies: { "@playwright/test": ["^1.61.0"] },
              statusMode: "conflicts-only",
            }),
          ])
        );
      } finally {
        rmSync(outputDir, { recursive: true, force: true });
      }
    },
    BUILD_TIMEOUT_MS
  );
});
