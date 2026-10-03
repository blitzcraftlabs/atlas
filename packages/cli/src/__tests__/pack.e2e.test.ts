import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { extractStaticModuleSpecifiers, packageRootFromSpecifier } from "../doctor/static-imports";
import { CLI_PACKAGE_NAME, readCliAtlasVersion } from "../version";
import {
  CONSUMER_CI_WORKFLOW_DESTINATION,
  FORBIDDEN_BOOTSTRAP_EXACT_PATHS,
  MAINTAINER_CI_LEAK_MARKERS,
  REQUIRED_BOOTSTRAP_FILE_PATHS,
  REQUIRED_PACKED_PATHS,
  collectRuntimeAtlasDependencies,
  collectWorkspaceProtocolLeaks,
  createCleanRoomDirectory,
  createPackDestination,
  expectCommandSuccess,
  extractTarballJsFiles,
  findPackedTarball,
  isForbiddenBootstrapPath,
  isPackedPathForbidden,
  listPackedBootstrapFiles,
  listTarballEntries,
  packedBootstrapFilePath,
  readPackedManifest,
  readTarballFile,
  runCommand,
} from "./helpers/pack-artifact";
import { getRepoRoot } from "./helpers/run-cli";
import { verifyGeneratedGitHook } from "./helpers/verify-generated-git-hook";
import type { PackagedBootstrapManifest } from "../bootstrap/schema";

const PACKAGE_ROOT = path.resolve(__dirname, "../..");
const PACK_TIMEOUT_MS = 180_000;
const MIN_NPM_NODE_MAJOR = 22;
const INCOMPLETE_NPM_PATTERN =
  /Cannot find module .*walk-up-path|npm ERR! code MODULE_NOT_FOUND|valid "main" entry/i;
const ALREADY_PUBLISHED_PATTERN = /cannot publish over the previously published versions/i;

interface NpmPublishInvocation {
  command: string;
  prefixArgs: string[];
  env?: NodeJS.ProcessEnv;
}

function nodeMajorFromPath(filePath: string): number | null {
  const match = filePath.match(/[/\\]v(\d+)\.\d+/);
  return match ? Number(match[1]) : null;
}

function withNodeBinFirst(binDir: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
  };
}

/**
 * Collect npm CLIs from Node >= 22 installs. PATH `npm` can resolve to an
 * older broken nvm copy; incomplete bundled installs are skipped at publish time.
 */
