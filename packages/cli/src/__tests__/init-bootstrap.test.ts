import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  ATLAS_CONTRACT_FILENAME,
  computeBaselineChecksum,
  resolveAtlasProject,
} from "@atlas/project";

import { sha256Bytes } from "../bootstrap/checksum";
import { BOOTSTRAP_MANIFEST_SCHEMA_VERSION } from "../bootstrap/constants";
import { findBootstrapAssetRoot, readBootstrapManifest } from "../bootstrap/resolve";
import { serializePackagedBootstrapManifest } from "../bootstrap/schema";
import { runInit } from "../commands/init";
import { CliError, CliErrorCode } from "../errors/cli-error";
import { ExitCode } from "../exit-codes";
import {
  CONSUMER_CI_WORKFLOW_DESTINATION,
  FORBIDDEN_BOOTSTRAP_EXACT_PATHS,
  MAINTAINER_CI_LEAK_MARKERS,
  isForbiddenBootstrapPath,
} from "./helpers/pack-artifact";
import { runAtlasCli } from "./helpers/run-cli";
import { CLI_PACKAGE_NAME } from "../version";

function writePackagedBootstrapFixture(options?: {
  corrupt?: boolean;
  omitFile?: boolean;
  executable?: boolean;
}): { assetRoot: string; packageRoot: string; cleanup: () => void } {
  const packageRoot = mkdtempSync(path.join(os.tmpdir(), "atlas-init-packaged-"));
  writeFileSync(
    path.join(packageRoot, "package.json"),
    `${JSON.stringify({ name: CLI_PACKAGE_NAME, version: "9.9.9" }, null, 2)}\n`,
    "utf8"
  );

  const filesRoot = path.join(packageRoot, "assets", "bootstrap", "files");
  const webPackage = `${JSON.stringify({ name: "@atlas/web", private: true }, null, 2)}\n`;
  const uiPackage = `${JSON.stringify({ name: "@atlas/ui", version: "9.9.9", private: true }, null, 2)}\n`;
  const featureFile = "export {};\n";
  const scriptContent = "#!/usr/bin/env node\nconsole.log('ok');\n";
  const webPath = path.join(filesRoot, "apps", "web", "package.json");
  const uiPath = path.join(filesRoot, "packages", "ui", "package.json");
  const featurePath = path.join(filesRoot, "apps", "web", "src", "features", "index.ts");
  const scriptPath = path.join(filesRoot, "scripts", "ensure-pnpm.js");
  mkdirSync(path.dirname(webPath), { recursive: true });
  mkdirSync(path.dirname(uiPath), { recursive: true });
  mkdirSync(path.dirname(featurePath), { recursive: true });
  mkdirSync(path.dirname(scriptPath), { recursive: true });
  writeFileSync(webPath, webPackage, "utf8");
  writeFileSync(uiPath, uiPackage, "utf8");
  writeFileSync(featurePath, featureFile, "utf8");
  writeFileSync(scriptPath, scriptContent, "utf8");
  chmodSync(scriptPath, 0o755);

  const entries = [
    {
      source: "apps/web/package.json",
      destination: "apps/web/package.json",
      sha256: sha256Bytes(Buffer.from(webPackage, "utf8")),
      mode: "0644",
    },
    {
      source: "apps/web/src/features/index.ts",
      destination: "apps/web/src/features/index.ts",
      sha256: sha256Bytes(Buffer.from(featureFile, "utf8")),
      mode: "0644",
    },
    {
      source: "packages/ui/package.json",
      destination: "packages/ui/package.json",
      sha256: sha256Bytes(Buffer.from(uiPackage, "utf8")),
      mode: "0644",
    },
    {
      source: "scripts/ensure-pnpm.js",
      destination: "scripts/ensure-pnpm.js",
      sha256: sha256Bytes(Buffer.from(scriptContent, "utf8")),
      mode: "0755",
    },
  ];

  if (options?.corrupt) {
    entries[0] = {
      ...entries[0],
      sha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    } as (typeof entries)[0];
  }

  if (options?.omitFile) {
    rmSync(webPath);
  }

  writeFileSync(
    path.join(packageRoot, "assets", "bootstrap", "manifest.json"),
    serializePackagedBootstrapManifest({
      schemaVersion: BOOTSTRAP_MANIFEST_SCHEMA_VERSION,
      atlasVersion: "9.9.9",
      generatedAtInit: [
        {
          destination: "package.json",
          reason: "generated",
        },
      ],
      entries,
    }),
    "utf8"
  );

  return {
    packageRoot,
    assetRoot: path.join(packageRoot, "assets", "bootstrap"),
    cleanup: () => rmSync(packageRoot, { recursive: true, force: true }),
  };
}

function listRelativeFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (current: string, relative: string): void => {
    for (const name of readdirSync(current).sort()) {
      const absolute = path.join(current, name);
      const child = relative ? `${relative}/${name}` : name;
      if (statSync(absolute).isDirectory()) {
        walk(absolute, child);
        continue;
      }
      files.push(child);
    }
  };
  walk(root, "");
  return files;
}

describe("atlas init bootstrap destination safety", () => {
  it("does not write files during dry-run", () => {
    const packaged = writePackagedBootstrapFixture();
    const cwd = mkdtempSync(path.join(os.tmpdir(), "atlas-init-dry-"));

    try {
      const result = runInit({
        cwd,
        project: "my-app",
        dryRun: true,
        reference: "keep",
        env: "skip",
        assetRoot: packaged.assetRoot,
      });

      expect(result.initMode).toBe("bootstrap");
      expect(existsSync(path.join(cwd, "my-app"))).toBe(false);
    } finally {
      packaged.cleanup();
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("rejects --reference remove in bootstrap mode", () => {
    const packaged = writePackagedBootstrapFixture();
    const cwd = mkdtempSync(path.join(os.tmpdir(), "atlas-init-ref-"));

    try {
      expect(() =>
        runInit({
          cwd,
          project: "my-app",
          reference: "remove",
          env: "skip",
          assetRoot: packaged.assetRoot,
        })
      ).toThrow(
        expect.objectContaining({
          code: CliErrorCode.USAGE_ERROR,
        })
      );
      expect(existsSync(path.join(cwd, "my-app"))).toBe(false);
    } finally {
      packaged.cleanup();
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("creates a project in a nonexistent destination", () => {
    const packaged = writePackagedBootstrapFixture();
    const cwd = mkdtempSync(path.join(os.tmpdir(), "atlas-init-dest-"));
    const destination = path.join(cwd, "my-app");

    try {
      const result = runInit({
        cwd,
        project: "my-app",
        reference: "keep",
        env: "skip",
        assetRoot: packaged.assetRoot,
      });

      expect(result.initMode).toBe("bootstrap");
      expect(result.atlasVersion).toBe("9.9.9");
      expect(realpathSync(result.repoRoot)).toBe(realpathSync(destination));
      expect(existsSync(path.join(destination, "apps/web/package.json"))).toBe(true);
      expect(existsSync(path.join(destination, "package.json"))).toBe(true);
      expect(existsSync(path.join(destination, "pnpm-lock.yaml"))).toBe(false);
    } finally {
      packaged.cleanup();
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("creates a project in an existing empty destination", () => {
    const packaged = writePackagedBootstrapFixture();
    const cwd = mkdtempSync(path.join(os.tmpdir(), "atlas-init-empty-"));
    const destination = path.join(cwd, "my-app");
    mkdirSync(destination);

    try {
      const result = runInit({
        cwd,
        project: "my-app",
        reference: "keep",
        env: "skip",
        assetRoot: packaged.assetRoot,
      });

      expect(result.initMode).toBe("bootstrap");
      expect(existsSync(path.join(destination, "package.json"))).toBe(true);
      expect(readdirSync(cwd).filter((name) => name.startsWith(".my-app.atlas-init-"))).toEqual([]);
    } finally {
      packaged.cleanup();
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("supports a nested relative destination", () => {
    const packaged = writePackagedBootstrapFixture();
    const cwd = mkdtempSync(path.join(os.tmpdir(), "atlas-init-nested-"));

    try {
      const result = runInit({
        cwd,
        project: "nested/my-app",
        reference: "keep",
        env: "skip",
        assetRoot: packaged.assetRoot,
      });

      expect(realpathSync(result.repoRoot)).toBe(realpathSync(path.join(cwd, "nested", "my-app")));
      expect(existsSync(path.join(cwd, "nested", "my-app", "package.json"))).toBe(true);
      const packageJson = JSON.parse(
        readFileSync(path.join(cwd, "nested", "my-app", "package.json"), "utf8")
      ) as { name: string };
      expect(packageJson.name).toBe("my-app");
    } finally {
      packaged.cleanup();
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("fails closed when the destination is not empty", () => {
    const packaged = writePackagedBootstrapFixture();
    const cwd = mkdtempSync(path.join(os.tmpdir(), "atlas-init-nonempty-"));
    const destination = path.join(cwd, "my-app");
    mkdirSync(destination);
    writeFileSync(path.join(destination, "notes.txt"), "user file\n", "utf8");

    try {
      expect(() =>
        runInit({
          cwd,
          project: "my-app",
          reference: "keep",
          env: "skip",
          assetRoot: packaged.assetRoot,
        })
      ).toThrow(CliError);

      try {
        runInit({
          cwd,
          project: "my-app",
          reference: "keep",
          env: "skip",
          assetRoot: packaged.assetRoot,
        });
      } catch (error) {
        expect(error).toBeInstanceOf(CliError);
        expect((error as CliError).code).toBe(CliErrorCode.BOOTSTRAP_CONFLICT);
        expect((error as CliError).message).toContain("not empty");
      }

      expect(readFileSync(path.join(destination, "notes.txt"), "utf8")).toBe("user file\n");
      expect(existsSync(path.join(destination, "package.json"))).toBe(false);
    } finally {
      packaged.cleanup();
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("refuses to overwrite an already generated project", () => {
    const packaged = writePackagedBootstrapFixture();
    const cwd = mkdtempSync(path.join(os.tmpdir(), "atlas-init-rerun-"));

    try {
      runInit({
        cwd,
        project: "my-app",
        reference: "keep",
        env: "skip",
        assetRoot: packaged.assetRoot,
      });

      expect(() =>
        runInit({
          cwd,
          project: "my-app",
          reference: "keep",
          env: "skip",
          assetRoot: packaged.assetRoot,
        })
      ).toThrow(
        expect.objectContaining({
          code: CliErrorCode.BOOTSTRAP_CONFLICT,
        })
      );
    } finally {
      packaged.cleanup();
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("rejects traversal and unsafe destinations", () => {
    const packaged = writePackagedBootstrapFixture();
    const cwd = mkdtempSync(path.join(os.tmpdir(), "atlas-init-unsafe-"));

    try {
      for (const project of ["../escape", "/tmp/abs-app", "foo/../../etc", ".", "..", "MyApp"]) {
        expect(() =>
          runInit({
            cwd,
            project,
            reference: "keep",
            env: "skip",
            assetRoot: packaged.assetRoot,
          })
        ).toThrow(
          expect.objectContaining({
            code: CliErrorCode.USAGE_ERROR,
          })
        );
      }

      expect(readdirSync(cwd)).toEqual([]);
    } finally {
      packaged.cleanup();
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("rejects a symbolic-link destination", () => {
    const packaged = writePackagedBootstrapFixture();
    const cwd = mkdtempSync(path.join(os.tmpdir(), "atlas-init-link-"));
    const outside = mkdtempSync(path.join(os.tmpdir(), "atlas-init-outside-"));
    symlinkSync(outside, path.join(cwd, "my-app"));

    try {
      expect(() =>
        runInit({
          cwd,
          project: "my-app",
          reference: "keep",
          env: "skip",
          assetRoot: packaged.assetRoot,
        })
      ).toThrow(
        expect.objectContaining({
          code: CliErrorCode.USAGE_ERROR,
        })
      );
      expect(readdirSync(outside)).toEqual([]);
    } finally {
      packaged.cleanup();
      rmSync(cwd, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("does not leave a partial project when promotion fails", () => {
    const packaged = writePackagedBootstrapFixture();
    const cwd = mkdtempSync(path.join(os.tmpdir(), "atlas-init-fail-"));

    try {
      expect(() =>
        runInit({
          cwd,
          project: "my-app",
          reference: "keep",
          env: "skip",
          assetRoot: packaged.assetRoot,
          beforePromote: () => {
            throw new Error("forced promotion failure");
          },
        })
      ).toThrow("forced promotion failure");

      expect(existsSync(path.join(cwd, "my-app"))).toBe(false);
      expect(readdirSync(cwd).filter((name) => name.includes("atlas-init"))).toEqual([]);
    } finally {
      packaged.cleanup();
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("preserves packaged executable modes", () => {
    const packaged = writePackagedBootstrapFixture({ executable: true });
    const cwd = mkdtempSync(path.join(os.tmpdir(), "atlas-init-mode-"));

    try {
      runInit({
        cwd,
        project: "my-app",
        reference: "keep",
        env: "skip",
        assetRoot: packaged.assetRoot,
      });

      const mode = statSync(path.join(cwd, "my-app", "scripts", "ensure-pnpm.js")).mode & 0o777;
      expect(mode).toBe(0o755);
    } finally {
      packaged.cleanup();
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe("atlas init bootstrap packaged integrity", () => {
  it("fails before writing when a packaged checksum does not match", () => {
    const packaged = writePackagedBootstrapFixture({ corrupt: true });
    const cwd = mkdtempSync(path.join(os.tmpdir(), "atlas-init-corrupt-"));

    try {
      expect(() =>
        runInit({
          cwd,
          project: "my-app",
          reference: "keep",
          env: "skip",
          assetRoot: packaged.assetRoot,
        })
      ).toThrow(
        expect.objectContaining({
          code: CliErrorCode.PREREQUISITE_ERROR,
        })
      );
      expect(existsSync(path.join(cwd, "my-app"))).toBe(false);
    } finally {
      packaged.cleanup();
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("fails before writing when a packaged file is missing", () => {
    const packaged = writePackagedBootstrapFixture({ omitFile: true });
    const cwd = mkdtempSync(path.join(os.tmpdir(), "atlas-init-missing-"));

    try {
      expect(() =>
        runInit({
          cwd,
          project: "my-app",
          reference: "keep",
          env: "skip",
          assetRoot: packaged.assetRoot,
        })
      ).toThrow(
        expect.objectContaining({
          code: CliErrorCode.PREREQUISITE_ERROR,
        })
      );
      expect(existsSync(path.join(cwd, "my-app"))).toBe(false);
    } finally {
      packaged.cleanup();
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe("atlas init bootstrap generated project", () => {
  const GENERATED_TIMEOUT_MS = 60_000;

  it(
    "materializes the packaged consumer workspace from installed CLI assets",
    () => {
      const assetRoot = findBootstrapAssetRoot();
      const manifest = readBootstrapManifest(assetRoot);
      const cwd = mkdtempSync(path.join(os.tmpdir(), "atlas-init-real-"));
      const destination = path.join(cwd, "test-app");

      try {
        const result = runInit({
          cwd,
          project: "test-app",
          reference: "keep",
          env: "skip",
        });

        expect(result.initMode).toBe("bootstrap");
        expect(result.atlasVersion).toBe(manifest.atlasVersion);
        expect(existsSync(path.join(destination, "apps/web"))).toBe(true);
        expect(existsSync(path.join(destination, "packages/ui"))).toBe(true);
        expect(existsSync(path.join(destination, "packages/consent"))).toBe(true);
        expect(existsSync(path.join(destination, "packages/config"))).toBe(true);
        expect(existsSync(path.join(destination, "openapi"))).toBe(true);
        expect(
          existsSync(path.join(destination, "templates/app-infrastructure.manifest.json"))
        ).toBe(true);
        expect(existsSync(path.join(destination, ATLAS_CONTRACT_FILENAME))).toBe(true);
        expect(existsSync(path.join(destination, "package.json"))).toBe(true);
        expect(existsSync(path.join(destination, "README.md"))).toBe(true);
        expect(existsSync(path.join(destination, "jest.config.js"))).toBe(true);

        expect(existsSync(path.join(destination, "apps/reference"))).toBe(false);
        expect(existsSync(path.join(destination, "packages/cli"))).toBe(false);
        expect(existsSync(path.join(destination, "packages/project"))).toBe(false);
        expect(existsSync(path.join(destination, "releases"))).toBe(false);
        expect(existsSync(path.join(destination, CONSUMER_CI_WORKFLOW_DESTINATION))).toBe(true);
        expect(
          existsSync(path.join(destination, ".github/workflows/trusted-self-hosted.yml"))
        ).toBe(false);
        expect(existsSync(path.join(destination, ".changeset"))).toBe(false);
        expect(existsSync(path.join(destination, "CONTRIBUTING.md"))).toBe(false);
        expect(existsSync(path.join(destination, "packages/ui/README.md"))).toBe(false);
        expect(existsSync(path.join(destination, "packages/ui/.storybook"))).toBe(false);
        expect(existsSync(path.join(destination, "packages/ui/visual-tests"))).toBe(false);
        expect(existsSync(path.join(destination, "packages/ui/.husky"))).toBe(false);
        expect(existsSync(path.join(destination, "docker-compose.yml"))).toBe(false);
        expect(existsSync(path.join(destination, "Dockerfile"))).toBe(true);
        expect(existsSync(path.join(destination, ".dockerignore"))).toBe(true);
        expect(existsSync(path.join(destination, "scripts/ensure-pnpm.js"))).toBe(true);
        const generatedDockerfile = readFileSync(path.join(destination, "Dockerfile"), "utf8");
        expect(generatedDockerfile).toContain("COPY packages/ui/package.json");
        expect(generatedDockerfile).toContain("COPY packages/consent/package.json");
        expect(generatedDockerfile).toContain("COPY packages/config/package.json");
        expect(generatedDockerfile).toContain("COPY scripts/ensure-pnpm.js");
        expect(generatedDockerfile).not.toContain("thedanielmark/atlas");
        expect(generatedDockerfile).not.toContain("packages/cli");
        expect(generatedDockerfile).not.toContain("apps/reference");
        const generatedContract = JSON.parse(
          readFileSync(path.join(destination, ATLAS_CONTRACT_FILENAME), "utf8")
        ) as {
          platform?: {
            baseline?: { repositorySyncedPathChecksums?: Record<string, string> };
          };
        };
        expect(
          generatedContract.platform?.baseline?.repositorySyncedPathChecksums?.Dockerfile
        ).toMatch(/^sha256:/);
        expect(
          generatedContract.platform?.baseline?.repositorySyncedPathChecksums?.[".dockerignore"]
        ).toMatch(/^sha256:/);
        expect(existsSync(path.join(destination, "coverage-policy.json"))).toBe(false);
        expect(existsSync(path.join(destination, ".husky"))).toBe(false);
        expect(existsSync(path.join(destination, ".github/dependabot.yml"))).toBe(false);
        expect(existsSync(path.join(destination, "pnpm-lock.yaml"))).toBe(false);
        expect(existsSync(path.join(destination, "apps/web/.env.local"))).toBe(false);
        expect(existsSync(path.join(destination, "apps/web/.env.example"))).toBe(true);

        const generatedFiles = listRelativeFiles(destination);
        for (const forbidden of FORBIDDEN_BOOTSTRAP_EXACT_PATHS) {
          if (forbidden === "package.json" || forbidden === "atlas.config.json") {
            continue;
          }
          expect(generatedFiles).not.toContain(forbidden);
        }
        expect(generatedFiles.filter((file) => isForbiddenBootstrapPath(file))).toEqual([]);

        const consumerCi = readFileSync(
          path.join(destination, CONSUMER_CI_WORKFLOW_DESTINATION),
          "utf8"
        );
        expect(consumerCi).toContain("runs-on: ubuntu-latest");
        expect(consumerCi).toContain("pnpm install --frozen-lockfile");
        expect(consumerCi).toContain("pnpm atlas doctor");
        expect(consumerCi).toMatch(/^\s+run: pnpm lint$/m);
        expect(consumerCi).toMatch(/^\s+run: pnpm typecheck$/m);
        expect(consumerCi).toMatch(/^\s+run: pnpm test$/m);
        expect(consumerCi).toMatch(/^\s+run: pnpm build$/m);
        expect(consumerCi).toContain("permissions:\n  contents: read");
        expect(consumerCi).not.toMatch(/test:e2e/);
        expect(consumerCi).not.toContain("{{ATLAS_CLI_VERSION}}");
        for (const marker of MAINTAINER_CI_LEAK_MARKERS) {
          expect(consumerCi).not.toContain(marker);
        }

        const packageJson = JSON.parse(
          readFileSync(path.join(destination, "package.json"), "utf8")
        ) as {
          name: string;
          version: string;
          packageManager: string;
          engines: { node: string; pnpm: string };
          scripts: Record<string, string>;
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        };
        expect(packageJson.name).toBe("test-app");
        expect(packageJson.version).toBe("0.1.0");
        expect(packageJson.packageManager).toBe("pnpm@10.19.0");
        expect(packageJson.engines.node).toBe(">=22.0.0");
        expect(packageJson.engines.pnpm).toBe(">=10.0.0");
        expect(packageJson.scripts.dev).toBeDefined();
        expect(packageJson.scripts.build).toBeDefined();
        expect(packageJson.scripts.lint).toBeDefined();
        expect(packageJson.scripts.typecheck).toBeDefined();
        expect(packageJson.scripts.test).toBeDefined();
        expect(packageJson.scripts.format).toBeDefined();
        expect(packageJson.scripts["api:gen"]).toBeDefined();
        expect(packageJson.scripts.atlas).toBe("atlas");
        expect(packageJson.scripts["template:check"]).toBeUndefined();
        expect(packageJson.scripts["template:sync"]).toBeUndefined();
        expect(packageJson.scripts["api:check"]).toBeUndefined();
        expect(JSON.stringify(packageJson.scripts)).not.toContain("git diff");
        expect(packageJson.scripts["perf:lhci"]).toBeDefined();
        expect(packageJson.scripts.changeset).toBeUndefined();
        expect(packageJson.scripts.release).toBeUndefined();
        expect(packageJson.scripts.prepare).toBeUndefined();
        expect(packageJson.dependencies).toBeUndefined();
        expect(JSON.stringify(packageJson)).not.toContain("workspace:");
        expect(packageJson.devDependencies?.["@atlas/cli"]).toBeUndefined();
        expect(packageJson.devDependencies?.["@blitzcraftlabs/atlas"]).toBe(manifest.atlasVersion);
        expect(packageJson.devDependencies?.["@atlas/project"]).toBeUndefined();

        const readme = readFileSync(path.join(destination, "README.md"), "utf8");
        expect(readme).toContain(`generated from Atlas ${manifest.atlasVersion}`);
        expect(readme).toContain("pnpm install");
        expect(readme).toContain("pnpm dev");
        expect(readme).toContain("pnpm atlas doctor");
        expect(readme).toContain(".github/workflows/ci.yml");
        expect(readme).not.toContain(
          `pnpm dlx @blitzcraftlabs/atlas@${manifest.atlasVersion} doctor`
        );
        expect(readme).not.toContain("pnpm atlas -- doctor");
        expect(readme).toContain("pnpm atlas");
        expect(readme).not.toContain("publication path is finalized");
        expect(readme).not.toContain("Enterprise frontend platform monorepo");

        const agents = readFileSync(path.join(destination, "AGENTS.md"), "utf8");
        expect(agents).toContain("pnpm atlas context --json");
        expect(agents).toContain("pnpm atlas enable list --json");
        expect(agents).not.toContain("pnpm dlx @blitzcraftlabs/atlas@");
        expect(agents).not.toContain("pnpm --filter @blitzcraftlabs/atlas build");
        expect(agents).not.toContain("packages/cli");
        expect(existsSync(path.join(destination, "docs/how-we-build/consumer-tooling.md"))).toBe(
          true
        );
        expect(existsSync(path.join(destination, "docs/how-we-build/reference-patterns.md"))).toBe(
          true
        );
        expect(existsSync(path.join(destination, "packages/ui/.storybook"))).toBe(false);
        expect(existsSync(path.join(destination, "docker-compose.yml"))).toBe(false);
        expect(existsSync(path.join(destination, "coverage-policy.json"))).toBe(false);

        const rootManifest = JSON.parse(
          readFileSync(path.join(destination, "package.json"), "utf8")
        ) as { pnpm?: { overrides?: Record<string, string> } };
        expect(rootManifest.pnpm?.overrides?.react).toBeDefined();
        expect(rootManifest.pnpm?.overrides?.vite).toBeUndefined();

        const jestConfig = readFileSync(path.join(destination, "jest.config.js"), "utf8");
        expect(jestConfig).toContain("apps/web");
        expect(jestConfig).toContain("packages/ui");
        expect(jestConfig).not.toContain("apps/reference");

        const templateManifest = JSON.parse(
          readFileSync(path.join(destination, "templates/app-infrastructure.manifest.json"), "utf8")
        ) as { consumerApplications: string[]; independentPaths: Record<string, unknown> };
        expect(templateManifest.consumerApplications).toEqual([]);
        expect(templateManifest.independentPaths["apps/reference"]).toBeUndefined();

        const contract = JSON.parse(
          readFileSync(path.join(destination, ATLAS_CONTRACT_FILENAME), "utf8")
        ) as {
          schemaVersion: number;
          platform?: {
            baseline?: {
              atlasVersion: string;
              syncedPathChecksums: Record<string, string>;
            };
          };
        };
        expect(contract.schemaVersion).toBe(1);
        expect(contract.platform?.baseline?.atlasVersion).toBe(manifest.atlasVersion);
        expect(packageJson.version).not.toBe(contract.platform?.baseline?.atlasVersion);
        expect(() => resolveAtlasProject(destination)).not.toThrow();

        const checksums = contract.platform?.baseline?.syncedPathChecksums ?? {};
        expect(Object.keys(checksums).length).toBeGreaterThan(0);
        for (const [relativePath, checksum] of Object.entries(checksums)) {
          const absolute = path.join(destination, "apps/web", relativePath);
          expect(existsSync(absolute)).toBe(true);
          expect(checksum).toBe(computeBaselineChecksum(readFileSync(absolute)));
        }
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    },
    GENERATED_TIMEOUT_MS
  );

  it("copies .env.example only when --env copy is requested", () => {
    const assetRoot = findBootstrapAssetRoot();
    const cwd = mkdtempSync(path.join(os.tmpdir(), "atlas-init-env-"));

    try {
      runInit({
        cwd,
        project: "copied-env",
        reference: "keep",
        env: "copy",
        assetRoot,
      });
      expect(existsSync(path.join(cwd, "copied-env", "apps/web/.env.local"))).toBe(true);
      expect(existsSync(path.join(cwd, "copied-env", "apps/web/.env.example"))).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe("atlas init CLI modes", () => {
  it("rejects too many init arguments through the executable", () => {
    const outside = mkdtempSync(path.join(os.tmpdir(), "atlas-init-cli-args-"));
    const result = runAtlasCli(["init", "one", "two"], outside);
    expect(result.exitCode).toBe(ExitCode.USAGE_ERROR);
    expect(result.stderr).toContain("Unexpected arguments");
  });

  it("rejects an invalid project name through the executable", () => {
    const outside = mkdtempSync(path.join(os.tmpdir(), "atlas-init-cli-name-"));
    const result = runAtlasCli(["init", "../escape"], outside);
    expect(result.exitCode).toBe(ExitCode.USAGE_ERROR);
    expect(existsSync(path.join(outside, "escape"))).toBe(false);
  });

  it("tells the caller to pass a project name when outside a checkout", () => {
    const outside = mkdtempSync(path.join(os.tmpdir(), "atlas-init-cli-missing-"));
    const result = runAtlasCli(["init"], outside);
    expect(result.exitCode).toBe(ExitCode.PROJECT_NOT_FOUND);
    expect(result.stderr).toContain("atlas init <project>");
  });
});