function collectNpmPublishCandidates(): NpmPublishInvocation[] {
  const candidates: (NpmPublishInvocation & { rank: number })[] = [];
  const seen = new Set<string>();

  const add = (candidate: NpmPublishInvocation, rank: number) => {
    const key = `${candidate.command}\0${candidate.prefixArgs.join("\0")}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    candidates.push({ ...candidate, rank });
  };

  const nodeBinDir = path.dirname(process.execPath);
  const currentMajor = Number(process.versions.node.split(".")[0]);
  const adjacentNpmCli = path.resolve(nodeBinDir, "../lib/node_modules/npm/bin/npm-cli.js");
  if (currentMajor >= MIN_NPM_NODE_MAJOR && existsSync(adjacentNpmCli)) {
    add(
      {
        command: process.execPath,
        prefixArgs: [adjacentNpmCli],
        env: withNodeBinFirst(nodeBinDir),
      },
      currentMajor
    );
  }

  const versionsRoot = path.resolve(nodeBinDir, "..", "..");
  if (existsSync(versionsRoot)) {
    for (const version of readdirSync(versionsRoot)) {
      const major = nodeMajorFromPath(`/${version}/`);
      if (major == null || major < MIN_NPM_NODE_MAJOR) {
        continue;
      }
      const binDir = path.join(versionsRoot, version, "bin");
      const nodeBin = path.join(binDir, "node");
      const npmCli = path.join(
        versionsRoot,
        version,
        "lib",
        "node_modules",
        "npm",
        "bin",
        "npm-cli.js"
      );
      if (existsSync(nodeBin) && existsSync(npmCli)) {
        add(
          {
            command: nodeBin,
            prefixArgs: [npmCli],
            env: withNodeBinFirst(binDir),
          },
          major
        );
      }
    }
  }

  add({ command: "npm", prefixArgs: [] }, MIN_NPM_NODE_MAJOR);

  return candidates
    .sort((left, right) => right.rank - left.rank)
    .map((candidate) => ({
      command: candidate.command,
      prefixArgs: candidate.prefixArgs,
      env: candidate.env,
    }));
}

function runNpmPublishDryRun() {
  const failures: string[] = [];

  for (const npm of collectNpmPublishCandidates()) {
    let result;
    try {
      result = runCommand(
        npm.command,
        [...npm.prefixArgs, "publish", "--dry-run", "--access", "public", "--ignore-scripts"],
        { cwd: PACKAGE_ROOT, env: npm.env }
      );
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
      continue;
    }

    const combined = `${result.stdout}\n${result.stderr}`;
    if (result.status === 0 || ALREADY_PUBLISHED_PATTERN.test(combined)) {
      return { result, combined };
    }
    if (INCOMPLETE_NPM_PATTERN.test(combined)) {
      failures.push(combined.trim());
      continue;
    }

    return { result, combined };
  }

  throw new Error(
    `Could not find a working npm executable for publish --dry-run\n${failures.join("\n---\n")}`
  );
}

function runInstalledAtlas(cleanRoom: string, args: string[], cwd = cleanRoom) {
  const bin = path.join(cleanRoom, "node_modules", ".bin", "atlas");
  return runCommand(bin, args, { cwd });
}

function readPackedBootstrapManifest(tarballPath: string): PackagedBootstrapManifest {
  return JSON.parse(
    readTarballFile(tarballPath, "package/assets/bootstrap/manifest.json")
  ) as PackagedBootstrapManifest;
}

describe("Atlas CLI pack and clean-room install", () => {
  const repoRoot = getRepoRoot();
  const cliVersion = readCliAtlasVersion();
  let tarballPath: string | undefined;
  let packDestination: string | undefined;
  let cleanRoom: string | undefined;
  let packedEntries: string[] = [];

  beforeAll(() => {
    packDestination = createPackDestination();
    // Pack the already-built dist. Do not invoke a rebuild here: `pnpm pack` with a
    // `prepack` rebuild would delete dist/ while other Jest workers spawn the CLI.
    expectCommandSuccess("pnpm", ["pack", "--pack-destination", packDestination], {
      cwd: PACKAGE_ROOT,
    });
    tarballPath = findPackedTarball(packDestination);
    packedEntries = listTarballEntries(tarballPath);
  }, PACK_TIMEOUT_MS);

  afterAll(() => {
    if (packDestination) {
      rmSync(packDestination, { recursive: true, force: true });
    }
    if (cleanRoom) {
      rmSync(cleanRoom, { recursive: true, force: true });
    }
  });

  it("packs the required executable surface and excludes repository-only files", () => {
    expect(tarballPath).toBeDefined();
    expect(packedEntries.length).toBeGreaterThan(0);

    for (const required of REQUIRED_PACKED_PATHS) {
      expect(packedEntries).toContain(required);
    }

    const forbidden = packedEntries
      .map((entry) => {
        const reason = isPackedPathForbidden(entry);
        return reason ? `${reason}: ${entry}` : undefined;
      })
      .filter((entry): entry is string => entry !== undefined);

    expect(forbidden).toEqual([]);
  });

  it("packs the bootstrap manifest and a manifest-driven asset tree", () => {
    expect(tarballPath).toBeDefined();
    const manifest = readPackedBootstrapManifest(tarballPath as string);
    const bootstrapFiles = listPackedBootstrapFiles(packedEntries);

    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.atlasVersion).toBe(cliVersion);
    expect(manifest.entries.length).toBeGreaterThan(0);
    expect(bootstrapFiles.sort()).toEqual(
      manifest.entries.map((entry) => entry.destination).sort()
    );

    for (const required of REQUIRED_BOOTSTRAP_FILE_PATHS) {
      expect(packedEntries).toContain(packedBootstrapFilePath(required));
      expect(manifest.entries.some((entry) => entry.destination === required)).toBe(true);
    }

    const forbiddenExact = bootstrapFiles.filter((file) =>
      (FORBIDDEN_BOOTSTRAP_EXACT_PATHS as readonly string[]).includes(file)
    );
    const forbiddenPrefixed = bootstrapFiles.filter((file) => isForbiddenBootstrapPath(file));

    expect(forbiddenExact).toEqual([]);
    expect(forbiddenPrefixed).toEqual([]);
    expect(bootstrapFiles.some((file) => file.startsWith("packages/ui/.storybook/"))).toBe(false);
    expect(bootstrapFiles).not.toContain("coverage-policy.json");
    expect(bootstrapFiles).not.toContain("docker-compose.yml");

    const capabilityManifest = JSON.parse(
      readTarballFile(tarballPath as string, "package/assets/capabilities/manifest.json")
    ) as { capabilities: { id: string; entries: { destination: string }[] }[] };
    expect(
      capabilityManifest.capabilities.some((capability) => capability.id === "storybook")
    ).toBe(true);
    expect(
      packedEntries.some((entry) =>
        entry.includes("assets/capabilities/files/storybook/packages/ui/.storybook/main.ts")
      )
    ).toBe(true);

    const consumerCi = readTarballFile(
      tarballPath as string,
      packedBootstrapFilePath(CONSUMER_CI_WORKFLOW_DESTINATION)
    );
    expect(consumerCi).toContain("runs-on: ubuntu-latest");
    expect(consumerCi).toContain("pnpm atlas doctor");
    expect(consumerCi).toContain("pnpm install --frozen-lockfile");
    expect(consumerCi).toMatch(/^\s+run: pnpm lint$/m);
    expect(consumerCi).toMatch(/^\s+run: pnpm typecheck$/m);
    expect(consumerCi).toMatch(/^\s+run: pnpm test$/m);
    expect(consumerCi).toMatch(/^\s+run: pnpm build$/m);
    expect(consumerCi).not.toMatch(/test:e2e/);
    expect(consumerCi).not.toContain("{{ATLAS_CLI_VERSION}}");
    for (const marker of MAINTAINER_CI_LEAK_MARKERS) {
      expect(consumerCi).not.toContain(marker);
    }

    const uiPackage = JSON.parse(
      readTarballFile(tarballPath as string, packedBootstrapFilePath("packages/ui/package.json"))
    ) as { scripts?: Record<string, string>; devDependencies?: Record<string, string> };
    expect(uiPackage.scripts?.storybook).toBeUndefined();
    expect(uiPackage.scripts?.["test:visual"]).toBeUndefined();
    expect(uiPackage.scripts?.prepare).toBeUndefined();
    expect(uiPackage.devDependencies?.["@playwright/test"]).toBeUndefined();
    expect(uiPackage.devDependencies?.storybook).toBeUndefined();
    expect(uiPackage.devDependencies?.husky).toBeUndefined();
    expect(uiPackage.scripts?.test).toBeDefined();

    const lighthouseConfig = readTarballFile(
      tarballPath as string,
      packedBootstrapFilePath("lighthouserc.json")
    );
    expect(lighthouseConfig).toContain("ci");
    const webPackage = JSON.parse(
      readTarballFile(tarballPath as string, packedBootstrapFilePath("apps/web/package.json"))
    ) as { scripts?: Record<string, string> };
    expect(webPackage.scripts?.["perf:lhci"]).toContain("../../lighthouserc.json");
  });

  it("packs production release assets and excludes rehearsal snapshots", () => {
    expect(tarballPath).toBeDefined();
    const catalog = JSON.parse(
      readTarballFile(tarballPath as string, "package/assets/releases/catalog.json")
    ) as {
      current: string;
      supportedVersions: string[];
      rehearsalOnlyVersions: string[];
    };

    expect(catalog.current).toBe(cliVersion);
    expect(catalog.supportedVersions).toContain(cliVersion);
    expect(catalog.supportedVersions).not.toContain("0.1.0");
    expect(catalog.supportedVersions).not.toContain("0.2.0");
    expect(catalog.rehearsalOnlyVersions).toEqual(["0.1.0", "0.2.0"]);
    expect(packedEntries).toContain("package/README.md");
    expect(packedEntries).toContain("package/THIRD_PARTY_NOTICES.md");
    const packedReadme = readTarballFile(tarballPath as string, "package/README.md");
    expect(packedReadme).toContain("pnpm dlx @blitzcraftlabs/atlas init my-app");
    expect(packedReadme).not.toContain("Atlas is not on the npm registry yet");
    expect(packedReadme).not.toContain("after the first npm publication");
    expect(packedReadme).not.toContain("publication path is finalized");
    expect(packedEntries).toContain(`package/assets/releases/${cliVersion}/release.snapshot.json`);
    expect(packedEntries.some((entry) => entry.includes("assets/releases/0.1.0"))).toBe(false);
    expect(packedEntries.some((entry) => entry.includes("assets/releases/0.2.0"))).toBe(false);
    expect(packedEntries.some((entry) => entry.startsWith("package/src/"))).toBe(false);
    expect(
      packedEntries.some(
        (entry) => entry.startsWith("package/src/") && entry.includes("/__tests__/")
      )
    ).toBe(false);
  });

  it("does not leak workspace protocol or unpublished Atlas runtime dependencies", () => {
    expect(tarballPath).toBeDefined();
    const manifest = readPackedManifest(tarballPath as string);

    expect(manifest.name).toBe(CLI_PACKAGE_NAME);
    expect(manifest.version).toBe(cliVersion);
    expect(manifest.private).not.toBe(true);
    expect(manifest.bin?.atlas).toBe("./dist/cli.js");
    expect(manifest.publishConfig?.access).toBe("public");
    expect(manifest.repository?.url).toContain("github.com/blitzcraftlabs/atlas");
    expect(manifest.repository?.directory).toBe("packages/cli");
    expect(manifest.homepage).toBe("https://shipwithatlas.com");
    expect(manifest.bugs?.url).toBe("https://github.com/blitzcraftlabs/atlas/issues");
    expect(manifest.license).toBe("Apache-2.0");
    expect(manifest.engines?.node).toContain("22");
    expect(manifest.description).toContain("Source-owned frontend platform CLI");
    expect(manifest.keywords).toEqual([
      "atlas",
      "nextjs",
      "react",
      "typescript",
      "frontend",
      "platform",
      "cli",
      "scaffolding",
      "codegen",
      "architecture",
      "pnpm",
    ]);
    expect(collectWorkspaceProtocolLeaks(manifest)).toEqual([]);
    expect(collectRuntimeAtlasDependencies(manifest)).toEqual([]);
    expect(manifest.dependencies?.["@atlas/project"]).toBeUndefined();
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual(
      ["minimatch", "typescript", "yaml", "zod"].sort()
    );
  });

  it("is accepted by npm publish --dry-run --access public without authentication", () => {
    const { result, combined } = runNpmPublishDryRun();
    try {
      const alreadyPublished = ALREADY_PUBLISHED_PATTERN.test(combined);
      if (result.status !== 0 && !alreadyPublished) {
        throw new Error(
          `npm publish --dry-run failed (${result.status})\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
        );
      }
      expect(combined).not.toMatch(/ENEEDAUTH|npm ERR! code ENEEDAUTH/i);
      expect(combined).toContain(CLI_PACKAGE_NAME);
      expect(combined).not.toMatch(/This package has been marked as private/i);
    } finally {
      for (const name of readdirSync(PACKAGE_ROOT)) {
        if (name.endsWith(".tgz")) {
          rmSync(path.join(PACKAGE_ROOT, name), { force: true });
        }
      }
    }
  });

  it("does not leave unresolved unpublished Atlas imports in packed runtime JS", () => {
    expect(tarballPath).toBeDefined();
    const jsFiles = extractTarballJsFiles(tarballPath as string).filter((file) =>
      file.path.startsWith("package/dist/")
    );
    expect(jsFiles.map((file) => file.path).sort()).toEqual(
      [
        "package/dist/bootstrap-assets.js",
        "package/dist/cli.js",
        "package/dist/dependency-validation.js",
        "package/dist/index.js",
        "package/dist/release-assets.js",
      ].sort()
    );

    const leaks: string[] = [];
    for (const file of jsFiles) {
      const specifiers = extractStaticModuleSpecifiers(file.path, file.content);
      for (const specifier of specifiers) {
        const packageName = packageRootFromSpecifier(specifier.specifier);
        if (packageName?.startsWith("@atlas/")) {
          leaks.push(`${file.path}:${specifier.line} ${specifier.specifier}`);
        }
      }
    }

    expect(leaks).toEqual([]);

    const cliJs = jsFiles.find((file) => file.path === "package/dist/cli.js");
    expect(cliJs?.content.startsWith("#!/usr/bin/env node\n")).toBe(true);
    expect(cliJs?.content.startsWith("#!/usr/bin/env node\n#!/usr/bin/env node")).toBe(false);
  });

  it(
    "installs the tarball outside the repository and runs the packed atlas binary",
    () => {
      expect(tarballPath).toBeDefined();
      cleanRoom = createCleanRoomDirectory(repoRoot);

      expectCommandSuccess("pnpm", ["add", tarballPath as string], {
        cwd: cleanRoom,
      });

      const bin = path.join(cleanRoom, "node_modules", ".bin", "atlas");
      expect(existsSync(bin)).toBe(true);
      expect(statSync(bin).mode & 0o111).not.toBe(0);

      const installedPackage = path.join(cleanRoom, "node_modules", "@blitzcraftlabs", "atlas");
      expect(existsSync(installedPackage)).toBe(true);
      expect(realpathSync(installedPackage)).not.toBe(realpathSync(PACKAGE_ROOT));
      expect(realpathSync(bin).startsWith(realpathSync(PACKAGE_ROOT) + path.sep)).toBe(false);

      const help = runInstalledAtlas(cleanRoom, ["--help"]);
      expect(help.status).toBe(0);
      expect(help.stdout).toContain("Atlas CLI");
      expect(help.stdout).toContain("generate");

      const version = runInstalledAtlas(cleanRoom, ["--version"]);
      expect(version.status).toBe(0);
      expect(version.stdout.trim()).toBe(cliVersion);
      expect(version.stdout.trim()).not.toBe("0.0.0");

      const generateHelp = runInstalledAtlas(cleanRoom, ["generate", "--help"]);
      expect(generateHelp.status).toBe(0);
      expect(generateHelp.stdout).toContain("atlas generate");

      const generateList = runInstalledAtlas(cleanRoom, ["generate", "list"]);
      expect(generateList.status).toBe(0);
      expect(generateList.stdout).toContain("feature");
      expect(generateList.stdout).toContain("page");

      const resolverPath = path.join(installedPackage, "dist", "bootstrap-assets.js");
      expect(existsSync(resolverPath)).toBe(true);

      const installedLookup = runCommand(
        process.execPath,
        [
          "-e",
          `
const path = require("path");
const resolver = require(${JSON.stringify(resolverPath)});
const root = resolver.findBootstrapAssetRoot();
const manifest = resolver.readBootstrapManifest(root);
const web = resolver.resolveBootstrapAsset("apps/web/package.json", root);
const ui = resolver.resolveBootstrapAsset("packages/ui/package.json", root);
const consent = resolver.resolveBootstrapAsset("packages/consent/package.json", root);
const config = resolver.resolveBootstrapAsset("packages/config/package.json", root);
const workspace = resolver.resolveBootstrapAsset("pnpm-workspace.yaml", root);
process.stdout.write(JSON.stringify({
  root,
  atlasVersion: manifest.atlasVersion,
  entryCount: manifest.entries.length,
  destinations: {
    web: web.absolutePath,
    ui: ui.absolutePath,
    consent: consent.absolutePath,
    config: config.absolutePath,
    workspace: workspace.absolutePath
  }
}));
`,
        ],
        { cwd: repoRoot }
      );
      expect(installedLookup.status).toBe(0);
      const resolved = JSON.parse(installedLookup.stdout) as {
        root: string;
        atlasVersion: string;
        entryCount: number;
        destinations: Record<string, string>;
      };

      const installedRoot = realpathSync(installedPackage);
      const repoReal = realpathSync(repoRoot);
      expect(resolved.atlasVersion).toBe(cliVersion);
      expect(resolved.entryCount).toBeGreaterThan(0);
      expect(realpathSync(resolved.root).startsWith(installedRoot)).toBe(true);
      expect(realpathSync(resolved.root).startsWith(`${repoReal}${path.sep}`)).toBe(false);

      for (const absolutePath of Object.values(resolved.destinations)) {
        expect(existsSync(absolutePath)).toBe(true);
        expect(realpathSync(absolutePath).startsWith(installedRoot)).toBe(true);
        expect(realpathSync(absolutePath).startsWith(`${repoReal}${path.sep}`)).toBe(false);
      }

      const init = runInstalledAtlas(cleanRoom, ["init", "test-app"], cleanRoom);
      expect(init.status).toBe(0);
      expect(init.stdout).toContain("Atlas project created");

      const generatedRoot = path.join(cleanRoom, "test-app");
      expect(existsSync(generatedRoot)).toBe(true);
      expect(realpathSync(generatedRoot).startsWith(`${repoReal}${path.sep}`)).toBe(false);
      expect(realpathSync(generatedRoot).startsWith(realpathSync(cleanRoom))).toBe(true);
      expect(existsSync(path.join(generatedRoot, "apps/web/package.json"))).toBe(true);
      expect(existsSync(path.join(generatedRoot, "packages/ui/package.json"))).toBe(true);
      expect(existsSync(path.join(generatedRoot, "packages/consent/package.json"))).toBe(true);
      expect(existsSync(path.join(generatedRoot, "packages/config/package.json"))).toBe(true);
      expect(existsSync(path.join(generatedRoot, "atlas.config.json"))).toBe(true);
      expect(existsSync(path.join(generatedRoot, "package.json"))).toBe(true);
      expect(existsSync(path.join(generatedRoot, CONSUMER_CI_WORKFLOW_DESTINATION))).toBe(true);
      const generatedCi = readFileSync(
        path.join(generatedRoot, CONSUMER_CI_WORKFLOW_DESTINATION),
        "utf8"
      );
      expect(generatedCi).toContain("runs-on: ubuntu-latest");
      expect(generatedCi).toContain("pnpm atlas doctor");
      for (const marker of MAINTAINER_CI_LEAK_MARKERS) {
        expect(generatedCi).not.toContain(marker);
      }
      expect(existsSync(path.join(generatedRoot, "apps/reference"))).toBe(false);
      expect(existsSync(path.join(generatedRoot, "packages/cli"))).toBe(false);
      expect(existsSync(path.join(generatedRoot, "pnpm-lock.yaml"))).toBe(false);

      const generatedContract = JSON.parse(
        readFileSync(path.join(generatedRoot, "atlas.config.json"), "utf8")
      ) as { platform?: { baseline?: { atlasVersion: string } } };
      expect(generatedContract.platform?.baseline?.atlasVersion).toBe(cliVersion);

      const generatedPackage = JSON.parse(
        readFileSync(path.join(generatedRoot, "package.json"), "utf8")
      ) as { name: string; version: string; scripts: Record<string, string> };
      expect(generatedPackage.name).toBe("test-app");
      expect(generatedPackage.version).toBe("0.1.0");
      expect(generatedPackage.version).not.toBe(cliVersion);
      expect(generatedPackage.scripts["api:gen"]).toBe("pnpm --filter @atlas/web api:gen");
      expect(generatedPackage.scripts.atlas).toBe("atlas");
      expect(generatedPackage.scripts["template:check"]).toBeUndefined();
      expect(generatedPackage.scripts["template:sync"]).toBeUndefined();
      expect(generatedPackage.scripts["api:check"]).toBeUndefined();

      const generatedReadme = readFileSync(path.join(generatedRoot, "README.md"), "utf8");
      expect(generatedReadme).toContain("pnpm install");
      expect(generatedReadme).toContain("pnpm dev");
      expect(generatedReadme).toContain("pnpm atlas doctor");
      expect(generatedReadme).toContain("pnpm dlx @blitzcraftlabs/atlas init");
      expect(generatedReadme).not.toContain(`pnpm dlx @blitzcraftlabs/atlas@${cliVersion} doctor`);
      expect(generatedReadme).not.toContain("pnpm atlas -- doctor");
      expect(generatedReadme).not.toContain("publication path is finalized");

      expect(init.stdout).toContain("pnpm install");
      expect(init.stdout).toContain("pnpm dev");
      expect(init.stdout).toContain("pnpm atlas doctor");
      expect(init.stdout).not.toContain(`pnpm dlx @blitzcraftlabs/atlas@${cliVersion} doctor`);
      expect(init.stdout).not.toContain("pnpm atlas -- doctor");
      expect(init.stdout).not.toContain("publication path is finalized");

      const context = runInstalledAtlas(
        cleanRoom,
        ["context", "--json", "--cwd", generatedRoot],
        generatedRoot
      );
      expect(context.status).toBe(0);
      const contextPayload = JSON.parse(context.stdout) as {
        ok: boolean;
        result: {
          atlasVersion: string;
          workspaceKind: string;
          validation?: { recommended?: { id: string }[] };
        };
      };
      expect(contextPayload.result.atlasVersion).toBe(cliVersion);
      expect(contextPayload.result.atlasVersion).not.toBe(generatedPackage.version);
      expect(contextPayload.result.workspaceKind).toBe("consumer");
      expect(
        (contextPayload.result.validation?.recommended ?? []).some(
          (entry: { id: string }) => entry.id === "reference-e2e" || entry.id === "governance-check"
        )
      ).toBe(false);

      const generatedAgents = readFileSync(path.join(generatedRoot, "AGENTS.md"), "utf8");
      expect(generatedAgents).toContain("pnpm atlas context --json");
      expect(generatedAgents).not.toContain("pnpm dlx @blitzcraftlabs/atlas@");
      expect(generatedAgents).not.toContain("pnpm --filter @blitzcraftlabs/atlas build");

      const shippedLighthouse = readFileSync(
        path.resolve(__dirname, "fixtures/shipped-1.1.0/lighthouserc.json"),
        "utf8"
      );
      writeFileSync(path.join(generatedRoot, "lighthouserc.json"), shippedLighthouse);
      const dryPerf = runInstalledAtlas(
        cleanRoom,
        ["enable", "perf-ci", "--dry-run", "--json", "--cwd", generatedRoot],
        generatedRoot
      );
      expect(dryPerf.status).toBe(0);
      expect(readFileSync(path.join(generatedRoot, "lighthouserc.json"), "utf8")).toBe(
        shippedLighthouse
      );

      const enablePerf = runInstalledAtlas(
        cleanRoom,
        ["enable", "perf-ci", "--cwd", generatedRoot],
        generatedRoot
      );
      expect(enablePerf.status).toBe(0);
      const lighthouse = JSON.parse(
        readFileSync(path.join(generatedRoot, "lighthouserc.json"), "utf8")
      ) as {
        ci: { collect: { settings: { chromeFlags: unknown; skipAudits: string[] } } };
      };
      expect(lighthouse.ci.collect.settings.chromeFlags).toBe(
        "--no-sandbox --disable-gpu --headless=new"
      );
      expect(lighthouse.ci.collect.settings.skipAudits).toEqual([
        "uses-http2",
        "uses-long-cache-ttl",
      ]);
      const bundleWorkflow = readFileSync(
        path.join(generatedRoot, ".github/workflows/perf-bundle.yml"),
        "utf8"
      );
      expect(bundleWorkflow).toMatch(
        /github\.event\.pull_request\.head\.repo\.full_name\s*==\s*\n?\s*github\.repository/
      );
      expect(bundleWorkflow).not.toContain("pull_request_target");

      const enableHooks = runInstalledAtlas(
        cleanRoom,
        ["enable", "hooks", "--cwd", generatedRoot],
        generatedRoot
      );
      expect(enableHooks.status).toBe(0);
      expect(existsSync(path.join(generatedRoot, "scripts/lint-staged-eslint.mjs"))).toBe(true);
      verifyGeneratedGitHook(generatedRoot);

      const enableSecurity = runInstalledAtlas(
        cleanRoom,
        ["enable", "security", "--cwd", generatedRoot],
        generatedRoot
      );
      expect(enableSecurity.status).toBe(0);
      const packedAuditScript = path.join(generatedRoot, "scripts/security-audit.mjs");
      expect(existsSync(packedAuditScript)).toBe(true);
      const metadataNullPath = path.join(generatedRoot, "audit-metadata-null.json");
      writeFileSync(metadataNullPath, `${JSON.stringify({ metadata: null })}\n`);
      const metadataNull = runCommand(process.execPath, [
        packedAuditScript,
        "--audit-json",
        metadataNullPath,
      ]);
      expect(metadataNull.status).toBe(1);
      expect(metadataNull.stderr).toContain("metadata must be an object");
      const metadataHighPath = path.join(generatedRoot, "audit-metadata-high.json");
      writeFileSync(
        metadataHighPath,
        `${JSON.stringify({ metadata: { vulnerabilities: { high: 1, critical: 0 } } })}\n`
      );
      const metadataHigh = runCommand(process.execPath, [
        packedAuditScript,
        "--audit-json",
        metadataHighPath,
      ]);
      expect(metadataHigh.status).toBe(1);
      expect(metadataHigh.stderr).toMatch(/no evaluable high\/critical findings/);

      const emptyAdvisoryPath = path.join(generatedRoot, "audit-empty-advisory.json");
      writeFileSync(emptyAdvisoryPath, `${JSON.stringify({ advisories: { "1": {} } })}\n`);
      const emptyAdvisory = runCommand(process.execPath, [
        packedAuditScript,
        "--audit-json",
        emptyAdvisoryPath,
      ]);
      expect(emptyAdvisory.status).toBe(1);
      expect(emptyAdvisory.stdout).not.toContain("No blocking high/critical advisories");

      const emptyViaHighPath = path.join(generatedRoot, "audit-empty-via-high.json");
      writeFileSync(
        emptyViaHighPath,
        `${JSON.stringify({ vulnerabilities: { example: { severity: "high", via: [] } } })}\n`
      );
      const emptyViaHigh = runCommand(process.execPath, [
        packedAuditScript,
        "--audit-json",
        emptyViaHighPath,
      ]);
      expect(emptyViaHigh.status).toBe(1);
      expect(emptyViaHigh.stderr).toMatch(/no evaluable advisory entries/);
      expect(emptyViaHigh.stdout).not.toContain("No blocking high/critical advisories");

      const lhciPath = "node_modules/@lhci/cli>tmp";
      const otherPath = "node_modules/@turbo/gen>inquirer>tmp";
      const tmpAdvisory = {
        github_advisory_id: "GHSA-ph9p-34f9-6g65",
        module_name: "tmp",
        severity: "high",
        title: "tmp advisory",
        url: "https://github.com/advisories/GHSA-ph9p-34f9-6g65",
      };
      const runPackedAudit = (name: string, document: unknown) => {
        const filePath = path.join(generatedRoot, name);
        writeFileSync(filePath, `${JSON.stringify(document)}\n`);
        return runCommand(process.execPath, [packedAuditScript, "--audit-json", filePath]);
      };
      const lhciFirst = runPackedAudit("audit-lhci-first.json", {
        advisories: {
          "1": {
            ...tmpAdvisory,
            findings: [
              { version: "0.0.33", paths: [lhciPath] },
              { version: "0.0.33", paths: [otherPath] },
            ],
          },
        },
      });
      const otherFirst = runPackedAudit("audit-other-first.json", {
        advisories: {
          "1": {
            ...tmpAdvisory,
            findings: [
              { version: "0.0.33", paths: [otherPath] },
              { version: "0.0.33", paths: [lhciPath] },
            ],
          },
        },
      });
      expect(lhciFirst.status).toBe(1);
      expect(otherFirst.status).toBe(1);
      expect(lhciFirst.stdout).not.toContain("No blocking high/critical advisories");
      expect(otherFirst.stdout).not.toContain("No blocking high/critical advisories");

      const enableList = runInstalledAtlas(
        cleanRoom,
        ["enable", "list", "--json", "--cwd", generatedRoot],
        generatedRoot
      );
      expect(enableList.status).toBe(0);
      const enablePayload = JSON.parse(enableList.stdout) as {
        ok: boolean;
        result: { capabilities: { id: string; status: string }[] };
      };
      expect(
        enablePayload.result.capabilities.some(
          (entry) => entry.id === "storybook" && entry.status === "absent"
        )
      ).toBe(true);

      const enableCoverage = runInstalledAtlas(
        cleanRoom,
        ["enable", "coverage", "--cwd", generatedRoot],
        generatedRoot
      );
      expect(enableCoverage.status).toBe(0);
      expect(existsSync(path.join(generatedRoot, "coverage-policy.json"))).toBe(true);

      expect(existsSync(path.join(generatedRoot, "releases"))).toBe(false);

      const releaseResolverPath = path.join(installedPackage, "dist", "release-assets.js");
      expect(existsSync(releaseResolverPath)).toBe(true);
      const releaseLookup = runCommand(
        process.execPath,
        [
          "-e",
          `
const path = require("path");
const resolver = require(${JSON.stringify(releaseResolverPath)});
const root = resolver.findReleaseAssetRoot();
const catalog = resolver.readPackagedReleaseCatalog(root);
process.stdout.write(JSON.stringify({ root, catalog }));
`,
        ],
        { cwd: generatedRoot }
      );
      expect(releaseLookup.status).toBe(0);
      const releaseResolved = JSON.parse(releaseLookup.stdout) as {
        root: string;
        catalog: { current: string; supportedVersions: string[] };
      };
      expect(realpathSync(releaseResolved.root).startsWith(installedRoot)).toBe(true);
      expect(realpathSync(releaseResolved.root).startsWith(`${repoReal}${path.sep}`)).toBe(false);
      expect(releaseResolved.catalog.current).toBe(cliVersion);
      expect(releaseResolved.catalog.supportedVersions).not.toContain("0.1.0");

      const unsupported = runInstalledAtlas(
        cleanRoom,
        ["upgrade", "--to", "9.9.9", "--dry-run", "--json", "--cwd", generatedRoot],
        generatedRoot
      );
      expect(unsupported.status).not.toBe(0);
      expect(`${unsupported.stdout}\n${unsupported.stderr}`).toMatch(
        /Unsupported target Atlas release 9\.9\.9|No matching version found for @blitzcraftlabs\/atlas@9\.9\.9/
      );
    },
    PACK_TIMEOUT_MS
  );
});
